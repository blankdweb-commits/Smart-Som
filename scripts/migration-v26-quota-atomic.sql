-- ============================================================
-- Polynurse Exam Center Migration v26 — Atomic Quota Consumption
-- + Idempotent Request ID + Race-Safe Refund
--
-- Closes three P0 gaps in the per-course quota system:
--
--   GAP 1 (race condition): consume_course_quota did
--     SELECT ... ; then INSERT/UPDATE ...
--   so two CONCURRENT requests for the same user+course could BOTH observe
--   "not in cooldown" and BOTH be authorized. This migration adds a
--   pg_advisory_xact_lock on (user_id, course_key) so competing requests are
--   serialized: the second waits for the first to commit, then sees the
--   cooldown the first opened and is refused.
--
--   GAP 2 (replay / double-click / refresh): a replayed or double-fired
--   request could charge the round twice. This migration adds a
--   last_round_id column + an optional p_request_id param. The FIRST request
--   for a given id charges the round; an identical replayed id returns the
--   same outcome with replayed=true and does NOT re-charge.
--
--   GAP 3 (refund safety): batch-create's refundRound() deleted the whole
--   quota row by (user_id, course_key), so a failed start from request B
--   could delete a legitimately-charged round opened by a concurrent
--   request A. Refunds now target the exact round id (last_round_id), so a
--   refund can only ever unwind the reservation THAT request made.
--
-- Fully backward compatible: p_request_id defaults to NULL (legacy callers
-- without an id still work; they just lose replay protection).
-- Idempotent. Safe to re-run. Compatible with migr-v13..v25.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ADD ROUND-ID COLUMN (serves as request-idempotency key AND
--    refund targeting key)
-- ------------------------------------------------------------
alter table public.user_course_quota
  add column if not exists last_round_id uuid;

comment on column public.user_course_quota.last_round_id is
  'Server-issued round/request id that reserved this row. Replaying the same id returns the same outcome; refunds only unwind the matching round.';

-- ------------------------------------------------------------
-- 2. REWRITE consume_course_quota — atomic + idempotent
-- ------------------------------------------------------------
create or replace function public.consume_course_quota(
  p_user_id uuid,
  p_course_key text,
  p_count integer default 10,
  p_is_premium boolean default false,
  p_request_id uuid default null
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
  -- Serialize concurrent calls for the SAME user+course. Two simultaneous
  -- requests can no longer both read "not in cooldown" before either writes.
  -- The advisory lock is released automatically when the tx commits/rolls back.
  perform pg_advisory_xact_lock(
    hashtext(coalesce(p_user_id::text, '') || '|' || coalesce(p_course_key, ''))
  );

  select * into rec from public.user_course_quota
   where user_id = p_user_id and course_key = p_course_key;

  -- Idempotency: the SAME request id replayed must never re-charge. If the
  -- row's last_round_id matches, return the recorded outcome (replayed=true).
  if p_request_id is not null and rec is not null and rec.last_round_id = p_request_id then
    return jsonb_build_object(
      'allowed', true,
      'premium', (rec.window_expires_at is null),
      'questions_remaining', 0,
      'round_completed', true,
      'rounds_completed', rec.rounds_completed,
      'window_expires_at', rec.window_expires_at,
      'cooldown_started_at', rec.cooldown_started_at,
      'cooldown_remaining_seconds',
        case when rec.window_expires_at is null then 0
             else greatest(0, floor(extract(epoch from (rec.window_expires_at - now()))))
        end,
      'is_ready', (rec.window_expires_at is null) or (now() >= rec.window_expires_at),
      'replayed', true
    );
  end if;

  -- Server-side clamp: this is the ONLY place counts are trusted.
  if p_is_premium then
    clamped := greatest(10, least(30, coalesce(p_count, 10)));
  else
    clamped := 10; -- FREE: exactly one 10-question round.
  end if;

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
    insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at, cooldown_started_at, last_round_id)
    values (p_user_id, p_course_key, clamped, new_rounds, now(), null, null, p_request_id)
    on conflict (user_id, course_key) do update set
      questions_used = public.user_course_quota.questions_used + clamped,
      rounds_completed = public.user_course_quota.rounds_completed + 1,
      last_round_completed_at = now(),
      window_expires_at = null,
      cooldown_started_at = null,
      last_round_id = coalesce(p_request_id, public.user_course_quota.last_round_id),
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
      'is_ready', true,
      'replayed', false
    );
  end if;

  -- FREE: reserve the 10-question round + start the 30-MIN cooldown.
  -- Cooldown begins at launch (reservation = the charge). cooldown_started_at
  -- records the exact backend moment a new cooldown window was opened.
  cooldown_started := now();

  insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at, cooldown_started_at, last_round_id)
  values (p_user_id, p_course_key, clamped, new_rounds, cooldown_started, cooldown_started + interval '30 minutes', cooldown_started, p_request_id)
  on conflict (user_id, course_key) do update set
    questions_used = clamped,
    rounds_completed = public.user_course_quota.rounds_completed + 1,
    last_round_completed_at = cooldown_started,
    window_expires_at = cooldown_started + interval '30 minutes',
    cooldown_started_at = cooldown_started,
    last_round_id = coalesce(p_request_id, public.user_course_quota.last_round_id),
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
    'is_ready', false,
    'replayed', false
  );
end;
$$;

-- ------------------------------------------------------------
-- 3. GRANTS — keep authenticated callable with the NEW signature.
-- ------------------------------------------------------------
grant execute on function public.consume_course_quota(uuid, text, integer, boolean, uuid) to authenticated;
grant execute on function public.consume_course_quota(uuid, text, integer, boolean) to authenticated;

-- ------------------------------------------------------------
-- DONE.
-- ------------------------------------------------------------