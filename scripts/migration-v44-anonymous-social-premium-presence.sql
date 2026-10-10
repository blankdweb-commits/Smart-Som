-- ============================================================
-- Apex Scholars Migration v44 — ANONYMOUS ROOM SOCIAL + PREMIUM + PRESENCE
--
-- FOCUSED change set for the Anonymous room ONLY. Nothing outside the
-- anonymous product surface is touched. Everything is idempotent and safe
-- to re-run against a live database with existing rows.
--
--   1. MESSAGE DECORATORS — anonymous_message_meta holds the optional
--      per-message sticker key and tag key OUTSIDE community_posts so the
--      base table is untouched (fully backward compatible). A message must
--      have content OR a sticker. Tags never change the 5-minute lifetime
--      (v43 trigger still pins expires_at). RLS enabled, no policies.
--
--   2. ENCODED MESSAGES (premium) — anonymous_encoded_messages holds the
--      server-encoded body keyed by post id. The plaintext is never stored
--      on community_posts for an encoded message (content is blanked). The
--      cipher is RECIPIENT-TARGETED: recipient_user_id names the single
--      member the sender encoded to, and only the author or that recipient
--      can ever decode (feed hydration NEVER decodes for other premium
--      viewers — the private body is not pushed into every client). This is
--      honest obfuscation ("Encoded Message"), NOT audited end-to-end
--      encryption. RLS enabled with NO policies => service-role only.
--
--   3. SOCIAL ACTIONS — anonymous_social_actions: one lightweight,
--      ephemeral acknowledgement per (post, actor, action). Cascades away
--      with the message. RLS enabled with NO policies.
--
--   4. SOCIAL PREFERENCES — anonymous_social_prefs lets a member mute a
--      peer (by underlying user id, resolved server-side from an alias) so
--      blocked/ muted users cannot target them. RLS enabled, no policies.
--
--   5. PRESENCE — anonymous_presence tracks a heartbeat per (group, user,
--      session). Online counts use server time only; stale rows are reaped.
--      A member who stays away longer than the inactivity window (default
--      5 minutes) releases their seat on the next reap, while the short
--      reconnect grace keeps their seat across a refresh/socket drop.
--      RLS enabled with NO policies.
--
--   6. PUSH SUBSCRIPTIONS + NOTIFICATION PREFERENCES — push_subscriptions
--      and notification_preferences store per-device Web Push endpoints and
--      per-user, per-kind opt-ins. Room message pushes are TARGETED (a reply
--      author, an @mentioned member, or an Encoded Message's recipient) — a
--      public message never pushes the whole room by default.
--
-- Idempotent. Safe to re-run. Requires v29 + v39 + v41 + v43.
-- Apply: node scripts/run-migration.mjs scripts/migration-v44-anonymous-social-premium-presence.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. MESSAGE DECORATORS (sticker + tag) + encoded flag — side table so the
--    base community_posts schema is untouched (backward compatible).
-- ------------------------------------------------------------
create table if not exists public.anonymous_message_meta (
  post_id uuid primary key references public.community_posts(id) on delete cascade,
  sticker text,
  tag text,
  is_encoded boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.anonymous_message_meta enable row level security;
revoke all on public.anonymous_message_meta from public, anon, authenticated;

-- ------------------------------------------------------------
-- 2. ENCODED MESSAGES (premium) — service-role only.
--    cipher_text is a server-encoded (base64) body. recipient_user_id is the
--    SINGLE member this message was encoded to (NULL for legacy rows) — the
--    decode gate is "author OR recipient", never "any premium viewer".
--    Deleting the post (expiry/wipe) cascades the encoded row away with it.
-- ------------------------------------------------------------
create table if not exists public.anonymous_encoded_messages (
  post_id uuid primary key references public.community_posts(id) on delete cascade,
  cipher_text text not null,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.anonymous_encoded_messages
  add column if not exists recipient_user_id uuid references auth.users(id) on delete cascade;

create index if not exists idx_anonymous_encoded_recipient
  on public.anonymous_encoded_messages(recipient_user_id);

alter table public.anonymous_encoded_messages enable row level security;
revoke all on public.anonymous_encoded_messages from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. SOCIAL ACTIONS — one row per (post, actor, action) caps spam even
--    before the API cooldown. Cascades with the message.
-- ------------------------------------------------------------
create table if not exists public.anonymous_social_actions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.community_posts(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  actor_alias integer,
  action text not null,
  target_alias integer,
  created_at timestamptz not null default now(),
  unique (post_id, actor_id, action)
);

create index if not exists idx_anonymous_social_actions_post
  on public.anonymous_social_actions(post_id);
create index if not exists idx_anonymous_social_actions_actor_created
  on public.anonymous_social_actions(actor_id, created_at desc);

alter table public.anonymous_social_actions enable row level security;
revoke all on public.anonymous_social_actions from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. SOCIAL PREFERENCES — a member's mute/block list (server-only).
-- ------------------------------------------------------------
create table if not exists public.anonymous_social_prefs (
  owner_id uuid not null references auth.users(id) on delete cascade,
  peer_id uuid not null references auth.users(id) on delete cascade,
  blocked boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (owner_id, peer_id)
);

alter table public.anonymous_social_prefs enable row level security;
revoke all on public.anonymous_social_prefs from public, anon, authenticated;

-- ------------------------------------------------------------
-- 5. PRESENCE — server-time heartbeats per (group, user, session).
-- ------------------------------------------------------------
create table if not exists public.anonymous_presence (
  group_id bigint not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  last_seen_at timestamptz not null default now(),
  primary key (group_id, user_id, session_id)
);

create index if not exists idx_anonymous_presence_group_seen
  on public.anonymous_presence(group_id, last_seen_at desc);

alter table public.anonymous_presence enable row level security;
revoke all on public.anonymous_presence from public, anon, authenticated;

-- ------------------------------------------------------------
-- 6a. PUSH SUBSCRIPTIONS (per device) — service-role only.
-- ------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_push_subscriptions_user
  on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

-- ------------------------------------------------------------
-- 6b. NOTIFICATION PREFERENCES (per user) — service-role only.
-- ------------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  room_messages boolean not null default true,
  member_joins boolean not null default true,
  social boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from public, anon, authenticated;

-- ------------------------------------------------------------
-- 7. PRESENCE RPCs (service-role only; called by /api/community).
-- ------------------------------------------------------------

-- Heartbeat: upsert this session's row and return the live online count.
create or replace function public.community_presence_heartbeat(
  p_group bigint,
  p_user uuid,
  p_session text
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare v_online integer;
begin
  if p_group is null or p_user is null or p_session is null or length(p_session) = 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;

  insert into public.anonymous_presence (group_id, user_id, session_id, last_seen_at)
  values (p_group, p_user, left(p_session, 128), now())
  on conflict (group_id, user_id, session_id)
    do update set last_seen_at = now();

  select count(distinct user_id) into v_online
    from public.anonymous_presence
   where group_id = p_group
     and last_seen_at > now() - interval '45 seconds';

  return jsonb_build_object('ok', true, 'online', coalesce(v_online, 0));
end;
$$;

-- Online count only (no write) — used after reap / on demand.
create or replace function public.community_presence_online(
  p_group bigint,
  p_grace integer default 45
)
returns integer
language sql volatile
security definer set search_path = public, pg_temp
as $$
  select count(distinct user_id)::int
    from public.anonymous_presence
   where group_id = p_group
     and last_seen_at > now() - make_interval(secs => greatest(coalesce(p_grace, 45), 5));
$$;

-- Explicit leave: drop every presence row for this user in this room so an
-- official exit never keeps a seat during the reconnect grace.
create or replace function public.community_presence_leave(
  p_group bigint,
  p_user uuid
)
returns void
language sql volatile
security definer set search_path = public, pg_temp
as $$
  delete from public.anonymous_presence
   where group_id = p_group and user_id = p_user;
$$;

-- Reap: delete stale presence rows; release seats for members whose newest
-- presence on ANY session is older than the inactivity window (owner/admin
-- seats are never released here), then run the activation/wipe watchdog.
create or replace function public.community_presence_reap(
  p_group bigint,
  p_grace integer default 45,
  p_inactivity integer default 300
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_grace interval := make_interval(secs => greatest(coalesce(p_grace, 45), 5));
  v_inactive interval := make_interval(secs => greatest(coalesce(p_inactivity, 300), 30));
  v_stale integer := 0;
  v_released integer := 0;
  v_count bigint;
begin
  perform pg_advisory_xact_lock(hashtext('community:presence:' || p_group::text));

  with gone as (
    delete from public.anonymous_presence
     where group_id = p_group
       and last_seen_at <= now() - v_grace
    returning 1
  )
  select count(*) into v_stale from gone;

  select * into v_gr from public.study_groups where id = p_group;
  if v_gr is not null and v_gr.type = 'anonymous' and v_gr.group_state = 'active' then
    with droppable as (
      select m.user_id
        from public.study_group_members m
       where m.group_id = p_group
         and coalesce(m.role, 'member') <> 'owner'
         and not exists (
           select 1 from public.anonymous_presence ap
            where ap.group_id = p_group
              and ap.user_id = m.user_id
              and ap.last_seen_at > now() - v_inactive
         )
    )
    delete from public.study_group_members m
      using droppable d
     where m.group_id = p_group and m.user_id = d.user_id;
    get diagnostics v_released = row_count;

    v_count := public.community_member_count(p_group);
    if v_count < v_gr.minimum_members_to_remain_active then
      perform public.community_anonymous_wipe(p_group);
    end if;
  else
    v_count := public.community_member_count(p_group);
  end if;

  return jsonb_build_object(
    'ok', true,
    'presence_reaped', v_stale,
    'members_released', v_released,
    'member_count', v_count
  );
end;
$$;

-- ------------------------------------------------------------
-- 8. GRANTS — presence + social helpers are service-role only.
-- ------------------------------------------------------------
revoke execute on function public.community_presence_heartbeat(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.community_presence_heartbeat(bigint, uuid, text) to service_role;

revoke execute on function public.community_presence_online(bigint, integer) from public, anon, authenticated;
grant execute on function public.community_presence_online(bigint, integer) to service_role;

revoke execute on function public.community_presence_leave(bigint, uuid) from public, anon, authenticated;
grant execute on function public.community_presence_leave(bigint, uuid) to service_role;

revoke execute on function public.community_presence_reap(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.community_presence_reap(bigint, integer, integer) to service_role;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
