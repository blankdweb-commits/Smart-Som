-- ============================================================
-- Apex Scholars Migration v36 — STUDENT BONUS PROMO (PRICING-ONLY)
-- Phase 9 of the mega-spec. Server-authoritative Paystack amounts.
-- Requires v31 (_sc_apply) — unrelated to coins, but keeps the
-- migration chain in order.
--
-- What changes:
--   1. `subscription_plans` gained `is_promo` (badge signal) + `slug`
--      (stable dedupe key for the promo rows).
--   2. Two STUDENT BONUS rows seeded (idempotent upsert on slug):
--        student-bonus-30 : ₦990  / 30 days  (vs ₦6,999 Monthly)
--        student-bonus-7  : ₦550  /  7 days  (vs ₦1,999.90 Weekly)
--   3. Amounts stay SERVER-side: initiate/verify resolve the price from
--      `subscription_plans.price`; the webhook now rejects any
--      `charge.success` whose paid amount ≠ resolved plan price.
-- No RLS change needed — subscription_plans already has a public
-- read path used by Activate.jsx. Idempotent. Safe to re-run.
-- ============================================================

alter table public.subscription_plans
  add column if not exists is_promo boolean not null default false;

alter table public.subscription_plans
  add column if not exists slug text;

create unique index if not exists subscription_plans_slug_key
  on public.subscription_plans(slug);

insert into public.subscription_plans (slug, name, price, duration_days, is_active, is_promo)
values
  ('student-bonus-30', 'Student Bonus (30 Days)', 990, 30, true, true),
  ('student-bonus-7',  'Student Bonus (7 Days)', 550, 7,  true, true)
on conflict (slug) do update
  set name = excluded.name,
      price = excluded.price,
      duration_days = excluded.duration_days,
      is_active = excluded.is_active,
      is_promo = excluded.is_promo;