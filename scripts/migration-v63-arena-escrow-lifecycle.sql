-- ============================================================
-- Apex Scholars Migration v63 — 1v1 ARENA: ESCROW + FULL MATCH LIFECYCLE
-- POLYNURSE 1v1 rumble, part 3. Replaces the v58/v60 blitz + sudden-death
-- 1v1 with ONE server-authoritative format and a real escrow economy.
--
-- USER-LOCKED DECISIONS (all four confirmed with the user before any code):
--   (1) ABANDONMENT  — a leaver FORFEITS their stake; the other player is
--       REFUNDED. Voluntary forfeit is immediate; an unexpected drop gets a
--       45s reconnect grace period first.
--   (2) ESCROW       — FULL TWO-SIDED escrow. Both stakes are debited at match
--       creation, BEFORE either player can start. There is no "check solvency
--       and hope" (the v38/v58/v60 bug that let one player open 20 concurrent
--       20-SC matches, and pay a winner from nothing at settle).
--   (3) FORMAT       — ONE format for 1v1: blitz (40 NMCN questions / 90s).
--       Sudden-death is removed from 1v1 for BOTH humans and bots. Bots now
--       play the identical flow: same board, same clock, same scoring, same
--       one-time Double, same scorecard, same result screen, same review.
--       Triple Threat keeps sudden-death untouched.
--   (4) TIE-BREAK    — points DESC, then correct count DESC, then DRAW.
--       The v58 cumulative-LATENCY tie-break is DELETED (unfair on mobile).
--
-- SCORING (identical for humans and bots, enforced in SQL only):
--   correct               -> points = 1
--   correct + Double      -> points = 2
--   incorrect             -> points = 0   (v58 used -1; removed)
--   incorrect + Double    -> points = 0   (v58 used -2; removed)
--   skip                  -> points = 0
--   The client NEVER sends a score. points is computed on INSERT from the
--   stored answer key and is the single source of truth for settlement.
--
-- POT ARITHMETIC (escrow already debited both sides):
--   win            winner released +2*stake   loser released 0
--   draw           both released +stake
--   forfeit        leaver released 0 (stake consumed)   other released +stake
--   cancel/no-show BOTH released +stake (nothing started, nobody at fault)
--
-- Forfeited stakes are credited to the platform treasury so total SC supply
-- is conserved. The treasury is a server_config key ('arena_treasury' ->
-- {"user_id": "<uuid>"}); if it is unset the consumed stake is simply removed
-- from circulation. See section 1.4.
--
-- Schema deltas (all idempotent):
--   competitive_matches += escrow + readiness + heartbeat + abandon columns,
--     and status gains 'ready' (both players confirmed, clock not yet open).
--   competitive_match_answers += points (server-computed), skipped, bot.
--   arena_queue             NEW — server-side matchmaking queue.
--   arena_match_events      NEW — append-only escrow/lifecycle audit trail.
--
-- CRITICAL INDEX ORDER (a partial UNIQUE index cannot be created while live
-- rows violate it, and the migration runs against a live DB):
--   section 1.5 sweeps pre-existing in-flight matches BEFORE section 1.6
--   creates the one-active-match-per-player indexes.
--
-- RPCs (all SECURITY DEFINER, ACLs re-asserted):
--   arena_create_match(text,int,uuid,text)  NEW — 1v1 blitz, two-sided escrow
--   arena_ready(uuid)                       NEW — both-ready handshake
--   arena_start(uuid)                       NEW — opens the shared 90s clock
--   arena_answer(uuid,int,text,bool,bool)   NEW — grade + skip + bot turn
--   arena_heartbeat(uuid)                   NEW — grace timer + lazy sweep
--   arena_forfeit(uuid)                     NEW — voluntary, immediate
--   arena_cancel(uuid)                      NEW — creator cancels, refund both
--   arena_settle(uuid)                      NEW — end-of-clock, idempotent
--   arena_state(uuid)                       NEW — reconnect/resume + review
--   arena_enqueue(text,int,text)            NEW — server-side matchmaking
--   arena_leave_queue()                     NEW — release the queue slot
--   arena_roster(int,text)                  NEW — live queue, humans first
--   arena_outcome(uuid)                     NEW — cheap result poll
--   _arena_* helpers                        internal, NOT client-callable
--
-- The v38/v58/v60 functions are deliberately KEPT for Triple Threat, but
-- their 1v1 blitz path is SEALED (BLITZ_REQUIRES_ARENA) so no client can
-- bypass escrow by calling the old RPCs. No new api/*.js — the 12-function
-- Vercel cap is untouched.
-- ============================================================

-- ============================================================
-- 1. SCHEMA
-- ============================================================
-- The v63 guard triggers (section 5) are already installed on any re-run, so
-- this migration must claim the arena write-scope for its OWN maintenance
-- sweeps below — otherwise re-applying would abort on its own trigger.
select set_config('arena.write', '1', true);

-- ------------------------------------------------------------
-- 1.1 Pre-migration safety sweep.
--
-- Two jobs, both MUST happen before the indexes in 1.6:
--   (a) Any PRE-v63 blitz match is in-flight under the OLD economy (stake never
--       debited, delta paid at settlement). Under the new escrow rules those
--       rows are un-settleable and hold no escrow, so they are voided here.
--       Zero coins move: nothing was debited for them.
--   (b) Any long-stale non-blitz match (pre-existing v38 rows) is abandoned for
--       the same reason. This clears the partial UNIQUE indexes in 1.6.
-- ============================================================
update public.competitive_matches
   set status = 'abandoned',
       completed_at = now(),
       outcome = coalesce(outcome, '{}'::jsonb)
             || jsonb_build_object('status', 'abandoned',
                                   'reason', 'v63_pre_migration_void',
                                   'at', now())
 where status in ('waiting', 'active')
   and created_at < now() - interval '10 minutes';

update public.competitive_matches
   set status = 'abandoned',
       completed_at = now(),
       outcome = coalesce(outcome, '{}'::jsonb)
             || jsonb_build_object('status', 'abandoned',
                                   'reason', 'v63_pre_migration_void',
                                   'at', now())
 where status in ('waiting', 'active')
   and format = 'blitz';

-- ------------------------------------------------------------
-- 1.2 competitive_matches — escrow, readiness, heartbeat, abandon.
-- ------------------------------------------------------------
alter table public.competitive_matches
  add column if not exists creator_ready         boolean not null default false,
  add column if not exists opponent_ready        boolean not null default false,
  add column if not exists ready_at              timestamptz,
  add column if not exists duration_seconds      int not null default 90,
  add column if not exists wager_creator_held    boolean not null default false,
  add column if not exists wager_opponent_held   boolean not null default false,
  add column if not exists escrow_amount         int not null default 0,
  add column if not exists wager_released        boolean not null default false,
  add column if not exists last_seen_creator_at  timestamptz,
  add column if not exists last_seen_opponent_at timestamptz,
  add column if not exists disconnected_creator_at  timestamptz,
  add column if not exists disconnected_opponent_at timestamptz,
  add column if not exists abandoned_by          uuid,
  add column if not exists abandon_reason        text,
  add column if not exists grace_seconds         int not null default 45;

-- 'ready' joins the lifecycle: both players confirmed the wager, clock not open.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'competitive_matches_status_check'
  ) then
    alter table public.competitive_matches
      drop constraint competitive_matches_status_check;
  end if;
end $$;

alter table public.competitive_matches
  add constraint competitive_matches_status_check
  check (status in ('waiting', 'ready', 'active', 'completed', 'abandoned'));

-- ------------------------------------------------------------
-- 1.3 competitive_match_answers — server-computed points + skip + bot rows.
--
-- points is written ONLY by arena_answer, derived from the stored answer key
-- and the consumed multiplier. There is no client-writable path to it (the
-- table has RLS enabled with no policies; only definer RPCs write).
-- ------------------------------------------------------------
alter table public.competitive_match_answers
  add column if not exists points  int not null default 0,
  add column if not exists skipped boolean not null default false,
  add column if not exists is_bot  boolean not null default false;

-- Backfill pre-existing rows so the column is never silently wrong. The v58
-- formula (+/- multiplier) is kept ONLY for history; arena settlement never
-- reads a legacy row because 1.1 voided every in-flight blitz match.
update public.competitive_match_answers
   set points = case when is_correct then multiplier else 0 end
 where points = 0 and is_correct;

-- A bot row is keyed by the match's own bot identity, NOT auth.users — bots
-- are not users and must not be able to impersonate one.
alter table public.competitive_match_answers
  drop constraint if exists competitive_match_answers_player_id_fkey;

-- One Double per PLAYER per match stays enforced by uq_cma_one_double (v58).
-- Bots get their own one-Double budget via a second partial index.
create unique index if not exists uq_cma_one_bot_double
  on public.competitive_match_answers (match_id, is_bot, player_id)
  where multiplier = 2 and is_bot;

-- ------------------------------------------------------------
-- 1.4 Arena config (server-side constants; clients never send these).
-- ------------------------------------------------------------
insert into public.server_config (key, value, description) values
  ('arena_rules',
   jsonb_build_object(
     'format', 'blitz',
     'question_count', 40,
     'duration_seconds', 90,
     'stakes', jsonb_build_array(1, 2, 5, 10, 20),
     'grace_seconds', 45,
     'heartbeat_gap_seconds', 10,
     'no_show_seconds', 120,
     'ready_timeout_seconds', 120,
     'double_max', 2,
     'score', jsonb_build_object(
       'correct', 1, 'correct_double', 2, 'incorrect', 0,
       'incorrect_double', 0, 'skip', 0)),
   '1v1 arena: one blitz format for humans and bots, two-sided escrow, grace-based forfeit'),
  ('arena_treasury',
   jsonb_build_object('user_id', null),
   'Platform treasury user for forfeited wagers; null = stake removed from circulation')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = now();

-- ============================================================
-- 2. QUEUE + AUDIT TABLES
-- ============================================================
create table if not exists public.arena_queue (
  user_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null default 'duel' check (mode in ('duel')),
  stake int not null check (stake in (1, 2, 5, 10, 20)),
  format text not null default 'blitz' check (format = 'blitz'),
  created_at timestamptz not null default now()
);

create index if not exists idx_arena_queue_match
  on public.arena_queue (mode, stake, format, created_at);

create table if not exists public.arena_match_events (
  id bigint generated always as identity primary key,
  match_id uuid not null references public.competitive_matches(id) on delete cascade,
  actor_id uuid,
  kind text not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_arena_events_match
  on public.arena_match_events (match_id, created_at);

-- RLS enabled with NO policies => deny-all for clients. Same posture as the
-- v38 competitive tables: only SECURITY DEFINER RPCs touch these rows.
alter table public.arena_queue enable row level security;
alter table public.arena_match_events enable row level security;

-- ============================================================
-- 3. INTERNAL HELPERS (not client-callable)
-- ============================================================

-- Arena rules, server-side only.
create or replace function public._arena_rules()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select value from public.server_config where key = 'arena_rules'),
    '{}'::jsonb);
$$;

-- The two escrow-relevant players of a match, in a stable order, with nulls
-- dropped. A bot match has exactly ONE real player (the human).
create or replace function public._arena_players(p_m public.competitive_matches)
returns uuid[]
language sql
stable
as $$
  select coalesce(array(
    select u from (values (p_m.creator_id), (p_m.opponent_id)) as x(u)
    where u is not null
  ), '{}'::uuid[]);
$$;

-- One active arena match per player. This is the guard that makes concurrent
-- matchmaking calls collapse instead of spawning duplicate matches.
create or replace function public._arena_in_active_match(p_user uuid)
returns uuid
language sql
stable
security definer set search_path = public
as $$
  select cm.id
  from public.competitive_matches cm
  where cm.format = 'blitz'
    and cm.status in ('waiting', 'ready', 'active')
    and (cm.creator_id = p_user or cm.opponent_id = p_user)
  order by cm.created_at desc
  limit 1;
$$;

-- Deterministic escrow hold. Idempotent on (match, player) via _sc_apply's
-- client_request_id, so a retried create never double-debits.
create or replace function public._arena_hold(
  p_match uuid,
  p_user  uuid,
  p_stake int,
  p_reason text default 'arena_wager_hold'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_req uuid;
  v_res jsonb;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'error', 'NO_USER');
  end if;
  v_req := md5('arena:hold:' || p_match::text || ':' || p_user::text)::uuid;
  v_res := public._sc_apply(
    p_user, -p_stake, p_reason, 'arena', 'spend',
    'competitive_match', p_match::text,
    jsonb_build_object('match_id', p_match::text, 'escrow', true,
                       'stake', p_stake),
    v_req);
  return v_res;
end;
$$;

-- Deterministic escrow release. Exactly one of: payout (win), refund (draw /
-- forfeit-refund / cancel), or nothing (forfeit-loser consumes the hold).
create or replace function public._arena_release(
  p_match  uuid,
  p_user   uuid,
  p_amount int,
  p_reason text,
  p_type   text default 'earn',
  p_meta   jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_req uuid;
  v_res jsonb;
begin
  if p_user is null or p_amount = 0 then
    return jsonb_build_object('ok', true, 'skipped', true, 'amount', 0);
  end if;
  v_req := md5('arena:release:' || p_match::text || ':' || p_user::text)::uuid;
  v_res := public._sc_apply(
    p_user, p_amount, p_reason, 'arena', p_type,
    'competitive_match', p_match::text,
    p_meta || jsonb_build_object('match_id', p_match::text),
    v_req);
  return v_res;
end;
$$;

-- Route a consumed (forfeited) stake to the platform treasury when one is
-- configured, so total SC supply is conserved. With no treasury configured the
-- amount is simply removed from circulation — the leaver still forfeits.
create or replace function public._arena_treasury(
  p_match uuid,
  p_amount int,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_treasury uuid;
  v_req uuid;
  v_res jsonb;
begin
  if p_amount = 0 then
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;

  select (value ->> 'user_id')::uuid into v_treasury
  from public.server_config where key = 'arena_treasury';

  if v_treasury is null then
    -- No treasury configured: the forfeited stake leaves circulation. This is
    -- still a real debit against the leaver's escrow hold (already applied).
    return jsonb_build_object('ok', true, 'sink', true, 'amount', p_amount);
  end if;

  v_req := md5('arena:treasury:' || p_match::text)::uuid;
  v_res := public._sc_apply(
    v_treasury, p_amount, p_reason, 'arena', 'earn',
    'competitive_match', p_match::text,
    jsonb_build_object('match_id', p_match::text, 'forfeited', true),
    v_req);
  return v_res;
end;
$$;

-- Server-side balanced 40-question NMCN selection, identical split to v58
-- (Easy 8 / Moderate 12 / Hard 12 / Expert 8) with a subject-spread walk so the
-- board is never pure random and is pinned once per match for BOTH players.
create or replace function public._arena_board(p_count int default 40)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_ids text[];
begin
  v_ids := array(
    select z.id
    from (
      select c.id,
             c.diff_rank,
             (floor(random() * 1000000000))::int as sub_key,
             (floor(random() * 1000000000))::int as within_subject,
             row_number() over (partition by c.diff_rank order by c.id) as rn_by_diff
      from (
        select q.id,
               case lower(coalesce(q.difficulty, ''))
                 when 'easy' then 0
                 when 'moderate' then 1
                 when 'hard' then 2
                 when 'expert' then 3
                 else 0
               end as diff_rank
        from public.questions q
        where q.exam_framework = 'NMCN'
          and q.is_active
          and q.question_text is not null
          and q.correct_answer is not null
          and q.options is not null
          and jsonb_typeof(q.options) = 'array'
          and jsonb_array_length(q.options) >= 2
      ) c
    ) z
    left join (
      select t.fill_rank, t.want from (values (0, 8), (1, 12), (2, 12), (3, 8)) as t(fill_rank, want)
    ) t on t.fill_rank = z.diff_rank
    order by
      (case when z.rn_by_diff <= coalesce(t.want, 0) then 0 else 1 end),
      z.sub_key,
      z.within_subject
    limit p_count
  );

  if v_ids is null or array_length(v_ids, 1) < 4 then
    return null;
  end if;

  return (
    select coalesce(jsonb_agg(x.id::text order by x.ord), '[]'::jsonb)
    from unnest(v_ids) with ordinality as x(id, ord)
  );
end;
$$;

-- Audit every escrow movement + lifecycle transition.
create or replace function public._arena_log(
  p_match uuid,
  p_actor uuid,
  p_kind  text,
  p_meta  jsonb default '{}'::jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.arena_match_events (match_id, actor_id, kind, meta)
  values (p_match, p_actor, p_kind, coalesce(p_meta, '{}'::jsonb));
exception when others then
  -- Auditing must never break a settlement.
  null;
end;
$$;

-- One scorecard row per participant. Bots are scored from their own answer
-- rows in the SAME table (is_bot = true), so the human and bot scorecards are
-- produced by identical SQL — that is what "same scoring" means here.
create or replace function public._arena_score(p_match uuid, p_player uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_answers int := 0;
  v_correct int := 0;
  v_wrong   int := 0;
  v_skipped int := 0;
  v_points  int := 0;
begin
  select count(*)::int,
         count(*) filter (where a.is_correct)::int,
         count(*) filter (where not a.is_correct and not a.skipped)::int,
         count(*) filter (where a.skipped)::int,
         coalesce(sum(a.points), 0)::int
    into v_answers, v_correct, v_wrong, v_skipped, v_points
  from public.competitive_match_answers a
  where a.match_id = p_match and a.player_id = p_player;

  return jsonb_build_object(
    'answers',   v_answers,
    'correct',   v_correct,
    'incorrect', v_wrong,
    'skipped',   v_skipped,
    'points',    v_points);
end;
$$;

-- Participant display name (bot names come from the server profile map).
create or replace function public._arena_name(p_match public.competitive_matches, p_user uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_name text;
begin
  if p_user is null then
    return case p_match.opponent_bot
             when 'apollo' then 'Prof. Apollo'
             when 'zainab' then 'Nurse Zainab'
             else 'The House'
           end;
  end if;
  select coalesce(cp.display_name, 'Rival Scholar') into v_name
  from public.community_profiles cp where cp.id = p_user;
  return v_name;
end;
$$;

-- Bot skill profile (server-side only; the client never chooses the roll).
create or replace function public._arena_bot_skill(p_bot text)
returns numeric
language sql
immutable
as $$
  select case p_bot
           when 'apollo' then 0.78
           when 'zainab' then 0.62
           else 0.55
         end;
$$;

-- The bot identity UUID for answer rows. Deterministic, namespaced, and NOT a
-- member of auth.users (so it can never collide with or impersonate a human).
create or replace function public._arena_bot_id(p_bot text)
returns uuid
language sql
immutable
as $$
  select md5('arena:bot:' || coalesce(p_bot, 'house'))::uuid;
$$;

-- ============================================================
-- 4. SETTLEMENT ENGINE (internal) — the ONLY place escrow is released.
--
-- Every terminal path (end of clock, voluntary forfeit, grace expiry, creator
-- cancel, no-show) funnels through here so there is exactly one payout
-- implementation and exactly one idempotency story.
--
--   p_reason = 'time'          -> points DESC, correct DESC, else DRAW
--   p_reason = 'forfeit'       -> p_leaver forfeits, other refunded
--   p_reason = 'grace_expired' -> identical to 'forfeit' (unexpected drop)
--   p_reason = 'cancel'        -> BOTH refunded (creator backed out, pre-start)
--   p_reason = 'no_show'       -> BOTH refunded (opponent never arrived)
--   p_reason = 'both_away'     -> BOTH refunded (shared network event)
--
-- Exactly-once: a per-match advisory lock serialises concurrent settles, the
-- terminal-status guard makes a replay a no-op, and every balance movement
-- uses a deterministic _sc_apply client_request_id on top of that.
-- ============================================================
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
begin
  -- Re-read under a per-match advisory lock.
  v_match_key := 'arena_match:' || p_match_id::text;
  perform pg_advisory_xact_lock(hashtext(v_match_key));

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  -- Terminal replay: the stored verdict wins, nothing moves twice. The
  -- breakdown is echoed back so a forfeit/disconnect screen can render the
  -- final scorecard without a second settlement call.
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
      'myOutcome', coalesce(v_m.outcome -> 'outcomes' ->> v_user::text, 'draw'));
  end if;

  -- Preconditions. 'time' may only settle once the shared clock has expired;
  -- forfeit/cancel may only settle a match that has not been settled.
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

  -- ------------------------------------------------------------
  -- 4.1 Scorecards. Identical query for humans and bots.
  -- ------------------------------------------------------------
  if v_m.opponent_bot is not null then
    v_s1 := public._arena_score(p_match_id, v_players[1]);
    v_s2 := public._arena_score(p_match_id, v_bot_id);
  else
    v_s1 := public._arena_score(p_match_id, v_players[1]);
    v_s2 := public._arena_score(p_match_id, v_players[2]);
  end if;

  -- ------------------------------------------------------------
  -- 4.2 Verdict.
  -- ------------------------------------------------------------
  if p_reason = 'time' then
    -- Locked rule: points DESC, then correct count DESC, then DRAW.
    -- No latency tie-break — it is not a fairness signal on mobile networks.
    if (v_s1 ->> 'points')::int > (v_s2 ->> 'points')::int then
      v_winner := v_players[1];
    elsif (v_s1 ->> 'points')::int < (v_s2 ->> 'points')::int then
      v_winner := case when v_m.opponent_bot is not null then null
                       else v_players[2] end;
      -- A bot win has no winner id (the bot is not a user).
      if v_m.opponent_bot is not null then
        v_winner := null;
        v_draw := false;
      end if;
    elsif (v_s1 ->> 'correct')::int > (v_s2 ->> 'correct')::int then
      v_winner := v_players[1];
    elsif (v_s1 ->> 'correct')::int < (v_s2 ->> 'correct')::int then
      v_winner := case when v_m.opponent_bot is not null then null
                       else v_players[2] end;
      if v_m.opponent_bot is not null then
        v_winner := null;
        v_draw := false;
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

  -- ------------------------------------------------------------
  -- 4.3 Release the escrow.
  -- ------------------------------------------------------------
  foreach v_p in array v_players loop
    v_score := public._arena_score(p_match_id, v_p);
    v_release := 0;
    v_oc := 'draw';

    if p_reason = 'time' then
      if v_draw then
        v_release := v_m.stake; v_oc := 'draw';
      elsif v_winner = v_p then
        v_release := v_m.stake * 2; v_oc := 'win';
      else
        v_release := 0; v_oc := 'loss';
      end if;
    elsif p_reason in ('forfeit', 'grace_expired') then
      if v_p = p_leaver then
        v_release := 0; v_oc := 'loss';
      else
        v_release := v_m.stake; v_oc := 'draw';   -- refunded
      end if;
    else
      v_release := v_m.stake; v_oc := 'draw';     -- cancelled: refund both
    end if;

    v_delta := v_release;
    v_settled := true;
    v_bal := null;
    if v_release <> 0 then
      v_res := public._arena_release(
        p_match_id, v_p, v_release,
        case when v_release > v_m.stake then 'arena_win'
             when p_reason in ('forfeit', 'grace_expired') then 'arena_forfeit_refund'
             else 'arena_refund' end,
        case when p_reason = 'time' and v_oc = 'win' then 'earn' else 'refund' end,
        jsonb_build_object('stake', v_m.stake, 'reason', p_reason,
                           'outcome', v_oc, 'points', v_score -> 'points'));
      v_settled := coalesce((v_res ->> 'ok')::boolean, false);
      if coalesce((v_res ->> 'ok')::boolean, false) then
        v_bal := to_jsonb(coalesce((v_res ->> 'balanceAfter')::int, 0));
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

    v_req := md5('arena:history:' || p_match_id::text || ':' || v_p::text)::uuid;
    insert into public.duels
      (user_id, opponent, opponent_id, mode, stake, outcome, delta,
       transaction_type, client_request_id)
    values
      (v_p, v_name, v_opp_id, v_m.match_type, v_m.stake, v_oc, v_delta,
       case when v_delta > 0 then 'duel' else 'duel_draw' end, v_req);

    -- Verified competitive stats ONLY for a fully-played HUMAN duel. A bot, a
    -- no-show, or a forfeit earns no verified win (keeps one_v_one_wins honest).
    if v_m.opponent_id is not null
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
      'delta', v_delta, 'settled', v_settled, 'balance', v_bal,
      'points', v_score -> 'points', 'correct', v_score -> 'correct',
      'incorrect', v_score -> 'incorrect', 'skipped', v_score -> 'skipped',
      'answers', v_score -> 'answers');
  end loop;

  -- The leaver's held stake is consumed: route it to the treasury when one is
  -- configured so total supply is conserved.
  if p_reason in ('forfeit', 'grace_expired') and p_leaver is not null then
    perform public._arena_treasury(p_match_id, v_m.stake, 'arena_forfeit_pool');
  end if;

  -- Bot scorecard appended so the client renders ONE identical scorecard for
  -- humans and bots alike.
  if v_bot_id is not null then
    v_breakdown := v_breakdown || jsonb_build_object(
      'playerId', null,
      'name', public._arena_name(v_m, null),
      'isBot', true,
      'result', case when v_winner is null and not v_draw then 'win' else 'loss' end,
      'delta', 0, 'settled', true,
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
           'stake', v_m.stake,
           'breakdown', v_breakdown,
           'deltas', (
             select jsonb_object_agg(b ->> 'playerId', b -> 'delta')
             from jsonb_array_elements(v_breakdown) b
             where (b ->> 'playerId') is not null),
           'outcomes', (
             select jsonb_object_agg(b ->> 'playerId', b -> 'result')
             from jsonb_array_elements(v_breakdown) b
             where (b ->> 'playerId') is not null))
   where id = p_match_id
     and status in ('waiting', 'ready', 'active');

  perform public._arena_log(p_match_id, p_actor, 'settled',
    jsonb_build_object('reason', p_reason, 'leaver', p_leaver,
                       'draw', v_draw, 'winner', v_winner,
                       'players_settled', v_settled_count));

  return jsonb_build_object(
    'ok', true, 'matchId', p_match_id, 'status', v_status, 'reason', p_reason,
    'draw', v_draw, 'winnerId', v_winner, 'stake', v_m.stake,
    'youWon', (v_winner = v_user and v_user is not null),
    'myDelta', coalesce(
      (select (b ->> 'delta')::int from jsonb_array_elements(v_breakdown) b
        where b ->> 'playerId' = v_user::text), 0),
    'myOutcome', coalesce(
      (select b ->> 'result' from jsonb_array_elements(v_breakdown) b
        where b ->> 'playerId' = v_user::text), 'draw'),
    'breakdown', v_breakdown);
end;
$$;

-- ============================================================
-- 5. ESCROW WRITE GUARD
--
-- The v38/v58/v60 RPCs still exist for Triple Threat (sudden-death). Their 1v1
-- blitz path would settle a match by paying DELTAS on top of an already-debited
-- escrow = double spend, and their blitz CREATE path would let a client build a
-- non-escrowed blitz match. Rather than rewrite two large legacy functions, the
-- arena claims its rows at the data layer:
--
--   * an arena match is any row with escrow_amount > 0
--   * an arena write is any session where the RPC set arena.write = '1'
--
-- So a legacy create/answer/start/complete against an arena match raises 42501
-- and the whole PostgREST transaction aborts — including any _sc_apply it had
-- already run. Legacy sudden-death (escrow_amount = 0) is untouched.
-- ============================================================
create or replace function public._arena_claim_write()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform set_config('arena.write', '1', true);
end;
$$;

create or replace function public._arena_guard_match_ins()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Blitz is arena-only: no legacy RPC may mint one (that would bypass escrow).
  if new.format = 'blitz'
     and coalesce(current_setting('arena.write', true), '') <> '1' then
    raise exception 'BLITZ_REQUIRES_ARENA' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public._arena_guard_match_upd()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Once a match is escrowed, ONLY an arena RPC may mutate it.
  if coalesce(old.escrow_amount, 0) > 0
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
  v_escrow int;
begin
  select cm.escrow_amount into v_escrow
  from public.competitive_matches cm where cm.id = v_id;

  if coalesce(v_escrow, 0) > 0
     and coalesce(current_setting('arena.write', true), '') <> '1' then
    raise exception 'ARENA_REQUIRES_ARENA_RPC' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_arena_guard_match_ins on public.competitive_matches;
create trigger trg_arena_guard_match_ins
  before insert on public.competitive_matches
  for each row execute function public._arena_guard_match_ins();

drop trigger if exists trg_arena_guard_match_upd on public.competitive_matches;
create trigger trg_arena_guard_match_upd
  before update on public.competitive_matches
  for each row execute function public._arena_guard_match_upd();

drop trigger if exists trg_arena_guard_answers on public.competitive_match_answers;
create trigger trg_arena_guard_answers
  before insert or update or delete on public.competitive_match_answers
  for each row execute function public._arena_guard_answers();

-- Indexes for the arena hot paths. Without these the per-request lazy sweep
-- would seq-scan competitive_matches on every heartbeat.
create index if not exists idx_cm_arena_live
  on public.competitive_matches (format, status, ends_at)
  where format = 'blitz';

create index if not exists idx_cm_arena_creator_live
  on public.competitive_matches (creator_id, created_at desc)
  where format = 'blitz' and status in ('waiting', 'ready', 'active');

create index if not exists idx_cm_arena_opponent_live
  on public.competitive_matches (opponent_id, created_at desc)
  where format = 'blitz' and status in ('waiting', 'ready', 'active')
    and opponent_id is not null;

create index if not exists idx_cma_match_player
  on public.competitive_match_answers (match_id, player_id, question_index);

-- ============================================================
-- 6. BOT TURN — bots play the SAME board, clock, scoring and Double.
--
-- The bot's answer is a REAL graded row in competitive_match_answers (is_bot),
-- produced by the same points arithmetic as a human's. It is resolved when the
-- human submits (or skips) that index, which keeps the bot in lockstep and
-- needs no cron. skill is server-side; the client never chooses the roll.
-- ============================================================
create or replace function public._arena_bot_turn(p_match_id uuid, p_index int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_m public.competitive_matches%rowtype;
  v_bot uuid;
  v_qid text;
  v_opts jsonb;
  v_correct text;
  v_wrong jsonb;
  v_is_correct boolean := false;
  v_skip boolean := false;
  v_mult int := 1;
  v_pick text;
  v_points int := 0;
  v_skill numeric;
begin
  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null or v_m.opponent_bot is null then
    return null;
  end if;
  if p_index < 0 or p_index >= v_m.question_count then
    return null;
  end if;

  v_bot := public._arena_bot_id(v_m.opponent_bot);

  if exists (
    select 1 from public.competitive_match_answers
    where match_id = p_match_id and player_id = v_bot and question_index = p_index
  ) then
    return jsonb_build_object('ok', true, 'replay', true);
  end if;

  v_qid := jsonb_array_element_text(v_m.question_ids, p_index);
  select q.options, q.correct_answer into v_opts, v_correct
  from public.questions q
  where q.id::text = v_qid and q.exam_framework = 'NMCN' and q.is_active;
  if v_opts is null or v_correct is null then
    return null;
  end if;

  v_skill := public._arena_bot_skill(v_m.opponent_bot);

  -- The bot spends its ONE Double on the same deterministic mid-board question
  -- every match, so the power-up is visible and testable rather than random.
  if p_index = (v_m.question_count / 2)
     and not exists (
       select 1 from public.competitive_match_answers
       where match_id = p_match_id and player_id = v_bot and multiplier = 2
     ) then
    v_mult := 2;
  end if;

  -- Same skip semantics as a human skip: 0 points, counted as skipped.
  if random()::numeric < 0.03 then
    v_skip := true;
    v_pick := null;
    v_is_correct := false;
    v_points := 0;
  elsif random()::numeric < v_skill then
    v_is_correct := true;
    v_pick := v_correct;
    v_points := v_mult;
  else
    v_is_correct := false;
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_wrong
    from jsonb_array_elements_text(v_opts) e
    where public._cm_normalize_answer(e) <> public._cm_normalize_answer(v_correct);
    if v_wrong is null or jsonb_array_length(v_wrong) = 0 then
      v_is_correct := true;
      v_pick := v_correct;
      v_points := v_mult;
    else
      v_pick := v_wrong[(floor(random() * jsonb_array_length(v_wrong)) + 1)::int];
      v_points := 0;
    end if;
  end if;

  insert into public.competitive_match_answers
    (match_id, player_id, question_index, selected_answer, is_correct,
     multiplier, points, skipped, is_bot)
  values
    (p_match_id, v_bot, p_index, v_pick, v_is_correct,
     v_mult, v_points, v_skip, true)
  on conflict (match_id, player_id, question_index) do nothing;

  return jsonb_build_object('ok', true, 'points', v_points,
                            'correct', v_is_correct, 'skipped', v_skip);
end;
$$;

-- ============================================================
-- 7. POST-MATCH REVIEW — answer key released ONLY after the match is terminal.
-- ============================================================
create or replace function public._arena_review(p_match_id uuid, p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_m public.competitive_matches%rowtype;
  v_out jsonb := '[]'::jsonb;
  v_row record;
begin
  select * into v_m from public.competitive_matches where id = p_match_id;
  -- Fail closed: nothing about the answer key leaves before the match ends.
  if v_m.id is null or v_m.status not in ('completed', 'abandoned') then
    return null;
  end if;

  for v_row in
    select q.id::text as id, q.question_text, q.options, q.correct_answer,
           q.explanation, q.hint, q.difficulty,
           a.question_index, a.selected_answer, a.is_correct, a.multiplier,
           a.points, a.skipped
    from public.competitive_match_answers a
    join public.questions q
      on q.id::text = jsonb_array_element_text(v_m.question_ids, a.question_index)
    where a.match_id = p_match_id and a.player_id = p_user
    order by a.question_index
  loop
    v_out := v_out || jsonb_build_object(
      'index', v_row.question_index,
      'question', v_row.question_text,
      'options', v_row.options,
      'difficulty', v_row.difficulty,
      'selected', v_row.selected_answer,
      'isCorrect', v_row.is_correct,
      'skipped', v_row.skipped,
      'multiplier', v_row.multiplier,
      'points', v_row.points,
      'correctAnswer', v_row.correct_answer,
      'explanation', v_row.explanation,
      'hint', v_row.hint);
  end loop;

  return v_out;
end;
$$;

-- ============================================================
-- 8. LAZY SWEEP — grace expiry + no-show. Traffic-driven (no cron available
--    on the Vercel Hobby plan); every arena read/write runs it first.
-- ============================================================
create or replace function public._arena_sweep()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rules jsonb;
  v_gap int;
  v_grace int;
  v_noshow int;
  v_row record;
  v_forfeits int := 0;
  v_cancels int := 0;
begin
  perform public._arena_claim_write();
  v_rules := public._arena_rules();
  v_gap := coalesce((v_rules ->> 'heartbeat_gap_seconds')::int, 10);
  v_grace := coalesce((v_rules ->> 'grace_seconds')::int, 45);
  v_noshow := coalesce((v_rules ->> 'no_show_seconds')::int, 120);

  -- 8.1 A live match whose opponent stopped sending heartbeats marks them
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

  -- 8.2 Forfeit a player who stayed away past the grace window. Both players
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

  -- 8.3 Nobody showed up: refund both sides (nobody is at fault).
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

  return jsonb_build_object('ok', true, 'forfeits', v_forfeits, 'cancels', v_cancels);
end;
$$;

-- ============================================================
-- 9. PUBLIC RPCs
-- ============================================================

-- ------------------------------------------------------------
-- 9.1 arena_create_match — one 1v1 blitz format, TWO-SIDED ESCROW.
--
-- The whole create is one transaction. Both holds (or neither) happen: if the
-- opponent cannot fund their stake, the creator's hold is rolled back with the
-- rest of the subtransaction, so a failed match never costs anybody anything.
-- ------------------------------------------------------------
create or replace function public.arena_create_match(
  p_mode         text   default 'duel',
  p_stake        integer default 0,
  p_opponent_id  uuid   default null,
  p_bot          text   default null
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
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_rules -> 'stakes', '[1]'::jsonb)) t
    where t::int = p_stake
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STAKE');
  end if;

  -- Opponent resolution: either a tutor bot (no account) or a real scholar.
  if v_bot is not null then
    if v_bot not in ('house', 'apollo', 'zainab') then
      return jsonb_build_object('ok', false, 'error', 'INVALID_BOT');
    end if;
    v_opp := null;
  elsif v_opp is null then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_REQUIRED');
  elsif v_opp = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;

  -- Concurrency: take an advisory lock on BOTH players, acquired in sorted
  -- order so two opposing creates can never deadlock, and no player can be
  -- inserted into two matches at the same instant. This is the hard guard
  -- behind "one active match per player" — the checks below alone are racy.
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
  end if;

  -- Replay for a racing pair: both callers get the SAME match id + SAME board.
  -- Checked BEFORE the active-match guard so the second caller is handed the
  -- match it is already part of (with its questions) rather than an error.
  select cm.id into v_existing
  from public.competitive_matches cm
  where cm.format = 'blitz'
    and cm.status in ('waiting', 'ready', 'active')
    and cm.stake = p_stake
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
                              'format', 'blitz', 'stake', p_stake,
                              'opponentBot', v_bot, 'questionCount', v_count,
                              'questions', v_questions);
  end if;

  -- ONE active match per player (now safe: both players are locked above).
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

  -- Atomic create + escrow. The subtransaction means a failure on EITHER side
  -- rolls back the match row AND both holds — nobody is ever charged for a
  -- match that did not happen.
  begin
    insert into public.competitive_matches
      (id, match_type, stake, status, framework, format,
       creator_id, opponent_id, opponent_bot, question_ids, question_count,
       creator_ready, opponent_ready, ready_at, duration_seconds,
       wager_creator_held, wager_opponent_held, escrow_amount,
       last_seen_creator_at, last_seen_opponent_at)
    values
      (v_m, 'duel', p_stake, v_status, 'NMCN', 'blitz',
       v_user, v_opp, v_bot, v_qids, jsonb_array_length(v_qids),
       true, (v_bot is not null), (case when v_bot is not null then now() else null end),
       v_dur,
       false, false, 0,
       now(), (case when v_opp is not null then now() else null end));

    v_res := public._arena_hold(v_m, v_user, p_stake);
    if not coalesce((v_res ->> 'ok')::boolean, false) then
      raise exception 'ESCROW_CREATOR_FAILED' using errcode = 'P0001';
    end if;

    if v_opp is not null then
      v_res := public._arena_hold(v_m, v_opp, p_stake);
      if not coalesce((v_res ->> 'ok')::boolean, false) then
        raise exception 'ESCROW_OPPONENT_FAILED' using errcode = 'P0001';
      end if;
    end if;

    update public.competitive_matches
       set wager_creator_held = true,
           wager_opponent_held = (v_opp is not null),
           escrow_amount = p_stake * (case when v_opp is not null then 2 else 1 end)
     where id = v_m;
  exception when others then
    return jsonb_build_object(
      'ok', false, 'error', 'ESCROW_FAILED',
      'detail', case when sqlerrm like '%ESCROW_OPPONENT%' then 'OPPONENT_INSUFFICIENT_SC'
                     else 'INSUFFICIENT_SC' end,
      'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0));
  end;

  perform public._arena_log(v_m, v_user, 'created', jsonb_build_object(
    'stake', p_stake, 'bot', v_bot, 'opponent', v_opp,
    'escrow', p_stake * (case when v_opp is not null then 2 else 1 end)));

  -- The queue slot is consumed by the match.
  delete from public.arena_queue where user_id in (v_user, v_opp);

  return jsonb_build_object('ok', true, 'replay', false, 'matchId', v_m,
                            'status', v_status, 'format', 'blitz',
                            'stake', p_stake, 'opponentBot', v_bot,
                            'durationSeconds', v_dur,
                            'escrowed', p_stake * (case when v_opp is not null then 2 else 1 end),
                            'questionCount', jsonb_array_length(v_qids),
                            'questions', v_questions);
end;
$$;

-- ------------------------------------------------------------
-- 9.2 arena_ready — the both-sides confirmation handshake.
-- ------------------------------------------------------------
create or replace function public.arena_ready(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_status text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;
  if v_m.status not in ('waiting', 'ready') then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_WAITING',
                              'status', v_m.status);
  end if;

  update public.competitive_matches
     set creator_ready = (creator_id = v_user) or creator_ready,
         opponent_ready = (opponent_id = v_user) or opponent_ready,
         status = case
                    when (creator_ready or creator_id = v_user)
                     and (opponent_ready or opponent_id = v_user)
                    then 'ready' else status end,
         ready_at = case
                    when (creator_ready or creator_id = v_user)
                     and (opponent_ready or opponent_id = v_user)
                    then coalesce(ready_at, now()) else ready_at end
   where id = p_match_id
  returning status into v_status;

  perform public._arena_log(p_match_id, v_user, 'ready', jsonb_build_object('status', v_status));

  return jsonb_build_object('ok', true, 'matchId', p_match_id, 'status', v_status,
                            'canStart', v_status = 'ready');
end;
$$;

-- ------------------------------------------------------------
-- 9.3 arena_start — opens the shared clock. Requires BOTH players ready.
-- ------------------------------------------------------------
create or replace function public.arena_start(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;
  if v_m.starts_at is not null then
    return jsonb_build_object('ok', true, 'replay', true, 'matchId', p_match_id,
                              'startsAt', v_m.starts_at, 'endsAt', v_m.ends_at);
  end if;
  -- The handshake is the whole point: nobody's stake is at risk until both
  -- sides have explicitly confirmed.
  if v_m.status <> 'ready'
     or not (v_m.creator_ready and (v_m.opponent_ready or v_m.opponent_bot is not null)) then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_READY',
                              'status', v_m.status,
                              'creatorReady', v_m.creator_ready,
                              'opponentReady', v_m.opponent_ready);
  end if;

  update public.competitive_matches
     set status = 'active',
         starts_at = now(),
         ends_at = now() + make_interval(secs => coalesce(duration_seconds, 90)),
         last_seen_creator_at = now(),
         last_seen_opponent_at = now()
   where id = p_match_id
  returning starts_at, ends_at into v_starts, v_ends;

  perform public._arena_log(p_match_id, v_user, 'started', jsonb_build_object(
    'startsAt', v_starts, 'endsAt', v_ends));

  return jsonb_build_object('ok', true, 'matchId', p_match_id,
                            'startsAt', v_starts, 'endsAt', v_ends);
end;
$$;

-- ------------------------------------------------------------
-- 9.4 arena_answer — grade, skip, Double, and the bot's turn.
--
-- points is written here and ONLY here, derived from the stored answer key.
-- A client that sends a double on the wrong question, or answers after the
-- clock, or tries to answer twice, is rejected by the database.
-- ------------------------------------------------------------
create or replace function public.arena_answer(
  p_match_id uuid,
  p_question_index integer,
  p_selected text default null,
  p_double boolean default false,
  p_skipped boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_qid text;
  v_correct text;
  v_is_correct boolean := false;
  v_mult int := 1;
  v_points int := 0;
  v_skip boolean := coalesce(p_skipped, false) or p_selected is null;
  v_first boolean := false;
  v_inserted boolean;
  v_bot_turn jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;
  if v_m.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_ACTIVE',
                              'status', v_m.status);
  end if;
  if v_m.starts_at is null or now() > v_m.ends_at then
    return jsonb_build_object('ok', false, 'error', 'MATCH_EXPIRED');
  end if;
  if p_question_index < 0 or p_question_index >= v_m.question_count then
    return jsonb_build_object('ok', false, 'error', 'INVALID_QUESTION_INDEX');
  end if;

  if not v_skip then
    v_qid := jsonb_array_element_text(v_m.question_ids, p_question_index);
    select q.correct_answer into v_correct
    from public.questions q
    where q.id::text = v_qid and q.exam_framework = 'NMCN' and q.is_active;
    if v_correct is null then
      return jsonb_build_object('ok', false, 'error', 'NO_ANSWER_KEY');
    end if;
    v_is_correct := public._cm_normalize_answer(p_selected)
                    = public._cm_normalize_answer(v_correct);

    -- The ONE Double: consumed only by a real, non-skipped submit, and only
    -- for this question. A losing race falls through to the stored grade.
    if p_double and not exists (
      select 1 from public.competitive_match_answers
      where match_id = p_match_id and player_id = v_user and multiplier = 2
    ) then
      v_mult := 2;
    end if;

    -- Locked scoring: correct 1 (2 with Double), incorrect 0, skip 0.
    v_points := case when v_is_correct then v_mult else 0 end;
  end if;

  -- FIRST-ANSWER-WINS. The Double is spent only if this insert actually won;
  -- a replay never burns it.
  --
  -- `on conflict do nothing` does NOT raise, so the winning insert is detected
  -- via RETURNING (no row => no insert => replay). A collision on the partial
  -- uq_cma_one_double index is a DIFFERENT constraint, so it raises and is
  -- caught: the race loser falls through to the stored grade.
  begin
    insert into public.competitive_match_answers
      (match_id, player_id, question_index, selected_answer, is_correct,
       multiplier, points, skipped, is_bot)
    values
      (p_match_id, v_user, p_question_index,
       case when v_skip then null else p_selected end,
       v_is_correct, v_mult, v_points, v_skip, false)
    on conflict (match_id, player_id, question_index) do nothing
    returning true into v_inserted;
    v_first := coalesce(v_inserted, false);
  exception when unique_violation then
    v_first := false;
  end;

  if not v_first then
    select a.is_correct, a.multiplier, a.points, a.skipped
      into v_is_correct, v_mult, v_points, v_skip
    from public.competitive_match_answers a
    where a.match_id = p_match_id and a.player_id = v_user
      and a.question_index = p_question_index;
  end if;

  -- The bot answers the same index now, so the scoreboard advances live.
  v_bot_turn := public._arena_bot_turn(p_match_id, p_question_index);

  perform public._arena_log(p_match_id, v_user, 'answered',
    jsonb_build_object('index', p_question_index, 'points', v_points,
                       'multiplier', v_mult, 'skipped', v_skip));

  return jsonb_build_object(
    'ok', true, 'matchId', p_match_id, 'questionIndex', p_question_index,
    'isCorrect', v_is_correct, 'skipped', v_skip,
    'multiplier', v_mult, 'points', v_points,
    'double', (v_mult = 2), 'replay', not v_first,
    'myScore', public._arena_score(p_match_id, v_user),
    'botTurn', v_bot_turn,
    'remainingMs', (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint);
end;
$$;

-- ------------------------------------------------------------
-- 9.5 arena_heartbeat — grace timer + lazy sweep.
-- ------------------------------------------------------------
create or replace function public.arena_heartbeat(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_rules jsonb;
  v_sweep jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  -- Sweep FIRST: this may settle the match, after which the heartbeat below
  -- correctly finds a terminal row.
  v_sweep := public._arena_sweep();

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
           -- Reconnecting inside the grace window clears the disconnect flag.
           disconnected_creator_at = case when creator_id = v_user then null else disconnected_creator_at end,
           disconnected_opponent_at = case when opponent_id = v_user then null else disconnected_opponent_at end
     where id = p_match_id;
  end if;

  return jsonb_build_object(
    'ok', true, 'matchId', p_match_id, 'status', v_m.status,
    'graceSeconds', coalesce((v_rules ->> 'grace_seconds')::int, 45),
    'opponentDisconnected', (v_m.opponent_id is not null
      and v_m.disconnected_opponent_at is not null),
    'opponentReconnected', (v_m.opponent_id is not null
      and v_m.disconnected_opponent_at is null
      and v_m.last_seen_opponent_at is not null),
    'remainingMs', case when v_m.starts_at is null then null
      else greatest(0, (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint) end,
    'myScore', case when v_m.creator_id = v_user then public._arena_score(p_match_id, v_user)
                     else public._arena_score(p_match_id, v_user) end);
end;
$$;

-- ------------------------------------------------------------
-- 9.6 arena_forfeit — voluntary, immediate, no grace.
-- ------------------------------------------------------------
create or replace function public.arena_forfeit(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  perform public._arena_log(p_match_id, v_user, 'forfeit', '{}'::jsonb);
  return public._arena_resolve(p_match_id, 'forfeit', v_user, v_user);
end;
$$;

-- ------------------------------------------------------------
-- 9.7 arena_cancel — creator backs out before the clock opens. Refund both.
-- ------------------------------------------------------------
create or replace function public.arena_cancel(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if v_m.creator_id <> v_user then
    return jsonb_build_object('ok', false, 'error', 'NOT_THE_CREATOR');
  end if;
  if v_m.starts_at is not null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_ALREADY_STARTED');
  end if;

  delete from public.arena_queue where user_id = v_user;
  perform public._arena_log(p_match_id, v_user, 'cancel', '{}'::jsonb);
  return public._arena_resolve(p_match_id, 'cancel', null, v_user);
end;
$$;

-- ------------------------------------------------------------
-- 9.8 arena_settle — end of the shared clock. Idempotent.
-- ------------------------------------------------------------
create or replace function public.arena_settle(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  perform public._arena_sweep();
  return public._arena_resolve(p_match_id, 'time', null, v_user);
end;
$$;

-- ------------------------------------------------------------
-- 9.9 arena_state — reconnect / resume payload + post-match review.
-- ------------------------------------------------------------
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
  v_sweep jsonb;
  v_remaining bigint;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  v_sweep := public._arena_sweep();

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

  -- The answer key is released ONLY once the match is terminal.
  v_review := public._arena_review(p_match_id, v_user);

  return jsonb_build_object(
    'ok', true, 'matchId', v_m.id, 'status', v_m.status,
    'mode', v_m.match_type, 'format', 'blitz', 'stake', v_m.stake,
    'framework', 'NMCN', 'questionCount', v_m.question_count,
    'opponentBot', v_m.opponent_bot,
    'opponentName', public._arena_name(v_m, v_opp_live),
    'opponentIsBot', (v_m.opponent_bot is not null),
    'escrowed', v_m.escrow_amount,
    'creatorReady', v_m.creator_ready, 'opponentReady', v_m.opponent_ready,
    'startsAt', v_m.starts_at, 'endsAt', v_m.ends_at,
    'remainingMs', v_remaining,
    'graceSeconds', coalesce((v_rules ->> 'grace_seconds')::int, 45),
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

-- ------------------------------------------------------------
-- 9.10 arena_outcome — cheap result poll (no question payload).
-- ------------------------------------------------------------
create or replace function public.arena_outcome(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  if v_m.status in ('waiting', 'ready', 'active')
     and v_m.starts_at is not null and now() > v_m.ends_at then
    return public._arena_resolve(p_match_id, 'time', null, v_user);
  end if;

  return jsonb_build_object(
    'ok', true, 'matchId', p_match_id, 'status', v_m.status,
    'outcome', v_m.outcome, 'abandonReason', v_m.abandon_reason,
    'remainingMs', case when v_m.starts_at is null then null
      else greatest(0, (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint) end);
end;
$$;

-- ------------------------------------------------------------
-- 9.11 arena_enqueue / arena_leave_queue — server-side matchmaking.
--
-- A slot is only paired when (mode, stake, format) match EXACTLY, so a client
-- cannot be matched into a wager it did not choose.
-- ------------------------------------------------------------
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
  v_existing uuid;
  v_m uuid;
  v_res jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();
  perform public._arena_sweep();

  v_rules := public._arena_rules();
  if p_mode <> 'duel' then
    return jsonb_build_object('ok', false, 'error', 'ARENA_IS_1V1');
  end if;
  if p_format <> 'blitz' then
    return jsonb_build_object('ok', false, 'error', 'ARENA_FORMAT_LOCKED');
  end if;
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_rules -> 'stakes', '[1]'::jsonb)) t
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

  -- Partner must be an activated, solvent scholar on an identical wager.
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
    return jsonb_build_object('ok', true, 'queued', true, 'stake', p_stake);
  end if;

  delete from public.arena_queue where user_id in (v_user, v_partner.user_id);

  -- Create through the single escrow path. If it fails, the partner is simply
  -- re-queued on their next poll rather than left hanging.
  v_res := public.arena_create_match('duel', p_stake, v_partner.user_id, null);
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

create or replace function public.arena_leave_queue()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_removed int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();

  delete from public.arena_queue where user_id = v_user;
  get diagnostics v_removed = row_count;

  return jsonb_build_object('ok', true, 'leftQueue', v_removed > 0);
end;
$$;

-- ------------------------------------------------------------
-- 9.12 arena_roster — live queue, HUMANS FIRST, bots after.
--
-- The bot is always instant (no queue slot, no escrow race), so it is listed
-- last and never consumes a human's turn.
-- ------------------------------------------------------------
create or replace function public.arena_roster(
  p_stake integer default 0,
  p_format text default 'blitz'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_players jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select coalesce(jsonb_agg(obj), '[]'::jsonb) into v_players
  from (
    select jsonb_build_object(
             'userId', q.user_id,
             'name', coalesce(cp.display_name, 'Scholar'),
             'stake', q.stake,
             'isBot', false,
             'waitingSince', q.created_at,
             'skill', null) as obj
    from public.arena_queue q
    join public.profiles p on p.id = q.user_id
    left join public.community_profiles cp on cp.id = q.user_id
    where q.user_id <> v_user
      and q.mode = 'duel'
      and q.format = 'blitz'
      and (p_stake = 0 or q.stake = p_stake)
      and p.is_activated
      and coalesce(p.smart_coins, 0) >= q.stake
      and public._arena_in_active_match(q.user_id) is null
    order by q.created_at asc
    limit 30
  ) humans;

  return jsonb_build_object('ok', true, 'stake', p_stake, 'format', 'blitz',
                            'players', v_players);
end;
$$;

-- ============================================================
-- 10. SEAL THE LEGACY BLITZ PATH
--
-- create_competitive_match / submit_competitive_answer /
-- complete_competitive_match are still used for Triple Threat
-- (format = 'sudden_death', escrow_amount = 0). The v63 triggers in section 5
-- already refuse any of them touching a blitz match, so this section only has
-- to make the refusal legible and the ACLs correct.
-- ============================================================

-- ============================================================
-- 11. ACLs (LIVE GRANT GOTCHA: default privileges auto-grant anon +
--    authenticated on every new function — revoke all three explicitly)
-- ============================================================
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
    -- resolve the live signature(s) and lock each one down
    for v_sig in
      select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
    loop
      execute format('revoke all on function %s from public, anon', v_sig);
      execute format('grant execute on function %s to authenticated', v_sig);
    end loop;
  end loop;
end $$;

-- Internal helpers are NEVER client-callable (service_role only, like _sc_apply).
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
    '_arena_guard_match_ins', '_arena_guard_match_upd', '_arena_guard_answers'
  ];
  foreach v_fn in array v_fns loop
    for v_sig in
      select p.oid::regprocedure::text
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_sig);
      execute format('grant execute on function %s to service_role', v_sig);
    end loop;
  end loop;
end $$;

-- Tables: deny-all to clients (RLS enabled with no policies already does this,
-- but be explicit for the audit trail).
revoke all on public.arena_queue from public, anon, authenticated;
revoke all on public.arena_match_events from public, anon, authenticated;
grant all on public.arena_queue to service_role;
grant all on public.arena_match_events to service_role;

-- ============================================================
-- 12. PostgREST schema reload — makes the new RPCs immediately callable
-- ============================================================
notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================