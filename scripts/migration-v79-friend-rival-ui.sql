-- ============================================================
-- migration-v79-friend-rival-ui.sql
--
-- v77 locked the relationship RPCs down (they were accepting requests from a
-- logged-out caller). What is still missing is the READ side: there was no
-- way for a client to list your friends/rivals, see incoming requests, or search
-- for someone to add - so the whole feature was unreachable.
--
-- This adds exactly two read RPCs and nothing else:
--
--   friend_list()          accepted friends + rivals, and pending requests
--                          (incoming/outgoing) in one call
--   friend_search(p_query) find ACTIVATED scholars by name/handle, excluding
--                          yourself and anyone already related to you
--
-- Both are read-only and revoke'd from anon, consistent with v77. Neither can
-- mutate anything - writes still go through request_relationship /
-- respond_relationship / remove_relationship.
--
-- Naming follows the SAME pair rule as the arena (v78): a real name only once
-- the two have completed a match, a pseudonym otherwise. Adding someone as a
-- friend must not by itself reveal their real name.
--
-- Idempotent. Re-run safe.
-- ============================================================

-- Shared helper so the pair-naming rule exists exactly once.
create or replace function public._person_pair_name(p_viewer uuid, p_other uuid)
returns text
language sql
stable
security definer set search_path = public
as $$
  select case
           when public._arena_pair_dueled(p_viewer, p_other)
             then public._person_name(p_other, 'real')
           else public._person_name(p_other, 'pseudonym')
         end;
$$;

revoke all on function public._person_pair_name(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- friend_list - friends/rivals, and pending requests in both directions.
-- One row per PAIR: the mirror row v77 created on accept is collapsed with
-- DISTINCT ON, preferring an explicit 'friend' over 'rival'.
-- ---------------------------------------------------------------------------
create or replace function public.friend_list()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'friends', coalesce((
      select jsonb_agg(obj order by lower(name))
        from (
          select distinct on (other_user)
                 jsonb_build_object(
                   'userId', other_user,
                   'name', name,
                   'relType', rel_type,
                   'since', responded_at) as obj,
                 other_user, name, rel_type, responded_at
            from (
              select case when r.user_id = v_user then r.target_id else r.user_id end as other_user,
                     r.rel_type,
                     r.responded_at,
                     public._person_pair_name(v_user,
                       case when r.user_id = v_user then r.target_id else r.user_id end) as name
                from public.user_relationships r
               where r.status = 'accepted'
                 and (r.user_id = v_user or r.target_id = v_user)
            ) s
           order by other_user, (rel_type = 'friend') desc, responded_at desc nulls last
        ) t
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(obj order by created_at)
        from (
          select jsonb_build_object(
                   'requestId', i.id,
                   'userId', i.from_user,
                   'name', public._person_pair_name(v_user, i.from_user),
                   'relType', i.rel_type,
                   'createdAt', i.created_at) as obj,
                 i.created_at
            from public.user_relationships i
           where i.status = 'pending' and i.target_id = v_user
        ) t
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(obj order by created_at)
        from (
          select jsonb_build_object(
                   'requestId', i.id,
                   'userId', i.to_user,
                   'name', public._person_pair_name(v_user, i.to_user),
                   'relType', i.rel_type,
                   'createdAt', i.created_at) as obj,
                 i.created_at
            from public.user_relationships i
           where i.status = 'pending' and i.user_id = v_user
        ) t
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- friend_search - activated scholars you are not already related to.
-- Mirrors arena_roster's predicate (and its refusal to match on email).
-- ---------------------------------------------------------------------------
create or replace function public.friend_search(p_query text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'query', v_q,
    'results', coalesce((
      select jsonb_agg(jsonb_build_object(
               'userId', p.id,
               'name', public._person_pair_name(v_user, p.id),
               'hasIdentityName', coalesce(nullif(btrim(p.identity_name), ''), '') <> ''
             ) order by lower(public._person_pair_name(v_user, p.id)))
        from public.profiles p
       where p.id <> v_user
         and p.is_activated
         and (v_q is null
           or p.identity_name ilike '%' || v_q || '%'
           or p.full_name ilike '%' || v_q || '%'
           or substr(md5(p.id::text), 1, 6) ilike '%' || v_q || '%')
         and not exists (
           select 1 from public.user_relationships r
            where (r.user_id = v_user and r.target_id = p.id)
               or (r.target_id = v_user and r.user_id = p.id))
       limit 25
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- ACLs - authenticated only, read-only.
-- ---------------------------------------------------------------------------
revoke all on function public.friend_list() from public, anon;
revoke all on function public.friend_search(text) from public, anon;
grant execute on function public.friend_list() to authenticated, service_role;
grant execute on function public.friend_search(text) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================