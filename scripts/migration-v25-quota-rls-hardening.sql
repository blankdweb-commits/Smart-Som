-- ============================================================
-- Polynurse Exam Center Migration v25 — Quota RLS Hardening + Cooldown Audit
--
-- Closes a security gap in the per-course free-user quota:
--
--   BEFORE (v13/v19): user_course_quota had an RLS policy "course_quota_all_own"
--   that granted authenticated users `ALL` (select/insert/update/delete) on
--   their OWN quota row. Because Supabase REST lets an authenticated client
--   write directly to a table when a policy allows it, a malicious user could
--   POST to /rest/v1/user_course_quota and set window_expires_at to the past
--   (or zero out questions_used), bypassing the 30-minute cooldown and the
--   quota entirely. The SECURITY DEFINER RPCs (consume_course_quota /
--   get_course_quota_status) were the intended path but were NOT the only path.
--
--   AFTER (this migration): authenticated users may READ their own quota rows
--   only. All WRITES (insert/update/delete) are restricted to the service role,
--   which only the SECURITY DEFINER RPCs (and server API via service key) use.
--   The RPCs are re-granted to authenticated so the normal flow still works.
--
--   ALSO: records when a cooldown began (cooldown_started_at) so the backend
--   can distinguish "never used" from "currently cooling down" and so server
--   time, not browser time, is the single authority for cooldown accounting.
--
-- Idempotent. Safe to re-run. Compatible with migr-v13..v24.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ADD COOLDOWN-START AUDIT COLUMN
-- ------------------------------------------------------------
alter table public.user_course_quota
  add column if not exists cooldown_started_at timestamptz;

comment on column public.user_course_quota.cooldown_started_at is
  'Server-side timestamp when the free-user 30-min cooldown began. NULL = never cooled down. Mirrors the reservation charge (cooldown starts at round launch).';

-- ------------------------------------------------------------
-- 2. TIGHTEN RLS — READ YOUR OWN ONLY.
--    Drop the dangerous `for all` policy; replace with a read-only
--    select-own policy. Writes now require the service role (SECURITY
--    DEFINER RPCs / server API), which bypasses RLS.
-- ------------------------------------------------------------
drop policy if exists "course_quota_all_own" on public.user_course_quota;

drop policy if exists "course_quota_select_own" on public.user_course_quota;
create policy "course_quota_select_own"
  on public.user_course_quota for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. RE-CREATE THE QUOTA RPCs SO THEY WRITE cooldown_started_at.
--    SECURITY DEFINER => run as table owner => bypasses RLS on writes.
-- ------------------------------------------------------------

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
  new_rounds integer;
  cooldown_started timestamptz;
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
      'cooldown_started_at', rec.cooldown_started_at,
      'cooldown_remaining_seconds', greatest(0, floor(extract(epoch from (rec.window_expires_at - now())))),
      'is_ready', false
    );
  end if;

  new_rounds := coalesce(rec.rounds_completed, 0) + 1;

  -- Premium: track rounds but never cooldown.
  if p_is_premium then
    insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at, cooldown_started_at)
    values (p_user_id, p_course_key, clamped, new_rounds, now(), null, null)
    on conflict (user_id, course_key) do update set
      questions_used = public.user_course_quota.questions_used + clamped,
      rounds_completed = public.user_course_quota.rounds_completed + 1,
      last_round_completed_at = now(),
      window_expires_at = null,
      cooldown_started_at = null,
      updated_at = now();
    return jsonb_build_object(
      'allowed', true,
      'premium', true,
      'questions_remaining', null,
      'round_completed', true,
      'rounds_completed', new_rounds,
      'window_expires_at', null,
      'cooldown_started_at', null,
      'cooldown_remaining_seconds', 0,
      'is_ready', true
    );
  end if;

  -- FREE: reserve the 10-question round + start the 30-MIN cooldown.
  -- Cooldown begins at launch (reservation = the charge). cooldown_started_at
  -- records the exact backend moment a new cooldown window was opened.
  cooldown_started := now();

  insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at, cooldown_started_at)
  values (p_user_id, p_course_key, clamped, new_rounds, cooldown_started, cooldown_started + interval '30 minutes', cooldown_started)
  on conflict (user_id, course_key) do update set
    questions_used = clamped,
    rounds_completed = public.user_course_quota.rounds_completed + 1,
    last_round_completed_at = cooldown_started,
    window_expires_at = cooldown_started + interval '30 minutes',
    cooldown_started_at = cooldown_started,
    updated_at = now();

  return jsonb_build_object(
    'allowed', true,
    'premium', false,
    'questions_remaining', 0,
    'round_completed', true,
    'rounds_completed', new_rounds,
    'window_expires_at', (cooldown_started + interval '30 minutes'),
    'cooldown_started_at', cooldown_started,
    'cooldown_remaining_seconds', 1800,
    'is_ready', false
  );
end;
$$;

-- ------------------------------------------------------------
-- 4. STATUS RPC — include cooldown_started_at in the map.
-- ------------------------------------------------------------
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
    'cooldown_started_at', cooldown_started_at,
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

-- ------------------------------------------------------------
-- 5. GRANTS — ensure authenticated can still call the RPCs.
-- ------------------------------------------------------------
grant execute on function public.consume_course_quota(uuid, text, integer, boolean) to authenticated;
grant execute on function public.get_course_quota_status(uuid) to authenticated;

-- ------------------------------------------------------------
-- DONE.
-- ------------------------------------------------------------
