-- ---------------------------------------------------------------------------
-- migration-v53-anonymous-social-events.sql
--
-- "Final tweaks" — Anonymous room social ACTIONS become EVENT CARDS in the
-- conversation (not just count chips on messages):
--   1. anonymous_room_events  — one row PER action/challenge/fight instance so
--      the feed can interleave event cards that others can React to and that
--      a challenger/target can accept or decline.
--   2. anonymous_event_reactions — per-event emoji reactions (separate from the
--      per-post community_post_reactions, which stay for messages).
--   3. anonymous_room_member_prefs — the "declining interactions" opt-out that
--      lets a member refuse being targeted by actions/challenges (anti-slam).
--   4. anonymous_encoded_messages += revealed_at / revealed_by — the RECIPIENT
--      of an Encoded Message can publicly reveal it ("the room knows a secret
--      exists") and take it private again; the author stays able to read it.
--
-- Mirrors the v44/v46 convention: RLS enabled + REVOKE ALL from public, anon,
-- authenticated. Everything is service-role only. Idempotent (re-run clean).
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------
-- 1. ROOM EVENTS (action / challenge / fight instances)
-- ------------------------------------------------------------
create table if not exists public.anonymous_room_events (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  post_id uuid references public.community_posts(id) on delete cascade,
  action text not null,
  kind text not null default 'action'
    check (kind in ('action', 'challenge', 'fight')),
  status text not null default 'open'
    check (status in ('open', 'pending', 'accepted', 'declined')),
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_alias integer,
  target_id uuid references auth.users(id) on delete cascade,
  target_alias integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_anon_room_events_group_created
  on public.anonymous_room_events(group_id, created_at desc);
create index if not exists idx_anon_room_events_target
  on public.anonymous_room_events(target_id, created_at desc);

alter table public.anonymous_room_events enable row level security;
revoke all on public.anonymous_room_events from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. EVENT REACTIONS (per event card)
-- ------------------------------------------------------------
create table if not exists public.anonymous_event_reactions (
  event_id bigint not null references public.anonymous_room_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id, emoji)
);

create index if not exists idx_anon_event_reactions_event
  on public.anonymous_event_reactions(event_id);

alter table public.anonymous_event_reactions enable row level security;
revoke all on public.anonymous_event_reactions from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. MEMBER PREFS — "declining interactions" anti-slam opt-out.
-- ------------------------------------------------------------
create table if not exists public.anonymous_room_member_prefs (
  owner_id uuid not null references auth.users(id) on delete cascade,
  declining_interactions boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id)
);

alter table public.anonymous_room_member_prefs enable row level security;
revoke all on public.anonymous_room_member_prefs from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. ENCODED MESSAGES — public reveal flag (recipient-controlled).
--    revealed_at NULL  = concealed to everyone but author/recipient (today).
--    revealed_at set   = the plaintext is shown to EVERY viewer (room knows).
-- ------------------------------------------------------------
alter table public.anonymous_encoded_messages
  add column if not exists revealed_at timestamptz;
alter table public.anonymous_encoded_messages
  add column if not exists revealed_by uuid references auth.users(id) on delete cascade;