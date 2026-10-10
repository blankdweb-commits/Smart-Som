-- ============================================================
-- Apex Scholars Migration v47 — ANONYMOUS ROOM: REMOVE STICKERS
--
-- The Anonymous room no longer ships stickers. v44 added a `sticker`
-- column to public.anonymous_message_meta for the (now-removed) sticker
-- picker; that column was read/written ONLY by the sticker feature.
--
-- This migration drops the column. The `tag` and `is_encoded` columns and
-- the whole tag / social-action system are untouched. No other table or
-- feature references a sticker.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/_apply-v43.mjs scripts/migration-v47-anonymous-remove-stickers.sql
-- ============================================================

alter table if exists public.anonymous_message_meta
  drop column if exists sticker;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
