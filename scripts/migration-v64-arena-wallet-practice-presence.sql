-- ============================================================================
-- migration-v64-arena-wallet-practice-presence.sql
--
-- Fixes the four live 1v1 defects found in browser QA, plus the two pieces the
-- new War Hall UI needs. Applied with the Management API; idempotent on re-run
-- (arena.write is claimed at the very top, BEFORE anything else, so the
-- migration's own writes do not trip the guard triggers it installs).
--
--   1. WALLET TRUTH — the escrow DEBIT and the settlement RELEASE now both
--      reach the screen.
--      * v63 only returned `breakdown[].balance` when the release was non-zero.
--        A LOSS releases 0, so the loser's row came back `balance: null` and the
--        client silently kept the pre-match number: "the history says -2 SC but
--        my wallet never moved". The balance is now ALWAYS populated.
--      * The hold taken at create was never surfaced either, so the SC pill was
--        stale for the whole 90 seconds. create/enqueue now return `balance`.
--   2. HISTORY TRUTH — `duels.delta` stored the RELEASE, not the net movement.
--      A timed loss wrote `outcome='loss', delta=0` while a draw wrote
--      `outcome='draw', delta=+stake`, so the two disagreed and the UI coloured
--      a red loss row green ("0 SC"). Delta is now NET (release - stake), which
--      is +stake / -stake / 0, and the existing arena rows are backfilled.
--   3. DEAD MATCHES — `_arena_sweep()` could only run when an arena RPC was
--      called, so if BOTH players closed their tab the row stayed `active` and
--      the pot stayed escrowed forever. api/session.js `touch` now sweeps (it
--      fires every 60s for every signed-in user). A match where only one side
--      ever readies is also expired, which nothing did before.
--   4. GRACE 45s -> 15s, and `arena_presence` gives the scholars list a real
--      availability signal (available / in a match / offline + last seen).
--   5. FREE PRACTICE — tutor matches cost no coins (stake 0), which requires
--      widening the `competitive_matches.stake` CHECK (v38 pinned it to
--      1|2|5|10|20) and moving the arena seal off `escrow_amount > 0` onto
--      `format = 'blitz'` — otherwise a 0-stake practice match would fall
--      OUTSIDE the seal and stay mutable by the legacy blitz path.
--
-- Verified against the live project. See AGENTS.md for the full record.
-- ============================================================================

-- The migration writes to arena-owned tables (competitive_matches updates,
-- duels updates). Claim the write scope BEFORE the first write.
select public._arena_claim_write();

-- ============================================================================
-- 1. CONFIG — shorter reconnect grace + an availability window.
-- ============================================================================
update public.server_config
   set value = value
      || jsonb_build_object('grace_seconds', 15, 'presence_window_seconds', 90)
      || jsonb_build_object('stake_fixed', 2, 'practice_stake', 0)
  , updated_at = now()
 where key = 'arena_rules';

-- ============================================================================
-- 2. STAKE 0 (FREE PRACTICE) — widen the v38 CHECK.
--
-- Practice is arena-only: a stake of 0 is legal on a blitz match and nowhere
-- else, so the legacy sudden-death path can never mint a coinless duel.
-- ============================================================================
alter table public.competitive_matches
  drop constraint if exists competitive_matches_stake_check;
alter table public.competitive_matches
  add constraint competitive_matches_stake_check
  check (stake > 0 or (stake = 0 and format = 'blitz'));

-- ============================================================================
-- 3. THE SEAL — arena-owned means format = 'blitz', not escrow_amount > 0.
--
-- With free practice a match can have escrow_amount = 0, which the old
-- predicate read as "not an arena match". Both guards now test the format, so
-- a practice match is sealed exactly like a wagered one.
-- ============================================================================
create or replace function public._arena_guard_match_upd()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(old.format, 'sudden_death') = 'blitz'
     and coalesce(current_setting('arena.write', true), '') <> '1' then
    raise exception 'ARENA_REQUIRES_ARENA_RPC' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public._arena_guard_answers()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid := coalesce(new.match_id, old.match_id);
  v_format text;
begin
  select cm.format into v_format
  from public.competitive_matches cm where cm.id = v_id;

  if coalesce(v_format, 'sudden_death') = 'blitz'
     and coalesce(current_setting('arena.write', true), '') <> '1' then
    raise exception 'ARENA_REQUIRES_ARENA_RPC' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

-- ============================================================================
-- 4. PRESENCE — the signal the scholars list needs.
--
-- One row per scholar, touched by the arena RPCs, by the roster poll itself
-- and by the session heartbeat, so "online" means "signed in and active in the
-- last ~90 seconds". RLS on with no policies: service-role only.
-- ============================================================================
create table if not exists public.arena_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_arena_presence_seen
  on public.arena_presence (last_seen_at desc);

alter table public.arena_presence enable row level security;
revoke all on public.arena_presence from public, anon, authenticated;
grant all on public.arena_presence to service_role;

create or replace function public._arena_touch_presence(p_user uuid)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.arena_presence (user_id, last_seen_at)
  values (p_user, now())
  on conflict (user_id) do update set last_seen_at = now();
$$;

-- ============================================================================
-- 5. SETTLEMENT — always return a balance, and record NET deltas.
--
-- Identical to v63 except:
--   * `balance` is read from profiles even when nothing was released (a loss),
--     so breakdown[].balance is never null for a real player.
--   * the history row stores the NET movement (release - stake) and a
--     transaction_type that matches the outcome, so 'win'/'loss'/'draw' and the
--     signed delta can never contradict each other again.
--   * a stake-0 practice match writes NO history row, NO stats and moves NO
--     coins.
-- ============================================================================
create or replace function public._arena_resolve(
  p_match_id uuid,
  p_reason   text,
  p_leaver   uuid default null,
  p_actor    uuid default null,
  p_force    boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_match_key text;
  v_players uuid[];
  v_p uuid;
  v_bot_id uuid;
  v_s1 jsonb;
  v_s2 jsonb;
  v_score jsonb;
  v_res jsonb;
  v_req uuid;
  v_release int;
  v_oc text;
  v_delta int;
  v_settled boolean;
  v_bal jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_winner uuid := null;
  v_draw boolean := false;
  v_name text;
  v_opp_id uuid;
  v_status text;
  v_reason text;
  v_settled_count int := 0;
  v_stake int;
begin
  -- Re-read under a per-match advisory lock.
  v_match_key := 'arena_match:' || p_match_id::text;
  perform pg_advisory_xact_lock(hashtext(v_match_key));

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  v_stake := coalesce(v_m.stake, 0);

  -- Terminal replay: the stored verdict wins, nothing moves twice.
  if v_m.status in ('completed', 'abandoned') then
    return jsonb_build_object(
      'ok', true, 'replay', true, 'matchId', p_match_id,
      'status', v_m.status, 'outcome', v_m.outcome,
      'breakdown', coalesce(v_m.outcome -> 'breakdown', '[]'::jsonb),
      'draw', coalesce((v_m.outcome ->> 'draw')::boolean, false),
      'winnerId', v_m.outcome -> 'winnerId',
      'reason', coalesce(v_m.abandon_reason, v_m.outcome ->> 'reason'),
      'youWon', (v_m.winner_id is not null and v_m.winner_id = v_user),
      'myDelta', coalesce(v_m.outcome -> 'deltas' ->> v_user::text, '0')::int,
      'myOutcome', coalesce(v_m.outcome -> 'outcomes' ->> v_user::text, 'draw'),
      'balance', (select smart_coins from public.profiles where id = v_user));
  end if;

  if p_reason = 'time' and not p_force then
    if v_m.starts_at is null then
      return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_STARTED');
    end if;
    if now() < v_m.ends_at then
      return jsonb_build_object(
        'ok', false, 'error', 'BLITZ_NOT_ENDED', 'matchId', p_match_id,
        'endsAt', v_m.ends_at,
        'remainingMs', (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint);
    end if;
  end if;
  if p_reason in ('cancel', 'no_show') and v_m.starts_at is not null
     and not p_force then
    return jsonb_build_object('ok', false, 'error', 'MATCH_ALREADY_STARTED');
  end if;
  if p_reason in ('forfeit', 'grace_expired')
     and v_m.status not in ('ready', 'active') then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FORFEITABLE',
                              'status', v_m.status);
  end if;

  v_players := public._arena_players(v_m);
  v_bot_id := case when v_m.opponent_bot is not null
                   then public._arena_bot_id(v_m.opponent_bot) else null end;

  -- 4.1 Scorecards. Identical query for humans and bots.
  if v_m.opponent_bot is not null then
    v_s1 := public._arena_score(p_match_id, v_players[1]);
    v_s2 := public._arena_score(p_match_id, v_bot_id);
  else
    v_s1 := public._arena_score(p_match_id, v_players[1]);
    v_s2 := public._arena_score(p_match_id, v_players[2]);
  end if;

  -- 4.2 Verdict (unchanged: points DESC, correct DESC, else DRAW).
  if p_reason = 'time' then
    if (v_s1 ->> 'points')::int > (v_s2 ->> 'points')::int then
      v_winner := v_players[1];
    elsif (v_s1 ->> 'points')::int < (v_s2 ->> 'points')::int then
      if v_m.opponent_bot is not null then
        v_winner := null; v_draw := false;
      else
        v_winner := v_players[2];
      end if;
    elsif (v_s1 ->> 'correct')::int > (v_s2 ->> 'correct')::int then
      v_winner := v_players[1];
    elsif (v_s1 ->> 'correct')::int < (v_s2 ->> 'correct')::int then
      if v_m.opponent_bot is not null then
        v_winner := null; v_draw := false;
      else
        v_winner := v_players[2];
      end if;
    else
      v_draw := true;
    end if;
    v_status := 'completed';
    v_reason := 'time';
  elsif p_reason in ('forfeit', 'grace_expired') then
    v_status := 'abandoned';
    v_reason := p_reason;
  else
    v_status := 'abandoned';
    v_reason := p_reason;
    v_draw := true;
  end if;

  -- 4.3 Release the escrow.
  foreach v_p in array v_players loop
    v_score := public._arena_score(p_match_id, v_p);
    v_release := 0;
    v_oc := 'draw';

    if p_reason = 'time' then
      if v_draw then
        v_release := v_stake; v_oc := 'draw';
      elsif v_winner = v_p then
        v_release := v_stake * 2; v_oc := 'win';
      else
        v_release := 0; v_oc := 'loss';
      end if;
    elsif p_reason in ('forfeit', 'grace_expired') then
      if v_p = p_leaver then
        v_release := 0; v_oc := 'loss';
      else
        v_release := v_stake; v_oc := 'draw';   -- refunded
      end if;
    else
      v_release := v_stake; v_oc := 'draw';     -- cancelled: refund both
    end if;

    -- The stake was debited at create, so the NET movement is the release
    -- minus what was held: +stake / -stake / 0.
    v_delta := v_release - v_stake;

    v_settled := true;
    v_bal := to_jsonb(coalesce(
      (select p2.smart_coins from public.profiles p2 where p2.id = v_p), 0));

    if v_stake > 0 and v_release <> 0 then
      v_res := public._arena_release(
        p_match_id, v_p, v_release,
        case when v_release > v_stake then 'arena_win'
             when p_reason in ('forfeit', 'grace_expired') then 'arena_forfeit_refund'
             else 'arena_refund' end,
        case when p_reason = 'time' and v_oc = 'win' then 'earn' else 'refund' end,
        jsonb_build_object('stake', v_stake, 'reason', p_reason,
                           'outcome', v_oc, 'points', v_score -> 'points'));
      v_settled := coalesce((v_res ->> 'ok')::boolean, false);
      if v_settled then
        -- The release moved the balance, so re-read it rather than trusting the
        -- pre-release value.
        v_bal := to_jsonb(coalesce(
          (v_res ->> 'balanceAfter')::int,
          (select p2.smart_coins from public.profiles p2 where p2.id = v_p), 0));
      end if;
      if v_settled then v_settled_count := v_settled_count + 1; end if;
    end if;

    -- Opponent identity for the history row.
    if v_p = v_m.creator_id then
      v_opp_id := v_m.opponent_id;
      v_name := public._arena_name(v_m, v_m.opponent_id);
    else
      v_opp_id := v_m.creator_id;
      v_name := public._arena_name(v_m, v_m.creator_id);
    end if;

    -- A free practice match is not a duel: no history row, no stats, no coins.
    if v_stake > 0 then
      v_req := md5('arena:history:' || p_match_id::text || ':' || v_p::text)::uuid;
      insert into public.duels
        (user_id, opponent, opponent_id, mode, stake, outcome, delta,
         transaction_type, client_request_id)
      values
        (v_p, v_name, v_opp_id, v_m.match_type, v_stake, v_oc, v_delta,
         case when v_oc = 'win' then 'duel_win'
              when v_oc = 'loss' then 'duel_loss'
              else 'duel_draw' end, v_req);
    end if;

    -- Verified competitive stats ONLY for a fully-played, WAGERED HUMAN duel.
    if v_stake > 0
       and v_m.opponent_id is not null
       and coalesce((v_score ->> 'answers')::int, 0) > 0
       and p_reason = 'time'
       and (v_s1 ->> 'answers')::int > 0
       and (v_s2 ->> 'answers')::int > 0 then
      insert into public.competitive_stats
        (user_id, competitive_matches, competitive_wins,
         one_v_one_matches, one_v_one_wins,
         three_v_three_matches, three_v_three_wins,
         last_match_at, updated_at)
      values
        (v_p, 1, case when v_oc = 'win' then 1 else 0 end,
         case when v_m.match_type = 'duel' then 1 else 0 end,
         case when v_m.match_type = 'duel' and v_oc = 'win' then 1 else 0 end,
         case when v_m.match_type = 'triple' then 1 else 0 end,
         case when v_m.match_type = 'triple' and v_oc = 'win' then 1 else 0 end,
         now(), now())
      on conflict (user_id) do update set
        competitive_matches   = public.competitive_stats.competitive_matches + 1,
        competitive_wins      = public.competitive_stats.competitive_wins
                                  + (case when v_oc = 'win' then 1 else 0 end),
        one_v_one_matches     = public.competitive_stats.one_v_one_matches
                                  + (case when v_m.match_type = 'duel' then 1 else 0 end),
        one_v_one_wins        = public.competitive_stats.one_v_one_wins
                                  + (case when v_m.match_type = 'duel' and v_oc = 'win' then 1 else 0 end),
        three_v_three_matches = public.competitive_stats.three_v_three_matches
                                  + (case when v_m.match_type = 'triple' then 1 else 0 end),
        three_v_three_wins    = public.competitive_stats.three_v_three_wins
                                  + (case when v_m.match_type = 'triple' and v_oc = 'win' then 1 else 0 end),
        last_match_at = now(),
        updated_at = now();
    end if;

    perform public.refresh_duel_risk(v_p);

    v_breakdown := v_breakdown || jsonb_build_object(
      'playerId', v_p, 'name', v_name, 'result', v_oc,
      'delta', v_delta, 'stake', v_stake,
      'settled', v_settled, 'balance', v_bal,
      'points', v_score -> 'points', 'correct', v_score -> 'correct',
      'incorrect', v_score -> 'incorrect', 'skipped', v_score -> 'skipped',
      'answers', v_score -> 'answers');
  end loop;

  -- The leaver's held stake is consumed: route it to the treasury when one is
  -- configured so total supply is conserved.
  if p_reason in ('forfeit', 'grace_expired') and p_leaver is not null then
    perform public._arena_treasury(p_match_id, v_stake, 'arena_forfeit_pool');
  end if;

  -- Bot scorecard appended so the client renders ONE identical scorecard for
  -- humans and bots alike.
  if v_bot_id is not null then
    v_breakdown := v_breakdown || jsonb_build_object(
      'playerId', null,
      'name', public._arena_name(v_m, null),
      'isBot', true,
      'result', case when v_winner is null and not v_draw then 'win' else 'loss' end,
      'delta', 0, 'stake', 0,
      'settled', true,
      'points', v_s2 -> 'points', 'correct', v_s2 -> 'correct',
      'incorrect', v_s2 -> 'incorrect', 'skipped', v_s2 -> 'skipped',
      'answers', v_s2 -> 'answers');
  end if;

  update public.competitive_matches
     set status = v_status,
         completed_at = now(),
         winner_id = v_winner,
         wager_released = true,
         abandoned_by = case when p_reason in ('forfeit', 'grace_expired')
                             then p_leaver else null end,
         abandon_reason = case when v_status = 'abandoned' then p_reason else null end,
         outcome = jsonb_build_object(
           'status', v_status, 'reason', p_reason, 'format', 'blitz',
           'winnerId', v_winner, 'draw', v_draw,
           'stake', v_stake,
           'breakdown', v_breakdown,
           'deltas', (
             select jsonb_object_agg(b ->> 'playerId', b ->> 'delta')
             from jsonb_array_elements(v_breakdown) b
             where (b ->> 'playerId') is not null),
           'outcomes', (
             select jsonb_object_agg(b ->> 'playerId', b ->> 'result')
             from jsonb_array_elements(v_breakdown) b
             where (b ->> 'playerId') is not null))
   where id = p_match_id
     and status in ('waiting', 'ready', 'active');

  perform public._arena_log(p_match_id, p_actor, 'settled',
    jsonb_build_object('reason', p_reason, 'leaver', p_leaver,
                       'draw', v_draw, 'winner', v_winner,
                       'stake', v_stake,
                       'players_settled', v_settled_count));

  return jsonb_build_object(
    'ok', true, 'matchId', p_match_id, 'status', v_status, 'reason', p_reason,
    'draw', v_draw, 'winnerId', v_winner, 'stake', v_stake,
    'youWon', (v_winner = v_user and v_user is not null),
    'myDelta', coalesce(
      (select (b ->> 'delta')::int from jsonb_array_elements(v_breakdown) b
        where b ->> 'playerId' = v_user::text), 0),
    'myOutcome', coalesce(
      (select b ->> 'result' from jsonb_array_elements(v_breakdown) b
        where b ->> 'playerId' = v_user::text), 'draw'),
    'balance', (select smart_coins from public.profiles where id = v_user),
    'breakdown', v_breakdown);
end;
$$;

-- ============================================================================
-- 6. BACKFILL — every existing arena history row gets its NET delta.
--
-- v63 stored the RELEASE. net = release - stake, which turns the broken
-- 'loss' + delta 0 rows into a truthful -stake and leaves the refund/cancel
-- rows at 0. The deterministic client_request_id identifies the exact row.
-- ============================================================================
do $$
declare
  v_m record;
  v_b record;
  v_fixed int := 0;
begin
  for v_m in
    select cm.id, coalesce(cm.stake, 0) as stake,
           coalesce(cm.outcome -> 'breakdown', '[]'::jsonb) as bd
      from public.competitive_matches cm
     where cm.format = 'blitz'
       and cm.outcome is not null
       and jsonb_typeof(cm.outcome -> 'breakdown') = 'array'
  loop
    for v_b in
      select e.value as el
        from jsonb_array_elements(v_m.bd) e
       where e.value ->> 'playerId' is not null
    loop
      update public.duels d
         set delta = coalesce((v_b.el ->> 'delta')::int, 0) - v_m.stake,
             transaction_type = case when v_b.el ->> 'result' = 'win' then 'duel_win'
                                     when v_b.el ->> 'result' = 'loss' then 'duel_loss'
                                     else 'duel_draw' end
       where d.client_request_id = md5(
               'arena:history:' || v_m.id::text || ':' || (v_b.el ->> 'playerId'))::uuid;
      v_fixed := v_fixed + 1;
    end loop;
  end loop;
  perform public._arena_log(
    (select id from public.competitive_matches
      where format = 'blitz' and outcome is not null
      order by created_at desc limit 1),
    null, 'v64_backfill', jsonb_build_object('history_rows_net_delta', v_fixed));
end $$;

-- ============================================================================
-- 7. CREATE — free practice + always return the post-hold balance.
--
-- Signature change (p_practice added). The 4-arg version is DROPPED FIRST: two
-- overloads with defaults make PostgREST answer PGRST203 "Multiple Choices"
-- and every call silently fails. Same trap as v58.
-- ============================================================================
drop function if exists public.arena_create_match(text, integer, uuid, text);

create or replace function public.arena_create_match(
  p_mode         text     default 'duel',
  p_stake        integer  default 0,
  p_opponent_id  uuid     default null,
  p_bot          text     default null,
  p_practice     boolean  default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rules jsonb;
  v_count int;
  v_dur int;
  v_prof public.profiles%rowtype;
  v_opp_prof public.profiles%rowtype;
  v_m uuid;
  v_qids jsonb;
  v_questions jsonb;
  v_bot text := p_bot;
  v_opp uuid := p_opponent_id;
  v_practice boolean := coalesce(p_practice, false);
  v_stake int := coalesce(p_stake, 0);
  v_existing uuid;
  v_res jsonb;
  v_status text;
  v_locks text[];
  v_lock text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  v_rules := public._arena_rules();
  v_count := coalesce((v_rules ->> 'question_count')::int, 40);
  v_dur := coalesce((v_rules ->> 'duration_seconds')::int, 90);

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;
  if not v_prof.is_activated then
    return jsonb_build_object('ok', false, 'error', 'NOT_ACTIVATED',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;
  if p_mode <> 'duel' then
    return jsonb_build_object('ok', false, 'error', 'ARENA_IS_1V1');
  end if;

  -- Practice is tutor-only and always free: the stake is forced to 0 server-side
  -- so a client can never buy a coinless duel against a human.
  if v_practice then
    if v_bot is null then
      return jsonb_build_object('ok', false, 'error', 'PRACTICE_NEEDS_BOT');
    end if;
    if v_opp is not null then
      return jsonb_build_object('ok', false, 'error', 'PRACTICE_IS_SOLO');
    end if;
    v_stake := 0;
  elsif v_bot is null and v_opp is null then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_REQUIRED');
  elsif not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_rules -> 'stakes', '[2]'::jsonb)) t
    where t::int = v_stake
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STAKE');
  end if;

  if v_bot is not null and v_bot not in ('house', 'apollo', 'zainab') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_BOT');
  elsif v_bot is not null then
    v_opp := null;
  elsif v_opp = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;

  perform public._arena_touch_presence(v_user);

  -- Concurrency: advisory lock on BOTH players in sorted order.
  v_locks := array(
    select distinct unnest(
      array[v_user::text, coalesce(v_opp::text, v_user::text)]) order by 1);
  foreach v_lock in array v_locks loop
    perform pg_advisory_xact_lock(hashtext('arena_user:' || v_lock));
  end loop;

  if v_opp is not null then
    select * into v_opp_prof from public.profiles where id = v_opp;
    if v_opp_prof.id is null then
      return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_FOUND');
    end if;
    if not v_opp_prof.is_activated then
      return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_ACTIVATED');
    end if;
    if coalesce(v_opp_prof.smart_coins, 0) < v_stake then
      return jsonb_build_object('ok', false, 'error', 'OPPONENT_INSUFFICIENT_SC');
    end if;
  end if;

  -- Replay for a racing pair: both callers get the SAME match id + SAME board.
  select cm.id into v_existing
  from public.competitive_matches cm
  where cm.format = 'blitz'
    and cm.status in ('waiting', 'ready', 'active')
    and cm.stake = v_stake
    and cm.opponent_bot is not distinct from v_bot
    and cm.created_at > now() - interval '10 minutes'
    and ((cm.creator_id = v_user and cm.opponent_id is not distinct from v_opp)
      or (v_opp is not null and cm.creator_id = v_opp and cm.opponent_id = v_user))
  order by cm.created_at desc
  limit 1;

  if v_existing is not null then
    v_questions := public._cm_serve_questions(
      (select cm.question_ids from public.competitive_matches cm where cm.id = v_existing));
    if v_questions is null then
      return jsonb_build_object('ok', false, 'error', 'MATCH_TAMPERED');
    end if;
    return jsonb_build_object('ok', true, 'replay', true, 'matchId', v_existing,
                              'status', (select cm.status from public.competitive_matches cm where cm.id = v_existing),
                              'format', 'blitz', 'stake', v_stake,
                              'practice', v_practice,
                              'opponentBot', v_bot, 'questionCount', v_count,
                              'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0),
                              'questions', v_questions);
  end if;

  -- ONE active match per player (safe now: both players are locked above).
  if public._arena_in_active_match(v_user) is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_MATCH',
                              'matchId', public._arena_in_active_match(v_user));
  end if;
  if v_opp is not null and public._arena_in_active_match(v_opp) is not null then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_BUSY',
                              'matchId', public._arena_in_active_match(v_opp));
  end if;

  v_qids := public._arena_board(v_count);
  if v_qids is null then
    return jsonb_build_object('ok', false, 'error', 'NO_QUESTIONS');
  end if;
  v_questions := public._cm_serve_questions(v_qids);
  if v_questions is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_TAMPERED');
  end if;

  v_m := gen_random_uuid();
  v_status := case when v_bot is not null then 'ready' else 'waiting' end;

  begin
    insert into public.competitive_matches
      (id, match_type, stake, status, framework, format,
       creator_id, opponent_id, opponent_bot, question_ids, question_count,
       creator_ready, opponent_ready, ready_at, duration_seconds,
       wager_creator_held, wager_opponent_held, escrow_amount,
       last_seen_creator_at, last_seen_opponent_at)
    values
      (v_m, 'duel', v_stake, v_status, 'NMCN', 'blitz',
       v_user, v_opp, v_bot, v_qids, jsonb_array_length(v_qids),
       true, (v_bot is not null), (case when v_bot is not null then now() else null end),
       v_dur,
       (v_stake = 0), (v_stake > 0 and v_opp is not null), 0,
       now(), (case when v_opp is not null then now() else null end));

    -- Practice moves no coins: there is nothing to escrow.
    if v_stake > 0 then
      v_res := public._arena_hold(v_m, v_user, v_stake);
      if not coalesce((v_res ->> 'ok')::boolean, false) then
        raise exception 'ESCROW_CREATOR_FAILED' using errcode = 'P0001';
      end if;

      if v_opp is not null then
        v_res := public._arena_hold(v_m, v_opp, v_stake);
        if not coalesce((v_res ->> 'ok')::boolean, false) then
          raise exception 'ESCROW_OPPONENT_FAILED' using errcode = 'P0001';
        end if;
      end if;
    end if;

    update public.competitive_matches
       set wager_creator_held = (v_stake > 0),
           wager_opponent_held = (v_stake > 0 and v_opp is not null),
           escrow_amount = v_stake * (case when v_opp is not null then 2 else 1 end)
     where id = v_m;
  exception when others then
    return jsonb_build_object(
      'ok', false, 'error', 'ESCROW_FAILED',
      'detail', case when sqlerrm like '%ESCROW_OPPONENT%' then 'OPPONENT_INSUFFICIENT_SC'
                     else 'INSUFFICIENT_SC' end,
      'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0));
  end;

  perform public._arena_log(v_m, v_user, 'created', jsonb_build_object(
    'stake', v_stake, 'bot', v_bot, 'opponent', v_opp, 'practice', v_practice,
    'escrow', v_stake * (case when v_opp is not null then 2 else 1 end)));

  delete from public.arena_queue where user_id in (v_user, v_opp);

  return jsonb_build_object('ok', true, 'replay', false, 'matchId', v_m,
                            'status', v_status, 'format', 'blitz',
                            'stake', v_stake, 'practice', v_practice,
                            'opponentBot', v_bot,
                            'durationSeconds', v_dur,
                            'escrowed', v_stake * (case when v_opp is not null then 2 else 1 end),
                            'questionCount', jsonb_array_length(v_qids),
                            'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0),
                            'questions', v_questions);
end;
$$;

-- arena_enqueue calls create positionally — update it for the new signature.
create or replace function public.arena_enqueue(
  p_mode text default 'duel',
  p_stake integer default 0,
  p_format text default 'blitz'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rules jsonb;
  v_prof public.profiles%rowtype;
  v_lock text;
  v_partner record;
  v_res jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();
  perform public._arena_sweep();
  perform public._arena_touch_presence(v_user);

  v_rules := public._arena_rules();
  if p_mode <> 'duel' then
    return jsonb_build_object('ok', false, 'error', 'ARENA_IS_1V1');
  end if;
  if p_format <> 'blitz' then
    return jsonb_build_object('ok', false, 'error', 'ARENA_FORMAT_LOCKED');
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_rules -> 'stakes', '[2]'::jsonb)) t
    where t::int = p_stake
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STAKE');
  end if;

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;
  if not v_prof.is_activated then
    return jsonb_build_object('ok', false, 'error', 'NOT_ACTIVATED');
  end if;
  if coalesce(v_prof.smart_coins, 0) < p_stake then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  if public._arena_in_active_match(v_user) is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_MATCH',
                              'matchId', public._arena_in_active_match(v_user));
  end if;

  -- Serialise pairing per (mode, stake) so two enqueues cannot both claim the
  -- same partner.
  v_lock := 'arena_queue:' || p_mode || ':' || p_stake::text;
  perform pg_advisory_xact_lock(hashtext(v_lock));

  select q.user_id into v_partner
  from public.arena_queue q
  join public.profiles p on p.id = q.user_id
  where q.user_id <> v_user
    and q.mode = p_mode
    and q.stake = p_stake
    and q.format = 'blitz'
    and p.is_activated
    and coalesce(p.smart_coins, 0) >= p_stake
    and public._arena_in_active_match(q.user_id) is null
  order by q.created_at asc
  limit 1;

  if v_partner is null then
    insert into public.arena_queue (user_id, mode, stake, format)
    values (v_user, p_mode, p_stake, 'blitz')
    on conflict (user_id) do update
      set created_at = now(), mode = excluded.mode,
          stake = excluded.stake, format = excluded.format;
    return jsonb_build_object('ok', true, 'queued', true, 'stake', p_stake,
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  delete from public.arena_queue where user_id in (v_user, v_partner.user_id);

  v_res := public.arena_create_match('duel', p_stake, v_partner.user_id, null, false);
  if not coalesce((v_res ->> 'ok')::boolean, false) then
    insert into public.arena_queue (user_id, mode, stake, format)
    values (v_partner.user_id, p_mode, p_stake, 'blitz')
    on conflict (user_id) do nothing;
    return v_res;
  end if;

  perform public._arena_log((v_res ->> 'matchId')::uuid, v_user, 'queued_match'::text,
    jsonb_build_object('partner', v_partner.user_id, 'stake', p_stake));

  return v_res;
end;
$$;

-- ============================================================================
-- 8. SCHOLARS — every activated scholar with a real availability signal.
--
-- v63's arena_roster returned ONLY scholars already sitting in the queue and
-- explicitly filtered out anyone in a match, so the list could not show
-- "busy" or "offline". Now: status is derived, and canChallenge says whether
-- the caller may press the button.
-- ============================================================================
create or replace function public.arena_roster(
  p_stake integer default 0,
  p_format text default 'blitz'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_window int;
  v_players jsonb;
  v_online int := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  -- Browsing the list is itself presence.
  perform public._arena_touch_presence(v_user);

  v_window := coalesce((public._arena_rules() ->> 'presence_window_seconds')::int, 90);

  with rows as (
    select p.id,
           coalesce(cp.display_name, 'Scholar') as name,
           coalesce(ap.last_seen_at, p.last_active_date::timestamptz) as seen,
           coalesce(p.smart_coins, 0) as coins,
           (public._arena_in_active_match(p.id) is not null) as busy,
           case
             when coalesce(ap.last_seen_at, p.last_active_date::timestamptz)
                  >= now() - make_interval(secs => v_window)
             then 1 else 0
           end as seen_recently
      from public.profiles p
      left join public.community_profiles cp on cp.id = p.id
      left join public.arena_presence ap on ap.user_id = p.id
     where p.id <> v_user
       and p.is_activated
  ), shaped as (
    select r.id, r.name, r.seen, r.coins, r.busy, r.seen_recently,
           case
             when r.busy then 'in_match'
             when r.seen_recently = 1 then 'available'
             else 'offline'
           end as status
      from rows r
  )
  select
    coalesce(jsonb_agg(obj order by rank, seen desc nulls last), '[]'::jsonb),
    count(*) filter (where status <> 'offline')
    into v_players, v_online
  from (
    select case status when 'available' then 0 when 'in_match' then 1 else 2 end as rank,
           seen,
           status,
           jsonb_build_object(
             'userId', id,
             'name', name,
             'status', status,
             'lastSeenAt', seen,
             'canChallenge', (status = 'available' and coins >= p_stake),
             'stake', p_stake,
             'isBot', false) as obj
      from shaped
     order by case status when 'available' then 0 when 'in_match' then 1 else 2 end,
              seen desc nulls last
     limit 30
  ) top;

  return jsonb_build_object('ok', true, 'stake', p_stake, 'format', 'blitz',
                            'online', v_online, 'windowSeconds', v_window,
                            'players', v_players);
end;
$$;

-- ============================================================================
-- 9. SWEEP — expire a half-made match, touch presence, purge stale rows.
--
-- v63 only expired a match once BOTH sides had readied (ready_at is set when
-- the second side readies). A match whose opponent never opened the invite
-- therefore froze BOTH stakes forever. The creator gets a longer window than
-- the opponent because they are the one who can see the arena at all.
-- ============================================================================
create or replace function public._arena_sweep()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rules jsonb;
  v_gap int;
  v_grace int;
  v_noshow int;
  v_invite_ttl int;
  v_row record;
  v_forfeits int := 0;
  v_cancels int := 0;
begin
  perform public._arena_claim_write();
  v_rules := public._arena_rules();
  v_gap := coalesce((v_rules ->> 'heartbeat_gap_seconds')::int, 10);
  v_grace := coalesce((v_rules ->> 'grace_seconds')::int, 15);
  v_noshow := coalesce((v_rules ->> 'no_show_seconds')::int, 120);
  v_invite_ttl := coalesce((v_rules ->> 'invite_ttl_seconds')::int, 60);

  -- 9.1 A live match whose opponent stopped sending heartbeats marks them
  --     disconnected; a second pass past the grace window forfeits for them.
  update public.competitive_matches m
     set disconnected_creator_at = m.last_seen_creator_at + make_interval(secs => v_gap)
   where m.format = 'blitz'
     and m.status = 'active'
     and m.last_seen_creator_at is not null
     and m.disconnected_creator_at is null
     and now() > m.last_seen_creator_at + make_interval(secs => v_gap);

  update public.competitive_matches m
     set disconnected_opponent_at = m.last_seen_opponent_at + make_interval(secs => v_gap)
   where m.format = 'blitz'
     and m.status = 'active'
     and m.opponent_id is not null
     and m.last_seen_opponent_at is not null
     and m.disconnected_opponent_at is null
     and now() > m.last_seen_opponent_at + make_interval(secs => v_gap);

  -- 9.2 Forfeit a player who stayed away past the grace window. Both players
  --     gone = a shared network event, so nobody is punished (refund both).
  for v_row in
    select id, creator_id, opponent_id, grace_seconds,
           disconnected_creator_at, disconnected_opponent_at
    from public.competitive_matches
    where format = 'blitz'
      and status = 'active'
      and (
        (disconnected_creator_at is not null
         and now() > disconnected_creator_at + make_interval(secs => grace_seconds))
        or (disconnected_opponent_at is not null
         and now() > disconnected_opponent_at + make_interval(secs => grace_seconds)))
    limit 50
  loop
    if v_row.disconnected_creator_at is not null
       and v_row.disconnected_opponent_at is not null then
      perform public._arena_resolve(v_row.id, 'both_away', null, null, true);
    else
      perform public._arena_resolve(
        v_row.id, 'grace_expired',
        case when v_row.disconnected_creator_at is not null
             then v_row.creator_id else v_row.opponent_id end);
      v_forfeits := v_forfeits + 1;
    end if;
  end loop;

  -- 9.3 Nobody showed up: refund both sides (nobody is at fault).
  for v_row in
    select id from public.competitive_matches
    where format = 'blitz'
      and status in ('waiting', 'ready')
      and starts_at is null
      and ready_at is not null
      and now() > ready_at + make_interval(secs => v_noshow)
    limit 50
  loop
    perform public._arena_resolve(v_row.id, 'no_show', null, null, true);
    v_cancels := v_cancels + 1;
  end loop;

  -- 9.4 v64: the opponent never readied at all, so ready_at is still null and
  --     9.3 could never fire. Both stakes would stay escrowed forever. The
  --     creator keeps their window open (they may still be browsing); the
  --     opponent's money comes back on schedule.
  for v_row in
    select id, stake from public.competitive_matches
    where format = 'blitz'
      and status = 'waiting'
      and starts_at is null
      and ready_at is null
      and opponent_bot is null
      and opponent_id is not null
      and now() > created_at + make_interval(secs => v_invite_ttl)
    limit 50
  loop
    perform public._arena_resolve(v_row.id, 'no_show', null, null, true);
    v_cancels := v_cancels + 1;
  end loop;

  -- 9.5 Housekeeping: presence rows older than a day are meaningless.
  delete from public.arena_presence where last_seen_at < now() - interval '1 day';

  return jsonb_build_object('ok', true, 'forfeits', v_forfeits,
                            'cancels', v_cancels);
end;
$$;

-- arena_rules gains the invite TTL the 9.4 expiry reads.
update public.server_config
   set value = value || jsonb_build_object('invite_ttl_seconds', 60),
       updated_at = now()
 where key = 'arena_rules';

-- Presence is stamped by the arena RPCs that already run during a match.
create or replace function public.arena_heartbeat(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_rules jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  -- Sweep FIRST: this may settle the match.
  perform public._arena_sweep();
  perform public._arena_touch_presence(v_user);

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  v_rules := public._arena_rules();

  if v_m.status = 'active' then
    update public.competitive_matches
       set last_seen_creator_at = case when creator_id = v_user then now() else last_seen_creator_at end,
           last_seen_opponent_at = case when opponent_id = v_user then now() else last_seen_opponent_at end,
           disconnected_creator_at = case when creator_id = v_user then null else disconnected_creator_at end,
           disconnected_opponent_at = case when opponent_id = v_user then null else disconnected_opponent_at end
     where id = p_match_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'matchId', p_match_id, 'status', v_m.status,
    'stake', coalesce(v_m.stake, 0),
    'escrowed', coalesce(v_m.escrow_amount, 0),
    'graceSeconds', coalesce((v_rules ->> 'grace_seconds')::int, 15),
    'opponentDisconnected', (v_m.opponent_id is not null
      and v_m.disconnected_opponent_at is not null),
    'opponentReconnected', (v_m.opponent_id is not null
      and v_m.disconnected_opponent_at is null
      and v_m.last_seen_opponent_at is not null),
    'remainingMs', case when v_m.starts_at is null then null
      else greatest(0, (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint) end,
    'balance', (select smart_coins from public.profiles where id = v_user),
    'myScore', public._arena_score(p_match_id, v_user),
    'opponentScore', public._arena_score(p_match_id, coalesce(
      case when v_m.creator_id = v_user then v_m.opponent_id else v_m.creator_id end,
      public._arena_bot_id(v_m.opponent_bot))));
end;
$$;

-- arena_state also stamps presence and reports the same live fields, so the
-- reconnect path gets them for free.
create or replace function public.arena_state(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_rules jsonb;
  v_questions jsonb;
  v_review jsonb;
  v_bot_id uuid;
  v_my_answers jsonb;
  v_opp_live uuid;
  v_opp_score jsonb;
  v_opp_answers jsonb;
  v_remaining bigint;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();
  perform public._arena_sweep();
  perform public._arena_touch_presence(v_user);

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  v_rules := public._arena_rules();
  v_questions := public._cm_serve_questions(v_m.question_ids);
  if v_questions is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_TAMPERED');
  end if;

  v_bot_id := case when v_m.opponent_bot is not null
                   then public._arena_bot_id(v_m.opponent_bot) else null end;
  v_opp_live := case when v_m.creator_id = v_user then v_m.opponent_id
                     else v_m.creator_id end;

  v_my_answers := (
    select coalesce(jsonb_agg(
      jsonb_build_object('index', a.question_index, 'selected', a.selected_answer,
                         'isCorrect', a.is_correct, 'multiplier', a.multiplier,
                         'points', a.points, 'skipped', a.skipped)
      order by a.question_index), '[]'::jsonb)
    from public.competitive_match_answers a
    where a.match_id = p_match_id and a.player_id = v_user
  );

  v_opp_answers := (
    select coalesce(jsonb_agg(
      jsonb_build_object('index', a.question_index, 'selected', a.selected_answer,
                         'isCorrect', a.is_correct, 'multiplier', a.multiplier,
                         'points', a.points, 'skipped', a.skipped)
      order by a.question_index), '[]'::jsonb)
    from public.competitive_match_answers a
    where a.match_id = p_match_id
      and a.player_id = coalesce(v_opp_live, v_bot_id)
  );

  v_opp_score := public._arena_score(p_match_id, coalesce(v_opp_live, v_bot_id));

  v_remaining := case when v_m.starts_at is null then null
    else greatest(0, (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint) end;

  v_review := public._arena_review(p_match_id, v_user);

  return jsonb_build_object(
    'ok', true, 'matchId', v_m.id, 'status', v_m.status,
    'mode', v_m.match_type, 'format', 'blitz',
    'stake', coalesce(v_m.stake, 0),
    'practice', (coalesce(v_m.stake, 0) = 0),
    'framework', 'NMCN', 'questionCount', v_m.question_count,
    'opponentBot', v_m.opponent_bot,
    'opponentName', public._arena_name(v_m, v_opp_live),
    'opponentIsBot', (v_m.opponent_bot is not null),
    'escrowed', coalesce(v_m.escrow_amount, 0),
    'balance', (select smart_coins from public.profiles where id = v_user),
    'creatorReady', v_m.creator_ready, 'opponentReady', v_m.opponent_ready,
    'startsAt', v_m.starts_at, 'endsAt', v_m.ends_at,
    'remainingMs', v_remaining,
    'graceSeconds', coalesce((v_rules ->> 'grace_seconds')::int, 15),
    'opponentDisconnected', (v_m.opponent_id is not null
      and v_m.disconnected_opponent_at is not null),
    'canCancel', (v_m.creator_id = v_user and v_m.starts_at is null),
    'canForfeit', (v_m.status in ('ready', 'active')),
    'myScore', public._arena_score(p_match_id, v_user),
    'opponentScore', v_opp_score,
    'myAnswers', v_my_answers,
    'opponentAnswers', v_opp_answers,
    'questions', v_questions,
    'review', v_review,
    'outcome', v_m.outcome,
    'abandonReason', v_m.abandon_reason);
end;
$$;

-- ============================================================================
-- 10. ACLs.
--
-- LIVE GRANT GOTCHA: this project's default privileges auto-grant anon +
-- authenticated on every new function, so `revoke from public` alone leaves
-- them executable. Revoke all three explicitly, every time.
-- ============================================================================
do $$
declare
  v_fns text[];
  v_fn text;
  v_sig text;
begin
  v_fns := array[
    'arena_create_match', 'arena_ready', 'arena_start', 'arena_answer',
    'arena_heartbeat', 'arena_forfeit', 'arena_cancel', 'arena_settle',
    'arena_state', 'arena_outcome', 'arena_enqueue', 'arena_leave_queue',
    'arena_roster'
  ];
  foreach v_fn in array v_fns loop
    for v_sig in
      select p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fn
    loop
      execute format('revoke all on function %s from public, anon', v_sig);
      execute format('grant execute on function %s to authenticated', v_sig);
    end loop;
  end loop;
end $$;

do $$
declare
  v_fns text[];
  v_fn text;
  v_sig text;
begin
  v_fns := array[
    '_arena_rules', '_arena_players', '_arena_in_active_match',
    '_arena_hold', '_arena_release', '_arena_treasury', '_arena_board',
    '_arena_log', '_arena_score', '_arena_name', '_arena_bot_skill',
    '_arena_bot_id', '_arena_resolve', '_arena_claim_write',
    '_arena_bot_turn', '_arena_review', '_arena_sweep',
    '_arena_touch_presence',
    '_arena_guard_match_ins', '_arena_guard_match_upd', '_arena_guard_answers'
  ];
  foreach v_fn in array v_fns loop
    for v_sig in
      select p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_fn
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_sig);
      execute format('grant execute on function %s to service_role', v_sig);
    end loop;
  end loop;
end $$;

revoke all on public.arena_presence from public, anon, authenticated;
grant all on public.arena_presence to service_role;

-- ============================================================================
-- 11. PostgREST schema reload.
-- ============================================================================
notify pgrst, 'reload schema';

-- ============================================================================
-- DONE.
-- ============================================================================