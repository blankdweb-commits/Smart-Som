-- ============================================================
-- Apex Scholars Migration v56 — ANONYMOUS CAPACITY + MONETIZATION (P2)
--
-- Turns the Anonymous room's membership from a hard door into a
-- two-tier capacity model WITHIN one room:
--
--   1. FOUNDING MEMBER BOUNDARY. The first `founding_member_cap`
--      member seats (default 20) are FREE. At/after the cap a new
--      member seat requires a one-time `member_price` (default
--      ₦499) — reported as MEMBERSHIP_PAYMENT_REQUIRED. This
--      REPLACES the v54 auto-lock at exactly 20 (20 was a dead
--      door; now it is the free→paid boundary). `membership_locked`
--      remains the host's explicit hard close.
--
--   2. FREE SPECTATOR TIER. The first `free_spectator_cap` (20)
--      spectator slots are free; beyond that a spectator pass costs
--      `spectator_price` (₦299) — SPECTATOR_PAYMENT_REQUIRED.
--
--   3. TOTAL CAPACITY. `study_groups.member_limit` (100) is the
--      combined ceiling: members + active spectators. Both join
--      paths return GROUP_FULL once combined >= member_limit.
--
--   4. PAID MEMBER LEDGER. `anonymous_memberships` records the
--      paid member seats (tier free|paid); wipe revokes them.
--      `anonymous_spectators` gains `tier` (free|paid) and its
--      `amount > 0` check is relaxed to `>= 0` (free seats are 0).
--
-- Idempotent. Safe to re-run. Requires v29 + v41 + v46 + v54.
-- Apply: node scripts/_apply-v43.mjs scripts/migration-v56-anonymous-capacity-monetization.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. CAPACITY COLUMNS
-- ------------------------------------------------------------
alter table public.study_groups
  add column if not exists founding_member_cap integer not null default 20;
alter table public.study_groups
  add column if not exists free_spectator_cap integer not null default 20;
alter table public.study_groups
  add column if not exists member_price numeric(12,2) not null default 499;

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.study_groups'::regclass
                    and conname = 'study_groups_member_price_check') then
    alter table public.study_groups
      add constraint study_groups_member_price_check check (member_price >= 0);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.study_groups'::regclass
                    and conname = 'study_groups_founding_member_cap_check') then
    alter table public.study_groups
      add constraint study_groups_founding_member_cap_check check (founding_member_cap >= 0);
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.study_groups'::regclass
                    and conname = 'study_groups_free_spectator_cap_check') then
    alter table public.study_groups
      add constraint study_groups_free_spectator_cap_check check (free_spectator_cap >= 0);
  end if;
end $$;

-- Anonymous rooms: free founding + free spectator caps of 20, member seat ₦499.
-- (ADD COLUMN ... DEFAULT backfills existing rows; this re-asserts intent.)
update public.study_groups
   set founding_member_cap = 20,
       free_spectator_cap = 20,
       member_price = 499,
       updated_at = now()
 where type = 'anonymous'
   and (founding_member_cap is null
        or free_spectator_cap is null
        or member_price is null);

-- ------------------------------------------------------------
-- 2. SPECTATOR TIER + FREE SEATS (relax amount check)
-- ------------------------------------------------------------
alter table public.anonymous_spectators
  add column if not exists tier text not null default 'paid';

alter table public.anonymous_spectators
  drop constraint if exists anonymous_spectators_amount_check;
alter table public.anonymous_spectators
  add constraint anonymous_spectators_amount_check check (amount >= 0);

