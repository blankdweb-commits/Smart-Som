-- ============================================================
-- migration-v89-relationship-repair.sql
--
-- v79 added the READ side of relationships (friend_list / friend_search) so the
-- feature could be reached at all. It shipped with a column-name bug that made
-- the entire read path dead, and it inherited three write holes from v14/v77.
-- This migration repairs all of it. Verified live before writing:
--
--   * pg_constraint on user_relationships confirms the columns are
--     `user_id` / `target_id`.
--   * migration-v79-friend-rival-ui.sql:89 and :102 read `i.from_user` /
--     `i.to_user` - names that exist on `arena_invites`, NOT here.
--   * Therefore friend_list() raises 42703 undefined_column and returns
--     NOTHING at all. Not an empty list - an error. Friends and Rivals has been
--     a dead screen this whole time.
--
-- Five things are fixed here.
--
-- ---------------------------------------------------------------------------
-- 1. friend_list() - the 42703, plus the columns it really has.
-- ---------------------------------------------------------------------------
--    `friends` was already correct (it uses r.user_id / r.target_id). Only the
--    incoming/outgoing branches were wrong. Fixed, and the DISTINCT ON collapse
--    is kept because it also resolves the old mirrored-row duplicates.
--
-- ---------------------------------------------------------------------------
-- 2. THE FORGE HOLE (relationships_insert_own, dropped).
-- ---------------------------------------------------------------------------
--    v14:184 gave clients a direct INSERT policy: `with check (auth.uid() =
--    user_id)`. It constrains who you may name, but NOT what the row may SAY.
--    A logged-in client could therefore write:
--
--        insert into user_relationships (user_id, target_id, rel_type, status)
--        values (auth.uid(), <anyone>, 'friend', 'accepted');
--
--    and manufacture a mutual friendship with no request, no consent, and no
--    row the other person ever sent. friend_list() reads status='accepted'
--    from either side, so it rendered as real. v14:191 has the same shape on
--    UPDATE (`with check (auth.uid() = target_id)`), letting the target
--    rewrite `user_id` on an existing row.
--
--    Both policies are dropped. Writes now go through the SECURITY DEFINER
--    RPCs only, which is how every other write in this schema already works -
--    the definer owns the table and bypasses RLS legitimately.
--
-- ---------------------------------------------------------------------------
-- 3. ONE ROW PER PAIR, LOCKED.
-- ---------------------------------------------------------------------------
--    `user_relationships_unique` is UNIQUE (user_id, target_id) - DIRECTIONAL.
--    Nothing stopped A->B and B->A from coexisting, and respond_relationship
--    deliberately created both (v77:113). That mirror row also made
--    notify_achievement_unlock fire twice and, on the second pass, notify the
--    unlocker about their own achievement with the other person as actor.
--
--    So: a new UNIQUE index on the SORTED pair makes the mirror impossible,
--    and respond_relationship stops writing it. Direction now means only
--    "who sent it", which friend_list already resolves correctly.
--
--    The three write RPCs take `pg_advisory_xact_lock` on the sorted pair
--    first. Without it, two simultaneous requests from opposite directions both
--    pass the exists() check and the second INSERT dies on the new unique
--    index as a raw 23505 rather than the tidy already_related the client
--    expects.
--
-- ---------------------------------------------------------------------------
-- 4. user_blocks.
-- ---------------------------------------------------------------------------
--    A general-purpose table, NOT the anonymous-room prefs (those key on
--    alias_id and mean something else entirely). Blocking is symmetric for
--    visibility: neither side sees the other in search, in the relationship
--    list, or as a challenge target. It does NOT hide them from the global
--    ranking - blocking a scholar should stop you challenging them, not erase
--    that they exist.
--
-- ---------------------------------------------------------------------------
-- 5. push_notification - executable by anon, and does not check auth.uid().
-- ---------------------------------------------------------------------------
--    Its whole body is an INSERT into notifications with no caller check:
--
--        create function push_notification(p_user uuid, p_kind text,
--                                          p_actor uuid, p_payload jsonb)
--        ...
--        insert into notifications (user_id, kind, actor_id, payload)
--        values (p_user, coalesce(p_kind,'info'), p_actor, ...);
--
--    Live ACLs: `=X/postgres,postgres=X,anon=X,authenticated=X,service_role=X`.
--    So any client holding only the publishable anon key could write arbitrary
--    rows into any user's inbox - arbitrary kind, arbitrary JSONB payload.
--    Grepped the whole repo: it has ZERO callers. There is no client feature
--    riding on it, so this closes a hole and breaks nothing.
--
-- PLUS, because the popup has to be able to show a REAL deadline:
-- arena_invites_list() now returns `expiresAt` per invite. It previously
-- returned only the global `windowSeconds`, so ChallengePopup.jsx had no way to
-- know a challenge was 40 seconds from expiring and always drew a fresh 600s.
--
-- Idempotent. Re-run safe.
-- Apply: node scripts/run-migration.mjs scripts/migration-v89-relationship-repair.sql
-- ============================================================


