-- ============================================================
-- Apex Scholars Migration v3 — Progression System & Content Sync
-- Idempotent. Adds difficulty-progression tables, custom flashcards,
-- quiz history, and extends existing learning tables.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES: add streak bookkeeping column
-- ------------------------------------------------------------
alter table public.profiles add column if not exists last_active_date timestamptz;

-- ------------------------------------------------------------
-- 2. USER FLASHCARDS: extend SRS table with session/mastering data
--    (single source of truth for card progress; avoids a duplicate table)
-- ------------------------------------------------------------
alter table public.user_flashcards add column if not exists status text not null default 'new'
  check (status in ('new', 'learning', 'review', 'mastered'));
alter table public.user_flashcards add column if not exists review_count integer not null default 0;
alter table public.user_flashcards add column if not exists mastered boolean not null default false;
alter table public.user_flashcards add column if not exists last_reviewed_at timestamptz;
alter table public.user_flashcards add column if not exists times_seen integer not null default 0;
alter table public.user_flashcards add column if not exists times_correct integer not null default 0;

-- ------------------------------------------------------------
-- 3. CUSTOM FLASHCARDS
--    user_id IS NULL  -> GLOBAL card (admin-created, visible to everyone)
--    user_id IS SET   -> personal card owned by that student
-- ------------------------------------------------------------
create table if not exists public.custom_flashcards (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  question text not null,
  answer text not null,
  options jsonb default null,
  correct_answer text,
  subject text not null default 'General',
  topic text default '',
  unit text default '',
  difficulty text not null default 'Easy' check (difficulty in ('Easy','Medium','Moderate','Hard','Expert','Master','Extreme')),
  level text default 'Year 1',
  semester text default 'Semester 1',
  category text default 'Custom',
  source text default '',
  hint text default '',
  rationale text default '',
  important boolean not null default false,
  is_pending boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_custom_cards_global on public.custom_flashcards(user_id);
create index if not exists idx_custom_cards_subject on public.custom_flashcards(subject);

alter table public.custom_flashcards enable row level security;

drop policy if exists "custom_cards_read" on public.custom_flashcards;
-- Global cards readable by all; personal cards readable by owner; admins read everything.
create policy "custom_cards_read"
  on public.custom_flashcards for select
  using (
    user_id is null
    or user_id = auth.uid()
    or public.is_admin()
  );

drop policy if exists "custom_cards_insert_own" on public.custom_flashcards;
-- Authenticated users insert personal cards; admins may insert global cards.
create policy "custom_cards_insert_own"
  on public.custom_flashcards for insert
  with check (
    auth.uid() is not null
    and (user_id = auth.uid() or public.is_admin())
  );

drop policy if exists "custom_cards_update" on public.custom_flashcards;
create policy "custom_cards_update"
  on public.custom_flashcards for update
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "custom_cards_delete" on public.custom_flashcards;
create policy "custom_cards_delete"
  on public.custom_flashcards for delete
  using (user_id = auth.uid() or public.is_admin());

-- ------------------------------------------------------------
-- 4. QUIZ RESULTS (attempt history)
-- ------------------------------------------------------------
create table if not exists public.quiz_results (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'standard',
  difficulty text not null default 'Easy',
  subject text default '',
  score integer not null default 0,
  total integer not null default 0,
  passed boolean not null default false,
  duration_seconds integer default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_quiz_results_user on public.quiz_results(user_id, created_at desc);

alter table public.quiz_results enable row level security;

drop policy if exists "quiz_results_all_own" on public.quiz_results;
create policy "quiz_results_all_own"
  on public.quiz_results for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "quiz_results_leaderboard_read" on public.quiz_results;
create policy "quiz_results_leaderboard_read"
  on public.quiz_results for select using (true);

-- ------------------------------------------------------------
-- 5. QUIZ LEVEL PROGRESSION
--    level_key identifies a completable unit of work, e.g.
--    'Anatomy & Physiology|hard' or 'level:<uuid>' for authored levels.
--    A completion only counts when passed = true.
-- ------------------------------------------------------------
create table if not exists public.user_quiz_progress (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  level_key text not null,
  difficulty text not null default 'Easy',
  score integer not null default 0,
  total integer not null default 0,
  passed boolean not null default false,
  attempts integer not null default 1,
  best_score integer not null default 0,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, level_key)
);

create index if not exists idx_quiz_progress_user on public.user_quiz_progress(user_id);

alter table public.user_quiz_progress enable row level security;

drop policy if exists "quiz_progress_all_own" on public.user_quiz_progress;
create policy "quiz_progress_all_own"
  on public.user_quiz_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 6. AUTHORED CONTENT TABLES (for future curated levels; app currently
--    generates sessions from the bundled question bank)
-- ------------------------------------------------------------
create table if not exists public.quiz_levels (
  id uuid primary key default gen_random_uuid(),
  course_id text,
  unit_id text,
  topic_id text,
  difficulty text not null default 'Easy' check (difficulty in ('Easy','Medium','Moderate','Hard','Expert','Master','Extreme')),
  level_number integer not null default 1,
  title text not null,
  passing_score integer not null default 70,
  question_count integer not null default 10,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.quiz_levels enable row level security;

drop policy if exists "quiz_levels_public_read" on public.quiz_levels;
create policy "quiz_levels_public_read"
  on public.quiz_levels for select using (is_active);

drop policy if exists "quiz_levels_admin_write" on public.quiz_levels;
create policy "quiz_levels_admin_write"
  on public.quiz_levels for all
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  level_id uuid not null references public.quiz_levels(id) on delete cascade,
  question text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  rationale text default '',
  explanation text default ''
);

create index if not exists idx_quiz_questions_level on public.quiz_questions(level_id);

alter table public.quiz_questions enable row level security;

drop policy if exists "quiz_questions_public_read" on public.quiz_questions;
create policy "quiz_questions_public_read"
  on public.quiz_questions for select using (true);

drop policy if exists "quiz_questions_admin_write" on public.quiz_questions;
create policy "quiz_questions_admin_write"
  on public.quiz_questions for all
  using (public.is_admin())
  with check (public.is_admin());
