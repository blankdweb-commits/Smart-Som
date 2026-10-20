-- ===========================================================================
-- scripts/migration-v103-live-event-reactions.sql
--
-- Reactions on live-event messages. Separate table so reactions are scoped to
-- a single event and inherit its lifecycle (insertable only while live).
--
-- Apply:  node scripts/_apply-v43.mjs scripts/migration-v103-live-event-reactions.sql
-- Re-run safe: every statement is guarded.
-- ===========================================================================

create table if not exists public.live_event_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.live_event_messages(id) on delete cascade,
  event_id uuid not null references public.live_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (length(trim(emoji)) between 1 and 20),
  created_at timestamptz not null default now(),
  constraint live_event_reactions_one_emoji_per_user_per_message
    unique (message_id, user_id, emoji)
);

create index if not exists idx_live_event_reactions_message
  on public.live_event_reactions(message_id);
create index if not exists idx_live_event_reactions_event
  on public.live_event_reactions(event_id);

comment on table public.live_event_reactions is
  'Reactions to live-event messages. Insertable only while the parent event is live.';
comment on column public.live_event_reactions.emoji is
  'Single emoji reaction; one per (message, user, emoji).';

alter table public.live_event_reactions enable row level security;

-- Read: any authenticated viewer of a viewable event.
drop policy if exists live_event_reactions_read on public.live_event_reactions;
create policy live_event_reactions_read on public.live_event_reactions
  for select to authenticated
  using (exists (
    select 1 from public.live_events le
    where le.id = live_event_reactions.event_id
      and le.status in ('scheduled','live','closed')
  ));

-- Insert: only while the event is live, by the reacting user.
drop policy if exists live_event_reactions_insert_live on public.live_event_reactions;
create policy live_event_reactions_insert_live on public.live_event_reactions
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.live_events le
      where le.id = live_event_reactions.event_id and le.status = 'live'
    )
  );

-- Update/delete: author only (and only while live is enforced at the API layer;
-- RLS keeps the row tamper-proof from other users).
drop policy if exists live_event_reactions_author_own on public.live_event_reactions;
create policy live_event_reactions_author_own on public.live_event_reactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists live_event_reactions_author_delete on public.live_event_reactions;
create policy live_event_reactions_author_delete on public.live_event_reactions
  for delete to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';

-- ===========================================================================
-- DONE. Re-run safe.
-- ===========================================================================
