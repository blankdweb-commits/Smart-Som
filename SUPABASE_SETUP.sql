-- ============================================================
-- Apex Scholars — Supabase Setup v2 (idempotent, upgrade-safe)
-- Works on a FRESH project AND upgrades the older partial schema
-- in place. Safe to re-run.
-- ============================================================

-- ============================================================
-- 1. PROFILES
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text default '',
  email text default '',
  phone text default '',
  department text default '',
  level text default '',
  matric_number text default '',
  is_activated boolean not null default false,
  role text not null default 'student' check (role in ('student', 'admin', 'super_admin')),
  streak integer default 0,
  cards_studied integer default 0,
  quiz_streak integer default 0,
  max_quiz_streak integer default 0,
  milestone text default 'Clinical Beginner',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Upgrade older profiles tables that pre-date some columns.
alter table public.profiles add column if not exists matric_number text default '';
alter table public.profiles add column if not exists is_activated boolean not null default false;
alter table public.profiles add column if not exists role text not null default 'student';
alter table public.profiles add column if not exists streak integer default 0;
alter table public.profiles add column if not exists cards_studied integer default 0;
alter table public.profiles add column if not exists quiz_streak integer default 0;
alter table public.profiles add column if not exists max_quiz_streak integer default 0;
alter table public.profiles add column if not exists milestone text default 'Clinical Beginner';
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_profiles_role on public.profiles(role);

-- Auto-create a profile whenever an auth user is created.
-- Role is FORCED to 'student' server-side; client-sent metadata cannot elevate privileges.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, phone, level)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'phone', ''),
    coalesce(new.raw_user_meta_data->>'nursing_year', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;

-- RLS helpers. Policies must never SELECT from the table they protect
-- (causes "infinite recursion detected in policy"); these SECURITY DEFINER
-- functions evaluate as the owner and are safe.
create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'super_admin')
    ), false);
$$;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = public.my_role());

drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all"
  on public.profiles for select
  using (public.is_admin());

-- ============================================================
-- 2. SUBSCRIPTIONS & PLANS
-- ============================================================
create table if not exists public.subscription_plans (
  id bigint generated always as identity primary key,
  name text not null,
  price numeric(12,2) not null,
  duration_days integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;

drop policy if exists "plans_public_read" on public.subscription_plans;
create policy "plans_public_read"
  on public.subscription_plans for select using (true);

-- Seed default plans (matches app fallback pricing)
insert into public.subscription_plans (name, price, duration_days)
select v.name, v.price, v.duration_days from (values
  ('Weekly', 1999.90, 7),
  ('Monthly', 6999.00, 30),
  ('Yearly', 49999.00, 365)
) as v(name, price, duration_days)
where not exists (select 1 from public.subscription_plans where name = v.name);

create table if not exists public.subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text default 'monthly',
  status text not null default 'active',
  expires_at timestamptz not null,
  grace_until timestamptz,
  amount numeric(12,2),
  reference text,
  created_at timestamptz not null default now()
);

-- Upgrade older subscriptions tables.
alter table public.subscriptions add column if not exists plan text default 'monthly';
alter table public.subscriptions add column if not exists grace_until timestamptz;
alter table public.subscriptions add column if not exists amount numeric(12,2);
alter table public.subscriptions add column if not exists reference text;
alter table public.subscriptions add column if not exists created_at timestamptz not null default now();

create index if not exists idx_subscriptions_user on public.subscriptions(user_id, created_at desc);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
  on public.subscriptions for select using (auth.uid() = user_id);

drop policy if exists "subscriptions_admin_all" on public.subscriptions;
create policy "subscriptions_admin_all"
  on public.subscriptions for all
  using (public.is_admin())
  with check (public.is_admin());
-- NOTE: subscription inserts happen server-side only (service role bypasses RLS).

