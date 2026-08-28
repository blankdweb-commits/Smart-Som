-- ============================================================
-- Apex Scholars Migration v4a — Weakness Challenge
-- Adds a per-question attempt log used to compute per-topic
-- accuracy, the "100 questions answered" milestone, and the
-- top-14 weak-concept list behind "Fix My Weak Areas".
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. QUESTION ATTEMPTS
--    One row per answered (or timed-out) quiz question so weak
--    topics are derived from real accuracy, not just wrongs.
-- ------------------------------------------------------------
create table if not exists public.question_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text default '',
  question text default '',
  topic text default 'General',
  subject text default 'General',
  correct boolean not null default false,
  timed_out boolean not null default false,
  mode text default 'standard',
  difficulty text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_question_attempts_user_topic on public.question_attempts(user_id, topic);
create index if not exists idx_question_attempts_user_created on public.question_attempts(user_id, created_at desc);

alter table public.question_attempts enable row level security;

drop policy if exists "question_attempts_all_own" on public.question_attempts;
create policy "question_attempts_all_own"
  on public.question_attempts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. WEAK CONCEPTS STORAGE
--    Complements weak_topics (wrong-answer counts) with the
--    full computed weak-concept list + the milestone counters.
-- ------------------------------------------------------------
alter table public.learning_analytics add column if not exists weak_concepts jsonb default '[]'::jsonb;
alter table public.learning_analytics add column if not exists total_attempts integer not null default 0;

-- ------------------------------------------------------------
-- 3. REALTIME (so the dashboard updates after a quiz)
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.question_attempts;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- DONE.
-- ============================================================