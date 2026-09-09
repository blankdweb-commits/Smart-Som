-- ============================================================
-- Polynurse Exam Center Migration v27 — Remove Stale Quota Overload
--
-- PROBLEM:
--   consume_course_quota exists TWICE in the live DB:
--     1) 4-arg (uuid, text, integer, boolean)      <- v13/v14/v19/v25
--     2) 5-arg (uuid, text, integer, boolean, uuid) <- v26 (atomic + idempotent)
--   PostgreSQL `create or replace` CANNOT change an argument list, so v26
--   added a NEW overload instead of replacing the old one. Both now exist.
--   PostgREST cannot disambiguate a 4-arg call and throws:
--     "Could not choose the best candidate function between: ... 4-arg ... 5-arg ..."
--   breaking BOTH the live API (/api/quota/course-consume, api/quota.js) and
--   the e2e suite (scripts/e2e-course-quota.mjs / e2e-quota-api.mjs).
--
-- FIX:
--   DROP the stale 4-arg overload. The 5-arg v26 version has
--   `p_request_id uuid default null`, so existing 4-arg callers keep working
--   (they simply opt out of replay protection, which is fine).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- Drop the stale 4-arg overload ONLY. The 5-arg v26 version is untouched.
drop function if exists public.consume_course_quota(uuid, text, integer, boolean);

-- Re-assert grants for the surviving 5-arg overload (authenticated + service role).
grant execute on function public.consume_course_quota(uuid, text, integer, boolean, uuid) to authenticated, service_role;

-- DONE.
