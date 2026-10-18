-- ============================================================
-- v87 - ANONYMOUS ROOM PRICES: member seat 499 -> 299, spectator pass 299 -> 190
-- ============================================================
--
-- WHY: operator decision. The member seat drops from NGN 499 to NGN 299 and the
-- spectator pass from NGN 299 to NGN 190. Note the collision the old numbers
-- had: a spectator pass cost exactly what a member seat costs, so there was no
-- price signal between the two at all. 190 < 299 now makes "watch" the cheaper
-- option, which is what the tier structure implies.
--
-- SCOPE (operator decision): every EXISTING anonymous room is updated, not just
-- new ones, and BOTH column defaults change so a room created later inherits
-- them. Without the default change, handleCreateAnonRoom inserts no explicit
-- price (api/_community.js handleCreateAnonRoom relies on the column default),
-- so the two live rooms would move and the next new room would silently revert
-- to 499/299.
--
-- TRUTHFULNESS: no price is hardcoded anywhere in the client. The amounts are
-- resolved server-side from these columns by resolveMembershipsPurchase /
-- resolveSpectatePurchase in api/initiate-payment.js, and the amount-mismatch
-- guards in verify-payment.js and payments-webhook.js compare the Paystack
-- charge against these same columns. Changing them here is therefore the ONLY
-- place a price needs to change, and a stale hardcoded price anywhere else
-- would already have been caught by the amount guard at checkout.
--
-- IDEMPOTENT: re-running re-asserts the same values. No data is destroyed -
-- gift seats inherit member_price at redemption time, so unclaimed gift codes
-- in existing rooms become 299 seats automatically. Nothing that was already
-- charged is affected: a granted membership is a row in anonymous_memberships
-- and is not repriced.
-- ============================================================

begin;

-- 1. Every existing anonymous room. Guarded on type so a regular study group
--    that happens to have a member_price column value is never touched.
update public.study_groups
   set member_price    = 299.00,
       spectator_price = 190.00
 where type = 'anonymous'
   and (member_price is distinct from 299.00
        or spectator_price is distinct from 190.00);

-- 2. Column defaults, so the NEXT room created inherits the new prices.
--    handleCreateAnonRoom inserts no explicit price.
alter table public.study_groups
  alter column member_price    set default 299,
  alter column spectator_price set default 190;

commit;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================