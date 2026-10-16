-- ============================================================
-- migration-v78-arena-invites.sql
--
-- Two operator decisions land here.
--
-- 1. FULL INVITE FLOW. Challenging someone used to create the match instantly,
--    which meant both stakes were escrowed the moment you pressed the button -
--    before the other player had agreed to anything. An invite is now the
--    primary path: send, they Accept or Decline, and ONLY THEN are the stakes
--    held. Escrow-on-accept also makes the existing "your stake is held from
--    match start" copy true.
--
--    The match itself is still built by `arena_create_match`, so the board, the
--    escrow, the seal, the sweep and settlement are ALL the same code that a
--    direct challenge already uses. Invites add consent, not a second engine.
--
-- 2. REAL NAMES ONLY AFTER A MATCH. `_person_name(user,'real')` now escapes
--    into the scholars list, but only for someone you have actually played.
--    `_arena_pair_dueled` is the predicate: a COMPLETED match between the two
--    of them. Everyone else stays a pseudonym/handle, so browsing the arena does
--    not enumerate anyone's real name.
--
-- Idempotent. Re-run safe.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 0. CONFIG - how long an invite stays open.
-- ---------------------------------------------------------------------------
update public.server_config
   set value = jsonb_set(coalesce(value, '{}'::jsonb), '{invite_expiry_seconds}', to_jsonb(600))
 where key = 'arena_rules'
   and coalesce((value ->> 'invite_expiry_seconds')::int, 0) <> 600;

-- ---------------------------------------------------------------------------
-- 1. "Have these two actually played?" - the gate on showing a real name.
-- ---------------------------------------------------------------------------
create or replace function public._arena_pair_dueled(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
      from public.competitive_matches cm
     where cm.format = 'blitz'
       and cm.status = 'completed'
       and ((cm.creator_id = p_a and cm.opponent_id = p_b)
         or (cm.creator_id = p_b and cm.opponent_id = p_a))
  );
$$;

