-- ============================================================
-- migration-v52-premium-grant-two-users.sql
--
-- Manual 1-month premium grant for two accounts (operator request):
--   * kokorichanyerhovwo430@gmail.com  (af44da2c-3114-40bf-8bfc-758c92481516)
--   * blankdweb@mark.com               (e80d23c9-0e1c-4574-b3d2-c34fede7de9b)
--
-- Each gets ONE active 'monthly' subscription row (expires +30 days,
-- grace +32 days) and profiles.is_activated = true. Matches the canonical
-- grant shape used by api/verify-payment.js (no id / plan_id supplied).
--
-- Idempotent: only inserts when the user has no live subscription, and the
-- unique `reference` guards re-runs. Safe to re-run.
-- ============================================================

insert into public.subscriptions (user_id, plan, status, expires_at, grace_until, amount, reference)
select v.uid,
       'monthly',
       'active',
       now() + interval '30 days',
       now() + interval '32 days',
       6999,
       'manual-grant-' || v.uid::text || '-v52premium'
  from (values
         ('af44da2c-3114-40bf-8bfc-758c92481516'::uuid),
         ('e80d23c9-0e1c-4574-b3d2-c34fede7de9b'::uuid)
       ) as v(uid)
 where not exists (
   select 1 from public.subscriptions s
    where s.user_id = v.uid
      and s.status = 'active'
      and coalesce(s.expires_at, s.grace_until) > now()
 )
on conflict (reference) do nothing;

update public.profiles
   set is_activated = true
 where id in (
   'af44da2c-3114-40bf-8bfc-758c92481516'::uuid,
   'e80d23c9-0e1c-4574-b3d2-c34fede7de9b'::uuid
 );

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
