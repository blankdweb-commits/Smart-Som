-- ============================================================
-- Apex Scholars Migration v46 — ANONYMOUS ROOM CORRECTIONS
--
-- FOCUSED change set for the Anonymous room ONLY. Nothing outside the
-- anonymous product surface is touched. Forward-only, idempotent, safe to
-- re-run against a live database with existing rows.
--
--   1. CENTRAL CONFIG (server_config) — one authoritative jsonb row per
--      tunable. Every SQL rule below reads its numbers from here (with a
--      hard-coded fallback) so thresholds are changed in ONE place.
--
--   2. MESSAGE LIFETIME 5 -> 10 MINUTES + VOTE ADJUSTMENTS.
--      The base life is now created_at + 10 minutes, pinned once on insert
--      onto community_posts.base_expires_at. A message that reaches
--      >= 7 net UP votes gains +3 minutes ONCE; a message that reaches
--      >= 10 net DOWN votes loses 3 minutes ONCE. Adjustments are applied
--      ATOMICALLY by community_apply_vote_expiry() (advisory-locked,
--      per-message idempotent flags) and an expired message is NEVER
--      revived. Interaction still cannot extend a message (the BEFORE
--      INSERT OR UPDATE trigger recomputes expires_at from the frozen
--      base + the two once-only adjustment flags).
--
--   3. COMBAT / FIGHT DETECTION. anonymous_combat_events records every
--      attack (slap/kick). community_fight_check() detects a RECIPROCAL
--      attack inside a 30-second window and records ONE fight per pair
--      per window (deduped), so a slap-fest cannot spam the room.
--
--   4. MEMBERSHIP ACTIVITY SEPARATE FROM PRESENCE. study_group_members
--      gains last_activity_at + warning_sent_at. community_membership_touch()
--      stamps real engagement; community_membership_reconcile() releases
--      seats idle past the activity deadline (default 15 min), flags members
--      due a 10-minute warning, and re-runs the wipe watchdog. Presence
--      (online heartbeat) stays its own system.
--
--   5. ATOMIC FIRST-VISITOR ROOM CREATION + FRESH COUNTS.
--      community_ensure_anonymous_room() opens exactly ONE non-wiped
--      Anonymous room when none exists, under a global advisory lock, with
--      the caller as owner + member #1. Handlers call it on room bootstrap
--      so counts are reconciled before they are shown (stale-count fix).
--
-- Idempotent. Safe to re-run. Requires v29 + v39 + v41 + v42 + v43 + v44.
-- Apply: node scripts/_apply-v43.mjs scripts/migration-v46-anonymous-room-corrections.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. CENTRAL CONFIG
-- ------------------------------------------------------------
create table if not exists public.server_config (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now()
);

alter table public.server_config enable row level security;
revoke all on public.server_config from public, anon, authenticated;

insert into public.server_config (key, value, description) values
  ('anonymous_message', '{"base_lifetime_seconds":600,"upvote_threshold":7,"downvote_threshold":10,"vote_adjust_seconds":180}'::jsonb,
   'Anonymous message lifetime + vote adjustment thresholds'),
  ('anonymous_membership', '{"activity_deadline_seconds":900,"warning_seconds":600,"presence_grace_seconds":45}'::jsonb,
   'Anonymous membership activity deadline + warning lead time'),
  ('anonymous_fight', '{"window_seconds":30,"attack_actions":["slap","kick"]}'::jsonb,
   'Reciprocal fight detection window + attack actions'),
  ('anonymous_social', '{"cooldown_seconds":8}'::jsonb,
   'Room-wide social action cooldown per actor')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = now();

-- Read one config value (service-role only). Never throws on a missing key.
create or replace function public.server_config_get(p_key text)
returns jsonb
language sql stable
security definer set search_path = public, pg_temp
as $$
  select value from public.server_config where key = p_key;
$$;

-- ------------------------------------------------------------
-- 2. MESSAGE LIFETIME 10 MIN + VOTE ADJUSTMENTS
-- ------------------------------------------------------------
alter table public.community_posts
  add column if not exists base_expires_at timestamptz;
alter table public.community_posts
  add column if not exists upvote_adjust_applied boolean not null default false;
alter table public.community_posts
  add column if not exists downvote_adjust_applied boolean not null default false;

-- Base expiry is frozen on insert; expires_at is always base + the two
-- once-only adjustments. Fires on UPDATE too, so nothing can silently move
-- the base or the flags.
create or replace function public.community_assign_post_expiry()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_anon boolean := false;
  v_cfg jsonb;
  v_base_secs integer;
  v_adj integer;
