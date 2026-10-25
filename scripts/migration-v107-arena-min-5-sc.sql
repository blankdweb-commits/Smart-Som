-- ============================================================
-- migration-v107-arena-min-5-sc.sql
--
-- WHY THIS EXISTS. v106 treated account ACTIVATION as the arena's entry
-- requirement, for the caller and for the opponent. The product decision is now
-- the opposite: a scholar does not need to be activated to challenge or to be
-- challenged. What matters is that every participant can cover the match, so
-- the arena requires at least 5 Smart Coins instead.
--
-- THE RULE
--   * Activation is NOT consulted anywhere in the arena.
--   * A real (staked) duel requires BOTH participants to hold >= 5 SC.
--   * Tutor practice stays free and needs no minimum: a bot match is stake 0,
--     escrow 0 and never touches the ledger.
--   * The stake itself is untouched (still the fixed 2 SC); the 5 SC figure is
--     a solvency floor, not a second charge.
--
-- SURFACES UPDATED (all keep their existing signatures, so no PGRST203):
--   arena_challenge_targets / arena_challenge_status / arena_roster
--   arena_invite / arena_invite_respond's create path / arena_enqueue
--   _arena_create_match_core (the body the v86 wrapper calls)
--
-- The old NOT_ACTIVATED / OPPONENT_NOT_ACTIVATED codes are no longer emitted by
-- the arena. Clients that still carry those strings are harmless; the live
-- refusal for an under-funded participant is INSUFFICIENT_SC /
-- OPPONENT_INSUFFICIENT_SC.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v107-arena-min-5-sc.sql
-- ============================================================


-- ---------------------------------------------------------------------------
-- 1. GLOBAL RANKING ELIGIBILITY.
-- ---------------------------------------------------------------------------
create or replace function public.arena_challenge_targets(
  p_limit  integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_stake int := coalesce(
    nullif(public._arena_rules() ->> 'stake_fixed', '')::int,
    (select min((t::int)::int)
       from jsonb_array_elements_text(
              coalesce(public._arena_rules() -> 'stakes', '[2]'::jsonb)) t
      where (t::text) ~ '^\s*\d+\s*$'),
    2);
  v_min int := greatest(coalesce(
    nullif(public._arena_rules() ->> 'stake_fixed', '')::int, 2), 5);
  v_me_coins int := 0;
  v_me_busy boolean := false;
  v_caller text;
  v_limit int := greatest(least(coalesce(p_limit, 100), 500), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select coalesce(p.smart_coins, 0)
    into v_me_coins
    from public.profiles p where p.id = v_me;
  v_me_busy := (public._arena_in_active_match(v_me) is not null);

  -- v107: activation is not a gate. Solvency is.
  v_caller := case
                when v_me_busy then 'ALREADY_IN_MATCH'
                when coalesce(v_me_coins, 0) < v_min then 'INSUFFICIENT_SC'
                else null end;

  select count(*) into v_total from public.v_competitive_base;

  with ranked as (
    select v.user_id,
           row_number() over (
             order by (v.parts ->> 'score')::int desc,
                      (v.parts ->> 'threeVThreeWins')::int desc,
                      (v.parts ->> 'oneVOneWins')::int desc,
                      (v.parts ->> 'wins')::int desc,
                      v.sc_balance desc,
                      v.user_id asc
           )::int as rank
      from public.v_competitive_base v
  ),
  scoped as (
    select r.user_id, r.rank
      from ranked r
     where r.user_id <> v_me
     order by r.rank asc
     limit v_limit offset v_offset
  ),
  facts as (
    select s.user_id, s.rank,
           coalesce(pb.smart_coins, 0) as coins
      from scoped s
      left join public.profiles pb on pb.id = s.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', f.rank,
           'userId', f.user_id,
           'name', public._person_pair_name(v_me, f.user_id),
           'inMatch', x.busy,
           'callerBlocked', v_caller,
           'canChallenge', f.coins >= v_min
                               and not x.busy
                               and not x.open_pair
                               and not x.blocked,
           'reason', case
                       when x.blocked then 'BLOCKED'
                       when x.busy then 'OPPONENT_BUSY'
                       when f.coins < v_min then 'OPPONENT_INSUFFICIENT_SC'
                       when x.open_pair then 'INVITE_ALREADY_OPEN'
                       else null end
         ) order by f.rank asc), '[]'::jsonb)
    into v_rows
    from facts f
    cross join lateral (
      select (public._arena_in_active_match(f.user_id) is not null) as busy,
             exists (
               select 1 from public.arena_invites i
                where i.status = 'pending'
                  and ((i.from_user = v_me and i.to_user = f.user_id)
                    or (i.to_user = v_me and i.from_user = f.user_id))
             ) as open_pair,
             public._blocked_between(v_me, f.user_id) as blocked
    ) x;

  return jsonb_build_object(
    'ok', true,
    'stake', v_stake,
    'minCoins', v_min,
    'totalPlayers', v_total,
    'callerBlocked', v_caller,
    'callerReason', v_caller,
    'players', v_rows
  );
