-- ============================================================
-- Apex Scholars Migration v49 — SC LEDGER ref_id TYPE FIX
--
-- Root cause (found while wiring the S8 license fee): migration v31 added a
-- generic `ref_id text` to smart_coin_ledger via `add column if not exists
-- ref_id text`. The column already existed as `ref_id bigint` (migration v5),
-- so the ADD was a silent no-op and `_sc_apply(...)` — which inserts the TEXT
-- `p_ref_id` — fails with
--   column "ref_id" is of type bigint but expression is of type text
-- whenever a non-null ref id is supplied (license_apply fee, sc_spend with a
-- refId, etc.). v31 clearly intended ref_id to be a generic text pointer.
--
-- This is a forward-only, idempotent correction: widen ref_id to text. Every
-- existing value is NULL or a small integer, so ref_id::text is lossless and no
-- consumer treats it as a number (verified: no FK, index, or numeric query on
-- ref_id exists in the repo).
--
-- Apply: node scripts/_apply-v43.mjs scripts/migration-v49-sc-ledger-ref-id-text.sql
-- ============================================================

alter table public.smart_coin_ledger
  alter column ref_id type text using ref_id::text;

comment on column public.smart_coin_ledger.ref_id is
  'Optional generic text reference to the triggering record (quiz batch, license attempt, product, ...).';
