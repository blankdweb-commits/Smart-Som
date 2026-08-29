-- ============================================================
-- Apex Scholars Migration v9 — SC Duel Arena
-- Two tables back the SC-powered die-roll duel arena:
--   1. duels          — history of every settled duel (SC delta, opponent).
--   2. duel_waiting   — matchmaking queue: users advertise a mode+stake and
--      get paired with the next matching human, or play "The House".
-- Idempotent. Safe to re-run. Requires migr-v5 (SC) first.
-- ============================================================

create table if not exists public.duels (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  opponent text not null default 'The House',
  opponent_id uuid references auth.users(id) on delete set null,
  mode text not null default 'duel',
  stake integer not null default 100,
  outcome text not null default 'win',
  delta integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_duels_user on public.duels(user_id, created_at desc);

alter table public.duels enable row level security;

drop policy if exists "duels_all_own" on public.duels;
create policy "duels_all_own"
  on public.duels for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Matchmaking queue: one open entry per user (latest upsert wins).
create table if not exists public.duel_waiting (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'duel',
  stake integer not null default 100,
  created_at timestamptz not null default now(),
  constraint duel_waiting_user_key unique (user_id)
);

alter table public.duel_waiting enable row level security;

drop policy if exists "duel_waiting_own_update" on public.duel_waiting;
create policy "duel_waiting_own_update"
  on public.duel_waiting for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "duel_waiting_select" on public.duel_waiting;
create policy "duel_waiting_select"
  on public.duel_waiting for select
  using (auth.uid() is not null);

-- Realtime so the second player observes the first joining the lane.
do $$
begin
  alter publication supabase_realtime add table public.duel_waiting;
  alter publication supabase_realtime add table public.duels;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- DONE.
-- ============================================================
