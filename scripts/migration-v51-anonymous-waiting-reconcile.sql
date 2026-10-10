-- ============================================================
-- migration-v51-anonymous-waiting-reconcile.sql
--
-- FIX: the Anonymous room showed a stale "N/100 members" count when nobody was
-- online. Root cause: `community_membership_reconcile` (v46) only released idle
-- seats inside the `group_state = 'active'` branch, so a `waiting` room never
-- dropped members who had gone offline — the 15-minute inactivity deadline was
-- silently ignored until the room activated.
--
-- This migration:
--   1. Rewrites `community_membership_reconcile` so the release step runs for
--      EVERY non-wiped state (waiting AND active). The active-only extras
--      (idle warnings + the "below minimum to remain" wipe watchdog) stay
--      strictly inside the `active` branch; a waiting room only sheds stale
--      seats (owner-exempt) and never warns or wipes.
--   2. One-time self-heal: deletes already-stale seats in waiting anonymous
--      rooms so the count drops immediately (the reported room can never keep
--      showing 8/100 after this runs).
--   3. Re-asserts the service_role-only grant (and revokes public/anon/
--      authenticated, per this project's default-privilege gotcha).
--
-- Forward-only. Idempotent: safe to re-run. No new columns, tables, or
-- function signatures; the jsonb return shape is unchanged so all callers
-- (api/_community.js) keep working.
-- ============================================================

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
  elsif v_gr.group_state = 'waiting' then
    -- v51 FIX: a waiting room must also shed members who have gone offline.
    -- No idle warnings and no wipe watchdog here — the room is still filling
    -- up, so it simply drops stale seats (owner exempt) so the count is real.
    with dropped as (
      delete from public.study_group_members m
       where m.group_id = p_group
         and coalesce(m.role, 'member') <> 'owner'
         and m.last_activity_at <= now() - make_interval(secs => v_deadline)
      returning 1
    )
    select count(*) into v_released from dropped;

    v_count := public.community_member_count(p_group);
  else
    -- wiped / anything else: nothing to release, just report the live count.
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

-- ------------------------------------------------------------
-- One-time self-heal: drop members already past the inactivity deadline in
-- waiting anonymous rooms (owner exempt). This instantly clears any stale
-- count left over from before this fix.
-- ------------------------------------------------------------
delete from public.study_group_members m
 using public.study_groups g
 where g.id = m.group_id
   and g.type = 'anonymous'
   and g.group_state = 'waiting'
   and coalesce(m.role, 'member') <> 'owner'
   and m.last_activity_at <= now() - make_interval(secs => 900);

-- ------------------------------------------------------------
-- Grants — service-role only.
-- ------------------------------------------------------------
revoke execute on function public.community_membership_reconcile(bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function public.community_membership_reconcile(bigint, integer, integer)
  to service_role;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
