-- ============================================================
-- Apex Scholars Migration v40 — ANONYMOUS SPECTATOR PRICE = ₦499
--
-- FOCUSED change set for the Anonymous room ONLY. Nothing outside
-- the anonymous product surface is touched.
--
--   1. The spectator pass price is 499 NAIRA (Paystack), resolved
--      SERVER-side from study_groups.spectator_price by
--      api/initiate-payment.js, api/verify-payment.js and
--      api/payments-webhook.js. This migration normalizes every
--      anonymous room's price from the previous 599 to 499.
--
-- No new columns, no SC ledger, no RPC, no RLS change. Spectator
-- access still expires with the room lifecycle (revoked on wipe by
-- community_anonymous_wipe). Idempotent and safe to re-run.
--
-- Apply: node scripts/run-migration.mjs scripts/migration-v40-anonymous-spectator-price.sql
-- ============================================================

-- Normalize the spectator price for all anonymous rooms. The WHERE
-- guard keeps the statement idempotent (a second run updates 0 rows).
update public.study_groups
   set spectator_price = 499,
       updated_at = now()
 where type = 'anonymous'
   and spectator_price is distinct from 499;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================