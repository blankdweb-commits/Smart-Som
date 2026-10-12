-- ============================================================================
-- v54 — ANONYMOUS FINAL TWEAKS
--   1. 'slap' is replaced by 'punch' everywhere. Old action rows are REWRITTEN
--      to 'punch' so history/hydration shows "Anonymous #N punched …" (the
--      server also maps any leftover 'slap' row to the Punch card defensively,
--      but the DB no longer stores the dead key).
--   2. community_anonymous_join is redeclared to AUTO-LOCK membership the
--      instant a room reaches 20 members (activation + membership_locked in
--      one atomic step). Spectators are unaffected; the host can reopen.
--   3. The canon Anonymous room (id 12) activates at 20 (so the room header
--      reads "opens at 20").
--   4. anonymous_fight config: the reciprocal-fight attack allowlist is now
--      punch/kick/fuckoff/waka (matches the v54 ROOM_ACTIONS attacks; slap
--      was removed alongside the punch rename).
-- Idempotent. service_role-only grants re-asserted (live GRANT GOTCHA).
-- ============================================================================

-- ------------------------------------------------------------
-- 1. slap -> punch
-- ------------------------------------------------------------
update public.anonymous_room_events
   set action = 'punch'
 where action = 'slap';

update public.anonymous_combat_events
   set action = 'punch'
 where action = 'slap';

-- ------------------------------------------------------------
-- 2. community_anonymous_join — auto-lock at 20 members.
--    Same shape as v41/v46 but: once the member count reaches 20 the room is
--    activated (if still waiting) AND membership_locked is set in the same
--    transaction, so the 21st join is refused with MEMBERSHIP_LOCKED.
-- ------------------------------------------------------------
create or replace function public.community_anonymous_join(p_group bigint, p_user uuid)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_role text;
  v_count bigint;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;
  if v_gr.group_state = 'wiped' or v_gr.is_active = false then
    return jsonb_build_object('ok', false, 'code', 'GROUP_WIPED');
  end if;

  v_role := public.community_role_for_group(p_user, p_group);
  if v_role in ('member', 'admin') then
    return jsonb_build_object('ok', true, 'already_member', true,
      'member_count', public.community_member_count(p_group),
      'group_state', v_gr.group_state,
      'membership_locked', v_gr.membership_locked,
      'member_limit', v_gr.member_limit);
  end if;
  if v_role = 'spectator' then
    return jsonb_build_object('ok', false, 'code', 'ALREADY_SPECTATOR',
      'message', 'You already have spectator access to this group. You cannot become a member.');
  end if;

  if exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_banned_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;

  v_count := public.community_member_count(p_group);

  -- The room is OPEN (activated) but its door may be locked or full.
  if v_gr.group_state = 'active' then
    if v_gr.membership_locked then
      return jsonb_build_object('ok', false, 'code', 'MEMBERSHIP_LOCKED',
        'message', 'Membership for this room has been closed. Spectator access is available instead.',
        'member_count', v_count, 'member_limit', v_gr.member_limit,
        'spectator_price', v_gr.spectator_price);
    end if;
  end if;

  if v_count >= v_gr.member_limit then
    return jsonb_build_object('ok', false, 'code', 'GROUP_FULL',
      'message', 'This room is at capacity. Spectator access is available instead.',
      'member_count', v_count, 'member_limit', v_gr.member_limit,
      'spectator_price', v_gr.spectator_price);
  end if;

  insert into public.study_group_members (group_id, user_id, role)
  values (p_group, p_user, 'member')
  on conflict (group_id, user_id) do nothing;

  v_count := public.community_member_count(p_group);
  if v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
    update public.study_groups set group_state = 'active', updated_at = now() where id = p_group;
  end if;
  -- v54 — the room locks the instant it REACHES 20 members (20 is the room's
  -- natural packed state; see step 3). Spectators can still buy a pass while
  -- active. Using equality (not >=) means a host who reopens membership is not
  -- immediately overridden by the next join — the host's unlock persists.
  if v_count = 20 then
    update public.study_groups set membership_locked = true, updated_at = now() where id = p_group;
  end if;

  return jsonb_build_object('ok', true, 'already_member', false, 'member_count', v_count,
    'group_state', (select group_state from public.study_groups where id = p_group),
    'membership_locked', (select membership_locked from public.study_groups where id = p_group),
    'member_limit', v_gr.member_limit);
end;
$$;

-- ------------------------------------------------------------
-- 3. The canon Anonymous room activates at 20 ("opens at 20").
-- ------------------------------------------------------------
update public.study_groups
   set minimum_members_to_activate = 20, updated_at = now()
 where id = 12 and type = 'anonymous';

-- ------------------------------------------------------------
-- 4. anonymous_fight config — the attack allowlist now matches the
--    v54 ROOM_ACTIONS attacks (punch/kick/fuckoff/waka). community_fight_check
--    reads this list to decide which actions count as reciprocal; `slap` must
--    be gone or punches/fuckoff/waka would silently never start a fight.
-- ------------------------------------------------------------
insert into public.server_config (key, value, description) values
  ('anonymous_fight', '{"window_seconds":30,"attack_actions":["punch","kick","fuckoff","waka"]}'::jsonb,
   'Reciprocal fight detection window + attack actions (v54 punch/kick/fuckoff/waka)')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description;

-- ------------------------------------------------------------
-- 5. GRANTS — re-assert service_role-only on the lifecycle RPC.
-- ------------------------------------------------------------
revoke execute on function public.community_anonymous_join(bigint, uuid) from public, anon, authenticated;
grant execute on function public.community_anonymous_join(bigint, uuid) to service_role;