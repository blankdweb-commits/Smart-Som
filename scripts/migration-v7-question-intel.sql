-- ============================================================
-- Apex Scholars Migration v7 — Question Intelligence System
-- Adds the two tables that back the Question Intelligence System:
--   1. question_feedback   — 👍/👎 review feedback per question, keyed
--      on (user_id, question_id) so a learner's latest rating wins.
--   2. generated_questions — stored output of the Gemini fallback
--      generator (only used when the hardcoded banks are exhausted).
-- Idempotent. Safe to re-run. Requires migr-v4a and migr-v5 first.
-- ============================================================

-- ------------------------------------------------------------
-- 1. QUESTION FEEDBACK
--    One row per user+question. rating = true (👍 good) / false
--    (👎 report). reason optional (e.g. incorrect/unclear).
-- ------------------------------------------------------------
create table if not exists public.question_feedback (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  rating boolean not null default true,
  reason text default '',
  created_at timestamptz not null default now(),
  constraint question_feedback_user_question_key unique (user_id, question_id)
);

create index if not exists idx_question_feedback_question on public.question_feedback(question_id);
create index if not exists idx_question_feedback_rating on public.question_feedback(rating);

alter table public.question_feedback enable row level security;

drop policy if exists "question_feedback_all_own" on public.question_feedback;
create policy "question_feedback_all_own"
  on public.question_feedback for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. GENERATED QUESTIONS (Gemini fallback output)
--    Only written server-side (service role) when every hardcoded
--    bank question for a niche has been answered. Readable by any
--    authenticated learner so it joins the shared pool.
-- ------------------------------------------------------------
create table if not exists public.generated_questions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text default 'General',
  niche text,
  difficulty text default '',
  question_text text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  explanation text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_generated_questions_subject on public.generated_questions(subject);
create index if not exists idx_generated_questions_niche on public.generated_questions(niche);

alter table public.generated_questions enable row level security;

drop policy if exists "generated_questions_select" on public.generated_questions;
create policy "generated_questions_select"
  on public.generated_questions for select
  using (auth.uid() is not null);

drop policy if exists "generated_questions_modify" on public.generated_questions;
create policy "generated_questions_modify"
  on public.generated_questions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- DONE.
-- ============================================================
