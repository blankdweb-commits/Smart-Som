-- ============================================================
-- Apex Scholars Migration v43 — ANONYMOUS 5-MINUTE MESSAGE LIFETIME
--
-- Scope: the Anonymous room ONLY. Every message (and every reply — a reply
-- is itself a community_post) that belongs to an anonymous group now expires
-- EXACTLY five minutes after created_at, regardless of how much anyone
-- interacts with it. Interaction can no longer extend an anonymous message,
-- and the client cannot override the expiry.
--
--   1. community_posts.expires_at (timestamptz) — the authoritative expiry.
--   2. A BEFORE INSERT OR UPDATE trigger assigns expires_at for any post in
--      an anonymous group: expires_at := created_at + 5 minutes. Because it
--      fires on UPDATE too, a later edit/reaction/vote can never push it out
--      and no code path (client or server) can set a different value.
--   3. community_post_lives_until(post) returns expires_at unchanged when
--      present, otherwise the legacy 1h-idle / created+6h model. So the
--      anonymous 5-minute life is absolute; all other posts are untouched.
--   4. Backfill uses ORIGINAL created_at (created_at + 5 min), so pre-existing
--      anonymous messages are treated as already expired and purged on the
--      next cleanup run — never extended from the migration date.
--   5. community_cleanup(p_now) is now batched + idempotent (advisory-locked)
--      and hard-deletes expired anonymous messages INCLUDING reported ones
--      (they must permanently disappear), while non-anonymous reported posts
--      keep the retain-for-moderation soft-hide behaviour. Deleting a post
--      cascades to comments/likes/reactions/votes and nulls reply previews
--      (reply_to_post_id ... on delete set null) — rooms, accounts and ledgers
--      are never touched.
--
-- Idempotent. Safe to re-run. Requires v29 + v39 + v41 + v42.
-- Apply: node scripts/run-migration.mjs scripts/migration-v43-anonymous-message-lifetime.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Authoritative expiry column
-- ------------------------------------------------------------
alter table public.community_posts
  add column if not exists expires_at timestamptz;

create index if not exists idx_community_posts_expires_at
  on public.community_posts (expires_at)
  where expires_at is not null;

-- ------------------------------------------------------------
-- 2. Trigger — anonymous posts always expire created_at + 5 minutes.
--    Fires on INSERT and UPDATE; read-only lookup of the group type.
-- ------------------------------------------------------------
create or replace function public.community_assign_post_expiry()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_anon boolean := false;
begin
  if new.group_id is not null then
    select (g.type = 'anonymous') into v_anon
      from public.study_groups g
     where g.id = NEW.group_id;
  end if;
  -- Anonymous messages: pin the expiry to created_at + 5 minutes. This runs
  -- on UPDATE as well, so interactions/edits can never extend it.
  if coalesce(v_anon, false) then
    new.expires_at := new.created_at + interval '5 minutes';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_community_posts_assign_expiry on public.community_posts;
create trigger trg_community_posts_assign_expiry
  before insert or update on public.community_posts
  for each row execute function public.community_assign_post_expiry();

-- ------------------------------------------------------------
-- 3. Lives-until: absolute expiry wins; legacy model otherwise.
-- ------------------------------------------------------------
create or replace function public.community_post_lives_until(p public.community_posts)
returns timestamptz
language sql stable
security definer set search_path = public, pg_temp
as $$
  select case
    when p.expires_at is not null then p.expires_at
    else least(
      coalesce(
        p.grace_until,
        coalesce(p.last_interaction_at, p.created_at) + interval '1 hour'
      ),
      p.created_at + interval '6 hours'
    )
  end
$$;

-- ------------------------------------------------------------
-- 5. Backfill anonymous messages from their ORIGINAL creation time.
--    (Runs before the trigger is re-created? No — trigger is already in
--    place above; it simply re-asserts created_at + 5 min on this UPDATE.)
-- ------------------------------------------------------------
update public.community_posts cp
   set expires_at = cp.created_at + interval '5 minutes'
  from public.study_groups g
 where cp.group_id = g.id
   and g.type = 'anonymous'
   and cp.expires_at is null;

