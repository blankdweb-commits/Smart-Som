-- =============================================================
-- v84 — ARENA CHALLENGE HANDOFF, LEADERBOARD TARGETS, PUSH
-- =============================================================
-- The bug this fixes, in one line: an invite could be accepted and the
-- INVITER WOULD NEVER KNOW. arena_invites_list() filtered status='pending' on
-- BOTH branches (v78:216 and :238), and arena_invite_respond (v78:294) makes
-- the ACCEPTER the creator_id and returns the created match only to them. So:
--
--   * the inviter gets no match id, no match row reference, no notification
--   * `opponent_ready` is therefore never set, so `status` never reaches 'ready'
--     and the shared 90-second clock never opens
--   * nobody is charged, nothing settles, and the inviter is simply stranded
--
-- That is why two players never actually started together. This migration
-- supplies the missing half: a `ready[]` channel the inviter can poll, a
-- function to acknowledge it, and a sweep so stale invites actually expire.
--
-- ALSO FIXED HERE: v78:360 defined _arena_expire_invites() with a header saying
-- it should be called "from the arena sweep", and nothing ever called it. A
-- pending invite therefore only expired lazily inside arena_invites_list(),
-- scoped to the CALLER's own rows — so an invite sent to someone who never
-- opened the arena stayed 'pending' forever.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v84-arena-challenge-handoff.sql
-- =============================================================

-- ------------------------------------------------------------
-- 1. NEW COLUMNS
-- ------------------------------------------------------------
-- pushed_at: exactly-once marker for the Web Push trigger in api/session.js.
-- joined_at: once the inviter has adopted the match, stop surfacing it.
alter table public.arena_invites
  add column if not exists pushed_at timestamptz;
alter table public.arena_invites
  add column if not exists joined_at timestamptz;

-- A fourth opt-in category so a user can silence duel challenges specifically
-- without muting room messages. Absent row still means default-on, which is how
-- api/_push.js already treats a missing preference.
alter table public.notification_preferences
  add column if not exists duels boolean not null default true;

-- ------------------------------------------------------------
-- 2. WIRE THE DEAD EXPIRY SWEEP.
--    Renamed rather than re-typed: the existing _arena_sweep body is ~105 lines
--    of forfeit/no-show/refund logic and copying it by hand is exactly the kind
--    of transcription risk that silently drops a refund. Instead the existing
--    body is preserved as _arena_sweep_core and a thin wrapper runs it, then
--    expires invites. Every existing caller does `perform public._arena_sweep()`
--    by NAME, so they all pick up the wrapper with no other edit.
--
--    The rename is guarded on _arena_sweep_core NOT existing, so re-running this
--    migration does not try to rename the wrapper onto its own core.
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_arena_sweep'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_arena_sweep_core'
  ) then
    execute 'alter function public._arena_sweep() rename to _arena_sweep_core';
    raise notice 'renamed _arena_sweep -> _arena_sweep_core (body preserved verbatim)';
  end if;
end $$;

create or replace function public._arena_sweep()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_core jsonb;
  v_window int;
  v_expired int := 0;
begin
  perform public._arena_claim_write();

  -- The v63/v64 behaviour, unchanged: heartbeat gaps, grace forfeits, no-show
  -- refunds, presence housekeeping.
  v_core := public._arena_sweep_core();

  -- 9.6 Pending invites past their window. The sweep runs from every arena RPC
  --     AND from api/session.js touch, which is the only traffic that happens
  --     with no arena tab open — so an invite to someone who never opened the
  --     arena still expires on schedule.
  v_window := coalesce((public._arena_rules() ->> 'invite_expiry_seconds')::int, 600);
  update public.arena_invites
     set status = 'expired', responded_at = now()
   where status = 'pending'
     and created_at < now() - make_interval(secs => v_window);
  get diagnostics v_expired = row_count;

  return coalesce(v_core, '{}'::jsonb) || jsonb_build_object('invitesExpired', v_expired);