end;
$$;

revoke all on function public.arena_challenge_targets(integer, integer)
  from public, anon, authenticated;
grant execute on function public.arena_challenge_targets(integer, integer)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. THE SCHOLARS LIST. Every profile is listed, activated or not.
-- ---------------------------------------------------------------------------
create or replace function public.arena_roster(
  p_stake integer default 0,
  p_format text default 'blitz',
  p_query text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_window int;
  v_players jsonb;
  v_online int := 0;
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_filter boolean := v_q is not null and char_length(v_q) >= 2;
  v_limit int := case when v_filter then 25 else 30 end;
  v_stake_fixed int := coalesce(
    nullif(public._arena_rules() ->> 'stake_fixed', '')::int, 2);
  v_stake int := case
                   when coalesce(p_stake, 0) <= 0 then v_stake_fixed
                   else p_stake
                 end;
  v_min int := greatest(v_stake, 5);
  v_me public.profiles%rowtype;
  v_caller text;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  perform public._arena_touch_presence(v_user);

  v_window := coalesce((public._arena_rules() ->> 'presence_window_seconds')::int, 90);

  select * into v_me from public.profiles where id = v_user;
  v_caller := case
                when v_me.id is null then 'NO_PROFILE'
                when public._arena_in_active_match(v_user) is not null
                  then 'ALREADY_IN_MATCH'
                when coalesce(v_me.smart_coins, 0) < v_min
                  then 'INSUFFICIENT_SC'
                else null end;

  with rows as (
    select p.id,
           case
             when public._arena_pair_dueled(v_user, p.id)
               then public._person_name(p.id, 'real')
             else public._person_name(p.id, 'pseudonym')
           end as name,
           coalesce(ap.last_seen_at, p.last_active_date::timestamptz) as seen,
           coalesce(p.smart_coins, 0) as coins,
           (public._arena_in_active_match(p.id) is not null) as busy,
           case
             when coalesce(ap.last_seen_at, p.last_active_date::timestamptz)
                  >= now() - make_interval(secs => v_window)
             then 1 else 0
           end as seen_recently,
           exists (
             select 1 from public.arena_invites i
              where i.status = 'pending'
                and ((i.from_user = v_user and i.to_user = p.id)
                  or (i.to_user = v_user and i.from_user = p.id))
           ) as open_pair,
           public._blocked_between(v_user, p.id) as blocked
      from public.profiles p
      left join public.arena_presence ap on ap.user_id = p.id
     where p.id <> v_user
       and (
         not v_filter
         or p.identity_name ilike '%' || v_q || '%'
         or p.full_name ilike '%' || v_q || '%'
         or substr(md5(p.id::text), 1, 6) ilike '%' || v_q || '%'
       )
  ), shaped as (
    select r.id, r.name, r.seen, r.coins, r.busy, r.seen_recently,
           r.open_pair, r.blocked,
           case
             when r.busy then 'in_match'
             when r.seen_recently = 1 then 'available'
             else 'offline'
           end as status
      from rows r
  )
  select
    coalesce(jsonb_agg(obj), '[]'::jsonb),
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
             -- Eligibility is about the duel, not activation and not the dot.
             'canChallenge', (coins >= v_min
                              and not busy
                              and not open_pair
                              and not blocked),
             'inMatch', busy,
             'openInvite', open_pair,
             'reason', case
                         when blocked then 'BLOCKED'
                         when busy then 'OPPONENT_BUSY'
                         when coins < v_min then 'OPPONENT_INSUFFICIENT_SC'
                         when open_pair then 'INVITE_ALREADY_OPEN'
                         else null end,
             'stake', v_stake,
             'isBot', false) as obj
      from shaped
     order by case status when 'available' then 0 when 'in_match' then 1 else 2 end,
              seen desc nulls last
     limit v_limit
  ) top;

  return jsonb_build_object('ok', true, 'stake', v_stake, 'format', 'blitz',
                            'minCoins', v_min,
                            'online', v_online, 'windowSeconds', v_window,
                            'query', v_q,
                            'searching', v_filter,
                            'callerBlocked', v_caller,
                            'callerReason', v_caller,
                            'players', v_players);