do $$ begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.anonymous_spectators'::regclass
                    and conname = 'anonymous_spectators_tier_check') then
    alter table public.anonymous_spectators
      add constraint anonymous_spectators_tier_check check (tier in ('free', 'paid'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. PAID MEMBER LEDGER (service-role only)
-- ------------------------------------------------------------
create table if not exists public.anonymous_memberships (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null unique,
  amount integer not null check (amount >= 0),
  tier text not null default 'paid' check (tier in ('free', 'paid')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (group_id, user_id)
);

create index if not exists idx_anonymous_memberships_group
  on public.anonymous_memberships(group_id, status);
create index if not exists idx_anonymous_memberships_user
  on public.anonymous_memberships(user_id, status);

alter table public.anonymous_memberships enable row level security;
revoke all on public.anonymous_memberships from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. community_spectator_count — active spectator seats.
-- ------------------------------------------------------------
create or replace function public.community_spectator_count(p_group bigint)
returns bigint
language sql stable
security definer set search_path = public, pg_temp
as $$
  select count(*)::bigint
    from public.anonymous_spectators s
   where s.group_id = p_group
     and s.status = 'active';
$$;

-- ------------------------------------------------------------
-- 5. community_anonymous_join — FREE FOUNDING SEATS, then paid.
--    waiting  : join freely; activates at minimum_members_to_activate.
--    active   : free while members < founding_member_cap; otherwise
--               MEMBERSHIP_PAYMENT_REQUIRED (+member_price).
--    locked   : MEMBERSHIP_LOCKED (host hard close) — takes priority.
--    capacity : members + spectators >= member_limit -> GROUP_FULL.
-- ------------------------------------------------------------
create or replace function public.community_anonymous_join(p_group bigint, p_user uuid)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_role text;
  v_count bigint;
  v_spec bigint;
  v_total bigint;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;
  if v_gr.group_state = 'wiped' or v_gr.is_active = false then
    return jsonb_build_object('ok', false, 'code', 'GROUP_WIPED');
  end if;

  v_role := public.community_role_for_group(p_user, p_group);
  if v_role in ('member', 'admin') then
    return jsonb_build_object('ok', true, 'already_member', true,
      'member_count', public.community_member_count(p_group),
      'group_state', v_gr.group_state,
      'member_limit', v_gr.member_limit,
      'founding_member_cap', v_gr.founding_member_cap);
  end if;
  if v_role = 'spectator' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SPECTATOR',
      'message', 'You already have spectator access to this group. You cannot become a member.');
  end if;

  if exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_banned_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;

  v_count := public.community_member_count(p_group);
  v_spec := public.community_spectator_count(p_group);
  v_total := v_count + v_spec;

  -- Host hard close takes priority over payment.
  if v_gr.group_state = 'active' and v_gr.membership_locked then
    return jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_LOCKED',
      'message', 'Membership for this room has been closed by the host. Spectator access is available instead.',
      'member_count', v_count, 'member_limit', v_gr.member_limit,
      'spectator_price', v_gr.spectator_price);
  end if;

  if v_total >= v_gr.member_limit then
    return jsonb_build_object('ok', false, 'code', 'GROUP_FULL',
      'message', 'This room is at capacity. Spectator access is available instead.',
      'member_count', v_count, 'spectator_count', v_spec, 'member_limit', v_gr.member_limit,
      'spectator_price', v_gr.spectator_price);
  end if;

  -- Free founding seats first; beyond the cap a paid member seat is required.
  if v_count >= v_gr.founding_member_cap then
    return jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_PAYMENT_REQUIRED',
      'message', 'All free founding member seats are taken. A one-time membership fee unlocks a member seat.',
      'member_count', v_count, 'founding_member_cap', v_gr.founding_member_cap,
      'member_limit', v_gr.member_limit, 'member_price', v_gr.member_price,
      'spectator_price', v_gr.spectator_price, 'group_state', v_gr.group_state);
  end if;

  insert into public.study_group_members (group_id, user_id, role)
  values (p_group, p_user, 'member')
  on conflict (group_id, user_id) do nothing;

  v_count := public.community_member_count(p_group);
  if v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
    update public.study_groups set group_state = 'active', updated_at = now() where id = p_group;
  end if;

  return jsonb_build_object('ok', true, 'already_member', false, 'free', true,
    'member_count', v_count,
    'group_state', (select group_state from public.study_groups where id = p_group),
    'member_limit', v_gr.member_limit,
    'founding_member_cap', v_gr.founding_member_cap);
end;
$$;

-- ------------------------------------------------------------
-- 6. community_anonymous_spectate_free — first N spectators free.
--    active rooms only. Beyond free_spectator_cap ->
--    SPECTATOR_PAYMENT_REQUIRED (+spectator_price). Capacity-guarded.
-- ------------------------------------------------------------
create or replace function public.community_anonymous_spectate_free(p_group bigint, p_user uuid)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_role text;
  v_count bigint;
  v_spec bigint;
  v_total bigint;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;
  if v_gr.group_state <> 'active' or v_gr.is_active = false then
    return jsonb_build_object('ok', false, 'code', 'GROUP_NOT_ACTIVE',
      'message', 'Spectator access unlocks once the Anonymous room is active.');
  end if;

  v_role := public.community_role_for_group(p_user, p_group);
  if v_role in ('member', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_MEMBER',
      'message', 'Members already have full access.');
  end if;

  v_count := public.community_member_count(p_group);
  v_spec := public.community_spectator_count(p_group);
  v_total := v_count + v_spec;

  -- Idempotent: an existing spectator seat is returned as-is.
  if v_role = 'spectator' then
    return jsonb_build_object('ok', true, 'already_spectator', true, 'free', true,
      'spectator_count', v_spec, 'member_count', v_count,
      'free_spectator_cap', v_gr.free_spectator_cap, 'member_limit', v_gr.member_limit);
  end if;

  if exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_banned_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;

  if v_total >= v_gr.member_limit then
    return jsonb_build_object('ok', false, 'code', 'GROUP_FULL',
      'message', 'This room is at capacity.',
      'member_count', v_count, 'spectator_count', v_spec, 'member_limit', v_gr.member_limit,
      'spectator_price', v_gr.spectator_price);
  end if;

  if v_spec >= v_gr.free_spectator_cap then
    return jsonb_build_object('ok', false, 'code', 'SPECTATOR_PAYMENT_REQUIRED',
      'message', 'All free spectator slots are taken. A one-time spectator pass unlocks access.',
      'spectator_count', v_spec, 'free_spectator_cap', v_gr.free_spectator_cap,
      'member_limit', v_gr.member_limit, 'spectator_price', v_gr.spectator_price);
  end if;

  insert into public.anonymous_spectators (group_id, user_id, reference, amount, tier, status)
  values (p_group, p_user,
          'free-spectate-' || p_group::text || '-' || p_user::text,
          0, 'free', 'active')
  on conflict (group_id, user_id) do update
    set status = 'active', revoked_at = null, tier = 'free', amount = 0,
        reference = excluded.reference;

  v_spec := public.community_spectator_count(p_group);

  return jsonb_build_object('ok', true, 'already_spectator', false, 'free', true,
    'spectator_count', v_spec, 'member_count', v_count,
    'free_spectator_cap', v_gr.free_spectator_cap, 'member_limit', v_gr.member_limit);
