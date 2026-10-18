-- ============================================================
-- v88 - HOST LEAVE DELETES THE ANONYMOUS ROOM (atomic, posts-first)
-- ============================================================
--
-- WHY: operator decision. When the host of an Anonymous room leaves, the room is
-- deleted outright rather than left orphaned. Previously community_anonymous_leave
-- refused with OWNER_CANNOT_LEAVE, which surfaced to the user as a bare HTTP 400.
--
-- ---------------------------------------------------------------------------
-- THE ORDERING IS THE WHOLE SAFETY PROPERTY. DO NOT REORDER THESE DELETES.
-- ---------------------------------------------------------------------------
-- community_posts.group_id is `on delete set null` (migration-v4c, verified live:
-- pg_constraint.confdeltype = 'n' for community_posts and quiz_results, 'c' for
-- the other ten children). The public community_feed view is
--
--   where not p.is_deleted and not p.is_hidden
--     and now() <= community_post_lives_until(p)
--     and (p.group_id is null
--          or not exists (select 1 from study_groups ag
--                          where ag.id = p.group_id and ag.type = 'anonymous'))
--
--   -- migration-v29-community-ephemeral-anonymous.sql, granted to anon+authenticated
--
-- So deleting the study_groups row FIRST nulls every post's group_id, which makes
-- the `p.group_id is null` branch true, which PUBLISHES every message ever sent
-- in that anonymous room into the logged-out public feed with the author's
-- community_profiles.display_name attached. That is not an orphan-row cleanup
-- issue, it is a confidentiality breach of the room's entire history.
--
-- Deleting the posts FIRST makes the room empty and only then removes the room.
-- Every other anon table is `on delete cascade` off study_groups and disappears
-- automatically - verified live, these are the ten:
--   anonymous_combat_events, anonymous_duels, anonymous_fights,
--   anonymous_membership_gifts, anonymous_memberships, anonymous_presence,
--   anonymous_room_events (-> anonymous_event_reactions),
--   anonymous_room_identities, anonymous_spectators, study_group_members
-- and deleting the posts cascades a further set off community_posts:
--   anonymous_message_meta, anonymous_encoded_messages, anonymous_social_actions,
-- plus community_post_likes / comments / votes / reactions.
--
-- Deliberately NOT deleted: quiz_results rows for the group. That column is also
-- set-null, so it detaches harmlessly, and the rows are the member's own graded
-- history. Deleting a user's quiz results is not this function's decision.
--
-- Deliberately NOT deleted: anonymous_room_member_prefs ("declining
-- interactions") and anonymous_social_prefs (mute/block). Neither has a group_id
-- - they are keyed on owner_id alone and are user-wide, so a room delete must
-- leave them intact.
-- ============================================================

create or replace function public.anonymous_room_delete_host(
  p_group bigint,
  p_user  uuid
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_group public.study_groups;
  v_post_count integer := 0;
begin
  if p_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_group is null then
    raise exception 'INVALID_GROUP' using errcode = '22023';
  end if;

  -- Serialise concurrent host deletes / leave attempts on this one group.
  perform pg_advisory_xact_lock(hashtext('anon_room_delete:' || p_group::text));

  select * into v_group from public.study_groups where id = p_group;
  if not found then
    return jsonb_build_object('ok', true, 'deleted', true, 'already_gone', true);
  end if;
  if v_group.type <> 'anonymous' then
    raise exception 'NOT_ANONYMOUS' using errcode = '22023';
  end if;

  -- Host test mirrors the two ways ownership is recorded: the creator column
  -- set at creation, and the membership row created alongside it. Either is
  -- sufficient; a member with no ownership marker is NOT the host.
  if v_group.creator_id is distinct from p_user
     and not exists (
       select 1 from public.study_group_members m
       where m.group_id = p_group
         and m.user_id  = p_user
         and m.role     = 'owner'
     ) then
    raise exception 'OWNER_CANNOT_LEAVE' using errcode = '22023';
  end if;

  -- 1. POSTS FIRST. See the header. This is the step that must never be
  --    skipped, deferred, or moved below the group delete.
  select count(*) into v_post_count
    from public.community_posts where group_id = p_group;

  delete from public.community_posts where group_id = p_group;

  -- 2. Detach quiz results rather than destroying them.
  update public.quiz_results set group_id = null where group_id = p_group;

  -- 3. Now the room. Everything still attached cascades.
  delete from public.study_groups where id = p_group;

  -- 4. The host's own visit key, so a re-join mints a FRESH alias rather than
  --    reusing this tab's pseudonym. Non-fatal by design.
  begin
    delete from public.anonymous_room_identities
     where group_id = p_group and user_id = p_user;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'deleted', true,
    'group_id', p_group,
    'posts_deleted', v_post_count
  );
end;
$$;

-- Service-role ONLY. This deletes data; it must never be callable from a client.
revoke all on function public.anonymous_room_delete_host(bigint, uuid) from public, anon, authenticated;
grant  execute on function public.anonymous_room_delete_host(bigint, uuid) to service_role;

-- PostgREST cache refresh so the new function is callable.
notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe (create or replace + revoke/grant are idempotent).
-- ============================================================