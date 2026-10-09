-- ============================================================
-- Apex Scholars Migration v41 — ANONYMOUS ROOM HARDENING
--
-- Focused change set for the Anonymous room ONLY. Nothing outside
-- the anonymous product surface is touched.
--
--   1. CAPACITY IS SEPARATE FROM ACTIVATION.
--      minimum_members_to_activate = 10 (the room opens at 10,
--      owner counts as member #1). member_limit is the real room
--      CAPACITY (default 100) — 10 is NOT the maximum. A new
--      membership_locked flag lets the owner close the door while
--      the room keeps running. Joins past capacity return
--      GROUP_FULL; joins while locked return MEMBERSHIP_LOCKED.
--      Both carry the spectator price so the client can offer the
--      "full room" choice screen.
--
--   2. EPHEMERAL HARD CEILING. community_post_lives_until() gains
--      an absolute created_at + 6h cap so no amount of interaction
--      farming can extend a message forever (was: last interaction
--      + 1h with no ceiling).
--
--   3. REPORTS get a category + details + a (reporter, post) index
--      so the API can rate-limit and de-duplicate. (RLS is unchanged:
--      admins read, server writes.)
--
--   4. SAFETY NOTICE ACKNOWLEDGEMENTS — per-user, versioned, server
--      readable/writable only. RLS enabled with NO policies.
--
-- Idempotent. Safe to re-run. Requires v29 + v39.
-- Apply: node scripts/run-migration.mjs scripts/migration-v41-anonymous-room-hardening.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. CAPACITY + MEMBERSHIP LOCK
-- ------------------------------------------------------------
alter table public.study_groups
  add column if not exists membership_locked boolean not null default false;

alter table public.study_groups
  alter column member_limit set default 100;

-- Anonymous rooms: capacity 100, lock off. The activation threshold
-- (10) is untouched — it stays the OPEN trigger, not the ceiling.
update public.study_groups
   set member_limit = 100,
       membership_locked = false,
       updated_at = now()
 where type = 'anonymous'
   and (member_limit is null or member_limit < 100);

-- ------------------------------------------------------------
-- 2. REPORT CATEGORY + DEDUP/RATE-LIMIT INDEXES
-- ------------------------------------------------------------
alter table public.community_reports
  add column if not exists category text not null default 'other';
alter table public.community_reports
  add column if not exists details text;

create index if not exists idx_community_reports_reporter_created
  on public.community_reports(reporter_id, created_at desc);
create index if not exists idx_community_reports_post
  on public.community_reports(post_id);

-- ------------------------------------------------------------
-- 3. SAFETY NOTICE ACKNOWLEDGEMENTS (versioned, service-role only)
-- ------------------------------------------------------------
create table if not exists public.community_notice_acks (
  user_id uuid not null references auth.users(id) on delete cascade,
  notice_key text not null,
  version integer not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, notice_key)
);

alter table public.community_notice_acks enable row level security;
revoke all on public.community_notice_acks from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. EPHEMERAL HARD CEILING (created_at + 6 hours)
--    grace_until still wins when present (legacy phase-out), but the
--    result is never later than created_at + 6h.
-- ------------------------------------------------------------
create or replace function public.community_post_lives_until(p public.community_posts)
returns timestamptz
language sql stable
security definer set search_path = public, pg_temp
as $$
  select least(
    coalesce(
      p.grace_until,
      coalesce(p.last_interaction_at, p.created_at) + interval '1 hour'
    ),
    p.created_at + interval '6 hours'
  )
$$;

