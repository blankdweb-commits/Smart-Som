-- ============================================================
-- Apex Scholars Migration v39 — ANONYMOUS ROOM (chat-first rebuild)
--
-- FOCUSED change set for the Anonymous room ONLY. Nothing outside
-- the anonymous product surface is touched.
--
--   1. community_posts.reply_to_post_id  — direct message replies
--      (threading column; no unrelated Community table changes).
--   2. community_post_reactions          — whitelisted lightweight
--      reactions (👍 😂 ❤️ 🔥 🤔). PRIMARY KEY (post,user,emoji)
--      makes reaction counts un-inflatable: one row per user per
--      emoji, ever. RLS enabled with NO policies => service-role
--      reads/writes only (clients cannot touch counts).
--   3. anonymous_room_identities         — server-generated room
--      pseudonyms (Anonymous #NN). Random 1..9999, unique per room,
--      NEVER derived from email/user id/uuid/pk/time. RLS enabled
--      with NO policies: the alias -> user mapping never leaves the
--      server, so no client can resolve Anonymous #27 back to a
--      real account.
--   4. Room lifecycle thresholds become 10 to activate / 5 to
--      survive, set in ONE place (study_groups server columns).
--      community_anonymous_join/leave/cleanup already read these
--      columns, so activation at 10 and wipe below 5 are enforced
--      by the existing server rules — spectators still do not count
--      (community_member_count only counts study_group_members).
--   5. community_anonymous_wipe() replaced: also shreds the room's
--      alias identities when the round is wiped.
--   6. community_group_feed() replaced: author_id (a Supabase user
--      uuid) is now masked to NULL for anonymous rooms — without
--      this, any room member could map author_id -> display_name via
--      the globally readable community_profiles view.
--   7. RLS read-gate: clients can no longer SELECT anonymous-room
--      rows from community_posts / community_comments /
--      community_post_likes at all. The room reads exclusively via
--      /api/community/anonymous/* (service role). This closes both
--      the direct author_id/user_id SELECT leak and the
--      postgres_changes realtime leak (realtime deliveries are
--      filtered by these same policies). Non-anonymous groups keep
--      their exact v29 read semantics; admins keep read access for
--      moderation.
--
-- Idempotent. Safe to re-run. Requires v29 (anonymous system).
-- Apply: node scripts/run-migration.mjs scripts/migration-v39-anonymous-room.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. MESSAGE REPLIES (anonymous room threading)
-- ------------------------------------------------------------
alter table public.community_posts
  add column if not exists reply_to_post_id uuid references public.community_posts(id) on delete set null;

create index if not exists idx_community_posts_group_created
  on public.community_posts(group_id, created_at desc);

-- ------------------------------------------------------------
-- 2. REACTIONS — whitelist enforced server-side (api/_community.js
--    ROOM_REACTIONS); the PK caps a user at exactly one row per
--    (post, emoji) so rapid toggling can never inflate a count.
-- ------------------------------------------------------------
create table if not exists public.community_post_reactions (
  post_id uuid not null references public.community_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id, emoji)
);

alter table public.community_post_reactions enable row level security;
-- No policies on purpose: reactions are written/read by the service
-- role only (/api/community/anonymous/react).
revoke all on public.community_post_reactions from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. ROOM IDENTITIES — temporary Anonymous #NN pseudonyms.
--    alias is random and room-scoped; unique (group_id, alias) so a
--    room can never hand the same number to two people.
-- ------------------------------------------------------------
create table if not exists public.anonymous_room_identities (
  group_id bigint not null references public.study_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  alias integer not null check (alias between 1 and 9999),
  created_at timestamptz not null default now(),
  primary key (group_id, user_id),
  unique (group_id, alias)
);

alter table public.anonymous_room_identities enable row level security;
-- No policies on purpose: the alias <-> user mapping must never be
-- readable by a client (service role only).
revoke all on public.anonymous_room_identities from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. ROOM THRESHOLDS — the single source of truth for the
--    10-member activation / 5-member survival rules.
--    join / leave / cleanup RPCs (v29) read these columns, so the
--    lifecycle itself is unchanged — only the configured numbers.
-- ------------------------------------------------------------
alter table public.study_groups
  alter column minimum_members_to_activate set default 10;
alter table public.study_groups
  alter column minimum_members_to_remain_active set default 5;

update public.study_groups
   set minimum_members_to_activate = 10,
       minimum_members_to_remain_active = 5,
       member_limit = 10,
       description = 'A private, member-gated room where you can speak freely on everything nursing. '
         || 'It opens once 10 members join and then closes to new members — members speak, '
         || 'anyone can watch with a spectator pass. If membership ever drops below 5 members, '
         || 'the Anonymous room is wiped.',
       updated_at = now()
 where type = 'anonymous';

-- ------------------------------------------------------------
-- 5. WIPE also shreds the round's room identities (verbatim v29
--    wipe + identity cleanup).
-- ------------------------------------------------------------
create or replace function public.community_anonymous_wipe(p_group bigint)
returns void
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare v_gr record;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return;
  end if;

  update public.study_groups
     set group_state = 'wiped', is_active = false, updated_at = now()
   where id = p_group;

  update public.community_posts
     set is_deleted = true, is_hidden = true
   where group_id = p_group and is_deleted = false;

  update public.anonymous_spectators
     set status = 'revoked', revoked_at = now()
   where group_id = p_group and status = 'active';

  -- New in v39: a wiped round never re-opens, so its temporary
  -- identities are destroyed with it (fresh round => fresh aliases).
  delete from public.anonymous_room_identities where group_id = p_group;

  delete from public.study_group_members where group_id = p_group;
end;
$$;

-- ------------------------------------------------------------
-- 6. community_group_feed — mask author_id for anonymous rooms.
--    Every other column/behaviour is byte-for-byte the v29 body
--    (expiry filter, identity masking, ephemeral fields).
-- ------------------------------------------------------------
create or replace function public.community_group_feed(p_group bigint, p_limit integer, p_user uuid)
returns table (
  id uuid,
  author_id uuid,
  content text,
  image_url text,
  group_id bigint,
  created_at timestamptz,
  display_name text,
  avatar_url text,
  year text,
  like_count integer,
  reply_count integer,
  share_count integer,
  liked_by_current_user boolean,
  last_interaction_at timestamptz,
  lives_until timestamptz,
  post_state text
)
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_anon boolean;
begin
  if auth.uid() is not null and auth.uid() <> p_user and not public.is_admin() then
    return;
  end if;
  if not public.community_can_view(p_user, p_group) then
    return;
  end if;
  -- Anonymous rooms mask every author's identity — the board is the point.
  select (g.type = 'anonymous') into v_anon from public.study_groups g where g.id = p_group;
  return query
    select
      p.id,
      case when v_anon then null else p.author_id end,
      p.content, p.image_url, p.group_id, p.created_at,
      case when v_anon then 'Anonymous Member' else cp.display_name end,
      case when v_anon then null else cp.avatar_url end,
      case when v_anon then null else cp.year end,
      (select count(*) from public.community_post_likes l where l.post_id = p.id)::int,
      (select count(*) from public.community_comments c where c.post_id = p.id and not c.is_deleted)::int,
      (select count(*) from public.community_post_shares s where s.post_id = p.id)::int,
      exists (select 1 from public.community_post_likes l2 where l2.post_id = p.id and l2.user_id = p_user),
      p.last_interaction_at,
      public.community_post_lives_until(p),
      case when now() <= coalesce(p.last_interaction_at, p.created_at) + interval '110 seconds'
           then 'active' else 'cold' end
    from public.community_posts p
    left join public.community_profiles cp on cp.id = p.author_id
   where p.group_id = p_group
     and not p.is_deleted
     and not p.is_hidden
     and now() <= public.community_post_lives_until(p)
   order by p.created_at desc
   limit v_limit;
end;
$$;

-- Grants stay exactly as v29 left them (read helpers for clients,
-- lifecycle RPCs service-role only).
grant execute on function public.community_group_feed(bigint, integer, uuid) to authenticated;

-- ------------------------------------------------------------
-- 7. RLS — anonymous-room rows are service-role only.
--    community_post_viewer_allowed() is the single predicate shared
--    by the v29 read policies on community_posts AND
--    community_comments, so making it refuse anonymous groups (for
--    non-admins) hides every anonymous post + comment from client
--    SELECTs and from postgres_changes deliveries in one place.
--    Non-anonymous groups: community_can_view() result unchanged.
-- ------------------------------------------------------------
create or replace function public.community_post_viewer_allowed(p_group bigint)
returns boolean
language sql stable
security definer set search_path = public, pg_temp
as $$
  select public.community_can_view(auth.uid(), p_group)
     and (
       not exists (
         select 1 from public.study_groups sg
          where sg.id = p_group
            and sg.type = 'anonymous'
       )
       or public.is_admin()
     );
$$;

-- The likes policy's `auth.uid() = user_id` self-arm would still
-- expose a member's own like row (and its post_id) for anonymous
-- rooms. This SECURITY DEFINER predicate answers "is this post in an
-- anonymous room" without being subject to community_posts RLS
-- itself (a plain subquery in the policy would fail OPEN, because
-- the same RLS would hide the very row it inspects).
create or replace function public.community_post_in_anonymous_room(p_post uuid)
returns boolean
language sql stable
security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.community_posts p
      join public.study_groups sg on sg.id = p.group_id
     where p.id = p_post
       and sg.type = 'anonymous'
       and not public.is_admin()
  );
$$;

grant execute on function public.community_post_in_anonymous_room(uuid) to anon, authenticated;

-- Restated v29 policy + the anonymous-room guard around the self-arm.
drop policy if exists "likes_read_gated" on public.community_post_likes;
create policy "likes_read_gated"
  on public.community_post_likes for select
  using (
    not public.community_post_in_anonymous_room(post_id)
    and (
      auth.uid() = user_id
      or exists (select 1 from public.community_posts p
                  where p.id = community_post_likes.post_id
                    and now() <= public.community_post_lives_until(p)
                    and public.community_post_viewer_allowed(p.group_id))
    )
  );

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
