-- ===========================================================================
-- scripts/migration-v102-live-events.sql
--
-- Admin-only Anonymous Live Events — a DEDICATED event entity, separate from
-- the existing Anonymous Room (which keeps its own membership, messaging and
-- lifecycle under migration-v99).
--
-- Lifecycle (server-enforced state machine):
--   draft -> scheduled | live (immediate launch)
--   scheduled -> live | cancelled
--   live -> closed | cancelled
--   closed / cancelled  -> TERMINAL (never reopen)
--
-- Only verified administrators may create or manage events. Ordinary
-- participants discover, join (read) and, while an event is live, send
-- messages. Closed events stay readable but refuse every mutation.
--
-- Apply:  node scripts/_apply-v43.mjs scripts/migration-v102-live-events.sql
-- Re-run safe: every statement is guarded.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. live_events — the event entity (admin-created, server-authoritative)
-- ---------------------------------------------------------------------------
create table if not exists public.live_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  description text not null check (length(trim(description)) between 1 and 2000),
  cover_url text,
  status text not null default 'draft'
    check (status in ('draft','scheduled','live','closed','cancelled')),
  start_at timestamptz,
  end_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.live_events is
  'Admin-created live events. Lifecycle draft -> scheduled -> live -> closed|cancelled; closed and cancelled are terminal.';
comment on column public.live_events.status is
  'Server-controlled state machine. Transitions are validated by the API handlers; closed/cancelled are terminal.';
comment on column public.live_events.end_at is
  'Authoritative hard deadline. Once an event is live it cannot be moved later — handlers reject any edit that would shift the window after participants have joined.';
comment on column public.live_events.created_by is
  'The verified administrator who created the event. References public.profiles(id).';

-- ---------------------------------------------------------------------------
-- 2. live_event_messages — event chat, SEPARATE from Anonymous Room messages
-- ---------------------------------------------------------------------------
create table if not exists public.live_event_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.live_events(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_alias text not null default 'Anonymous Member'
    check (length(trim(author_alias)) between 1 and 60),
  content text not null check (length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists idx_live_event_messages_event_created
  on public.live_event_messages(event_id, created_at);

comment on table public.live_event_messages is
  'Event chat messages. Stored separately from Anonymous Room messages so the two features never share permissions or leak room rows.';
comment on column public.live_event_messages.author_alias is
  'Pseudonymous display name (defaults to "Anonymous Member"). Never the real identity.';

-- ---------------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------------
alter table public.live_events enable row level security;
alter table public.live_event_messages enable row level security;

-- Public (authenticated) discovery read: scheduled / live / closed events only.
-- Draft and cancelled events are never listed to participants.
drop policy if exists live_events_public_read on public.live_events;
create policy live_events_public_read on public.live_events
  for select to authenticated
  using (status in ('scheduled','live','closed'));

-- Administrators manage events: create, update, delete, read everything.
drop policy if exists live_events_admin_manage on public.live_events;
create policy live_events_admin_manage on public.live_events
  for all to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin','super_admin')
  ))
  with check (exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin','super_admin')
  ));

-- Messages: read any message on a viewable event.
drop policy if exists live_event_messages_read on public.live_event_messages;
create policy live_event_messages_read on public.live_event_messages
  for select to authenticated
  using (exists (
    select 1 from public.live_events le
    where le.id = live_event_messages.event_id
      and le.status in ('scheduled','live','closed')
  ));

-- Messages: insert only while the event is live, by an authenticated participant.
drop policy if exists live_event_messages_insert_live on public.live_event_messages;
create policy live_event_messages_insert_live on public.live_event_messages
  for insert to authenticated
  with check (
    auth.uid() = author_id
    and exists (
      select 1 from public.live_events le
      where le.id = live_event_messages.event_id and le.status = 'live'
    )
  );

-- Messages: update/delete by the author only.
drop policy if exists live_event_messages_author_own on public.live_event_messages;
create policy live_event_messages_author_own on public.live_event_messages
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());
drop policy if exists live_event_messages_author_delete on public.live_event_messages;
create policy live_event_messages_author_delete on public.live_event_messages
  for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 4. Authoritative helpers — server clock, never the browser
