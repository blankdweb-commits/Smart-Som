-- ============================================================
-- Apex Scholars Migration v4c — Verified Study Groups
-- Adds a group registry + membership, and scopes community posts
-- to a group (`group_id`). Group-scoped posts render a private
-- feed on the group detail screen; the main community feed only
-- shows non-group posts. Admins verify groups (`is_verified`).
-- Idempotent. Safe to re-run. Requires migr-v4b first.
-- ============================================================

-- ------------------------------------------------------------
-- 1. STUDY GROUPS REGISTRY
-- ------------------------------------------------------------
create table if not exists public.study_groups (
  id bigint generated always as identity primary key,
  name text not null,
  description text not null default '',
  school text not null default '',
  level text not null default '',
  focus text not null default '',
  creator_id uuid not null references auth.users(id) on delete cascade,
  is_verified boolean not null default false,
  member_limit integer not null default 30 check (member_limit between 2 and 200),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_study_groups_active on public.study_groups(is_active);
create index if not exists idx_study_groups_created on public.study_groups(created_at desc);

-- ------------------------------------------------------------
-- 2. MEMBERSHIP (owner is inserted as the first member)
-- ------------------------------------------------------------
create table if not exists public.study_group_members (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists idx_study_group_members_user on public.study_group_members(user_id);

-- ------------------------------------------------------------
-- 3. GROUP-SCOPED POSTS
-- ------------------------------------------------------------
alter table public.community_posts add column if not exists group_id bigint references public.study_groups(id) on delete set null;
create index if not exists idx_community_posts_group on public.community_posts(group_id);

-- ------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ------------------------------------------------------------
alter table public.study_groups enable row level security;
alter table public.study_group_members enable row level security;

-- Groups: anyone can browse active groups; owner creates/manages;
-- admins verify/unverify; owner deletes.
drop policy if exists "groups_public_read_active" on public.study_groups;
create policy "groups_public_read_active"
  on public.study_groups for select
  using (is_active);

drop policy if exists "groups_insert_authed" on public.study_groups;
create policy "groups_insert_authed"
  on public.study_groups for insert
  with check (auth.uid() = creator_id and auth.uid() is not null);

drop policy if exists "groups_owner_update" on public.study_groups;
create policy "groups_owner_update"
  on public.study_groups for update
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

drop policy if exists "groups_admin_update" on public.study_groups;
create policy "groups_admin_update"
  on public.study_groups for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "groups_owner_delete" on public.study_groups;
create policy "groups_owner_delete"
  on public.study_groups for delete
  using (auth.uid() = creator_id);

drop policy if exists "groups_admin_delete" on public.study_groups;
create policy "groups_admin_delete"
  on public.study_groups for delete
  using (public.is_admin());

-- Membership: visible to all signed-in users (group sizes/authorship);
-- members can join/leave; owners can manage roles.
drop policy if exists "members_public_read" on public.study_group_members;
create policy "members_public_read"
  on public.study_group_members for select using (true);

drop policy if exists "members_insert_own" on public.study_group_members;
create policy "members_insert_own"
  on public.study_group_members for insert
  with check (auth.uid() = user_id and auth.uid() is not null);

drop policy if exists "members_delete_own" on public.study_group_members;
create policy "members_delete_own"
  on public.study_group_members for delete
  using (auth.uid() = user_id);

-- Group posts inherit the existing post policies (community_posts RLS).

-- ------------------------------------------------------------
-- 5. RECREATE community_feed VIEW incl. group_id + section
-- ------------------------------------------------------------
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
    cp.display_name,
    cp.avatar_url,
    cp.year,
    (select count(*) from public.community_post_likes l where l.post_id = p.id)::int as like_count,
    (select count(*) from public.community_comments c where c.post_id = p.id and not c.is_deleted)::int as reply_count,
    (select count(*) from public.community_post_shares s where s.post_id = p.id)::int as share_count,
    exists (
      select 1 from public.community_post_likes l2
      where l2.post_id = p.id and l2.user_id = auth.uid()
    ) as liked_by_current_user
  from public.community_posts p
  left join public.community_profiles cp on cp.id = p.author_id
  where not p.is_deleted and not p.is_hidden;

grant select on public.community_feed to anon, authenticated;

-- ------------------------------------------------------------
-- 6. REALTIME
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.study_groups;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.study_group_members;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- DONE.
-- ============================================================