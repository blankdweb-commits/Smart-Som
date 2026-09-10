-- ============================================================
-- Polynurse Exam Center Migration v28 — Quota/Difficulty RPCs: SERVICE-ROLE ONLY
--
-- PROBLEM (security audit, Phase 8):
--   consume_course_quota(get_course_quota_status/record_difficulty_correct/
--   get_difficulty_status) are SECURITY DEFINER and currently granted EXECUTE to
--   `authenticated`. Because these RPCs receive p_user_id as a plain argument
--   (they do NOT call auth.uid() themselves), ANY signed-in client could call
--   them directly via PostgREST (/rest/v1/rpc/...) and:
--     * call consume_course_quota(..., p_is_premium => true) to forge premium
--       unlimited rounds for any user_id (bypassing payment + cooldown), and
--     * call record_difficulty_correct({user_id, course_key, difficulty}) to
--       self-inflate correct counts and unlock Hard/Expert difficulty, and
--     * call get_course_quota_status / get_difficulty_status for ANY user_id
--       to read other users' quota/difficulty state.
--   The intended design is that ONLY the server API (/api/quota, /api/progress,
--   /api/quiz-batch-*) invokes these with the service-role key. The frontend
--   never calls them (verified via grep: the only client-side .rpc() calls are
--   bump_group_quiz_streak, can_access_flashcards, cast_vote, admin_*).
--
-- FIX:
--   Revoke EXECUTE from PUBLIC/anon/authenticated and grant EXECUTE to the
--   service_role only. Serverless functions run as the service role, so the
--   existing API flow is unaffected; the direct client call path is closed.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- 1. consume_course_quota — v26 5-arg (the surviving overload)
revoke execute on function public.consume_course_quota(uuid, text, integer, boolean, uuid) from public;
grant execute on function public.consume_course_quota(uuid, text, integer, boolean, uuid) to service_role;

-- 2. get_course_quota_status
revoke execute on function public.get_course_quota_status(uuid) from public;
grant execute on function public.get_course_quota_status(uuid) to service_role;

-- 3. record_difficulty_correct — v20 3-arg (user_id, course_key, difficulty)
revoke execute on function public.record_difficulty_correct(uuid, text, text) from public;
grant execute on function public.record_difficulty_correct(uuid, text, text) to service_role;

-- 4. get_difficulty_status — v20 2-arg (user_id, course_key default null)
revoke execute on function public.get_difficulty_status(uuid, text) from public;
grant execute on function public.get_difficulty_status(uuid, text) to service_role;

-- 5. reset_course_quota — admin/debug only
revoke execute on function public.reset_course_quota(uuid, text) from public;
grant execute on function public.reset_course_quota(uuid, text) to service_role;

-- DONE.