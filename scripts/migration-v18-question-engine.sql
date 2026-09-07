-- ============================================================
-- Polynurse Exam Center Migration v18 — Controlled-Random Question Engine
--
-- Creates the server-authoritative question selection system:
--   1. questions          — normalized question bank (replaces client-side JSON)
--   2. quiz_batches       — reserved quiz batches (transactional)
--   3. quiz_batch_questions — per-question tracking within a batch
--   4. user_question_history — batch-aware exposure/answer history
--
-- Also extends question_attempts with batch_id for linkage.
-- Idempotent. Safe to re-run.
-- ============================================================

-- ============================================================
-- 1. QUESTIONS TABLE — Normalized question bank
--    All JSON banks (NMCN, NCLEX, USELU, Nursing200, Midwifery) migrate here.
-- ============================================================
create table if not exists public.questions (
  id text primary key,                      -- e.g. "pharm-1", "nclex-3", "n200-42"
  course_id text not null,                   -- e.g. "nmcn", "nclex", "nursing200", "midwifery", "uselu"
  subject_id text,                           -- e.g. "Pharmacology", "Medical Surgical"
  topic_id text,                             -- e.g. "Cardiovascular", "Fluid Balance"
  subtopic_id text,                          -- finer-grained grouping
  concept_id text,                           -- concept cluster for diversity
  difficulty text not null default 'Medium', -- Easy, Medium, Hard, Expert
  question_type text default 'mcq',          -- mcq, ngn, flashcard
  exam_framework text,                       -- NCLEX, NMCN, or null for non-exam questions
  question_text text not null,
  options jsonb not null default '[]'::jsonb, -- array of option strings
  correct_answer text not null,              -- the correct option text or letter
  explanation text,                          -- rationale
  hint text,
  source text,                               -- provenance: "Richard's Bank", "Fluid-Electrolytes", etc.
  metadata jsonb default '{}'::jsonb,        -- extensible metadata
  is_active boolean default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_questions_course_diff on public.questions(course_id, difficulty);
create index if not exists idx_questions_framework on public.questions(exam_framework) where exam_framework is not null;
create index if not exists idx_questions_subject_topic on public.questions(subject_id, topic_id);
create index if not exists idx_questions_concept on public.questions(concept_id) where concept_id is not null;
create index if not exists idx_questions_active on public.questions(is_active) where is_active = true;

-- ============================================================
-- 2. QUIZ BATCHES — Reserved quiz batches (transactional)
--    Created atomically with question selection to prevent
--    two concurrent requests from getting duplicate questions.
-- ============================================================
create table if not exists public.quiz_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null,                        -- practice, dailyQuiz, topicQuiz, examSimulation, nclex, nmcn, oneVsOne
  exam_framework text,                       -- NCLEX or NMCN (validated server-side)
  course_key text not null,                  -- matches the course_key from quota system
  difficulty_distribution jsonb not null,    -- e.g. {"Easy":5,"Medium":5,"Hard":5,"Expert":5}
  question_ids text[] not null,              -- ordered list of question IDs in this batch
  total_questions integer not null,
  status text not null default 'reserved',   -- reserved, started, completed, abandoned
  expires_at timestamptz not null,           -- batch expires after this time (default 10 min)
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  metadata jsonb default '{}'::jsonb         -- selection debug info, relaxation level, etc.
);

create index if not exists idx_quiz_batches_user_status on public.quiz_batches(user_id, status);
create index if not exists idx_quiz_batches_expires on public.quiz_batches(expires_at) where status in ('reserved', 'started');

alter table public.quiz_batches enable row level security;

drop policy if exists "quiz_batches_own" on public.quiz_batches;
create policy "quiz_batches_own"
  on public.quiz_batches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 3. QUIZ BATCH QUESTIONS — Per-question tracking within a batch
--    Tracks sequence order, time limits, answers.
-- ============================================================
create table if not exists public.quiz_batch_questions (
  batch_id uuid not null references public.quiz_batches(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  sequence int not null,                     -- position in the batch (1-indexed)
  time_limit_seconds int,                    -- per-question time limit (null = no limit)
  answered boolean default false,
  selected_answer text,
  correct boolean,
  answered_at timestamptz,
  elapsed_ms int,                            -- time spent answering (milliseconds)
  primary key (batch_id, question_id)
);

create index if not exists idx_batch_questions_batch on public.quiz_batch_questions(batch_id);

alter table public.quiz_batch_questions enable row level security;

drop policy if exists "batch_questions_own" on public.quiz_batch_questions;
create policy "batch_questions_own"
  on public.quiz_batch_questions for all
  using (
    exists (
      select 1 from public.quiz_batches
      where quiz_batches.id = quiz_batch_questions.batch_id
        and quiz_batches.user_id = auth.uid()
    )
  );

-- ============================================================
-- 4. USER QUESTION HISTORY — Batch-aware exposure/answer tracking
--    Replaces the v10 user_question_history with batch-level tracking.
--    Records both exposure (when batch is reserved) and answers.
-- ============================================================
-- Drop old v10 table if it exists (it was barely used — progress API read it
-- but selection engine read from question_attempts instead)
drop table if exists public.user_question_history;

create table if not exists public.user_question_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  batch_id uuid,                             -- which batch exposed this question
  times_seen int not null default 1,
  last_seen_at timestamptz not null default now(),
  last_batch_id uuid,
  last_answered_at timestamptz,
  correct_count int not null default 0,
  incorrect_count int not null default 0,
  last_selected_answer text,
  last_mode text,
  last_difficulty text,
  last_exam_framework text,
  created_at timestamptz not null default now(),
  constraint user_question_history_unique unique (user_id, question_id)
);

create index if not exists idx_uqh_user on public.user_question_history(user_id);
create index if not exists idx_uqh_user_batch on public.user_question_history(user_id, batch_id);

alter table public.user_question_history enable row level security;

drop policy if exists "uqh_own" on public.user_question_history;
create policy "uqh_own"
  on public.user_question_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 5. EXTEND question_attempts WITH batch_id
--    Backward-compatible: batch_id is nullable so old rows still work.
-- ============================================================
alter table public.question_attempts
  add column if not exists batch_id uuid;

-- ============================================================
-- 6. BATCH EXPIRY CLEANUP FUNCTION
--    Mark expired batches as abandoned. Called by cron or on batch-create.
-- ============================================================
create or replace function public.cleanup_expired_batches()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  cleaned int;
begin
  update public.quiz_batches
  set status = 'abandoned', completed_at = now()
  where status in ('reserved', 'started')
    and expires_at < now();

  get diagnostics cleaned = row_count;
  return cleaned;
end;
$$;

-- ============================================================
-- 7. GRANTS
-- ============================================================
grant execute on function public.cleanup_expired_batches() to authenticated;

-- ============================================================
-- 8. DISABLE RLS ON questions TABLE
--    Questions are read by the server-side service (service-role client).
--    Clients never query questions directly.
-- ============================================================
alter table public.questions disable row level security;

-- ============================================================
-- DONE.
-- ============================================================