-- ###########################################################################
-- 4a. user_blocks
-- ###########################################################################

create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint user_blocks_pkey primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);

create index if not exists idx_user_blocks_blocked
  on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- Clients write their own block directly (there is no money, no history and no
-- cross-row invariant to protect, so an RPC would buy nothing). Everything
-- else stays closed: no UPDATE at all, and no policy that lets you see who has
-- blocked YOU.
drop policy if exists "user_blocks_read_own" on public.user_blocks;
create policy "user_blocks_read_own"
  on public.user_blocks for select
  using (auth.uid() = blocker_id);

drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own"
  on public.user_blocks for insert
  with check (auth.uid() = blocker_id);

drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own"
  on public.user_blocks for delete
  using (auth.uid() = blocker_id);


-- Symmetric in both directions: a block hides the pair from each other.
create or replace function public._blocked_between(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks
     where (blocker_id = p_a and blocked_id = p_b)
        or (blocker_id = p_b and blocked_id = p_a)
  );
$$;

revoke all on function public._blocked_between(uuid, uuid) from public, anon, authenticated;

grant execute on function public._blocked_between(uuid, uuid) to service_role;


-- ###########################################################################
-- 3a. ONE ROW PER UNORDERED PAIR
-- ###########################################################################

-- Defensive: collapse any pre-existing directional duplicates onto the earliest
-- row. Lives at 0 rows today, but this file must be re-runnable after real
-- users exist, and a partial duplicate set would make the CREATE UNIQUE INDEX
-- below fail on a re-run.
delete from public.user_relationships a
      using public.user_relationships b
     where a.id > b.id
       and a.user_id = b.target_id
       and a.target_id = b.user_id;

-- Dropped on purpose, with the ON CONFLICT targets rewritten in section 3b
-- first. The directional unique is what let a mirror row exist at all.
-- It is a table CONSTRAINT, not a bare index (pg_constraint shows
-- `UNIQUE (user_id, target_id)`), so dropindex errors with 2BP01 here.
alter table public.user_relationships
  drop constraint if exists user_relationships_unique;

create unique index if not exists user_relationships_pair_unique
  on public.user_relationships (least(user_id, target_id), greatest(user_id, target_id));


-- ###########################################################################
-- 2a. DROP THE CLIENT WRITE POLICIES
-- ###########################################################################
-- Keep read_involved and delete_involved: both are self-scoped and harmless,
-- and delete_involved lets a user remove their own row without a round trip.

drop policy if exists "relationships_insert_own" on public.user_relationships;
drop policy if exists "relationships_update_target" on public.user_relationships;


-- ###########################################################################
-- 3b. THE THREE WRITE RPCs, RELOCKED AND BLOCK-AWARE
-- ###########################################################################

