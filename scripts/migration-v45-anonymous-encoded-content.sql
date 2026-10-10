-- ============================================================
-- Apex Scholars Migration v45 — ANONYMOUS ENCODED CONTENT CHECK
--
-- v44 introduced Encoded Messages whose plaintext is stored ONLY in
-- anonymous_encoded_messages; the community_posts.content column is
-- intentionally BLANKED for those rows. The pre-existing
-- community_posts_content_check (char_length(trim(content)) > 0) rejected
-- that blank insert (SQLSTATE 23514), so no Encoded Message could be sent.
--
-- This migration relaxes the check to permit blank/empty content. The check
-- was a display-level guard, not a security boundary:
--   * every community + anonymous write goes through the service-role API
--     (v29 dropped client write RLS), which still enforces
--     "content OR sticker" for the Anonymous room and "content OR image" for
--     the general feed;
--   * row-level security and all other constraints are untouched.
-- Image-only general posts (content '' + image_url set) are likewise fixed.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v45-anonymous-encoded-content.sql
-- ============================================================

alter table public.community_posts
  drop constraint if exists community_posts_content_check;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
