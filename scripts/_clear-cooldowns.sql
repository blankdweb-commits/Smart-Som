-- Clear ALL cooldown rows so dev/test quiz starts are not blocked by rounds
-- burned in earlier failed experiments (premium users are unaffected; other
-- free users simply get a fresh cooldown window on their next round).
delete from public.user_course_quota
 where window_expires_at is not null and now() < window_expires_at;