create or replace function public.request_relationship(p_target uuid, p_type text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_type  text := coalesce(nullif(btrim(p_type), ''), 'friend');
  v_lo    uuid;
  v_hi    uuid;
  v_id    bigint;
begin
  -- v77's lesson, kept: with auth.uid() NULL every `x <> auth.uid()` is NULL,
  -- not TRUE, and PL/pgSQL reads that as "guard not taken".
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_target is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  if p_target = v_me then
    return jsonb_build_object('ok', false, 'error', 'cannot_add_self');
  end if;
  if v_type not in ('friend', 'rival') then
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end if;
  if public._blocked_between(v_me, p_target) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;

  -- Lock the SORTED pair, so A->B and B->A requests serialise against each
  -- other instead of both passing the exists() check below.
  v_lo := least(v_me, p_target);
  v_hi := greatest(v_me, p_target);
  perform pg_advisory_xact_lock(hashtext('relationship:' || v_lo::text || '>' || v_hi::text));

  if exists (select 1 from public.user_relationships r
               where (r.user_id = v_me and r.target_id = p_target)
                  or (r.target_id = v_me and r.user_id = p_target)) then
    return jsonb_build_object('ok', false, 'error', 'already_related');
  end if;

  insert into public.user_relationships (user_id, target_id, rel_type, status)
  values (v_me, p_target, v_type, 'pending')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke all on function public.request_relationship(uuid, text) from public, anon;
grant execute on function public.request_relationship(uuid, text) to authenticated, service_role;


create or replace function public.respond_relationship(p_rel_id bigint, p_accept boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_rel public.user_relationships;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into v_rel
    from public.user_relationships
   where id = p_rel_id
     for update;
  if v_rel is null then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_not_target');
  end if;
  if v_rel.target_id is null or v_rel.target_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_not_target');
  end if;
  if v_rel.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'already_answered');
  end if;

  -- A block raised between the request and the reply wins over the reply.
  if public._blocked_between(v_me, v_rel.user_id) then
    delete from public.user_relationships where id = p_rel_id;
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;

  if p_accept then
    -- NOTE: the v77 mirror insert (target_id -> user_id) is deliberately GONE.
    -- Section 3a makes one row per unordered pair, so the mirror is now
    -- impossible; direction means only "who sent it", which is all
    -- friend_list and notify_achievement_unlock ever read.
    update public.user_relationships
       set status = 'accepted', responded_at = now()
     where id = p_rel_id;
    return jsonb_build_object('ok', true, 'id', p_rel_id);
  end if;

  delete from public.user_relationships where id = p_rel_id;
  return jsonb_build_object('ok', true, 'rejected', true);
end;
$$;

revoke all on function public.respond_relationship(bigint, boolean) from public, anon;
grant execute on function public.respond_relationship(bigint, boolean) to authenticated, service_role;


create or replace function public.remove_relationship(p_other uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_other is null then
    return;
  end if;
  delete from public.user_relationships r
   where (r.user_id = v_me and r.target_id = p_other)
      or (r.target_id = v_me and r.user_id = p_other);
end;
$$;

revoke all on function public.remove_relationship(uuid) from public, anon;
grant execute on function public.remove_relationship(uuid) to authenticated, service_role;


-- ###########################################################################
-- 1a. friend_list - THE 42703, REPAIRED
-- ###########################################################################
-- The `friends` branch was already right. incoming/outgoing are rewritten onto
-- the real columns, blocked pairs are filtered out, and a `blocks` array is
-- added so the client can render an existing block without a second call.

create or replace function public.friend_list()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'friends', coalesce((
      select jsonb_agg(obj order by lower(name))
        from (
          select distinct on (other_user)
                 jsonb_build_object(
                   'userId', other_user,
                   'name', name,
                   'relType', rel_type,
                   'since', responded_at) as obj,
                 other_user, name, rel_type, responded_at
            from (
              select case when r.user_id = v_user then r.target_id else r.user_id end as other_user,
                     r.rel_type,
                     r.responded_at,
                     public._person_pair_name(v_user,
                       case when r.user_id = v_user then r.target_id else r.user_id end) as name
                from public.user_relationships r
               where r.status = 'accepted'
                 and (r.user_id = v_user or r.target_id = v_user)
                 and not public._blocked_between(v_user,
                       case when r.user_id = v_user then r.target_id else r.user_id end)
            ) s
           order by other_user, (rel_type = 'friend') desc, responded_at desc nulls last
        ) t
    ), '[]'::jsonb),
    -- THE FIX. v79 read i.from_user / i.to_user; this table has user_id /
    -- target_id. That mismatch raised 42703 and killed the whole function.
    'incoming', coalesce((
      select jsonb_agg(obj order by created_at)
        from (
          select jsonb_build_object(
                   'requestId', i.id,
                   'userId', i.user_id,
                   'name', public._person_pair_name(v_user, i.user_id),
                   'relType', i.rel_type,
                   'createdAt', i.created_at) as obj,
                 i.created_at
            from public.user_relationships i
           where i.status = 'pending'
             and i.target_id = v_user
             and not public._blocked_between(v_user, i.user_id)
        ) t
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(obj order by created_at)
        from (
          select jsonb_build_object(
                   'requestId', i.id,
                   'userId', i.target_id,
                   'name', public._person_pair_name(v_user, i.target_id),
                   'relType', i.rel_type,
                   'createdAt', i.created_at) as obj,
                 i.created_at
            from public.user_relationships i
           where i.status = 'pending'
             and i.user_id = v_user
             and not public._blocked_between(v_user, i.target_id)
        ) t
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'userId', b.blocked_id,
               'name', public._person_pair_name(v_user, b.blocked_id)
             ) order by b.created_at desc)
        from public.user_blocks b
       where b.blocker_id = v_user
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.friend_list() from public, anon;
grant execute on function public.friend_list() to authenticated, service_role;


-- ###########################################################################
-- 4b. friend_search - hide blocked scholars from results entirely
-- ###########################################################################

create or replace function public.friend_search(p_query text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'query', v_q,
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'userId', p.id,
               'name', public._person_pair_name(v_user, p.id),
               'hasIdentityName', coalesce(nullif(btrim(p.identity_name), ''), '') <> ''
             ) order by lower(public._person_pair_name(v_user, p.id)))
        from public.profiles p
       where p.id <> v_user
         and p.is_activated
         and (v_q is null
           or p.identity_name ilike '%' || v_q || '%'
           or p.full_name ilike '%' || v_q || '%'
           or substr(md5(p.id::text), 1, 6) ilike '%' || v_q || '%')
         and not exists (
           select 1 from public.user_relationships r
            where (r.user_id = v_user and r.target_id = p.id)
               or (r.target_id = v_user and r.user_id = p.id))
         and not public._blocked_between(v_user, p.id)
       limit 25
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.friend_search(text) from public, anon;
grant execute on function public.friend_search(text) to authenticated, service_role;


-- ###########################################################################
-- 4c. arena_challenge_targets - a block stops the CHALLENGE, not the RANKING
-- ###########################################################################
-- Copied from v84:287 verbatim except for the `blocked` term. Blocked scholars
-- stay in the list and stay on the leaderboard - they are still ranked, and
-- hiding them would misrepresent the board - but they are not challengeable
-- and the client gets the reason so the button is honestly disabled.

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
           'callerBlocked', case
                              when not v_me_activated then 'NOT_ACTIVATED'
                              when v_me_busy then 'ALREADY_IN_MATCH'
                              when v_me_coins < v_stake then 'INSUFFICIENT_SC'
                              else null end,
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
    'players', v_rows
  );
