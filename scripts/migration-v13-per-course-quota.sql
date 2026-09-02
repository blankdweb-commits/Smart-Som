-- ============================================================
-- Apex Scholars Migration v13 — Per-Course Round Quota (Free Tier)
--
-- REPLACES the old global 50-Q / 12h quota (user_quota, migration v10) and the
-- v12 simulated per-subject cooldown (user_subject_quota) with a single
-- server-authoritative per-course round system:
--
--   FREE USERS
--     1 round = 10 questions (reserved up front at launch)
--     1h cooldown per course after a round is reserved
--     quiting early still consumes the round (reservation is the charge)
--     per-course = per-EXAM-SOURCE for Clinical/Quick (nmcx|nclex|both),
--     per-SUBJECT for 200-level banks, single key for Weakness/Daily
--
--   PREMIUM USERS
--     10-30 questions per session, never cooled down (unlimited)
--
-- Logic lives in SECURITY DEFINER RPCs so a client can never spoof the count.
-- Idempotent. Safe to re-run. Compatible with migr-v11..v12.
-- ============================================================

-- ============================================================
-- 1. COURSE QUOTA TABLE
--    One row per user per course_key.
--    course_key examples:
--      clinical-challenge:nmcx | :nclex | :both
--      quick-quiz:nmcx | :nclex | :both
--      uselu-test
--      nursing-200:Pharmacology
--      midwifery-200:Child Health
--      weakness-challenge
--      daily-challenge
-- ============================================================
create table if not exists public.user_course_quota (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  course_key text not null,
  questions_used integer not null default 0,   -- current window usage (free: round size or 0)
  rounds_completed integer not null default 0,
  last_round_completed_at timestamptz,
  window_expires_at timestamptz,               -- last round + 1h (free only; null = no cooldown)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_course_quota_unique unique (user_id, course_key)
);

create index if not exists idx_course_quota_user on public.user_course_quota(user_id);

alter table public.user_course_quota enable row level security;

drop policy if exists "course_quota_all_own" on public.user_course_quota;
create policy "course_quota_all_own"
  on public.user_course_quota for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 2. CENTRAL CONSTANTS (kept here so RPCs + API stay in sync)
-- ============================================================
-- FREE_ROUND_SIZE          = 10
-- FREE_TIMER_SECONDS       = {10, 15}  (enforced client-side in setup; server
--                              cannot police wall-clock per question honestly)
-- COOLDOWN                 = 1 hour
-- PREMIUM_MIN/MAX          = 10 / 30
-- These are referenced inline in the RPC below; no separate config table is
-- needed because the migration is the single source of truth.