-- ============================================================
-- 3. PAYMENTS & TRANSACTIONS (server-side writes via service role)
-- ============================================================
create table if not exists public.payments (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text,
  amount numeric(12,2) not null,
  reference text unique not null,
  status text not null default 'success',
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_user on public.payments(user_id);

alter table public.payments enable row level security;

drop policy if exists "payments_select_own" on public.payments;
create policy "payments_select_own"
  on public.payments for select using (auth.uid() = user_id);

create table if not exists public.transactions (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  reference text unique not null,
  amount numeric(12,2) not null,
  status text not null default 'success',
  paid_at timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_transactions_user on public.transactions(user_id);

alter table public.transactions enable row level security;

drop policy if exists "transactions_select_own" on public.transactions;
create policy "transactions_select_own"
  on public.transactions for select using (auth.uid() = user_id);

-- ============================================================
-- 4. LEARNING DATA
-- ============================================================
create table if not exists public.learning_analytics (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  weak_topics jsonb default '[]'::jsonb,
  recommended_revision jsonb default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.learning_analytics add column if not exists weak_topics jsonb default '[]'::jsonb;
alter table public.learning_analytics add column if not exists recommended_revision jsonb default '[]'::jsonb;
alter table public.learning_analytics add column if not exists updated_at timestamptz not null default now();

alter table public.learning_analytics enable row level security;

drop policy if exists "analytics_select_own" on public.learning_analytics;
create policy "analytics_select_own"
  on public.learning_analytics for select using (auth.uid() = user_id);

create table if not exists public.user_flashcards (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  flashcard_id text not null,
  reps integer default 0,
  interval integer default 0,
  efactor numeric(4,2) default 2.5,
  next_review timestamptz default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_flashcards add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_user_flashcards_user on public.user_flashcards(user_id);
-- Required by the app's upsert(onConflict: user_id + flashcard_id):
create unique index if not exists uq_user_flashcards_card on public.user_flashcards(user_id, flashcard_id);

alter table public.user_flashcards enable row level security;

drop policy if exists "user_flashcards_all_own" on public.user_flashcards;
create policy "user_flashcards_all_own"
  on public.user_flashcards for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.exams (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  date timestamptz not null,
  time text default '',
  topics jsonb default '[]'::jsonb,
  readiness integer default 0,
  subject text default '',
  created_at timestamptz not null default now()
);

alter table public.exams add column if not exists time text default '';
alter table public.exams add column if not exists topics jsonb default '[]'::jsonb;
alter table public.exams add column if not exists readiness integer default 0;
alter table public.exams add column if not exists subject text default '';
alter table public.exams add column if not exists created_at timestamptz not null default now();

create index if not exists idx_exams_user on public.exams(user_id);

alter table public.exams enable row level security;

drop policy if exists "exams_all_own" on public.exams;
create policy "exams_all_own"
  on public.exams for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 5. TESTIMONIALS (public read; admin write)
-- ============================================================
create table if not exists public.testimonials (
  id bigint generated always as identity primary key,
  name text not null,
  quote text not null,
  level text default '',
  image_url text default '',
  category text default '',
  created_at timestamptz not null default now()
);

alter table public.testimonials enable row level security;

drop policy if exists "testimonials_public_read" on public.testimonials;
create policy "testimonials_public_read"
  on public.testimonials for select using (true);

drop policy if exists "testimonials_admin_write" on public.testimonials;
create policy "testimonials_admin_write"
  on public.testimonials for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- 6. COMMUNITY
-- ============================================================
create table if not exists public.community_posts (
  id bigint generated always as identity primary key,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  image_url text default '',
  is_deleted boolean not null default false,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.community_posts add column if not exists image_url text default '';
alter table public.community_posts add column if not exists is_deleted boolean not null default false;
alter table public.community_posts add column if not exists is_hidden boolean not null default false;
alter table public.community_posts add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_community_posts_created on public.community_posts(created_at desc);

create table if not exists public.community_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.community_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  content text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_community_comments_post on public.community_comments(post_id);

create table if not exists public.community_post_likes (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

create table if not exists public.community_post_shares (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.community_posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.community_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  post_id bigint not null references public.community_posts(id) on delete cascade,
  reason text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Author display info exposed safely (no emails) for feeds/comments.
-- Drop-and-recreate handles older definitions; community_profiles/community_feed
-- may exist as a VIEW or a TABLE depending on schema version.
-- (Plain "DROP VIEW IF EXISTS" still errors on a table of the same name,
--  so each drop is wrapped in an exception-safe block.)
do $$
begin
  drop view if exists public.community_feed;
exception when wrong_object_type or undefined_table then null;
end $$;
do $$
begin
  drop view if exists public.community_profiles;
exception when wrong_object_type or undefined_table then null;
end $$;
do $$
begin
  drop table if exists public.community_profiles cascade;
exception when wrong_object_type or undefined_table then null;
end $$;

create view public.community_profiles as
  select id, full_name as display_name, '' as avatar_url,
         case when level ~ '^\d' then regexp_replace(level, '[^0-9]', '', 'g') else null end as year
  from public.profiles;

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_post_likes enable row level security;
alter table public.community_post_shares enable row level security;
alter table public.community_reports enable row level security;

drop policy if exists "posts_public_read" on public.community_posts;
create policy "posts_public_read"
  on public.community_posts for select
  using (not is_deleted and not is_hidden);

drop policy if exists "posts_insert_own" on public.community_posts;
create policy "posts_insert_own"
  on public.community_posts for insert
  with check (auth.uid() = author_id and auth.uid() is not null);

drop policy if exists "posts_update_own" on public.community_posts;
create policy "posts_update_own"
  on public.community_posts for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "comments_public_read" on public.community_comments;
create policy "comments_public_read"
  on public.community_comments for select
  using (not is_deleted);

drop policy if exists "comments_insert_own" on public.community_comments;
create policy "comments_insert_own"
  on public.community_comments for insert
  with check (auth.uid() = author_id and auth.uid() is not null);

drop policy if exists "comments_update_own" on public.community_comments;
create policy "comments_update_own"
  on public.community_comments for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

drop policy if exists "likes_insert_own" on public.community_post_likes;
create policy "likes_insert_own"
  on public.community_post_likes for insert
  with check (auth.uid() = user_id and auth.uid() is not null);

drop policy if exists "likes_delete_own" on public.community_post_likes;
create policy "likes_delete_own"
  on public.community_post_likes for delete
  using (auth.uid() = user_id);

drop policy if exists "likes_public_read" on public.community_post_likes;
create policy "likes_public_read"
  on public.community_post_likes for select using (true);

drop policy if exists "shares_insert_authed" on public.community_post_shares;
create policy "shares_insert_authed"
  on public.community_post_shares for insert
  with check (auth.uid() = user_id and auth.uid() is not null);

drop policy if exists "reports_insert_authed" on public.community_reports;
create policy "reports_insert_authed"
  on public.community_reports for insert
  with check (auth.uid() = reporter_id and auth.uid() is not null);

-- Aggregated feed used by Community.jsx (public read).
create view public.community_feed as
  select
    p.id,
    p.author_id,
    p.content,
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
grant select on public.community_profiles to anon, authenticated;

-- Realtime for community tables (skip silently if already added).
do $$
begin
  alter publication supabase_realtime add table public.community_posts;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.community_comments;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.community_post_likes;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- 7. STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('receipts', 'receipts', false),
  ('uploads', 'uploads', true),
  ('branding', 'branding', true),
  ('disputes-proof', 'disputes-proof', false)
on conflict (id) do update set public = excluded.public;

drop policy if exists "avatars_public_read" on storage.objects;
create policy "avatars_public_read"
  on storage.objects for select using (bucket_id = 'avatars');

drop policy if exists "avatars_owner_write" on storage.objects;
create policy "avatars_owner_write"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "uploads_owner_all" on storage.objects;
create policy "uploads_owner_all"
  on storage.objects for all
  using (bucket_id in ('uploads', 'receipts', 'disputes-proof') and auth.uid()::text = (storage.foldername(name))[1])
  with check (bucket_id in ('uploads', 'receipts', 'disputes-proof') and auth.uid()::text = (storage.foldername(name))[1]);

-- Public read for uploads (community post images are publicly viewable).
drop policy if exists "uploads_public_read" on storage.objects;
create policy "uploads_public_read"
  on storage.objects for select using (bucket_id = 'uploads');

drop policy if exists "branding_public_read" on storage.objects;
create policy "branding_public_read"
  on storage.objects for select using (bucket_id = 'branding');

-- ============================================================
-- 8. UPDATED_AT TOUCH TRIGGER
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

-- ============================================================
-- DONE.
-- Next step: run `node scripts/create-admin.mjs` to seed the
-- super admin account (admin@apexscholars.com / changeme123).
-- ============================================================

-- ============================================================
-- MIGRATION: Payment integrity (Paystack idempotency + indexes)
-- Guarantees one subscription per payment reference so the
-- callback verifier and the webhook can never double-activate.
-- Safe to re-run.
-- ============================================================

-- One subscription per Paystack reference. Existing duplicates are
-- collapsed first (keep earliest) so the constraint can be applied.
delete from public.subscriptions a
using public.subscriptions b
where a.reference is not null
  and b.reference is not null
  and a.reference = b.reference
  and a.id > b.id;

alter table public.subscriptions
  drop constraint if exists subscriptions_reference_unique;
alter table public.subscriptions
  add constraint subscriptions_reference_unique unique (reference);

create index if not exists idx_subscriptions_reference on public.subscriptions(reference);
create index if not exists idx_payments_reference on public.payments(reference);
create index if not exists idx_transactions_reference on public.transactions(reference);
create index if not exists idx_community_comments_post_id on public.community_comments(post_id);

-- ============================================================
-- MIGRATION: Image posts
-- Expose community_posts.image_url through the aggregated feed
-- view so clients can render post attachments. Column order
-- changes require drop-and-recreate.
-- ============================================================

drop view if exists public.community_feed;

create view public.community_feed as
  select
    p.id,
    p.author_id,
    p.content,
    p.image_url,
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

-- ============================================================
-- MIGRATION: Public uploads bucket
-- Community post images are served via public URLs, so the
-- uploads bucket must allow public reads (writes stay owner-only).
-- ============================================================

update storage.buckets set public = true where id = 'uploads';

drop policy if exists "uploads_public_read" on storage.objects;
create policy "uploads_public_read"
  on storage.objects for select using (bucket_id = 'uploads');
