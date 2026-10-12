-- ============================================================================
-- Apex Scholars Migration v55 — ANONYMOUS SPECTATOR PRICE = ₦299
--
-- Supersedes v40 (₦499) / v42 default (₦499). The spectator pass is a
-- one-time 299 NAIRA Paystack charge for the Anonymous room. The amount is
-- RESOLVED SERVER-SIDE from study_groups.spectator_price in
-- api/initiate-payment.js / api/verify-payment.js / api/payments-webhook.js
-- (the amount-mismatch guard is unchanged), so no other code path changes.
--
--   1. Every existing anonymous room's price is normalized to 299.
--   2. New anonymous rooms default spectator_price to 299.
--
-- Idempotent. No SC ledger, no new column, no RPC, no RLS change. Spectator
-- access still expires with the room lifecycle (revoked on wipe).
-- ============================================================================

-- 1. Normalize existing anonymous rooms (incl. the seeded room 12).
update public.study_groups
   set spectator_price = 299,
       updated_at = now()
 where type = 'anonymous'
   and spectator_price is distinct from 299;

-- 2. Future anonymous rooms default to ₦299.
alter table public.study_groups
  alter column spectator_price set default 299;
