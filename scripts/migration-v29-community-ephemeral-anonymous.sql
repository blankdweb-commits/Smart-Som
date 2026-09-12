-- ============================================================
-- Apex Scholars Migration v29 — Community Reset + Ephemeral
-- Posts + Anonymous Group System
--
-- WHAT THIS MIGRATION DOES (matches "POLYNURSE — COMMUNITY RESET +
-- EPHEMERAL POSTS + ANONYMOUS GROUP SYSTEM", 32 phases):
--   P1  Community reset: all legacy posts move to the single
--       `general` feed and get a 24-hour grace period
--       (grace_until = now()+24h) so nothing is deleted.
--   P3-P16  Ephemeral posts: server-authoritative life clock.
--       lives_until = grace_until (legacy) OR
--       coalesce(last_interaction_at, created_at) + 1 hour.
--       A post is 'cold' after 110s of idle but stays visible
--       and revivable until the 1h wipe point. Wipe via
--       community_cleanup() (idempotent). Hard deletes purge
--       cascading comments/likes/shares; reported posts are
--       soft-hidden and RETAINED for moderation.
--   P17-P29  Anonymous group: new study_groups columns
--       (type/privacy/spectator_price/minimum_members_to_activate
--       =30/minimum_members_to_remain_active=18/group_state),
--       anonymous_spectators ledger, SECURITY DEFINER RPCs
--       (join/leave/wipe/panel/feed), client write LPS dropped,
--       anonymity-preserving membership RLS, profiles ban flag.
--   P30  Client writes locked to server (posts/comments/likes).
--       RPC grants: join/leave/wipe/cleanup = service_role ONLY.
--
-- Security model: SECURITY DEFINER bypasses RLS, all functions set
-- search_path. Read helpers are granted to authenticated/anon so RLS
-- policies + views can call them; write/lifecycle RPCs are
-- service_role-only (never exposed to the client).
--
-- Idempotent. Safe to re-run. Requires v4c (study_groups/members),
-- v22/v23 (community_profiles/community_feed), v25 (profiles RLS).
-- ============================================================

-- ------------------------------------------------------------
-- 0. PROFILES: ban flag (null = not banned)
-- ------------------------------------------------------------
alter table public.profiles add column if not exists community_banned_at timestamptz;

-- ------------------------------------------------------------
-- 1. COMMUNITY POSTS: ephemeral lifecycle columns
-- ------------------------------------------------------------
alter table public.community_posts add column if not exists last_interaction_at timestamptz;
alter table public.community_posts add column if not exists last_interaction_by uuid
  references auth.users(id) on delete set null;
alter table public.community_posts add column if not exists grace_until timestamptz;

create index if not exists idx_community_posts_interaction on public.community_posts(last_interaction_at);

-- Community reset (P1): single `general` feed + 24h phase-out window.
update public.community_posts
   set section            = 'general',
       grace_until        = now() + interval '24 hours',
       last_interaction_at = coalesce(last_interaction_at, created_at)
 where section is distinct from 'general'
    or grace_until is null;

-- ------------------------------------------------------------
-- 2. STUDY GROUPS: Anonymous-group columns
--    type:   normal | anonymous
--    privacy: public | restricted
--    group_state: normal (regular groups) | waiting | active | wiped
--    minimum_members_to_activate        = 30 (opens the group)
--    minimum_members_to_remain_active   = 18 (below => wipe)
-- ------------------------------------------------------------
alter table public.study_groups add column if not exists type text not null default 'normal';
alter table public.study_groups add column if not exists privacy text not null default 'public';
alter table public.study_groups add column if not exists spectator_price numeric(12,2) not null default 0;
alter table public.study_groups add column if not exists minimum_members_to_activate integer not null default 0;
alter table public.study_groups add column if not exists minimum_members_to_remain_active integer not null default 0;
alter table public.study_groups add column if not exists group_state text not null default 'normal';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.study_groups'::regclass and conname = 'study_groups_type_check') then
    alter table public.study_groups add constraint study_groups_type_check check (type in ('normal', 'anonymous'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.study_groups'::regclass and conname = 'study_groups_privacy_check') then
    alter table public.study_groups add constraint study_groups_privacy_check check (privacy in ('public', 'restricted'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.study_groups'::regclass and conname = 'study_groups_state_check') then
    alter table public.study_groups add constraint study_groups_state_check check (group_state in ('normal', 'waiting', 'active', 'wiped'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.study_groups'::regclass and conname = 'study_groups_spectator_price_check') then
    alter table public.study_groups add constraint study_groups_spectator_price_check check (spectator_price >= 0);
  end if;
end $$;

-- Backfill: existing normal groups get explicit normal values.
update public.study_groups
   set type = 'normal', privacy = 'public', group_state = 'normal'
 where type is null or group_state is null or privacy is null;

-- ------------------------------------------------------------
-- 3. ANONYMOUS SPECTATOR LEDGER
--    A ₦599 payment grants `active` spectator status (no free-form
--    chat; can view + approved reactions only). Wipe revokes all.
-- ------------------------------------------------------------
create table if not exists public.anonymous_spectators (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reference text not null unique,
  amount integer not null check (amount > 0),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (group_id, user_id)
);

create index if not exists idx_anonymous_spectators_group on public.anonymous_spectators(group_id, status);
create index if not exists idx_anonymous_spectators_user on public.anonymous_spectators(user_id, status);

alter table public.anonymous_spectators enable row level security;

-- ============================================================
-- 4. SECURITY DEFINER RPCs
--    search_path pinned; definer bypasses RLS (server-authoritative).
-- ============================================================

-- 4.1 community_can_view(p_user, p_group) — core visibility predicate.
--     Guard: a CLIENT caller may only ask about its own auth.uid().
--     (service-role/API callers pass the verified token user.)
create or replace function public.community_can_view(p_user uuid, p_group bigint)
returns boolean
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare v_gr record; v_role text;
begin
  if p_group is null then
    return true;
  end if;
  -- Only the invoking user (or an admin) may evaluate another uid.
  if auth.uid() is not null and auth.uid() <> p_user and not public.is_admin() then
    return false;
  end if;
  select * into v_gr from public.study_groups where id = p_group;
  if v_gr is null then
    return false;
  end if;
  if v_gr.group_state = 'wiped' or v_gr.is_active = false then
    return false;
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return true; -- normal/regular groups stay publicly browsable
  end if;
  v_role := public.community_role_for_group(p_user, p_group);
  return v_role in ('member', 'spectator', 'admin');
end;
$$;

-- 4.2 community_role_for_group(p_user, p_group) -> member|spectator|admin|none
create or replace function public.community_role_for_group(p_user uuid, p_group bigint)
returns text
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
begin
  if p_user is null then
    return 'none';
  end if;
  if auth.uid() is not null and auth.uid() <> p_user and not public.is_admin() then
    return 'none';
  end if;
  if exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_banned_at is not null) then
    return 'none';
  end if;
  if exists (select 1 from public.study_group_members m where m.group_id = p_group and m.user_id = p_user) then
    return 'member';
  end if;
  if exists (select 1 from public.anonymous_spectators s
              where s.group_id = p_group and s.user_id = p_user and s.status = 'active') then
    return 'spectator';
  end if;
  if public.is_admin() then
    return 'admin';
  end if;
  return 'none';
end;
$$;

-- 4.3 community_member_count(p_group) — active (non-banned) members.
create or replace function public.community_member_count(p_group bigint)
returns bigint
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare v_count bigint;
begin
  select count(*)::bigint into v_count
    from public.study_group_members m
    left join public.profiles pr on pr.id = m.user_id
   where m.group_id = p_group
     and (pr.id is null or pr.community_banned_at is null);
  return v_count;
end;
$$;

-- 4.4 community_post_lives_until(p) — the SOLE wipe authority.
--     Legacy (grace_until not null) => grace_until (24h phase-out).
--     Otherwise => last interaction (or creation) + 1 hour.
create or replace function public.community_post_lives_until(p public.community_posts)
returns timestamptz
language sql stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(p.grace_until, coalesce(p.last_interaction_at, p.created_at) + interval '1 hour')
$$;

-- 4.5 community_post_viewer_allowed(p_group) — RLS policy predicate.
create or replace function public.community_post_viewer_allowed(p_group bigint)
returns boolean
language sql stable
security definer set search_path = public, pg_temp
as $$
  select public.community_can_view(auth.uid(), p_group)
$$;

-- 4.6 community_panel(p_group, p_user) — group card + role + masked count.
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
  -- The waitlist counter is public during the OPEN waiting round so joiners can
  -- see progress toward activation; once active the exact count is member-only.
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
    'can_view', v_view,
    'my_role', v_role,
    'member_count', v_count
  );
end;
$$;

-- 4.7 community_group_feed(p_group, p_limit, p_user) — authorization-gated
--     feed for group posts incl. anonymous groups. Mirrors community_feed
--     columns + ephemeral fields. Returns zero rows when not allowed.
create or replace function public.community_group_feed(p_group bigint, p_limit integer, p_user uuid)
returns table (
  id uuid,
  author_id uuid,
  content text,
  image_url text,
  group_id bigint,
  created_at timestamptz,
  display_name text,
  avatar_url text,
  year text,
  like_count integer,
  reply_count integer,
  share_count integer,
  liked_by_current_user boolean,
  last_interaction_at timestamptz,
  lives_until timestamptz,
  post_state text
)
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_anon boolean;
begin
  if auth.uid() is not null and auth.uid() <> p_user and not public.is_admin() then
    return;
  end if;
  if not public.community_can_view(p_user, p_group) then
    return;
  end if;
  -- Anonymous rooms mask every author's identity — the board is the point.
  select (g.type = 'anonymous') into v_anon from public.study_groups g where g.id = p_group;
  return query
    select
      p.id, p.author_id, p.content, p.image_url, p.group_id, p.created_at,
      case when v_anon then 'Anonymous Member' else cp.display_name end,
      case when v_anon then null else cp.avatar_url end,
      case when v_anon then null else cp.year end,
      (select count(*) from public.community_post_likes l where l.post_id = p.id)::int,
      (select count(*) from public.community_comments c where c.post_id = p.id and not c.is_deleted)::int,
      (select count(*) from public.community_post_shares s where s.post_id = p.id)::int,
      exists (select 1 from public.community_post_likes l2 where l2.post_id = p.id and l2.user_id = p_user),
      p.last_interaction_at,
      public.community_post_lives_until(p),
      case when now() <= coalesce(p.last_interaction_at, p.created_at) + interval '110 seconds'
           then 'active' else 'cold' end
    from public.community_posts p
    left join public.community_profiles cp on cp.id = p.author_id
   where p.group_id = p_group
     and not p.is_deleted
     and not p.is_hidden
     and now() <= public.community_post_lives_until(p)
   order by p.created_at desc
   limit v_limit;
end;
$$;

-- 4.8 community_anonymous_join(p_group, p_user) — service-role ONLY.
--     Serialized via advisory xact lock. Activates exactly at 30;
--     the 31st join is refused. Guards: banned, wiped, already role.
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
    return jsonb_build_object('ok', true, 'already_member', true, 'member_count', public.community_member_count(p_group), 'group_state', v_gr.group_state);
  end if;
  if v_role = 'spectator' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SPECTATOR', 'message', 'You already have spectator access to this group. You cannot become a member.');
  end if;

  if exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_banned_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;

  v_count := public.community_member_count(p_group);
  if v_gr.group_state = 'active' or v_count >= v_gr.minimum_members_to_activate then
    return jsonb_build_object('ok', false, 'code', 'GROUP_ACTIVE',
      'message', 'This group is full and its member list is now locked. Spectator access is available instead.',
      'member_count', v_count, 'spectator_price', v_gr.spectator_price);
  end if;

  insert into public.study_group_members (group_id, user_id, role)
  values (p_group, p_user, 'member')
  on conflict (group_id, user_id) do nothing;

  v_count := public.community_member_count(p_group);
  if v_count >= v_gr.minimum_members_to_activate then
    update public.study_groups set group_state = 'active', updated_at = now() where id = p_group;
  end if;

  return jsonb_build_object('ok', true, 'already_member', false, 'member_count', v_count,
    'group_state', (select group_state from public.study_groups where id = p_group));
end;
$$;

-- 4.9 community_anonymous_leave(p_group, p_user) — service-role ONLY.
--     Below minimum_members_to_remain_active (18) on an ACTIVE group
--     triggers the wipe. Returns { ok, wiped, member_count }.
create or replace function public.community_anonymous_leave(p_group bigint, p_user uuid)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_role text;
  v_count bigint;
  v_owner boolean;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;

  v_role := public.community_role_for_group(p_user, p_group);
  if v_role = 'none' then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_MEMBER');
  end if;
  if exists (select 1 from public.study_group_members m
              where m.group_id = p_group and m.user_id = p_user and m.role = 'owner') then
    return jsonb_build_object('ok', false, 'code', 'OWNER_CANNOT_LEAVE');
  end if;

  delete from public.study_group_members where group_id = p_group and user_id = p_user;
  v_count := public.community_member_count(p_group);

  if v_gr.group_state = 'active' and v_count < v_gr.minimum_members_to_remain_active then
    perform public.community_anonymous_wipe(p_group);
    return jsonb_build_object('ok', true, 'wiped', true, 'member_count', v_count,
      'group_state', 'wiped');
  end if;

  if v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
    update public.study_groups set group_state = 'active', updated_at = now() where id = p_group;
  end if;

  return jsonb_build_object('ok', true, 'wiped', false, 'member_count', v_count,
    'group_state', (select group_state from public.study_groups where id = p_group));
end;
$$;

-- 4.10 community_anonymous_wipe(p_group) — service-role ONLY.
--      Locks the group to 'wiped', soft-hides its messages, revokes
--      spectators, empties memberships. Never re-openable.
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

  delete from public.study_group_members where group_id = p_group;
end;
$$;

-- 4.11 community_cleanup(p_now) — service-role ONLY scheduler entry.
--      Idempotent. Purges expired posts (hard delete → cascades),
--      soft-hides expired REPORTED posts (retained for moderation),
--      and watchdog-moves anonymous groups (waiting→active at 30,
--      active→wiped below 18). Advisory-locked against joins/leaves.
create or replace function public.community_cleanup(p_now timestamptz default null)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_purged bigint := 0;
  v_hidden bigint := 0;
  v_author_purged bigint := 0;
  v_active bigint := 0;
  v_wiped bigint := 0;
  v_gr record;
  v_count bigint;
begin
  perform pg_advisory_xact_lock(hashtext('community:cleanup'));

  -- Author-shredded or moderator-hidden soft-deleted posts: purge once past life.
  delete from public.community_posts cp
   where cp.is_deleted = true
     and v_now > public.community_post_lives_until(cp);
  get diagnostics v_author_purged = row_count;

  -- Reported posts expire by being retained: soft-hide, keep row for mods.
  update public.community_posts cp
     set is_hidden = true
   where cp.is_deleted = false
     and cp.is_hidden = false
     and v_now > public.community_post_lives_until(cp)
     and exists (select 1 from public.community_reports r where r.post_id = cp.id);
  get diagnostics v_hidden = row_count;

  -- Non-reported expired posts: hard purge (cascades comments/likes/shares).
  delete from public.community_posts cp
   where cp.is_deleted = false
     and v_now > public.community_post_lives_until(cp)
     and not exists (select 1 from public.community_reports r where r.post_id = cp.id);
  get diagnostics v_purged = row_count;

  -- Anonymous group watchdog (overlaps join/leave but is race-safe).
  for v_gr in
    select g.* from public.study_groups g
     where g.type = 'anonymous' and g.group_state in ('waiting', 'active')
  loop
    v_count := public.community_member_count(v_gr.id);
    if v_gr.group_state = 'active' and v_count < v_gr.minimum_members_to_remain_active then
      perform public.community_anonymous_wipe(v_gr.id);
      v_wiped := v_wiped + 1;
    elsif v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
      update public.study_groups set group_state = 'active', updated_at = now() where id = v_gr.id;
      v_active := v_active + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'posts_purged', v_purged,
    'posts_hidden_reported', v_hidden,
    'soft_deleted_purged', v_author_purged,
    'groups_activated', v_active,
    'groups_wiped', v_wiped
  );
end;
$$;

-- ------------------------------------------------------------
-- 5. RPC GRANTS
--    Read/policy helpers → authenticated (+ anon for RLS/view eval).
--    Lifecycle/wipe/cleanup RPCs → service_role ONLY (never client).
-- ------------------------------------------------------------
grant execute on function public.community_can_view(uuid, bigint) to anon, authenticated;
grant execute on function public.community_role_for_group(uuid, bigint) to authenticated;
grant execute on function public.community_member_count(bigint) to authenticated;
grant execute on function public.community_post_lives_until(public.community_posts) to anon, authenticated;
grant execute on function public.community_post_viewer_allowed(bigint) to anon, authenticated;
grant execute on function public.community_panel(bigint, uuid) to authenticated;
grant execute on function public.community_group_feed(bigint, integer, uuid) to authenticated;

revoke execute on function public.community_anonymous_join(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.community_anonymous_leave(bigint, uuid) from public, anon, authenticated;
revoke execute on function public.community_anonymous_wipe(bigint) from public, anon, authenticated;
revoke execute on function public.community_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.community_anonymous_join(bigint, uuid) to service_role;
grant execute on function public.community_anonymous_leave(bigint, uuid) to service_role;
grant execute on function public.community_anonymous_wipe(bigint) to service_role;
grant execute on function public.community_cleanup(timestamptz) to service_role;

-- ============================================================
-- 6. RLS LOCKDOWN — client writes go through the API now.
-- ============================================================

-- --- community_posts -------------------------------------------------
-- (Legacy policy names are the human-readable ones created by the base
-- schema: "Users can ...". The *_own fires below never matched the live
-- schema, so the real names are dropped explicitly.)
drop policy if exists "posts_public_read" on public.community_posts;
drop policy if exists "posts_insert_own" on public.community_posts;
drop policy if exists "posts_update_own" on public.community_posts;
drop policy if exists "Users can create community posts" on public.community_posts;
drop policy if exists "Users can update own community posts" on public.community_posts;
drop policy if exists "Users can delete own community posts" on public.community_posts;
drop policy if exists "Users can view community posts" on public.community_posts;

create policy "posts_read_gated"
  on public.community_posts for select
  using (not is_deleted
     and not is_hidden
     and now() <= public.community_post_lives_until(community_posts)
     and public.community_post_viewer_allowed(group_id));

-- Admins may soft-delete/hide any post for moderation (server-side API
-- performs author edits + all writes via the service role).
create policy "posts_admin_moderate"
  on public.community_posts for update
  using (public.is_admin())
  with check (public.is_admin());

-- --- community_comments ----------------------------------------------
drop policy if exists "comments_public_read" on public.community_comments;
drop policy if exists "comments_insert_own" on public.community_comments;
drop policy if exists "comments_update_own" on public.community_comments;
drop policy if exists "Users can create community comments" on public.community_comments;
drop policy if exists "Users can update own comments" on public.community_comments;
drop policy if exists "Users can delete own comments" on public.community_comments;
drop policy if exists "Users can view community comments" on public.community_comments;

create policy "comments_read_gated"
  on public.community_comments for select
  using (not is_deleted
     and exists (select 1 from public.community_posts p
                  where p.id = community_comments.post_id
                    and now() <= public.community_post_lives_until(p)
                    and public.community_post_viewer_allowed(p.group_id)));

create policy "comments_admin_moderate"
  on public.community_comments for update
  using (public.is_admin())
  with check (public.is_admin());

-- --- community_post_likes --------------------------------------------
drop policy if exists "likes_insert_own" on public.community_post_likes;
drop policy if exists "likes_delete_own" on public.community_post_likes;
drop policy if exists "likes_public_read" on public.community_post_likes;
drop policy if exists "Users can like posts" on public.community_post_likes;
drop policy if exists "Users can unlike posts" on public.community_post_likes;
drop policy if exists "Users can view post likes" on public.community_post_likes;

create policy "likes_read_gated"
  on public.community_post_likes for select
  using (auth.uid() = user_id
     or exists (select 1 from public.community_posts p
                 where p.id = community_post_likes.post_id
                   and now() <= public.community_post_lives_until(p)
                   and public.community_post_viewer_allowed(p.group_id)));

-- --- community_reports (client report-writes go through the API; admins can now read) -----
drop policy if exists "reports_admin_read" on public.community_reports;
drop policy if exists "reports_insert_authed" on public.community_reports;
drop policy if exists "Users can create reports" on public.community_reports;
create policy "reports_admin_read"
  on public.community_reports for select
  using (public.is_admin());

-- --- study_groups -----------------------------------------------------
drop policy if exists "groups_insert_authed" on public.study_groups;
create policy "groups_insert_authed"
  on public.study_groups for insert
  with check (auth.uid() = creator_id and auth.uid() is not null and type <> 'anonymous');

drop policy if exists "groups_owner_update" on public.study_groups;
create policy "groups_owner_update"
  on public.study_groups for update
  using (auth.uid() = creator_id and type <> 'anonymous')
  with check (auth.uid() = creator_id and type <> 'anonymous');

drop policy if exists "groups_owner_delete" on public.study_groups;
create policy "groups_owner_delete"
  on public.study_groups for delete
  using (auth.uid() = creator_id and type <> 'anonymous');

-- --- study_group_members ----------------------------------------------
drop policy if exists "members_public_read" on public.study_group_members;
drop policy if exists "members_insert_own" on public.study_group_members;
drop policy if exists "members_delete_own" on public.study_group_members;

-- Read: admins see all; everyone sees their own rows; normal-group
-- memberships stay public for header counts; ANONYMOUS membership is
-- invisible except to the member themselves (anonymity preserved).
create policy "members_read_masked"
  on public.study_group_members for select
  using (public.is_admin()
     or auth.uid() = user_id
     or exists (select 1 from public.study_groups g
                 where g.id = study_group_members.group_id and g.type <> 'anonymous'));

create policy "members_insert_own"
  on public.study_group_members for insert
  with check (auth.uid() = user_id
     and auth.uid() is not null
     and exists (select 1 from public.study_groups g
                  where g.id = study_group_members.group_id and g.type <> 'anonymous'));

create policy "members_delete_own"
  on public.study_group_members for delete
  using (auth.uid() = user_id
     and exists (select 1 from public.study_groups g
                  where g.id = study_group_members.group_id and g.type <> 'anonymous'));

create policy "members_admin_delete"
  on public.study_group_members for delete
  using (public.is_admin());

-- ============================================================
-- 7. COMMUNITY FEED VIEW — expiry + post_state + anon exclusion
--    Expiry is ALSO enforced inside the view (not only RLS) so
--    service-role reads (API) never leak expired content.
--    Anonymous-group posts are excluded from the generic view and
--    render exclusively via community_group_feed (auth-gated).
-- ============================================================
do $$
begin
  drop view if exists public.community_feed;
exception when wrong_object_type or undefined_table then null;
end $$;
do $$
begin
  drop table if exists public.community_feed cascade;
exception when wrong_object_type then null;
end $$;

create view public.community_feed as
  select
    p.id,
    p.author_id,
    p.content,
    p.image_url,
    p.section,
    p.group_id,
    p.created_at,
    p.last_interaction_at,
    public.community_post_lives_until(p) as lives_until,
    cp.display_name,
    cp.avatar_url,
    cp.year,
    (select count(*) from public.community_post_likes l where l.post_id = p.id)::int as like_count,
    (select count(*) from public.community_comments c where c.post_id = p.id and not c.is_deleted)::int as reply_count,
    (select count(*) from public.community_post_shares s where s.post_id = p.id)::int as share_count,
    exists (
      select 1 from public.community_post_likes l2
      where l2.post_id = p.id and l2.user_id = auth.uid()
    ) as liked_by_current_user,
    case when now() <= coalesce(p.last_interaction_at, p.created_at) + interval '110 seconds'
         then 'active' else 'cold' end as post_state
  from public.community_posts p
  left join public.community_profiles cp on cp.id = p.author_id
 where not p.is_deleted
   and not p.is_hidden
   and now() <= public.community_post_lives_until(p)
   and (p.group_id is null
        or not exists (select 1 from public.study_groups ag
                        where ag.id = p.group_id and ag.type = 'anonymous'));

grant select on public.community_feed to anon, authenticated;

-- ============================================================
-- 8. SEED: THE ANONYMOUS GROUP
--    One-time, admin-anchored. 30 to activate, 18 to survive,
--    restricted, ₦599 spectator access. group_state starts 'waiting'.
-- ============================================================
insert into public.study_groups (
  name, description, creator_id, is_verified, member_limit, is_active,
  type, privacy, spectator_price,
  minimum_members_to_activate, minimum_members_to_remain_active, group_state
)
select
  'Anonymous',
  'A private, member-gated community where you can speak freely on everything nursing. '
  || 'It becomes active once 30 verified members join. After that the room is closed — '
  || 'only members speak, anyone can watch as a spectator. If total membership ever '
  || 'drops below 18 members, the Anonymous room is wiped.',
  admin.id, true, 30, true,
  'anonymous', 'restricted', 599.00,
  30, 18, 'waiting'
from (select id from public.profiles
       where role in ('admin', 'super_admin')
       order by created_at limit 1) admin
where not exists (
  select 1 from public.study_groups g where g.type = 'anonymous'
);

-- ============================================================
-- DONE. Next: node scripts/seed-anonymous... (not needed — the seed
-- lives here). Apply with: node scripts/run-migration.mjs
--     scripts/migration-v29-community-ephemeral-anonymous.sql
-- ============================================================