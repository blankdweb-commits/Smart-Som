-- ============================================================
-- migration-v106-arena-challenge-eligibility.sql
--
-- WHY THIS EXISTS. Two surfaces showed a dead Challenge button and neither
-- could say why:
--
--   * Global Ranking (Leaderboard -> RankingBoard) disables a row when
--     arena_challenge_targets says it cannot be challenged.
--   * War Hall -> Online scholars disables a row when arena_roster says so.
--
-- The two functions disagreed about what "cannot be challenged" means, and
-- one of them disagreed with its own client.
--
-- 1. arena_roster gated canChallenge on `status = 'available'`, i.e. on
--    presence. Presence is a display fact, not a permission: arena_invite
--    never checked it, and an offline scholar still has a 10-minute invite
--    window in which nothing is escrowed until they accept. The UI was
--    strictly stricter than the server, for no reason the player could act on.
--
-- 2. arena_challenge_targets emitted callerBlocked INSIDE every player row
--    (v93), never at the top level. Leaderboard.jsx read `res.callerBlocked`,
--    got undefined, and so the caller-side banner ("you are already in a
--    duel" / "you need 2 SC") never rendered. The rows were right; the
--    envelope lied.
--
-- 3. arena_invite checked the CALLER's coins and match state, but not the
--    TARGET's. A target with 1 SC, a target already in a duel, a blocked
--    pair and an already-open invite all failed late (on insert, or on
--    accept) instead of at the moment the invite was sent. The client could
--    only discover the real reason after a round trip.
--
-- WHAT THIS MIGRATION DOES
--
--   * arena_challenge_targets  (same signature) - add TOP-LEVEL
--     callerBlocked/callerReason. The per-row field is kept untouched so an
--     older client keeps working.
--   * arena_roster             (same signature) - presence no longer gates
--     canChallenge. Adds inMatch/openInvite/reason per row and
--     callerBlocked/callerReason/top-level stake. A blank p_stake now means
--     the arena's fixed stake instead of 0 (0 made every row affordable).
--   * arena_challenge_status   (NEW) - the same eligibility answer for an
--     ARBITRARY list of user ids, so search results and leaderboard pages
--     beyond the first 100 can be resolved without fetching the whole board.
--     A new name, not an overload: PGRST203 is unforgiving about overloads.
--   * arena_invite             (same signature) - refuse the four target-side
--     cases up front, in a stable order, and sweep expired rows first so a
--     stale match cannot look like a live duel.
--
-- REFUSAL ORDER. Caller-side first (activation, stake, coins, active match),
-- then target-side (exists, activated, busy, blocked, open invite, coins).
-- On the target side busy precedes blocked, blocked precedes an open invite,
-- and an open invite precedes insufficient coins, because "there is already a
-- challenge between you" is more useful than "the opponent is poor" when both
-- are true. The read RPCs keep v93's row precedence (blocked first) so older
-- clients see exactly the labels they saw before. The client's BLOCKED_COPY
-- table already understands every code below.
--
-- NOT CHANGED HERE: the stake is still the fixed 2 SC (stakes list and
-- arena_invite's accepted values are untouched), no coins move when an invite
-- is sent, premium still grants no arena privilege, and no sweep is added to
-- the read paths. Arena reads stay read-only; the 60-second api/session.js
-- touch already runs _arena_sweep() for every signed-in user.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v106-arena-challenge-eligibility.sql
-- ============================================================


-- ---------------------------------------------------------------------------
-- 1. GLOBAL RANKING ELIGIBILITY - top-level caller state.
--
-- Body is v93's, unchanged except for hoisting the caller refusal into a
-- variable that is returned both per row (backward compatibility) and on the
-- envelope (what the client actually reads).
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
  v_me_coins int := 0;
  v_me_activated boolean := false;
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

  select coalesce(p.smart_coins, 0), coalesce(p.is_activated, false)
    into v_me_coins, v_me_activated
    from public.profiles p where p.id = v_me;
  v_me_busy := (public._arena_in_active_match(v_me) is not null);

  v_caller := case
                when v_me_activated is not true then 'NOT_ACTIVATED'
                when v_me_busy then 'ALREADY_IN_MATCH'
                when coalesce(v_me_coins, 0) < v_stake then 'INSUFFICIENT_SC'
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
           coalesce(pb.is_activated, false) as activated,
           coalesce(pb.smart_coins, 0) as coins
      from scoped s
      left join public.profiles pb on pb.id = s.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', f.rank,
           'userId', f.user_id,
           'name', public._person_pair_name(v_me, f.user_id),
           'inMatch', x.busy,
           -- Kept for older clients that read the refusal from each row.
           'callerBlocked', v_caller,
           'canChallenge', f.activated
                               and f.coins >= v_stake
                               and not x.busy
                               and not x.open_pair
                               and not x.blocked,
           'reason', case
                       when x.blocked then 'BLOCKED'
                       when not f.activated then 'OPPONENT_NOT_ACTIVATED'
                       when x.busy then 'OPPONENT_BUSY'
                       when f.coins < v_stake then 'OPPONENT_INSUFFICIENT_SC'
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
-- 2. THE SCHOLARS LIST - challengeable without being "available".
--
-- Presence still decides the status pill (available / in_match / offline)
-- and the online count, because that is what presence is for. It no longer
-- decides canChallenge. An offline scholar is challengeable: the invite sits
-- for 10 minutes and no coins are held until they accept.
-- ---------------------------------------------------------------------------
drop function if exists public.arena_roster(integer, text, text);

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
  -- A blank stake used to mean 0, which advertised every row as affordable.
  -- It now means the arena's fixed stake, the same number every surface prints.
  v_stake_fixed int := coalesce(
    nullif(public._arena_rules() ->> 'stake_fixed', '')::int, 2);
  v_stake int := case
                   when coalesce(p_stake, 0) <= 0 then v_stake_fixed
                   else p_stake
                 end;
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
                when v_me.id is null or not coalesce(v_me.is_activated, false)
                  then 'NOT_ACTIVATED'
                when public._arena_in_active_match(v_user) is not null
                  then 'ALREADY_IN_MATCH'
                when coalesce(v_me.smart_coins, 0) < v_stake
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
       and p.is_activated
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
             -- Eligibility is about the duel, not the dot. Offline is fine.
             'canChallenge', (coins >= v_stake
                              and not busy
                              and not open_pair
                              and not blocked),
             'inMatch', busy,
             'openInvite', open_pair,
             'reason', case
                         when blocked then 'BLOCKED'
                         when busy then 'OPPONENT_BUSY'
                         when coins < v_stake then 'OPPONENT_INSUFFICIENT_SC'
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
--
-- The Ranking tab loads 100 rows per page and can search the whole directory;
-- neither is in arena_challenge_targets' offset window. This resolves just the
-- ids the client is about to render, with the same gate and the same reason
-- codes, so a row and its button can never disagree.
--
-- The caller is never returned (you cannot challenge yourself) and the list is
-- capped at 200 ids. Unknown ids are dropped rather than rendered as unknowns.
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
  v_me_coins int := 0;
  v_me_activated boolean := false;
  v_caller text;
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select coalesce(p.smart_coins, 0), coalesce(p.is_activated, false)
    into v_me_coins, v_me_activated
    from public.profiles p where p.id = v_me;

  v_caller := case
                when v_me_activated is not true then 'NOT_ACTIVATED'
                when public._arena_in_active_match(v_me) is not null
                  then 'ALREADY_IN_MATCH'
                when coalesce(v_me_coins, 0) < v_stake then 'INSUFFICIENT_SC'
                else null end;

  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', f.user_id,
           'name', public._person_pair_name(v_me, f.user_id),
           'inMatch', x.busy,
           'canChallenge', f.activated
                               and f.coins >= v_stake
                               and not x.busy
                               and not x.open_pair
                               and not x.blocked,
           'reason', case
                       when x.blocked then 'BLOCKED'
                       when not f.activated then 'OPPONENT_NOT_ACTIVATED'
                       when x.busy then 'OPPONENT_BUSY'
                       when f.coins < v_stake then 'OPPONENT_INSUFFICIENT_SC'
                       when x.open_pair then 'INVITE_ALREADY_OPEN'
                       else null end,
           'stake', v_stake,
           'isBot', false
         ) order by f.user_id), '[]'::jsonb)
    into v_rows
    from (
      select s.id as user_id,
             coalesce(pb.is_activated, false) as activated,
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
-- 4. SENDING AN INVITE - refuse the target-side cases up front.
--
-- Sender order is unchanged for caller-side refusals; the target is inspected
-- only after the caller is known to be allowed. The insert keeps its
-- `on conflict do nothing` branch as the race backstop, but a pair with an open
-- invite now gets a clean INVITE_ALREADY_OPEN before touching the table.
--
-- The sweep is what makes `_arena_in_active_match` trustworthy here: without
-- it, a match abandoned 30 seconds ago still reads as active, and a legitimate
-- challenge would be refused as OPPONENT_BUSY until the next minute's session
-- touch (or the arena's own traffic) cleared it.
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
  v_id bigint;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if p_to_user is null or p_to_user = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;

  -- Expire stale matches/invites first (internal, service-role only, called
  -- from a definer function): a dead duel must not read as OPPONENT_BUSY.
  perform public._arena_sweep();

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null or not coalesce(v_prof.is_activated, false) then
    return jsonb_build_object('ok', false, 'error', 'NOT_ACTIVATED',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  v_rules := public._arena_rules();
  if not exists (
    select 1 from jsonb_array_elements_text(coalesce(v_rules -> 'stakes', '[2]'::jsonb)) t
     where t::int = v_stake
  ) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STAKE');
  end if;
  if coalesce(v_prof.smart_coins, 0) < v_stake then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  -- Caller-side refusals come first: "you are already in a duel" is about the
  -- person pressing the button, and is true regardless of the target.
  if public._arena_in_active_match(v_user) is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_MATCH');
  end if;

  select * into v_target from public.profiles where id = p_to_user;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_FOUND');
  end if;
  if not coalesce(v_target.is_activated, false) then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_ACTIVATED');
  end if;

  -- Target-side refusals. Order is deliberate and mirrored by BLOCKED_COPY:
  -- busy -> blocked -> open pair -> coins.
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
  if coalesce(v_target.smart_coins, 0) < v_stake then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_INSUFFICIENT_SC',
                              'balance', coalesce(v_target.smart_coins, 0));
  end if;

  insert into public.arena_invites (from_user, to_user, stake)
  values (v_user, p_to_user, v_stake)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Race backstop. The pair checks above make both branches unlikely, but two
    -- simultaneous taps can still get here.
    if exists (select 1 from public.arena_invites i
                where i.status = 'pending'
                  and ((i.from_user = v_user and i.to_user = p_to_user)
                    or (i.from_user = p_to_user and i.to_user = v_user))) then
      return jsonb_build_object('ok', false, 'error', 'INVITE_ALREADY_OPEN');
    end if;
    return jsonb_build_object('ok', false, 'error', 'ALREADY_RELATED');
  end if;

  return jsonb_build_object('ok', true, 'inviteId', v_id, 'stake', v_stake,
                            'toName', public._person_name(p_to_user, 'pseudonym'),
                            'toUserId', p_to_user);
end;
$$;

revoke all on function public.arena_invite(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.arena_invite(uuid, integer)
  to authenticated, service_role;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
