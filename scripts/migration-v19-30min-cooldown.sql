-- ============================================================
-- Polynurse Exam Center Migration v19 — Update Cooldown to 30 Minutes
--
-- Changes the free-user cooldown from 1 hour to 30 minutes
-- in the consume_course_quota RPC.
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

  -- FREE: reserve the 10-question round + start the 30-MIN cooldown.
  insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at)
  values (p_user_id, p_course_key, clamped, new_rounds, now(), now() + interval '30 minutes')
  on conflict (user_id, course_key) do update set
    questions_used = clamped,
    rounds_completed = public.user_course_quota.rounds_completed + 1,
    last_round_completed_at = now(),
    window_expires_at = now() + interval '30 minutes',
    updated_at = now();

  return jsonb_build_object(
    'allowed', true,
    'premium', false,
    'questions_remaining', 0,
    'round_completed', true,
    'rounds_completed', new_rounds,
    'window_expires_at', (now() + interval '30 minutes'),
    'cooldown_remaining_seconds', 1800,
    'is_ready', false
  );
end;
$$;