end;
$$;

revoke all on function public.arena_roster(integer, text, text)
  from public, anon, authenticated;
grant execute on function public.arena_roster(integer, text, text)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 3. ELIGIBILITY FOR AN ARBITRARY LIST OF IDS.
-- ---------------------------------------------------------------------------
create or replace function public.arena_challenge_status(
  p_user_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_stake int := coalesce(
    nullif(public._arena_rules() ->> 'stake_fixed', '')::int,
    (select min((t::int)::int)
       from jsonb_array_elements_text(
              coalesce(public._arena_rules() -> 'stakes', '[2]'::jsonb)) t
      where (t::text) ~ '^\s*\d+\s*$'),
    2);
  v_min int := greatest(coalesce(
    nullif(public._arena_rules() ->> 'stake_fixed', '')::int, 2), 5);
  v_me_coins int := 0;
  v_caller text;
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select coalesce(p.smart_coins, 0)
    into v_me_coins
    from public.profiles p where p.id = v_me;

  v_caller := case
                when public._arena_in_active_match(v_me) is not null
                  then 'ALREADY_IN_MATCH'
                when coalesce(v_me_coins, 0) < v_min then 'INSUFFICIENT_SC'
                else null end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', f.user_id,
           'name', public._person_pair_name(v_me, f.user_id),
           'inMatch', x.busy,
           'canChallenge', f.coins >= v_min
                               and not x.busy
                               and not x.open_pair
                               and not x.blocked,
           'reason', case
                       when x.blocked then 'BLOCKED'
                       when x.busy then 'OPPONENT_BUSY'
                       when f.coins < v_min then 'OPPONENT_INSUFFICIENT_SC'
                       when x.open_pair then 'INVITE_ALREADY_OPEN'
                       else null end,
           'stake', v_stake,
           'isBot', false
         ) order by f.user_id), '[]'::jsonb)
    into v_rows
    from (
      select s.id as user_id,
             coalesce(pb.smart_coins, 0) as coins
        from (
          select distinct t.id
            from unnest(coalesce(p_user_ids, '{}'::uuid[])) as t(id)
           where t.id is not null
             and t.id <> v_me
           limit 200
        ) s
        join public.profiles pb on pb.id = s.id
    ) f
    cross join lateral (
      select (public._arena_in_active_match(f.user_id) is not null) as busy,
             exists (
               select 1 from public.arena_invites i
                where i.status = 'pending'
                  and ((i.from_user = v_me and i.to_user = f.user_id)
                    or (i.to_user = v_me and i.from_user = f.user_id))
             ) as open_pair,
             public._blocked_between(v_me, f.user_id) as blocked
    ) x;

  return jsonb_build_object(
    'ok', true,
    'stake', v_stake,
    'minCoins', v_min,
    'callerBlocked', v_caller,
    'callerReason', v_caller,
    'players', v_rows
  );
end;
$$;

revoke all on function public.arena_challenge_status(uuid[])
  from public, anon, authenticated;
