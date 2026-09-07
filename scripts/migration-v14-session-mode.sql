-- ============================================================
-- Apex Scholars Migration v14 -- Configurable Session / Device Mode
--
-- Adds a DB-backed toggle that controls session-enforcement strictness:
--   'soft'   (DEFAULT)  track devices, never auto-revoke. Multi-device OK.
--   'strict'            single-active-device with a configurable grace window
--                       (older device keeps working during grace, then is
--                       shown a "signed in on another device" notice and is
--                       revoked once the new device's grace elapses).
--
-- Soft mode removes the old hard-revoke in register_session (which caused
-- false "signed in elsewhere" lockouts) while keeping per-device revoke via
-- revoke_session() / list_active_sessions().
--
-- Idempotent, safe to re-run. Compatible with migration v10..v13.
-- ============================================================

-- ------------------------------------------------------------
-- 1. app_settings table + session_mode row
-- ------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value)
values ('session_mode', 'soft')
on conflict (key) do update set value = excluded.value;

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_read_public" on public.app_settings;
create policy "app_settings_read_public"
  on public.app_settings for select
  using (true);

grant select on table public.app_settings to authenticated, anon;
grant insert, update, delete on table public.app_settings to service_role;

-- ------------------------------------------------------------
-- 2. get_session_mode() -- reads the toggle, defaults to 'soft'
-- ------------------------------------------------------------
create or replace function public.get_session_mode()
returns text
language sql stable
security definer set search_path = public
as $$
  select coalesce(
    (select value from public.app_settings where key = 'session_mode'),
    'soft'
  );
$$;

grant execute on function public.get_session_mode() to authenticated, anon;

-- ------------------------------------------------------------
-- 3. list_active_sessions(p_user_id)
--    Returns this user's current non-revoked device sessions, newest first.
--    session_id is returned masked (first 8 chars) for display safety.
-- ------------------------------------------------------------
create or replace function public.list_active_sessions(p_user_id uuid)
returns table (
  id bigint,
  device_identifier text,
  is_active boolean,
  last_seen timestamptz,
  created_at timestamptz,
  session_display text,
  current boolean
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  return query
  select
    s.id,
    coalesce(s.device_identifier, ''),
    s.is_active,
    s.last_seen,
    s.created_at,
    left(coalesce(s.device_identifier, s.session_id), 12),
    false
  from public.user_sessions s
  where s.user_id = p_user_id
    and s.is_active = true
  order by s.last_seen desc;
end;
$$;

grant execute on function public.list_active_sessions(uuid) to authenticated;

-- ------------------------------------------------------------
-- 4. register_session_soft(p_user_id, p_session_id, p_device_identifier)
--    SOFT registration: insert-or-touch THIS device/session and NEVER
--    deactivate other devices. Multi-device login just works.
-- ------------------------------------------------------------
create or replace function public.register_session_soft(
  p_user_id uuid,
  p_session_id text,
  p_device_identifier text default ''
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  row_id bigint;
begin
  insert into public.user_sessions (user_id, session_id, device_identifier, is_active, last_seen)
  values (p_user_id, p_session_id, coalesce(p_device_identifier, ''), true, now())
  on conflict (session_id) do update
    set is_active = true, last_seen = now(),
        device_identifier = coalesce(excluded.device_identifier, public.user_sessions.device_identifier)
  returning id into row_id;

  return row_id;
end;
$$;

grant execute on function public.register_session_soft(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 5. register_session(p_user_id, p_session_id, p_device_identifier, p_grace_seconds)
--    STRICT registration: single-active-device with a grace window.
--    During the grace period the previous device is NOT immediately revoked;
--    it is flagged so it can show a "signed in on another device" notice.
--    Only devices whose last_seen is OLDER than the grace window are revoked.
-- ------------------------------------------------------------
create or replace function public.register_session(
  p_user_id uuid,
  p_session_id text,
  p_device_identifier text default '',
  p_grace_seconds integer default 600
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  new_id bigint;
begin
  -- Revoke only devices that have gone quiet for longer than the grace window.
  update public.user_sessions
     set is_active = false, revoked_at = now()
   where user_id = p_user_id
     and is_active = true
     and session_id <> p_session_id
     and last_seen < now() - make_interval(secs => p_grace_seconds);

  -- This device always registers/touches as active.
  insert into public.user_sessions (user_id, session_id, device_identifier, is_active, last_seen)
  values (p_user_id, p_session_id, coalesce(p_device_identifier, ''), true, now())
  on conflict (session_id) do update
    set is_active = true, last_seen = now(),
        device_identifier = coalesce(excluded.device_identifier, public.user_sessions.device_identifier)
  returning id into new_id;

  return new_id;
end;
$$;

grant execute on function public.register_session(uuid, text, text, integer) to authenticated;

-- ------------------------------------------------------------
-- 6. revoke_session(p_user_id, p_session_id, p_device_identifier)
--    Per-device revoke for the soft/admin-revoke flow.
--    Matches by session_id OR by device_identifier so admins/users can revoke
--    a specific device row.
-- ------------------------------------------------------------
drop function if exists public.revoke_session(uuid, text);
create or replace function public.revoke_session(
  p_user_id uuid,
  p_session_id text,
  p_device_identifier text default ''
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.user_sessions
     set is_active = false, revoked_at = now()
   where user_id = p_user_id
     and (
       p_session_id <> '' and session_id = p_session_id
       or (p_session_id = '' and p_device_identifier <> '' and device_identifier = p_device_identifier)
     );
end;
$$;

grant execute on function public.revoke_session(uuid, text, text) to authenticated;

-- ------------------------------------------------------------
-- 7. Keep heartbeat + active check working and granted to clients.
-- ------------------------------------------------------------
create or replace function public.touch_session(
  p_user_id uuid,
  p_session_id text
)
returns void
language sql security definer set search_path = public
as $$
  update public.user_sessions set last_seen = now()
   where user_id = p_user_id and session_id = p_session_id;
$$;

grant execute on function public.touch_session(uuid, text) to authenticated;

create or replace function public.session_is_active(
  p_user_id uuid,
  p_session_id text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select is_active from public.user_sessions
     where user_id = p_user_id and session_id = p_session_id
     order by created_at desc limit 1
  ), false);
$$;

grant execute on function public.session_is_active(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 8. user_sessions insert policy (so SECURITY DEFINER RPCs are not strictly
--    required for owner inserts) and RLS reads for the device list.
-- ------------------------------------------------------------
drop policy if exists "user_sessions_insert_own" on public.user_sessions;
create policy "user_sessions_insert_own"
  on public.user_sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_sessions_delete_own" on public.user_sessions;
create policy "user_sessions_delete_own"
  on public.user_sessions for delete
  using (auth.uid() = user_id);
