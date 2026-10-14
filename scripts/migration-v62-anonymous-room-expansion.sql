-- scripts/migration-v62-anonymous-room-expansion.sql
-- Anonymous room expansion (APEX-SCHOLARS / PolyNurse):
--   1. STALE LOCK — clear the membership_locked left on a room by the retired
--      v54 "auto-lock at 20" rule. v56 already removed that rule from
--      community_anonymous_join, so any membership_locked still set on an
--      anonymous room is a leftover that blocks ALL joins (data-only fix).
--      Free founding member seats are deliberately UNCHANGED at 20: a 60-seat
--      experiment was reverted before this migration was ever applied, so the
--      live DB is still on the v56 value and this migration does not touch it.
--   2. RPS — rock-paper-scissors for an ACCEPTED challenge (opt-in).
--   3. GAG  — the "toast / crack / belle" comedic action, a kind that the
--      targeted member accepts or declines, plus DELAYED announcements
--      revealed by a request-driven sweep (no cron needed).
--
-- Idempotent. Apply:
--   node scripts/run-migration.mjs scripts/migration-v62-anonymous-room-expansion.sql

-- =====================================================================
-- 1. STALE LOCK (capacity intentionally left at the v56 default of 20)
-- =====================================================================
-- v54 auto-locked membership the instant a room hit 20 members. v56 replaced
-- community_anonymous_join and dropped that rule, so any membership_locked
-- still set on an anonymous room is a leftover that locks out every join.
update public.study_groups
   set membership_locked = false,
       updated_at = now()
 where type = 'anonymous'
   and membership_locked = true;

-- =====================================================================
-- 2. EVENTS: widen the kind allowlist, add visible_at for delayed reveals
-- =====================================================================
-- 'duel'     — a rock-paper-scissors bout opened from an accepted challenge.
-- 'announce' — a comedic system line (crack / belle / quadruplets).
alter table public.anonymous_room_events
  drop constraint if exists anonymous_room_events_kind_check;
alter table public.anonymous_room_events
  add constraint anonymous_room_events_kind_check
  check (kind in ('action', 'challenge', 'fight', 'duel', 'announce'));

-- Delayed announcements. Existing rows default to now() so they stay visible
-- immediately; only rows written with a future visible_at stay hidden.
alter table public.anonymous_room_events
  add column if not exists visible_at timestamptz;

update public.anonymous_room_events
   set visible_at = created_at
 where visible_at is null;

alter table public.anonymous_room_events
  alter column visible_at set default now();

-- The sweep scans for due rows per room.
create index if not exists idx_anon_room_events_due
  on public.anonymous_room_events(group_id, visible_at)
  where visible_at is not null;

-- =====================================================================
-- 3. RPS: one bout per accepted challenge
-- =====================================================================
create table if not exists public.anonymous_duels (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  -- One bout per accepted challenge card (unique => no duplicate duels when
  -- the callback verifier and the webhook both process the acceptance).
  event_id bigint not null unique references public.anonymous_room_events(id) on delete cascade,
  a_id uuid not null references auth.users(id) on delete cascade,
  b_id uuid not null references auth.users(id) on delete cascade,
  a_move text check (a_move in ('rock', 'paper', 'scissors')),
  b_move text check (b_move in ('rock', 'paper', 'scissors')),
  status text not null default 'open' check (status in ('open', 'done', 'expired')),
  winner_id uuid references auth.users(id) on delete set null,
  a_alias integer,
  b_alias integer,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint anonymous_duels_distinct check (a_id <> b_id)
);

create index if not exists idx_anonymous_duels_group_created
  on public.anonymous_duels(group_id, created_at desc);

alter table public.anonymous_duels enable row level security;
revoke all on public.anonymous_duels from public, anon, authenticated;

-- =====================================================================
-- 4. CLEANUP: events/combat/fights were never purged (v43 cleanup only
--    touches community_posts), so they grew forever per room.
-- =====================================================================
do $$
begin
  if to_regclass('public.anonymous_room_events') is not null then
    delete from public.anonymous_room_events
     where created_at < now() - interval '1 day';
    delete from public.anonymous_event_reactions r
     where not exists (select 1 from public.anonymous_room_events e where e.id = r.event_id);
  end if;
  if to_regclass('public.anonymous_combat_events') is not null then
    delete from public.anonymous_combat_events
     where created_at < now() - interval '1 day';
  end if;
  if to_regclass('public.anonymous_fights') is not null then
    delete from public.anonymous_fights
     where started_at < now() - interval '1 day';
  end if;
end $$;

-- =====================================================================
-- DONE
-- =====================================================================
select 'v62 anon room expansion applied' as status;