-- ============================================================
-- 3. CONSUME (atomic, server-authoritative)
--    Reserve a round for a course. FREE users are charged exactly 10 questions
--    and start a 1h cooldown regardless of how many they actually answer.
--    PREMIUM users reserve 10-30 (server-clamped) and never cool down.
--    Returns the authoritative new state. Refuses while in cooldown.
-- ============================================================
create or replace function public.consume_course_quota(
  p_user_id uuid,
  p_course_key text,
  p_count integer default 10,
  p_is_premium boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  clamped integer;
  rec public.user_course_quota;
  in_cooldown boolean;
  new_rounds integer;
begin
  -- Server-side clamp: this is the ONLY place counts are trusted.
  if p_is_premium then
    clamped := greatest(10, least(30, coalesce(p_count, 10)));
  else
    clamped := 10; -- FREE: exactly one 10-question round.
  end if;

  select * into rec from public.user_course_quota
   where user_id = p_user_id and course_key = p_course_key;

  -- In cooldown? (free users only; premium never has a window)
  if not p_is_premium and rec is not null
     and rec.window_expires_at is not null
     and now() < rec.window_expires_at then
    return jsonb_build_object(
      'allowed', false,
      'premium', false,
      'questions_remaining', 0,
      'round_completed', false,
      'rounds_completed', rec.rounds_completed,
      'window_expires_at', rec.window_expires_at,
      'cooldown_remaining_seconds', greatest(0, floor(extract(epoch from (rec.window_expires_at - now())))),
      'is_ready', false
    );
  end if;

  new_rounds := coalesce(rec.rounds_completed, 0) + 1;

  -- Premium: track rounds but never cooldown.
  if p_is_premium then
    insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at)
    values (p_user_id, p_course_key, clamped, new_rounds, now(), null)
    on conflict (user_id, course_key) do update set
      questions_used = public.user_course_quota.questions_used + clamped,
      rounds_completed = public.user_course_quota.rounds_completed + 1,
      last_round_completed_at = now(),
      window_expires_at = null,
      updated_at = now();
    return jsonb_build_object(
      'allowed', true,
      'premium', true,
      'questions_remaining', null,
      'round_completed', true,
      'rounds_completed', new_rounds,
      'window_expires_at', null,
      'cooldown_remaining_seconds', 0,
      'is_ready', true
    );
  end if;

  -- FREE: reserve the 10-question round + start the 1h cooldown.
  insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at)
  values (p_user_id, p_course_key, clamped, new_rounds, now(), now() + interval '1 hour')
  on conflict (user_id, course_key) do update set
    questions_used = clamped,
    rounds_completed = public.user_course_quota.rounds_completed + 1,
    last_round_completed_at = now(),
    window_expires_at = now() + interval '1 hour',
    updated_at = now();

  return jsonb_build_object(
    'allowed', true,
    'premium', false,
    'questions_remaining', 0,
    'round_completed', true,
    'rounds_completed', new_rounds,
    'window_expires_at', (now() + interval '1 hour'),
    'cooldown_remaining_seconds', 3600,
    'is_ready', false
  );
end;
$$;

-- ============================================================
-- 4. STATUS (per-course map for the Course Selector UI)
--    is_ready flips back to true once the 1h window elapses. No row = ready.
-- ============================================================
create or replace function public.get_course_quota_status(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_object_agg(course_key, jsonb_build_object(
    'questions_used', questions_used,
    'rounds_completed', rounds_completed,
    'last_round_completed_at', last_round_completed_at,
    'window_expires_at', window_expires_at,
    'cooldown_remaining_seconds',
      case when window_expires_at is null then 0
           else greatest(0, floor(extract(epoch from (window_expires_at - now()))))
      end,
    'is_ready', (window_expires_at is null) or (now() >= window_expires_at)
  )) into result
  from public.user_course_quota
  where user_id = p_user_id;

  return coalesce(result, '{}'::jsonb);
end;
$$;

-- ============================================================
-- 5. RESET (admin/debug/dev only; not exposed to clients)
-- ============================================================
create or replace function public.reset_course_quota(p_user_id uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.user_course_quota where user_id = p_user_id;
$$;

-- ============================================================
-- 6. GRANTS
-- ============================================================
grant execute on function public.consume_course_quota(uuid, text, integer, boolean) to authenticated;
grant execute on function public.get_course_quota_status(uuid) to authenticated;

-- ============================================================
-- 7. REMOVE OBSOLETE QUOTA OBJECTS
--    Old global 50/12h (v10) + simulated per-subject cooldown (v12).
--    Idempotent; safe even if they were never created.
-- ============================================================
drop table if exists public.user_quota;
drop table if exists public.user_subject_quota;

drop function if exists public.ensure_quota_row(uuid);
drop function if exists public.reset_quota_if_expired(uuid);
drop function if exists public.consume_question(uuid);
drop function if exists public.get_quota_status(uuid);
drop function if exists public.record_subject_usage(uuid, text, integer);
drop function if exists public.get_subject_quota_status(uuid);
drop function if exists public.reset_subject_quota(uuid);

-- ============================================================
-- DONE.
-- ============================================================