-- ------------------------------------------------------------
-- 5. community_panel — expose member_limit + membership_locked so
--    the client can render capacity / the full-room choice screen.
--    Count stays public during a waiting round; member-only after.
-- ------------------------------------------------------------
create or replace function public.community_panel(p_group bigint, p_user uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare v_gr record; v_view boolean; v_role text; v_count bigint;
begin
  if auth.uid() is not null and auth.uid() <> p_user and not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;
  select * into v_gr from public.study_groups where id = p_group;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  v_view := public.community_can_view(p_user, p_group);
  v_role := public.community_role_for_group(p_user, p_group);
  v_count := case
    when v_view
      or (v_gr.type = 'anonymous' and v_gr.group_state = 'waiting')
    then public.community_member_count(p_group) else null end;
  return jsonb_build_object(
    'ok', true,
    'id', v_gr.id,
    'name', v_gr.name,
    'description', v_gr.description,
    'type', v_gr.type,
    'privacy', v_gr.privacy,
    'group_state', v_gr.group_state,
    'is_active', v_gr.is_active,
    'spectator_price', v_gr.spectator_price,
    'minimum_members_to_activate', v_gr.minimum_members_to_activate,
    'minimum_members_to_remain_active', v_gr.minimum_members_to_remain_active,
    'member_limit', v_gr.member_limit,
    'membership_locked', v_gr.membership_locked,
    'can_view', v_view,
    'my_role', v_role,
    'member_count', v_count
  );
end;
$$;

-- ------------------------------------------------------------
-- 6. community_anonymous_join — CAPACITY model.
--    waiting  : join freely (this is what reaches 10 and opens).
--    active   : join while not locked and below member_limit.
--    full     : GROUP_FULL (with capacity + spectator price)
--    locked   : MEMBERSHIP_LOCKED (with spectator price)
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
      'member_limit', v_gr.member_limit);
  end if;
  if v_role = 'spectator' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SPECTATOR',
      'message', 'You already have spectator access to this group. You cannot become a member.');
  end if;

  if exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_banned_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;

  v_count := public.community_member_count(p_group);

  -- The room is OPEN (activated) but its door may be locked or full.
  if v_gr.group_state = 'active' then
    if v_gr.membership_locked then
      return jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_LOCKED',
        'message', 'Membership for this room has been closed by the host. Spectator access is available instead.',
        'member_count', v_count, 'member_limit', v_gr.member_limit,
        'spectator_price', v_gr.spectator_price);
    end if;
  end if;

  if v_count >= v_gr.member_limit then
    return jsonb_build_object('ok', false, 'code', 'GROUP_FULL',
      'message', 'This room is at capacity. Spectator access is available instead.',
      'member_count', v_count, 'member_limit', v_gr.member_limit,
      'spectator_price', v_gr.spectator_price);
  end if;

  insert into public.study_group_members (group_id, user_id, role)
  values (p_group, p_user, 'member')
  on conflict (group_id, user_id) do nothing;

  v_count := public.community_member_count(p_group);
  if v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
    update public.study_groups set group_state = 'active', updated_at = now() where id = p_group;
  end if;

  return jsonb_build_object('ok', true, 'already_member', false, 'member_count', v_count,
    'group_state', (select group_state from public.study_groups where id = p_group),
    'member_limit', v_gr.member_limit);
end;
$$;

-- ------------------------------------------------------------
-- 7. community_anonymous_set_locked — owner/admin closes or reopens
--    membership while the room keeps running. service_role ONLY.
-- ------------------------------------------------------------
create or replace function public.community_anonymous_set_locked(p_group bigint, p_locked boolean)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare v_gr record;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));
  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;
  update public.study_groups
     set membership_locked = coalesce(p_locked, false), updated_at = now()
   where id = p_group;
  return jsonb_build_object('ok', true, 'group_id', p_group,
    'membership_locked', coalesce(p_locked, false),
    'group_state', v_gr.group_state,
    'member_count', public.community_member_count(p_group),
    'member_limit', v_gr.member_limit);
end;
$$;

-- ------------------------------------------------------------
-- 8. GRANTS — re-assert service_role-only on lifecycle RPCs.
-- ------------------------------------------------------------
revoke execute on function public.community_anonymous_join(bigint, uuid) from public, anon, authenticated;
grant execute on function public.community_anonymous_join(bigint, uuid) to service_role;

revoke execute on function public.community_anonymous_set_locked(bigint, boolean) from public, anon, authenticated;
grant execute on function public.community_anonymous_set_locked(bigint, boolean) to service_role;

grant execute on function public.community_panel(bigint, uuid) to authenticated;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
