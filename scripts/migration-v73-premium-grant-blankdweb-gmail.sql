-- ============================================================
-- migration-v73-premium-grant-blankdweb-gmail.sql
--
-- Manual 1-month premium grant (operator request):
--   * blankdweb@gmail.com  (1de5bb28-85c4-4572-90d1-96040e9e7de3)
--
-- Grants ONE active 'monthly' subscription row: expiry +30 days,
-- grace +32 days. Matches the canonical grant shape used by
-- api/verify-payment.js (no id / plan_id supplied).
--
-- DELIBERATE OMISSIONS (do not "fix" these):
--
--  1. NO `update profiles set is_activated`. The account is already
--     activated. `trg_referral_credit_on_activation` is
--     `AFTER UPDATE OF is_activated`, which Postgres fires even when
--     the new value equals the old one -- so writing the column would
--     grant an unintended +15 SC referral bonus.
--
--  2. NO Smart Coin grant. This account already holds a
--     'premium-30-sc-grant' ledger entry (2026-09-05). The one-time
--     premium SC bonus is lifetime, not per-subscription, so re-granting
--     would double-pay. v70 must also skip this account.
--
--  3. NO edit of the expired 2026-10-05 subscription. It stays as
--     history, exactly as a real repeat purchase would leave it.
--
-- Idempotent: only inserts when the user has no live subscription, and
-- the unique `reference` guards re-runs. Safe to re-run.
-- ============================================================

insert into public.subscriptions (user_id, plan, status, expires_at, grace_until, amount, reference)
select v.uid,
       'monthly',
       'active',
       now() + interval '30 days',
       now() + interval '32 days',
       6999,
       'manual-grant-' || v.uid::text || '-v73premium'
  from (values
         ('1de5bb28-85c4-4572-90d1-96040e9e7de3'::uuid)
       ) as v(uid)
 where not exists (
   select 1 from public.subscriptions s
    where s.user_id = v.uid
      and s.status = 'active'
      and coalesce(s.expires_at, s.grace_until) > now()
 )
on conflict (reference) do nothing;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================