-- ------------------------------------------------------------
-- 6. community_cleanup(p_now) — batched, idempotent, race-safe.
--    Anonymous expired posts are ALWAYS hard-deleted (even if reported);
--    non-anonymous reported posts are retained as soft-hidden for moderation.
-- ------------------------------------------------------------
create or replace function public.community_cleanup(p_now timestamptz default null)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_batch integer := 500;
  v_purged bigint := 0;
  v_hidden bigint := 0;
  v_author_purged bigint := 0;
  v_active bigint := 0;
  v_wiped bigint := 0;
  v_gr record;
  v_count bigint;
  v_loop integer;
begin
  perform pg_advisory_xact_lock(hashtext('community:cleanup'));

  -- Author-shredded / moderator-hidden soft-deleted posts: batched hard purge.
  loop
    with expired as (
      select cp.id from public.community_posts cp
       where cp.is_deleted = true
         and v_now > public.community_post_lives_until(cp)
       limit v_batch
    )
    delete from public.community_posts cp using expired e where cp.id = e.id;
    get diagnostics v_loop = row_count;
    v_author_purged := v_author_purged + v_loop;
    exit when v_loop < v_batch;
  end loop;

  -- Non-anonymous reported posts expire by being retained: soft-hide, keep row
  -- for moderators. Anonymous posts (expires_at is not null) are NOT retained.
  loop
    with expired as (
      select cp.id from public.community_posts cp
       where cp.is_deleted = false
         and cp.is_hidden = false
         and cp.expires_at is null
         and v_now > public.community_post_lives_until(cp)
         and exists (select 1 from public.community_reports r where r.post_id = cp.id)
       limit v_batch
    )
    update public.community_posts cp set is_hidden = true
      from expired e where cp.id = e.id;
    get diagnostics v_loop = row_count;
    v_hidden := v_hidden + v_loop;
    exit when v_loop < v_batch;
  end loop;

  -- Everything else past life: hard purge (cascades reactions/votes/comments;
  -- reply_to_post_id is ON DELETE SET NULL so survivor replies lose preview).
  loop
    with expired as (
      select cp.id from public.community_posts cp
       where cp.is_deleted = false
         and v_now > public.community_post_lives_until(cp)
         and (
           cp.expires_at is not null
           or not exists (select 1 from public.community_reports r where r.post_id = cp.id)
         )
       limit v_batch
    )
    delete from public.community_posts cp using expired e where cp.id = e.id;
    get diagnostics v_loop = row_count;
    v_purged := v_purged + v_loop;
    exit when v_loop < v_batch;
  end loop;

  -- Anonymous group watchdog (overlaps join/leave but is race-safe).
  for v_gr in
    select g.* from public.study_groups g
     where g.type = 'anonymous' and g.group_state in ('waiting', 'active')
  loop
    v_count := public.community_member_count(v_gr.id);
    if v_gr.group_state = 'active' and v_count < v_gr.minimum_members_to_remain_active then
      perform public.community_anonymous_wipe(v_gr.id);
      v_wiped := v_wiped + 1;
    elsif v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
      update public.study_groups set group_state = 'active', updated_at = now() where id = v_gr.id;
      v_active := v_active + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'posts_purged', v_purged,
    'posts_hidden_reported', v_hidden,
    'soft_deleted_purged', v_author_purged,
    'groups_activated', v_active,
    'groups_wiped', v_wiped,
    'batch_size', v_batch
  );
end;
$$;

-- ------------------------------------------------------------
-- 7. GRANTS — cleanup + helper stay service-role only (explicit revokes
--    defeat this project's permissive default ACLs).
-- ------------------------------------------------------------
revoke execute on function public.community_cleanup(timestamptz) from public, anon, authenticated;
grant execute on function public.community_cleanup(timestamptz) to service_role;

revoke execute on function public.community_post_lives_until(public.community_posts) from public;
grant execute on function public.community_post_lives_until(public.community_posts) to anon, authenticated;

-- Trigger function is internal (fires from the trigger).
revoke execute on function public.community_assign_post_expiry() from public, anon, authenticated;
grant execute on function public.community_assign_post_expiry() to service_role;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
