-- ============================================================
-- Polynurse Exam Center Migration v20 — Per-Course Difficulty Progression
--
-- 1. Renames the difficulty tier 'Medium' -> 'Moderate' everywhere
--    (question bank + difficulty_progress + RPCs + code use 'Moderate').
--    Threshold chain: Easy -> Moderate -> Hard -> Expert.
-- 2. Extends difficulty_progress with a course_key column so unlock
--    progression is tracked INDEPENDENTLY per course (and per subject /
--    framework variant), not globally.
--    PK becomes (user_id, course_key, difficulty).
-- 3. Backfills existing rows with course_key = 'global' (legacy aggregate).
-- 4. Rewrites record_difficulty_correct / get_difficulty_status RPCs to
--    accept p_course_key (default 'global' / NULL = aggregate).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ============================================================
-- 1. RENAME 'Medium' -> 'Moderate' IN THE QUESTION BANK
--    The server-side selection engine filters on questions.difficulty and
--    validates against C.VALID_DIFFICULTIES. Keeping the two in sync is
--    mandatory or locking breaks.
-- ============================================================
update public.questions
   set difficulty = 'Moderate'
 where difficulty = 'Medium';

-- ============================================================
-- 2. RENAME 'Medium' -> 'Moderate' IN difficulty_progress
-- ============================================================
update public.difficulty_progress
   set difficulty = 'Moderate'
 where difficulty = 'Medium';

-- ============================================================
-- 3. ADD course_key TO difficulty_progress (default 'global' backfill)
-- ============================================================
alter table public.difficulty_progress
  add column if not exists course_key text not null default 'global';

-- ============================================================
-- 4. REPLACE OLD UNIQUE (user_id, difficulty) WITH
--    (user_id, course_key, difficulty)
--    The `if exists` + add pair is safe on re-run.
-- ============================================================
alter table public.difficulty_progress
  drop constraint if exists difficulty_progress_unique;

alter table public.difficulty_progress
  add constraint difficulty_progress_unique
    unique (user_id, course_key, difficulty);

create index if not exists idx_difficulty_progress_user_course
  on public.difficulty_progress(user_id, course_key);

-- ============================================================
-- 5. REWRITE record_difficulty_correct — course-aware, correct-only
-- ============================================================
create or replace function public.record_difficulty_correct(
  p_user_id uuid,
  p_difficulty text,
  p_course_key text default 'global'
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.difficulty_progress (user_id, course_key, difficulty, correct_count, unlocked_at, updated_at)
  values (p_user_id, p_course_key, p_difficulty, 1, null, now())
  on conflict (user_id, course_key, difficulty) do update set
    correct_count = public.difficulty_progress.correct_count + 1,
    updated_at = now();
end;
$$;

-- ============================================================
-- 6. REWRITE get_difficulty_status — course-aware
--    p_course_key = NULL  -> aggregate correct counts across ALL courses
--                            (for the dashboard).
--    p_course_key = 'x'   -> per-course counts (for course-level locking).
-- ============================================================
create or replace function public.get_difficulty_status(
  p_user_id uuid,
  p_course_key text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  if p_course_key is null then
    select jsonb_object_agg(difficulty, correct_count)
      into result
      from public.difficulty_progress
     where user_id = p_user_id
       and difficulty in ('Easy','Moderate','Hard','Expert');
  else
    select jsonb_object_agg(difficulty, correct_count)
      into result
      from public.difficulty_progress
     where user_id = p_user_id
       and course_key = p_course_key
       and difficulty in ('Easy','Moderate','Hard','Expert');
  end if;
  return coalesce(result, '{}'::jsonb);
end;
$$;

-- ============================================================
-- 7. GRANTS (no-ops if already granted)
-- ============================================================
grant execute on function public.record_difficulty_correct(uuid, text, text) to authenticated;
grant execute on function public.get_difficulty_status(uuid, text) to authenticated;

-- ============================================================
-- DONE.
-- ============================================================