revoke all on function public._arena_pair_dueled(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. INVITES TABLE. RLS on with NO policies: service-role only. Every read and
--    write goes through the definer RPCs below, which own the authorization.
-- ---------------------------------------------------------------------------
create table if not exists public.arena_invites (
  id bigint generated always as identity primary key,
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  stake integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  match_id uuid references public.competitive_matches(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint arena_invites_no_self check (from_user <> to_user)
);

-- At most ONE open invite per ordered pair, in either direction.
create unique index if not exists uq_arena_invites_open_pair
  on public.arena_invites (
    least(from_user, to_user),
    greatest(from_user, to_user)
  )
  where status = 'pending';

create index if not exists idx_arena_invites_to_user
  on public.arena_invites (to_user, status, created_at desc);
create index if not exists idx_arena_invites_from_user
  on public.arena_invites (from_user, status, created_at desc);

alter table public.arena_invites enable row level security;
revoke all on public.arena_invites from public, anon, authenticated;
grant all on public.arena_invites to service_role;

-- ---------------------------------------------------------------------------
-- 3. SEND AN INVITE.
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

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null or not v_prof.is_activated then
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

  select * into v_target from public.profiles where id = p_to_user;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_FOUND');
  end if;
  if not v_target.is_activated then
    return jsonb_build_object('ok', false, 'error', 'OPPONENT_NOT_ACTIVATED');
  end if;

  -- An invite must not be sent from inside a duel that is already running.
  if public._arena_in_active_match(v_user) is not null then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_MATCH');
  end if;

  insert into public.arena_invites (from_user, to_user, stake)
  values (v_user, p_to_user, v_stake)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    -- Either an invite is already open between you, or you already tried this
    -- person. Distinguish so the UI can say something useful.
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

-- ---------------------------------------------------------------------------
-- 4. MY INVITES - incoming and outgoing, for the UI strip.
--
-- The other party is named 'real' ONLY if the two have completed a match;
-- otherwise it is a pseudonym. Declining an invite does NOT unlock a name.
-- ---------------------------------------------------------------------------
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

  -- Expire anything past its window first, so the UI never offers a dead invite.
  update public.arena_invites
     set status = 'expired', responded_at = now()
   where status = 'pending'
     and created_at < now() - make_interval(secs => v_window)
     and (from_user = v_user or to_user = v_user);

  return jsonb_build_object(
    'ok', true,
    'windowSeconds', v_window,
    'incoming', coalesce((
      select jsonb_agg(obj) -- order happens in the subquery: the outer FROM
                          -- only exposes `obj`, so ordering by created_at here
                          -- raised and the whole list came back empty.
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
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. ACCEPT / DECLINE. The recipient only, and escrow happens HERE.
-- ---------------------------------------------------------------------------
create or replace function public.arena_invite_respond(p_invite_id bigint, p_accept boolean default true)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_inv public.arena_invites%rowtype;
  v_window int;
  v_res jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_inv from public.arena_invites where id = p_invite_id for update;
  if v_inv.id is null or v_inv.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'INVITE_NOT_FOUND');
  end if;
  -- NULL-safe on purpose: `to_user <> auth.uid()` alone would be NULL (and so
  -- skipped) for an unauthenticated caller. v78 fixed exactly that bug in
  -- respond_relationship (v77), so the same trap is closed here from the start.
  if v_inv.to_user is null or v_inv.to_user <> v_user then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_INVITE');
  end if;

  v_window := coalesce((public._arena_rules() ->> 'invite_expiry_seconds')::int, 600);
  if v_inv.created_at < now() - make_interval(secs => v_window) then
    update public.arena_invites
       set status = 'expired', responded_at = now()
     where id = p_invite_id;
    return jsonb_build_object('ok', false, 'error', 'INVITE_EXPIRED');
  end if;

  if not p_accept then
    update public.arena_invites
       set status = 'declined', responded_at = now()
     where id = p_invite_id;
    return jsonb_build_object('ok', true, 'declined', true);
  end if;

  -- Accept: build the match through the ONE canonical path, so escrow, the
  -- board, the seal and settlement are byte-identical to a direct challenge.
  -- The accepter becomes creator_id and both sides are escrowed by the same
  -- logic that has been proven by e2e-arena.
  v_res := public.arena_create_match(
    p_mode        => 'duel',
    p_stake       => v_inv.stake,
    p_opponent_id => v_inv.from_user);

  if coalesce((v_res ->> 'ok')::boolean, false) is not true then
    -- Leave the invite pending so they can retry, EXCEPT when the reason makes
    -- retry pointless (they can never afford it / not activated).
    if v_res ->> 'error' in ('OPPONENT_INSUFFICIENT_SC', 'OPPONENT_NOT_ACTIVATED',
                             'OPPONENT_NOT_FOUND', 'INVALID_STAKE') then
      update public.arena_invites
         set status = 'declined', responded_at = now()
       where id = p_invite_id;
      return jsonb_build_object('ok', false, 'error', v_res ->> 'error',
                                'balance', coalesce((select smart_coins
                                                       from public.profiles
                                                      where id = v_user), 0));
    end if;
    return jsonb_build_object('ok', false, 'error', coalesce(v_res ->> 'error', 'INVITE_FAILED'),
                              'detail', v_res);
  end if;

  update public.arena_invites
     set status = 'accepted', responded_at = now(), match_id = (v_res ->> 'matchId')::uuid
   where id = p_invite_id;

  -- The result is the create result plus the invite id, so the client can adopt
  -- the match without a second round trip.
  return v_res || jsonb_build_object('ok', true, 'inviteId', p_invite_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. CANCEL (sender only).
-- ---------------------------------------------------------------------------
create or replace function public.arena_invite_cancel(p_invite_id bigint)
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

  select * into v_inv from public.arena_invites where id = p_invite_id;
  if v_inv.id is null or v_inv.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'INVITE_NOT_FOUND');
  end if;
  if v_inv.from_user is null or v_inv.from_user <> v_user then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_INVITE');
  end if;

  update public.arena_invites
     set status = 'cancelled', responded_at = now()
   where id = p_invite_id;
  return jsonb_build_object('ok', true, 'cancelled', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. EXPIRE STALE INVITES from the arena sweep (the one traffic source that
--    runs with no arena tab open).
-- ---------------------------------------------------------------------------
create or replace function public._arena_expire_invites()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_window int;
  v_n int;
begin
  v_window := coalesce((public._arena_rules() ->> 'invite_expiry_seconds')::int, 600);
  update public.arena_invites
     set status = 'expired', responded_at = now()
   where status = 'pending'
     and created_at < now() - make_interval(secs => v_window);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. THE SCHOLARS LIST uses the pair predicate: a real name for someone you
--    have already played, a pseudonym for everyone else.
--
--    Dropped 3-arg first, for the same PGRST203 reason as v75.
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
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  perform public._arena_touch_presence(v_user);

  v_window := coalesce((public._arena_rules() ->> 'presence_window_seconds')::int, 90);

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
           end as seen_recently
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
             'canChallenge', (status = 'available' and coins >= p_stake),
             'stake', p_stake,
             'isBot', false) as obj
      from shaped
     order by case status when 'available' then 0 when 'in_match' then 1 else 2 end,
              seen desc nulls last
     limit v_limit
  ) top;

  return jsonb_build_object('ok', true, 'stake', p_stake, 'format', 'blitz',
                            'online', v_online, 'windowSeconds', v_window,
                            'query', v_q,
                            'searching', v_filter,
                            'players', v_players);
end;
$$;

revoke all on function public.arena_roster(integer, text, text)
  from public, anon;
grant execute on function public.arena_roster(integer, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. ACLs - authenticated only. These move real money on accept.
-- ---------------------------------------------------------------------------
revoke all on function public.arena_invite(uuid, integer) from public, anon;
revoke all on function public.arena_invites_list() from public, anon;
revoke all on function public.arena_invite_respond(bigint, boolean) from public, anon;
revoke all on function public.arena_invite_cancel(bigint) from public, anon;
revoke all on function public._arena_expire_invites() from public, anon, authenticated;

grant execute on function public.arena_invite(uuid, integer) to authenticated, service_role;
grant execute on function public.arena_invites_list() to authenticated, service_role;
grant execute on function public.arena_invite_respond(bigint, boolean) to authenticated, service_role;
grant execute on function public.arena_invite_cancel(bigint) to authenticated, service_role;
grant execute on function public._arena_expire_invites() to service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================