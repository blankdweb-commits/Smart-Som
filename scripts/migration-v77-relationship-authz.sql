-- ============================================================
-- migration-v77-relationship-authz.sql
--
-- Closes a CONFIRMED authorization bypass, and closes the achievement leak.
--
-- ---------------------------------------------------------------------------
-- 1. THE BYPASS (proved live, not theoretical)
-- ---------------------------------------------------------------------------
-- `respond_relationship(p_rel_id, p_accept)` guarded the caller with:
--
--     if rel is null or rel.target_id <> auth.uid() then
--       return error;
--     end if;
--
-- For an UNAUTHENTICATED caller `auth.uid()` is NULL, so
-- `rel.target_id <> NULL` evaluates to NULL - not TRUE. The IF condition
-- becomes `false or NULL` = NULL, which PL/pgSQL treats as "not taken", so the
-- guard was skipped entirely and the function ran to completion.
--
-- Proved against the live database: a client holding only the publishable anon
-- key, with no account and no session, called respond_relationship and the
-- pending request flipped:
--
--     seeded pending request: {"id":1,"status":"pending"}
--     ANON respond -> {"ok":true}
--     row after the anon call: [{"status":"accepted"}]
--
-- So anyone on the internet could accept - or decline and delete - any pending
-- friend/rival request in the system, forging mutual relationships.
--
-- THE FIX is not just "revoke from anon": SECURITY DEFINER functions still run
-- for an authenticated user whose uid does not match, and the same NULL trap
-- would reopen if auth.uid() ever returned NULL again. Every function below
-- now tests `auth.uid() is null` FIRST and uses an explicit, NULL-safe
-- comparison for the ownership check.
--
-- `request_relationship` and `remove_relationship` did not have a working
-- guard either - they happened to fail safely (NOT NULL violation / silent
-- no-op) rather than by design. They get the same explicit guard.
--
-- ---------------------------------------------------------------------------
-- 2. THE ACHIEVEMENT LEAK
-- ---------------------------------------------------------------------------
-- `get_user_achievements(p_user uuid)` is SECURITY DEFINER and took an
-- arbitrary user id, so anyone could read anyone else's unlocked achievement
-- history. It now only answers for the caller. It has no client caller today,
-- so this changes no UI.
-- ============================================================

-- ---------------------------------------------------------------------------
-- request_relationship
-- ---------------------------------------------------------------------------
create or replace function public.request_relationship(p_target uuid, p_type text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  new_id bigint;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_target is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  if p_target = v_me then
    return jsonb_build_object('ok', false, 'error', 'cannot_add_self');
  end if;
  if exists (select 1 from public.user_relationships r
              where (r.user_id = v_me and r.target_id = p_target)
                 or (r.target_id = v_me and r.user_id = p_target)) then
    return jsonb_build_object('ok', false, 'error', 'already_related');
  end if;
  insert into public.user_relationships (user_id, target_id, rel_type, status)
  values (v_me, p_target, coalesce(p_type, 'friend'), 'pending')
  on conflict (user_id, target_id)
    do update set rel_type = excluded.rel_type, responded_at = null, status = 'pending'
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- respond_relationship  <- the bypass
-- ---------------------------------------------------------------------------
create or replace function public.respond_relationship(p_rel_id bigint, p_accept boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  rel public.user_relationships;
begin
  -- MUST come before any ownership comparison: with auth.uid() NULL,
  -- `rel.target_id <> auth.uid()` is NULL and the old guard was skipped.
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  select * into rel from public.user_relationships where id = p_rel_id;
  if rel is null or rel.target_id is null or rel.target_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_not_target');
  end if;

  if p_accept then
    update public.user_relationships
       set status = 'accepted', responded_at = now()
     where id = p_rel_id;
    -- Mirror row so both directions resolve.
    insert into public.user_relationships (user_id, target_id, rel_type, status, responded_at)
    values (rel.target_id, rel.user_id, rel.rel_type, 'accepted', now())
    on conflict (user_id, target_id)
      do update set status = 'accepted', rel_type = excluded.rel_type, responded_at = now();
    return jsonb_build_object('ok', true);
  else
    delete from public.user_relationships where id = p_rel_id;
    return jsonb_build_object('ok', true, 'rejected', true);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- remove_relationship
-- ---------------------------------------------------------------------------
create or replace function public.remove_relationship(p_other uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or p_other is null then
    return;
  end if;
  delete from public.user_relationships r
   where (r.user_id = v_me and r.target_id = p_other)
      or (r.target_id = v_me and r.user_id = p_other);
end;
$$;

-- ---------------------------------------------------------------------------
-- get_user_achievements  <- self only
-- ---------------------------------------------------------------------------
create or replace function public.get_user_achievements(p_user uuid)
returns setof achievements
language plpgsql
security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;
  if p_user is null or p_user <> auth.uid() then
    raise exception 'not your achievements' using errcode = '42501';
  end if;
  return query
    select a.*
      from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id
     where ua.user_id = p_user
     order by ua.unlocked_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- ACLs. This project's default privileges auto-grant anon + authenticated to
-- every new function, so the revokes are explicit and mandatory.
-- ---------------------------------------------------------------------------
revoke all on function public.request_relationship(uuid, text) from public, anon;
revoke all on function public.respond_relationship(bigint, boolean) from public, anon;
revoke all on function public.remove_relationship(uuid) from public, anon;
revoke all on function public.get_user_achievements(uuid) from public, anon;

grant execute on function public.request_relationship(uuid, text) to authenticated, service_role;
grant execute on function public.respond_relationship(bigint, boolean) to authenticated, service_role;
grant execute on function public.remove_relationship(uuid) to authenticated, service_role;
grant execute on function public.get_user_achievements(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================