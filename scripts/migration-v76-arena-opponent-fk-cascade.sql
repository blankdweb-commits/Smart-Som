-- ============================================================
-- migration-v76-arena-opponent-fk-cascade.sql
--
-- FIXES A REAL BUG FOUND WHILE CLEANING UP AFTER A TEST RUN.
--
-- `competitive_matches_opponent_id_fkey` was `ON DELETE SET NULL`. Deleting a
-- user who had ever been the OPPONENT in an arena match therefore made
-- Postgres issue an UPDATE on the competitive_matches row - and the v63/v64
-- arena seal (`trg_arena_guard_match_upd`) correctly rejects any non-arena
-- write to a blitz row. So the referential action was rejected and:
--
--     ERROR: 42501 ARENA_REQUIRES_ARENA_RPC
--     CONTEXT: PL/pgSQL function _arena_guard_match_upd() line 5 at RAISE
--     SQL statement "UPDATE ONLY public.competitive_matches
--                    SET opponent_id = NULL WHERE $1 OPERATOR(pg_catalog.=) opponent_id"
--
-- which made `delete from auth.users` fail outright for that account. Anyone
-- who had ever been challenged in the arena could not be deleted - by an
-- admin, by an e2e cleanup script, or by an account-deletion request. The
-- GoTrue admin API only surfaces it as a generic 500
-- ("unexpected_failure"), which is why it looked like an auth problem.
--
-- THE FIX: make the FK `ON DELETE CASCADE` so referential integrity DELETES
-- the match row instead of UPDATEing it. That sidesteps the seal entirely
-- (no UPDATE is issued) and makes opponent_id symmetric with creator_id,
-- which has been `ON DELETE CASCADE` since v63.
--
-- TRADE-OFF, stated plainly: deleting a user's opponent now removes that one
-- competitive_matches row instead of blanking its opponent_id. This does NOT
-- touch the user-visible duel history - that lives in `duels`, whose own FKs
-- are `ON DELETE SET NULL` and are deliberately left alone. It also only
-- affects accounts that are being deleted anyway.
--
-- This is the ONLY FK in the database whose referential action would UPDATE a
-- table carrying an arena seal trigger; that was verified against pg_constraint
-- before writing this migration.
-- ============================================================

alter table public.competitive_matches
  drop constraint if exists competitive_matches_opponent_id_fkey;

alter table public.competitive_matches
  add constraint competitive_matches_opponent_id_fkey
  foreign key (opponent_id) references auth.users(id) on delete cascade;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================