begin
  if new.group_id is not null then
    select (g.type = 'anonymous') into v_anon
      from public.study_groups g
     where g.id = NEW.group_id;
  end if;
  if not coalesce(v_anon, false) then
    return new;
  end if;

  v_cfg := coalesce(public.server_config_get('anonymous_message'), '{}'::jsonb);
  v_base_secs := coalesce((v_cfg->>'base_lifetime_seconds')::int, 600);
  v_adj := coalesce((v_cfg->>'vote_adjust_seconds')::int, 180);

  if new.base_expires_at is null then
    new.base_expires_at := new.created_at + make_interval(secs => v_base_secs);
  end if;

  new.expires_at := new.base_expires_at
    + case when coalesce(new.upvote_adjust_applied, false) then make_interval(secs => v_adj) else interval '0' end
    - case when coalesce(new.downvote_adjust_applied, false) then make_interval(secs => v_adj) else interval '0' end;
  return new;
end;
$$;

drop trigger if exists trg_community_posts_assign_expiry on public.community_posts;
create trigger trg_community_posts_assign_expiry
  before insert or update on public.community_posts
  for each row execute function public.community_assign_post_expiry();

-- Backfill existing anonymous posts from their ORIGINAL creation time onto the
-- new base (10 min). Idempotent: only rows still missing a base.
update public.community_posts cp
   set base_expires_at = cp.created_at + make_interval(secs => coalesce((public.server_config_get('anonymous_message')->>'base_lifetime_seconds')::int, 600))
  from public.study_groups g
 where cp.group_id = g.id
   and g.type = 'anonymous'
   and cp.base_expires_at is null;

-- Apply the (once-only) vote adjustments for one message, atomically.
-- Returns the resulting expires_at (or null when not an anonymous message).
create or replace function public.community_apply_vote_expiry(p_post uuid)
returns timestamptz
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_post record;
  v_cfg jsonb;
  v_up_threshold integer;
  v_down_threshold integer;
  v_up integer;
  v_down integer;
  v_exp timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('community:vote-expiry:' || p_post::text));

  select * into v_post from public.community_posts where id = p_post for update;
  if v_post is null or v_post.expires_at is null then
    return null;
  end if;
  -- NEVER revive an already-expired message.
  if v_post.expires_at <= now() then
    return v_post.expires_at;
  end if;

  v_cfg := coalesce(public.server_config_get('anonymous_message'), '{}'::jsonb);
  v_up_threshold := coalesce((v_cfg->>'upvote_threshold')::int, 7);
  v_down_threshold := coalesce((v_cfg->>'downvote_threshold')::int, 10);

  select count(*) filter (where value = 1), count(*) filter (where value = -1)
    into v_up, v_down
    from public.community_post_votes
   where post_id = p_post;

  if coalesce(v_up, 0) >= v_up_threshold and not coalesce(v_post.upvote_adjust_applied, false) then
    update public.community_posts set upvote_adjust_applied = true where id = p_post;
  end if;
  if coalesce(v_down, 0) >= v_down_threshold and not coalesce(v_post.downvote_adjust_applied, false) then
    update public.community_posts set downvote_adjust_applied = true where id = p_post;
  end if;

  select expires_at into v_exp from public.community_posts where id = p_post;
  return v_exp;
end;
$$;