-- ---------------------------------------------------------------------------
-- Effective lifecycle state. A stored 'live' event whose end_at has passed is
-- reported as 'closed' even if the sweep has not yet persisted it, so the UI
-- and the write gates agree with the database clock.
create or replace function public._live_event_state(p_event uuid)
returns text
language sql stable
as $$
  select case
    when e.id is null then null
    when e.status = 'cancelled' then 'cancelled'
    when e.status = 'closed' then 'closed'
    when e.status = 'live' and e.end_at is not null and now() >= e.end_at then 'closed'
    when e.status = 'live' then 'live'
    when e.status = 'scheduled' and e.start_at is not null and now() >= e.start_at then 'live'
    else e.status
  end
  from public.live_events e
  where e.id = p_event;
$$;

-- THE predicate: true when no new interaction may be written to this event.
create or replace function public._live_event_over(p_event uuid)
returns boolean
language sql stable
as $$
  select coalesce((
    select (e.status = 'closed') or (e.status = 'cancelled')
        or (e.status = 'live' and e.end_at is not null and now() >= e.end_at)
      from public.live_events e
     where e.id = p_event
  ), false);
$$;

-- ---------------------------------------------------------------------------
-- 5. Exactly-once closure (advisory-locked, idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.live_event_close(
  p_event uuid,
  p_reason text default 'deadline'
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_ev record;
begin
  if p_reason is null or p_reason not in ('deadline','moderator','admin','operational') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REASON');
  end if;

  perform pg_advisory_xact_lock(hashtext('live_event:' || p_event::text));

  select * into v_ev from public.live_events where id = p_event for update;
  if v_ev is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_ev.status in ('closed','cancelled') then
    return jsonb_build_object(
      'ok', true, 'already_closed', true,
      'status', v_ev.status,
      'state', public._live_event_state(p_event)
    );
  end if;

  update public.live_events
     set status = 'closed',
         updated_at = now()
   where id = p_event;

  return jsonb_build_object(
    'ok', true, 'already_closed', false,
    'status', 'closed',
    'closed_at', now(),
    'reason', p_reason,
    'state', public._live_event_state(p_event)
  );
end;
$$;

-- Bulk sweep: close every live event whose deadline has passed. Idempotent and
-- advisory-locked per event by live_event_close itself. Intended to be invoked
-- by the /api/community/cleanup scheduler (service-role token) and/or lazily
-- on traffic so expiry does not depend on a browser being open.
create or replace function public.live_event_sweep(
  p_now timestamptz default null
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_res jsonb;
  v_cut timestamptz := coalesce(p_now, now());
  v_closed integer := 0;
  v_list jsonb := '[]'::jsonb;
begin
  for v_row in
    select e.id
      from public.live_events e
     where e.status = 'live'
       and e.end_at is not null
       and e.end_at <= v_cut
     order by e.id
     limit 500
  loop
    v_res := public.live_event_close(v_row.id, 'deadline');
    if coalesce((v_res ->> 'ok')::boolean, false) then
      v_closed := v_closed + 1;
      v_list := v_list || jsonb_build_object('event', v_row.id);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'events_closed', v_closed, 'closed', v_list);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants — service_role owns mutation; helpers readable by authenticated
-- ---------------------------------------------------------------------------
revoke all on function public.live_event_close(uuid, text)
  from public, anon, authenticated;
grant execute on function public.live_event_close(uuid, text)
  to service_role;

revoke all on function public.live_event_sweep(timestamptz)
  from public, anon, authenticated;
grant execute on function public.live_event_sweep(timestamptz)
  to service_role;

revoke execute on function public._live_event_state(uuid)
  from public, anon, authenticated;
grant execute on function public._live_event_state(uuid)
  to anon, authenticated, service_role;

revoke execute on function public._live_event_over(uuid)
  from public, anon, authenticated;
grant execute on function public._live_event_over(uuid)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- ===========================================================================
-- DONE. Re-run safe.
-- ===========================================================================
