-- Web Push subscriptions + delivery log (VAPID / push-subscribe flow).
-- Tables are written ONLY by the server (service-role via /api/push-*), so no
-- client insert/update policies exist; users can read/delete their own rows.
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_own_read" on public.push_subscriptions;
create policy "push_subscriptions_own_read"
  on public.push_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "push_subscriptions_own_delete" on public.push_subscriptions;
create policy "push_subscriptions_own_delete"
  on public.push_subscriptions
  for delete
  using (auth.uid() = user_id);

-- Delivery log: one row per (user, kind, day) so scheduled reminders never
-- spam. `status` tracks the outcome for diagnostics (sent / failed / pruned).
create table if not exists public.push_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,          -- e.g. 'streak-alert', 'exam-near', 'daily-reminder', 'achievement'
  sent_date   date not null default current_date,
  sent_at     timestamptz not null default now(),
  status      text not null default 'sent',
  endpoints   integer not null default 0,
  unique (user_id, kind, sent_date)
);

alter table public.push_log enable row level security;

drop policy if exists "push_log_own_read" on public.push_log;
create policy "push_log_own_read"
  on public.push_log
  for select
  using (auth.uid() = user_id);

-- Confirm both tables exist and report current subscription count.
select
  (select count(*) from public.push_subscriptions) as push_subscriptions,
  (select count(*) from public.push_log) as push_log;