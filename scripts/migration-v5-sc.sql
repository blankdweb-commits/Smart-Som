-- ============================================================
-- Apex Scholars Migration v5 — Smart Coin (SC) currency + group quiz link
-- Adds the SC economy to profiles (wallet + daily payout tracking +
-- once-per-day fail penalty tracking) and an auditable ledger, plus a
-- `group_id` link on quiz_results so group leadership boards can show
-- per-group streaks and today's activity.
-- Idempotent. Safe to re-run. Requires migr-v4c (study groups) first.
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES — SC WALLET + payout/fail tracking
-- ------------------------------------------------------------
alter table public.profiles add column if not exists smart_coins integer not null default 0;
alter table public.profiles add column if not exists sc_last_payout timestamptz;
alter table public.profiles add column if not exists sc_last_fail_date date;

create index if not exists idx_profiles_smart_coins on public.profiles(smart_coins desc);

-- ------------------------------------------------------------
-- 2. SMART COIN LEDGER (audit trail for earns & losses)
--    amount is signed (+ earn, - loss). reason is a stable enum-ish tag;
--    ref_id optionally points at the triggering record (e.g. quiz_results.id).
-- ------------------------------------------------------------
create table if not exists public.smart_coin_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount integer not null,
  balance_after integer not null default 0,
  reason text not null default 'misc',
  ref_id bigint,
  created_at timestamptz not null default now()
);

create index if not exists idx_smart_coin_ledger_user on public.smart_coin_ledger(user_id, created_at desc);

alter table public.smart_coin_ledger enable row level security;

drop policy if exists "sc_ledger_select_own" on public.smart_coin_ledger;
create policy "sc_ledger_select_own"
  on public.smart_coin_ledger for select
  using (auth.uid() = user_id);

drop policy if exists "sc_ledger_insert_own" on public.smart_coin_ledger;
create policy "sc_ledger_insert_own"
  on public.smart_coin_ledger for insert
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. QUIZ RESULTS — GROUP LINK (for community streak/leaderboard)
-- ------------------------------------------------------------
alter table public.quiz_results add column if not exists group_id bigint references public.study_groups(id) on delete set null;
create index if not exists idx_quiz_results_group on public.quiz_results(group_id, created_at desc);

-- ------------------------------------------------------------
-- 4. REALTIME
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.smart_coin_ledger;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- DONE.
-- ============================================================