-- ------------------------------------------------------------
-- 3. COMBAT / FIGHT DETECTION
-- ------------------------------------------------------------
create table if not exists public.anonymous_combat_events (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_anonymous_combat_group_created
  on public.anonymous_combat_events(group_id, created_at desc);
create index if not exists idx_anonymous_combat_pair
  on public.anonymous_combat_events(group_id, actor_id, target_id, created_at desc);
alter table public.anonymous_combat_events enable row level security;
revoke all on public.anonymous_combat_events from public, anon, authenticated;

create table if not exists public.anonymous_fights (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  a_id uuid not null references auth.users(id) on delete cascade,
  b_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now()
);
create index if not exists idx_anonymous_fights_group_started
  on public.anonymous_fights(group_id, started_at desc);
alter table public.anonymous_fights enable row level security;
revoke all on public.anonymous_fights from public, anon, authenticated;

-- Record an attack and detect a reciprocal one within the window. Deduped so
-- one pair triggers at most ONE fight per window. service-role only.
create or replace function public.community_fight_check(
  p_group bigint,
  p_actor uuid,
  p_target uuid,
  p_action text
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_cfg jsonb;
  v_window integer;
  v_attacks text[];
  v_lo uuid;
  v_hi uuid;
  v_reciprocal boolean := false;
  v_existing boolean := false;
begin
  if p_group is null or p_actor is null or p_target is null or p_actor = p_target then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;

  v_cfg := coalesce(public.server_config_get('anonymous_fight'), '{}'::jsonb);
  v_window := coalesce((v_cfg->>'window_seconds')::int, 30);
  v_attacks := coalesce(
    (select array_agg(x) from jsonb_array_elements_text(coalesce(v_cfg->'attack_actions', '["slap","kick"]'::jsonb)) as x),
    array['slap','kick']
  );

  -- Only attacks are recorded / can start a fight.
  if not (p_action = any(v_attacks)) then
    return jsonb_build_object('ok', true, 'fight', false, 'recorded', false);
  end if;

  insert into public.anonymous_combat_events (group_id, actor_id, target_id, action)
  values (p_group, p_actor, p_target, left(p_action, 32));

  select exists (
    select 1 from public.anonymous_combat_events e
     where e.group_id = p_group
       and e.actor_id = p_target
       and e.target_id = p_actor
       and e.action = any(v_attacks)
       and e.created_at > now() - make_interval(secs => v_window)
  ) into v_reciprocal;

  if not v_reciprocal then
    return jsonb_build_object('ok', true, 'fight', false, 'recorded', true);
  end if;

  -- Normalise the pair; record the fight at most once per window.
  v_lo := least(p_actor, p_target);
  v_hi := greatest(p_actor, p_target);

  select exists (
    select 1 from public.anonymous_fights f
     where f.group_id = p_group
       and f.a_id = v_lo
       and f.b_id = v_hi
       and f.started_at > now() - make_interval(secs => v_window)
  ) into v_existing;

  if v_existing then
    return jsonb_build_object('ok', true, 'fight', true, 'deduped', true, 'recorded', true);
  end if;

  insert into public.anonymous_fights (group_id, a_id, b_id) values (p_group, v_lo, v_hi);
  return jsonb_build_object('ok', true, 'fight', true, 'deduped', false, 'recorded', true);
end;
$$;

-- ------------------------------------------------------------
-- 4. MEMBERSHIP ACTIVITY (separate from presence)
-- ------------------------------------------------------------
alter table public.study_group_members
  add column if not exists last_activity_at timestamptz not null default now();
alter table public.study_group_members
  add column if not exists warning_sent_at timestamptz;

-- Backfill so no existing member is released immediately after this migration.
update public.study_group_members
   set last_activity_at = now()
 where last_activity_at is null;

-- Stamp real engagement for this member (called on send/reply/react/vote/social
-- and on an explicit room bootstrap).
create or replace function public.community_membership_touch(p_group bigint, p_user uuid)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare v_count bigint;
begin
  update public.study_group_members
     set last_activity_at = now(),
         warning_sent_at = null
   where group_id = p_group and user_id = p_user;
  select public.community_member_count(p_group) into v_count;
  return jsonb_build_object('ok', true, 'member_count', v_count);
end;
$$;

-- Release seats idle past the deadline, flag members due a warning, then run the
-- wipe watchdog. Owner seats are never released. Presence rows are untouched.
create or replace function public.community_membership_reconcile(
  p_group bigint,
  p_deadline integer default null,
  p_warning integer default null
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_cfg jsonb;
  v_deadline integer;
  v_warning integer;
  v_released integer := 0;
  v_warned jsonb := '[]'::jsonb;
  v_count bigint;
  v_wipe boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('community:membership:' || p_group::text));

  v_cfg := coalesce(public.server_config_get('anonymous_membership'), '{}'::jsonb);
  v_deadline := coalesce(p_deadline, (v_cfg->>'activity_deadline_seconds')::int, 900);
  v_warning := coalesce(p_warning, (v_cfg->>'warning_seconds')::int, 600);

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null or v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;

  if v_gr.group_state = 'active' then
    -- Members due a warning (idle >= warning seconds, still within the deadline).
    select coalesce(jsonb_agg(distinct m.user_id), '[]'::jsonb) into v_warned
      from public.study_group_members m
     where m.group_id = p_group
       and coalesce(m.role, 'member') <> 'owner'
       and m.last_activity_at <= now() - make_interval(secs => v_warning)
       and m.last_activity_at > now() - make_interval(secs => v_deadline)
       and (m.warning_sent_at is null or m.warning_sent_at < m.last_activity_at);

    -- Stamp the warning so it is delivered once per idle streak.
    update public.study_group_members m
       set warning_sent_at = now()
     where m.group_id = p_group
       and coalesce(m.role, 'member') <> 'owner'
       and m.last_activity_at <= now() - make_interval(secs => v_warning)
       and m.last_activity_at > now() - make_interval(secs => v_deadline)
       and (m.warning_sent_at is null or m.warning_sent_at < m.last_activity_at);

    -- Members idle past the deadline lose their seat (owner exempt).
    with dropped as (
      delete from public.study_group_members m
       where m.group_id = p_group
         and coalesce(m.role, 'member') <> 'owner'
         and m.last_activity_at <= now() - make_interval(secs => v_deadline)
      returning 1
    )
    select count(*) into v_released from dropped;

    v_count := public.community_member_count(p_group);
    if v_count < v_gr.minimum_members_to_remain_active then
      perform public.community_anonymous_wipe(p_group);
      v_wipe := true;
    end if;
  else
    v_count := public.community_member_count(p_group);
  end if;

  return jsonb_build_object(
    'ok', true,
    'member_count', v_count,
    'released', v_released,
    'warned', v_warned,
    'wipe', v_wipe
  );
end;
$$;

-- Presence reap is now presence-ONLY (seat release is owned by
-- community_membership_reconcile). Same 3-arg signature kept for callers.
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
  v_grace interval := make_interval(secs => greatest(coalesce(p_grace, 45), 5));
  v_stale integer := 0;
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

  v_count := public.community_member_count(p_group);
  return jsonb_build_object('ok', true, 'presence_reaped', v_stale, 'member_count', v_count);
end;
$$;

-- ------------------------------------------------------------
-- 5. ATOMIC FIRST-VISITOR ROOM CREATION
-- ------------------------------------------------------------
-- Opens exactly ONE non-wiped Anonymous room when none exists, under a global
-- advisory lock; the caller becomes owner + member #1. Returns the room id.
create or replace function public.community_ensure_anonymous_room(
  p_user uuid,
  p_name text default null
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_name text;
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID');
  end if;

  perform pg_advisory_xact_lock(hashtext('community:anon:ensure'));

  select g.id into v_id
    from public.study_groups g
   where g.type = 'anonymous'
     and g.group_state <> 'wiped'
     and g.is_active = true
   order by g.id asc
   limit 1;

  if v_id is not null then
    return jsonb_build_object('ok', true, 'created', false, 'group_id', v_id);
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    v_name := 'Anonymous Nursing Room ' || upper(substr(md5(random()::text), 1, 4));
  end if;

  insert into public.study_groups (name, description, creator_id, type, privacy, group_state)
  values (
    left(v_name, 120),
    'A private, member-gated room where you can speak freely on everything nursing. '
      || 'It opens once 10 members join and then closes to new members. If membership '
      || 'ever drops below 5 members, the Anonymous room is wiped.',
    p_user, 'anonymous', 'restricted', 'waiting'
  )
  returning id into v_id;

  insert into public.study_group_members (group_id, user_id, role)
  values (v_id, p_user, 'owner')
  on conflict (group_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'created', true, 'group_id', v_id);
end;
$$;

-- ------------------------------------------------------------
-- 6. GRANTS — all new helpers are service-role only.
-- ------------------------------------------------------------
revoke execute on function public.server_config_get(text) from public, anon, authenticated;
grant execute on function public.server_config_get(text) to service_role;

revoke execute on function public.community_apply_vote_expiry(uuid) from public, anon, authenticated;
grant execute on function public.community_apply_vote_expiry(uuid) to service_role;

revoke execute on function public.community_fight_check(bigint, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.community_fight_check(bigint, uuid, uuid, text) to service_role;

revoke execute on function public.community_membership_touch(bigint, uuid) from public, anon, authenticated;
grant execute on function public.community_membership_touch(bigint, uuid) to service_role;

revoke execute on function public.community_membership_reconcile(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.community_membership_reconcile(bigint, integer, integer) to service_role;

revoke execute on function public.community_ensure_anonymous_room(uuid, text) from public, anon, authenticated;
grant execute on function public.community_ensure_anonymous_room(uuid, text) to service_role;

revoke execute on function public.community_presence_reap(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.community_presence_reap(bigint, integer, integer) to service_role;

revoke execute on function public.community_assign_post_expiry() from public, anon, authenticated;
grant execute on function public.community_assign_post_expiry() to service_role;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