end;
$$;

-- ------------------------------------------------------------
-- 7. community_anonymous_grant_membership — paid seat fulfilment.
--    Called ONLY by the payment verifier / webhook (service_role)
--    after a verified charge. Grants the member seat, records the
--    ledger row, revokes any spectator seat (one seat per user),
--    and re-checks capacity. Idempotent on (group_id, user_id).
-- ------------------------------------------------------------
create or replace function public.community_anonymous_grant_membership(
  p_group bigint,
  p_user uuid,
  p_reference text,
  p_amount integer,
  p_tier text default 'paid'
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_count bigint;
  v_spec bigint;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;
  if v_gr.group_state = 'wiped' or v_gr.is_active = false then
    return jsonb_build_object('ok', false, 'code', 'GROUP_WIPED');
  end if;

  -- Replay-safe: an existing paid membership is the seat.
  if exists (select 1 from public.anonymous_memberships m
              where m.group_id = p_group and m.user_id = p_user) then
    return jsonb_build_object('ok', true, 'already_member', true,
      'member_count', public.community_member_count(p_group),
      'group_state', v_gr.group_state);
  end if;

  v_count := public.community_member_count(p_group);
  v_spec := public.community_spectator_count(p_group);
  if v_count + v_spec >= v_gr.member_limit then
    return jsonb_build_object('ok', false, 'code', 'GROUP_FULL',
      'message', 'This room is at capacity.',
      'member_count', v_count, 'spectator_count', v_spec, 'member_limit', v_gr.member_limit);
  end if;

  -- One seat per user: a buyer who was spectating loses the spectator seat.
  update public.anonymous_spectators
     set status = 'revoked', revoked_at = now()
   where group_id = p_group and user_id = p_user and status = 'active';

  insert into public.anonymous_memberships (group_id, user_id, reference, amount, tier, status)
  values (p_group, p_user, p_reference, greatest(coalesce(p_amount, 0), 0),
          coalesce(p_tier, 'paid'), 'active')
  on conflict (group_id, user_id) do nothing;

  insert into public.study_group_members (group_id, user_id, role)
  values (p_group, p_user, 'member')
  on conflict (group_id, user_id) do nothing;

  v_count := public.community_member_count(p_group);
  if v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
    update public.study_groups set group_state = 'active', updated_at = now() where id = p_group;
  end if;

  return jsonb_build_object('ok', true, 'already_member', false, 'granted', true,
    'member_count', v_count,
    'group_state', (select group_state from public.study_groups where id = p_group));
end;
$$;

-- ------------------------------------------------------------
-- 8. community_anonymous_wipe — also revoke paid member seats.
-- ------------------------------------------------------------
create or replace function public.community_anonymous_wipe(p_group bigint)
returns void
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare v_gr record;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return;
  end if;

  update public.study_groups
     set group_state = 'wiped', is_active = false, updated_at = now()
   where id = p_group;

  update public.community_posts
     set is_deleted = true, is_hidden = true
   where group_id = p_group and is_deleted = false;

  update public.anonymous_spectators
     set status = 'revoked', revoked_at = now()
   where group_id = p_group and status = 'active';

  update public.anonymous_memberships
     set status = 'revoked', revoked_at = now()
   where group_id = p_group and status = 'active';

  delete from public.study_group_members where group_id = p_group;
end;
$$;

-- ------------------------------------------------------------
-- 9. GRANTS — payment/lifecycle RPCs service_role ONLY
--    (explicit anon/authenticated revokes: this project's default
--    privileges auto-grant EXECUTE on every new function).
-- ------------------------------------------------------------
revoke execute on function public.community_anonymous_join(bigint, uuid) from public, anon, authenticated;
grant execute on function public.community_anonymous_join(bigint, uuid) to service_role;

revoke execute on function public.community_anonymous_spectate_free(bigint, uuid) from public, anon, authenticated;
grant execute on function public.community_anonymous_spectate_free(bigint, uuid) to service_role;

revoke execute on function public.community_anonymous_grant_membership(bigint, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.community_anonymous_grant_membership(bigint, uuid, text, integer, text) to service_role;

revoke execute on function public.community_anonymous_wipe(bigint) from public, anon, authenticated;
grant execute on function public.community_anonymous_wipe(bigint) to service_role;

revoke execute on function public.community_spectator_count(bigint) from public, anon;
grant execute on function public.community_spectator_count(bigint) to authenticated, service_role;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
