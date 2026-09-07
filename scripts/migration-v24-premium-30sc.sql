-- Grant +30 Smart Coins to every currently-premium account (active subscription
-- with a valid expiry or grace window). Idempotent: skips users who already have
-- a 'premium-30-sc-grant' ledger entry so the balance is never granted twice.
with premium_users as (
  select distinct user_id
  from public.subscriptions
  where status = 'active'
    and (expires_at is null or expires_at > now())
    and (grace_until is null or grace_until > now())
),
not_yet_granted as (
  select pu.user_id
  from premium_users pu
  where not exists (
    select 1 from public.smart_coin_ledger l
    where l.user_id = pu.user_id and l.reason = 'premium-30-sc-grant'
  )
),
updated as (
  update public.profiles p
  set smart_coins = coalesce(p.smart_coins, 0) + 30
  from not_yet_granted ng
  where p.id = ng.user_id
  returning p.id, p.smart_coins
)
insert into public.smart_coin_ledger (user_id, amount, balance_after, reason, ref_id, created_at)
select u.id, 30, u.smart_coins, 'premium-30-sc-grant', null, now()
from updated u;

select l.user_id, l.amount, l.balance_after, l.reason, l.created_at
from public.smart_coin_ledger l
where l.reason = 'premium-30-sc-grant'
order by l.created_at;