end;
$$;

-- The core keeps the same internal-only ACL it had; the wrapper is called by
-- other definer functions so it must not become client-reachable either.
revoke all on function public._arena_sweep() from public, anon, authenticated;
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_arena_sweep_core'
  ) then
    execute 'revoke all on function public._arena_sweep_core() from public, anon, authenticated';
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. arena_invites_list — same incoming/outgoing contract as v78, PLUS the
--    `ready` array that is the whole point of this migration.
--
--    `ready` = invitations I SENT that were accepted recently and that the
--    match has not yet been joined. Surfacing it here (rather than adding a new
--    RPC) means the client already polls this function, so the inviter learns
--    their challenge was accepted within one poll interval with no new call.
-- ------------------------------------------------------------
create or replace function public.arena_invites_list()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_window int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  perform public._arena_touch_presence(v_user);

  v_window := coalesce((public._arena_rules() ->> 'invite_expiry_seconds')::int, 600);

  update public.arena_invites
     set status = 'expired', responded_at = now()
   where status = 'pending'
     and created_at < now() - make_interval(secs => v_window)
     and (from_user = v_user or to_user = v_user);

  return jsonb_build_object(
    'ok', true,
    'windowSeconds', v_window,
    'incoming', coalesce((
      select jsonb_agg(obj)
        from (
          select jsonb_build_object(
                   'inviteId', i.id,
                   'stake', i.stake,
                   'createdAt', i.created_at,
                   'userId', other_user,
                   'name', case
                              when public._arena_pair_dueled(v_user, other_user)
                                then public._person_name(other_user, 'real')
                              else public._person_name(other_user, 'pseudonym')
                            end,
                   'isMe', false) as obj
            from (
              select i.id, i.stake, i.created_at, i.from_user as other_user
                from public.arena_invites i
               where i.to_user = v_user and i.status = 'pending'
               order by i.created_at asc
            ) i
        ) t
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(obj)
        from (
          select jsonb_build_object(
                   'inviteId', i.id,
                   'stake', i.stake,
                   'createdAt', i.created_at,
                   'userId', other_user,
                   'name', case
                              when public._arena_pair_dueled(v_user, other_user)
                                then public._person_name(other_user, 'real')
                              else public._person_name(other_user, 'pseudonym')
                            end,
                   'isMe', true) as obj
            from (
              select i.id, i.stake, i.created_at, i.to_user as other_user
                from public.arena_invites i
               where i.from_user = v_user and i.status = 'pending'
               order by i.created_at asc
            ) i
        ) t
    ), '[]'::jsonb),
    -- The handoff. matchedAt is null when the accepter could not escrow, in
    -- which case v78 force-declined the invite and it never reaches 'accepted',
    -- so a non-null match_id here always means a real match exists.
    'ready', coalesce((
      select jsonb_agg(obj)
        from (
          select jsonb_build_object(
                   'inviteId', i.id,
                   'matchId', i.match_id,
                   'stake', i.stake,
                   'acceptedAt', i.responded_at,
                   'userId', i.to_user,
                   'name', case
                              when public._arena_pair_dueled(v_user, i.to_user)
                                then public._person_name(i.to_user, 'real')
                              else public._person_name(i.to_user, 'pseudonym')
                            end) as obj
            from (
              select i.id, i.match_id, i.stake, i.responded_at, i.to_user
                from public.arena_invites i
               where i.from_user = v_user
                 and i.status = 'accepted'
                 and i.match_id is not null
                 and i.joined_at is null
                 and i.responded_at > now() - interval '10 minutes'
               order by i.responded_at asc
            ) i
        ) t
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.arena_invites_list() from public, anon;
grant execute on function public.arena_invites_list() to authenticated, service_role;

-- ------------------------------------------------------------
-- 4. arena_invite_ready — the inviter acknowledges and adopts the match.
--    Marks joined_at so `ready` stops offering it, and returns the matchId the
--    client then verifies through arena_state (never trusting the row alone).
--    Replay-safe: a second call still returns the same matchId.
--    Ownership-guarded: NOT_YOUR_INVITE covers the v77-era NULL-ownership bug.
-- ------------------------------------------------------------
create or replace function public.arena_invite_ready(p_invite_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.arena_invites%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_inv from public.arena_invites where id = p_invite_id for update;
  if v_inv.id is null then
    return jsonb_build_object('ok', false, 'error', 'INVITE_NOT_FOUND');
  end if;
  if v_inv.from_user is null or v_inv.from_user <> v_user then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_INVITE');
  end if;
  if v_inv.status <> 'accepted' or v_inv.match_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVITE_NOT_ACCEPTED');
  end if;

  update public.arena_invites
     set joined_at = coalesce(joined_at, now())
   where id = p_invite_id;

  return jsonb_build_object(
    'ok', true,
    'inviteId', p_invite_id,
    'matchId', v_inv.match_id,
    'stake', v_inv.stake,
    'replay', v_inv.joined_at is not null
  );
end;
$$;
revoke all on function public.arena_invite_ready(bigint) from public, anon;
grant execute on function public.arena_invite_ready(bigint) to authenticated, service_role;

-- ------------------------------------------------------------
-- 5. arena_challenge_targets — the Global Ranking's eligibility source.
--
--    The leaderboard lists EVERY ranked account, but an invite can only be sent
--    to someone who can actually play it. Returning a bare roster would show a
--    Challenge button on rows where the server would refuse, so this returns
--    the REFUSAL REASON as well as the boolean, and the client can say why
--    ("Busy", "Low coins") instead of rendering a dead control.
--
--    It also deliberately returns any ranked scholar, not only the ones
--    currently online: on a leaderboard you want to be able to challenge
--    someone who is not on the arena scholars screen right now.
--
--    Ordered identically to get_player_leaderboard so rows merge 1:1.
-- ------------------------------------------------------------
create or replace function public.arena_challenge_targets(
  p_limit  integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  -- The arena is a single fixed-stake format (2 SC). Read it from the rules so
  -- the server stays authoritative, but default to the live value of 2.
  v_stake int := coalesce(
    (select min((t::int)::int)
       from jsonb_array_elements_text(
              coalesce(public._arena_rules() -> 'stakes', '[2]'::jsonb)) t
      where (t::text) ~ '^\s*\d+\s*$'), 2);
  v_me_coins int := 0;
  v_me_activated boolean := false;
  v_me_busy boolean := false;
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

  select count(*) into v_total from public.v_competitive_base;

  with ranked as (
    -- Byte-identical ordering to get_player_leaderboard (v74), so a target row
    -- can be merged onto its leaderboard row by userId without a second sort.
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
     where r.user_id <> v_me          -- never list or allow challenging yourself
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
           -- Caller-side refusals: if any of these is set, NOTHING in the list
           -- can be challenged, so the client disables the tab rather than
           -- rendering live-looking buttons that the server will refuse.
           'callerBlocked', case
                              when not v_me_activated then 'NOT_ACTIVATED'
                              when v_me_busy then 'ALREADY_IN_MATCH'
                              when v_me_coins < v_stake then 'INSUFFICIENT_SC'
                              else null end,
           -- Per-target refusals, most specific first. An empty string means
           -- "no reason", which is what the client renders as an enabled button.
           'canChallenge', f.activated
                              and f.coins >= v_stake
                              and not x.busy
                              and not x.open_pair,
           'reason', case
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
             ) as open_pair
    ) x;

  return jsonb_build_object(
    'ok', true,
    'stake', v_stake,
    'totalPlayers', v_total,
    'players', v_rows
  );
end;
$$;
revoke all on function public.arena_challenge_targets(integer, integer) from public, anon;
grant execute on function public.arena_challenge_targets(integer, integer) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================
-- DONE. Re-run safe.
-- =============================================================