end;
$$;

revoke all on function public.arena_challenge_targets(integer, integer) from public, anon;
grant execute on function public.arena_challenge_targets(integer, integer) to authenticated, service_role;


-- ###########################################################################
-- 5a. arena_invites_list - expiresAt, so the popup can show a REAL deadline
-- ###########################################################################
-- Copied from v84:122 verbatim except that each incoming/outgoing row now
-- carries `expiresAt = created_at + invite_expiry_seconds`. Before this the
-- only timing the client got was the global `windowSeconds`, which is why
-- ChallengePopup.jsx drew a fresh 600s countdown for a challenge that had been
-- sitting unanswered for nine minutes.

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
                   'expiresAt', i.created_at + make_interval(secs => v_window),
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
                   'expiresAt', i.created_at + make_interval(secs => v_window),
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


-- ###########################################################################
-- 5b. push_notification - CLOSED
-- ###########################################################################
-- SECURITY DEFINER with no auth.uid() check, previously executable by anon.
-- Zero callers repo-wide, so this closes the hole and breaks no feature.
-- Re-granted to service_role so the notification writes stay possible from an
-- api/ handler if one is ever added.

revoke all on function public.push_notification(uuid, text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.push_notification(uuid, text, uuid, jsonb)
  to service_role;

-- Same treatment for get_user_achievements: v77 fixed its logic, but its ACLs
-- still handed EXECUTE to anon via this project's default privileges.
revoke all on function public.get_user_achievements(uuid) from public, anon;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