grant execute on function public.arena_challenge_status(uuid[])
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 4. SENDING AN INVITE. Activation is irrelevant; 5 SC is the floor.
-- ---------------------------------------------------------------------------
create or replace function public.arena_invite(p_to_user uuid, p_stake integer default 2)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_rules jsonb;
  v_prof public.profiles%rowtype;
  v_target public.profiles%rowtype;
  v_stake int := coalesce(p_stake, 2);
  v_min int;
  v_id bigint;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if p_to_user is null or p_to_user = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;

  perform public._arena_sweep();

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;

  v_rules := public._arena_rules();
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_rules -> 'stakes', '[2]'::jsonb)) t
     where t::int = v_stake
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STAKE');
  end if;

  v_min := greatest(v_stake, 5);
  if coalesce(v_prof.smart_coins, 0) < v_min then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'balance', coalesce(v_prof.smart_coins, 0),
                              'minCoins', v_min);
  end if;

  if public._arena_in_active_match(v_user) is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_MATCH');
  end if;

  select * into v_target from public.profiles where id = p_to_user;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_FOUND');
  end if;

  -- Target-side refusals. busy -> blocked -> open pair -> coins.
  if public._arena_in_active_match(p_to_user) is not null then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_BUSY');
  end if;
  if public._blocked_between(v_user, p_to_user) then
    return jsonb_build_object('ok', false, 'error', 'BLOCKED');
  end if;
  if exists (select 1 from public.arena_invites i
              where i.status = 'pending'
                and ((i.from_user = v_user and i.to_user = p_to_user)
                  or (i.from_user = p_to_user and i.to_user = v_user))) then
    return jsonb_build_object('ok', false, 'error', 'INVITE_ALREADY_OPEN');
  end if;
  if coalesce(v_target.smart_coins, 0) < v_min then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_INSUFFICIENT_SC',
                              'balance', coalesce(v_target.smart_coins, 0),
                              'minCoins', v_min);
  end if;

  insert into public.arena_invites (from_user, to_user, stake)
  values (v_user, p_to_user, v_stake)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    if exists (select 1 from public.arena_invites i
                where i.status = 'pending'
                  and ((i.from_user = v_user and i.to_user = p_to_user)
                    or (i.from_user = p_to_user and i.to_user = v_user))) then
      return jsonb_build_object('ok', false, 'error', 'INVITE_ALREADY_OPEN');
    end if;
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RELATED');
  end if;

  return jsonb_build_object('ok', true, 'inviteId', v_id, 'stake', v_stake,
                            'minCoins', v_min,
                            'toName', public._person_name(p_to_user, 'pseudonym'),
                            'toUserId', p_to_user);
end;
$$;

revoke all on function public.arena_invite(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.arena_invite(uuid, integer)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 5. MATCH CREATION. The v86 wrapper keeps its bot/practice normalisation; the
--    core is re-created only to replace the activation gate with the solvency
--    floor. Every other line is the v64 body (escrow, lock order, replay and
--    settlement contract untouched).
-- ---------------------------------------------------------------------------
create or replace function public._arena_create_match_core(
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
  v_min int;
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

  -- v107: activation is no longer required. A staked duel needs 5 SC; practice
  -- (stake forced to 0 above) does not.
  v_min := greatest(v_stake, 5);
  if not v_practice and coalesce(v_prof.smart_coins, 0) < v_min then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'balance', coalesce(v_prof.smart_coins, 0),
                              'minCoins', v_min);
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
    if coalesce(v_opp_prof.smart_coins, 0) < v_min then
      return jsonb_build_object('ok', false, 'error', 'OPPONENT_INSUFFICIENT_SC',
                                'minCoins', v_min);
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

revoke all on function public._arena_create_match_core(text, integer, uuid, text, boolean)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. MATCHMAKING QUEUE. Same 5 SC floor, and non-activated players are
--    eligible partners.
-- ---------------------------------------------------------------------------
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
  v_min int;
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

  v_min := greatest(p_stake, 5);
  if coalesce(v_prof.smart_coins, 0) < v_min then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'balance', coalesce(v_prof.smart_coins, 0),
                              'minCoins', v_min);
  end if;

  if public._arena_in_active_match(v_user) is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_MATCH',
                              'matchId', public._arena_in_active_match(v_user));
  end if;

  v_lock := 'arena_queue:' || p_mode || ':' || p_stake::text;
  perform pg_advisory_xact_lock(hashtext(v_lock));

  select q.user_id into v_partner
  from public.arena_queue q
  join public.profiles p on p.id = q.user_id
  where q.user_id <> v_user
    and q.mode = p_mode
    and q.stake = p_stake
    and q.format = 'blitz'
    and coalesce(p.smart_coins, 0) >= v_min
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
                              'minCoins', v_min,
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

revoke all on function public.arena_enqueue(text, integer, text)
  from public, anon, authenticated;
grant execute on function public.arena_enqueue(text, integer, text)
  to authenticated, service_role;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
