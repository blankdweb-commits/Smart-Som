-- ============================================================
-- migration-v94-notifications-reader.sql
--
-- The `notifications` table was WRITE-ONLY. Nothing ever read it.
--
-- The history: `notify_achievement_unlock` is a trigger on user_achievements
-- that inserts a row for each friend of the unlocker, and `push_notification`
-- inserts arbitrary rows. Both wrote. No client, no RPC, no view ever
-- SELECTed the table - `NotificationBell.jsx` builds its list entirely from
-- live client state (streak, upcoming exams, weak concepts, identity tier).
--
-- So the "your friends unlocked something" notification was generated
-- correctly, stored correctly, and shown to NOBODY. It was fixed in v91 (the
-- trigger fired twice and told the unlocker they had unlocked something), but
-- fixing a notification that nobody sees is not the same as delivering it.
--
-- This migration adds the missing read path, and closes the write hole on the
-- way:
--
--   1. `notifications_all_own` was `FOR ALL` - select, insert, update AND
--      delete, scoped to `auth.uid() = user_id`. A client could therefore
--      write rows into its OWN inbox (forging a notification), rewrite them,
--      or delete them. Same shape of defect as
--      `marketplace_purchases_all_own`, which v92 narrowed. The trigger is
--      SECURITY DEFINER and bypasses RLS, so the inserts it performs are
--      unaffected by narrowing the policy to select-only.
--
--   2. `notifications_list()` - the caller's notifications, newest first,
--      with the actor's name resolved through the SAME pair rule every other
--      social surface uses (`_person_pair_name`), so being notified about
--      someone does not reveal their real name before you have dueled them.
--
--   3. `notifications_mark_read()` - marks the caller's own notifications
--      read. Scoped to auth.uid() so one account cannot clear another's inbox.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v94-notifications-reader.sql
-- ============================================================


-- ###########################################################################
-- 1. NARROW THE POLICY
-- ###########################################################################

drop policy if exists "notifications_all_own" on public.notifications;

drop policy if exists "notifications_read_own" on public.notifications;
create policy "notifications_read_own"
  on public.notifications for select
  using (auth.uid() = user_id);

-- No INSERT / UPDATE / DELETE policy at all.
--   * the trigger is SECURITY DEFINER -> it writes regardless of RLS
--   * `notifications_mark_read()` is SECURITY DEFINER -> it writes regardless
--   * a client can no longer forge, rewrite or delete rows in its own inbox


-- ###########################################################################
-- 2. THE READ PATH
-- ###########################################################################

create or replace function public.notifications_list(
  p_limit  integer default 20,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(least(coalesce(p_limit, 20), 100), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_unread int;
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select count(*) into v_total
    from public.notifications
   where user_id = v_me;

  select count(*) into v_unread
    from public.notifications
   where user_id = v_me and not read;

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id', n.id,
               'kind', n.kind,
               'actorId', n.actor_id,
               -- The pair rule: a pseudonym until the two have dueled. Being
               -- told that someone unlocked something must not hand over their
               -- real name as a side effect.
               'actorName', case
                             when n.actor_id is null then null
                             when n.actor_id = v_me then 'You'
                             else public._person_pair_name(v_me, n.actor_id)
                           end,
               'payload', coalesce(n.payload, '{}'::jsonb),
               'read', n.read,
               'createdAt', n.created_at) as row_obj,
             n.created_at
        from public.notifications n
       where n.user_id = v_me
       limit v_limit offset v_offset
    ) s;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'unread', v_unread,
    'notifications', v_rows
  );
end;
$$;

revoke all on function public.notifications_list(integer, integer) from public, anon;
grant execute on function public.notifications_list(integer, integer) to authenticated, service_role;


-- ###########################################################################
-- 3. MARK READ
-- ###########################################################################

create or replace function public.notifications_mark_read(p_ids bigint[] default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_marked int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  -- p_ids NULL means "all of them". Either way the WHERE clause is pinned to
  -- auth.uid(), so one account can never clear another's inbox.
  if p_ids is null or cardinality(p_ids) = 0 then
    update public.notifications
       set read = true
     where user_id = v_me and not read;
  else
    update public.notifications
       set read = true
     where user_id = v_me and id = any(p_ids) and not read;
  end if;

  get diagnostics v_marked = row_count;

  return jsonb_build_object('ok', true, 'marked', v_marked);
end;
$$;

revoke all on function public.notifications_mark_read(bigint[]) from public, anon;
grant execute on function public.notifications_mark_read(bigint[]) to authenticated, service_role;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
