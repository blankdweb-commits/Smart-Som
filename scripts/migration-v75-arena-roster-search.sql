-- ============================================================
-- migration-v75-arena-roster-search.sql
--
-- Let a player find a SPECIFIC scholar instead of scrolling the top 30.
--
-- v64's arena_roster returned the 30 highest-priority scholars (available
-- first, then in_match, then offline) and gave the client no way to narrow
-- that. With 54 accounts now, and every row labelled by a distinct name (v74),
-- the list is findable by eye but not searchable.
--
-- WHAT IT MATCHES
--   * identity_name  (what the user chose to be called)
--   * full_name      (so you can find someone by their real name)
--   * the stable handle suffix, i.e. `Scholar-a1b2c3` matches `a1b2c3`
-- All case-insensitive substring matches.
--
-- WHAT IT DELIBERATELY DOES NOT MATCH: **email**. profiles.email is readable
-- cross-user by service role, and matching on it would turn this search box
-- into a user-enumeration oracle ("does an account exist for this address?",
-- "who is this email?"). Do not add it.
--
-- SEARCH INCLUDES OFFLINE SCHOLARS. The unsearched list is priority-ordered
-- and shows whoever is free first; when someone types a name they mean a
-- specific person, so hiding them because they happen to be offline would make
-- the search useless. The Challenge button is still disabled when they are.
--
-- OVERLOAD SAFETY: arena_roster is being replaced with a THIRD parameter. The
-- 2-arg form is DROPPED FIRST, so there is never a moment where both a 2-arg
-- and a 3-arg overload exist and PostgREST answers with PGRST203 "Multiple
-- Choices" (the v58 trap).
-- ============================================================

drop function if exists public.arena_roster(integer, text);

create or replace function public.arena_roster(
  p_stake integer default 0,
  p_format text default 'blitz',
  p_query text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_window int;
  v_players jsonb;
  v_online int := 0;
  -- A 1-character query matches most of the roster, so require 2+ chars before
  -- the filter engages; below that the normal priority list is returned.
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_filter boolean := v_q is not null and char_length(v_q) >= 2;
  v_limit int := case when v_filter then 25 else 30 end;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  -- Browsing the list is itself presence.
  perform public._arena_touch_presence(v_user);

  v_window := coalesce((public._arena_rules() ->> 'presence_window_seconds')::int, 90);

  with rows as (
    select p.id,
           public._person_name(p.id, 'pseudonym') as name,
           coalesce(ap.last_seen_at, p.last_active_date::timestamptz) as seen,
           coalesce(p.smart_coins, 0) as coins,
           (public._arena_in_active_match(p.id) is not null) as busy,
           case
             when coalesce(ap.last_seen_at, p.last_active_date::timestamptz)
                  >= now() - make_interval(secs => v_window)
             then 1 else 0
           end as seen_recently
      from public.profiles p
      left join public.arena_presence ap on ap.user_id = p.id
     where p.id <> v_user
       and p.is_activated
       and (
         not v_filter
         or p.identity_name ilike '%' || v_q || '%'
         or p.full_name ilike '%' || v_q || '%'
         or substr(md5(p.id::text), 1, 6) ilike '%' || v_q || '%'
       )
  ), shaped as (
    select r.id, r.name, r.seen, r.coins, r.busy, r.seen_recently,
           case
             when r.busy then 'in_match'
             when r.seen_recently = 1 then 'available'
             else 'offline'
           end as status
      from rows r
  )
  select
    coalesce(jsonb_agg(obj order by rank, seen desc nulls last), '[]'::jsonb),
    count(*) filter (where status <> 'offline')
    into v_players, v_online
  from (
    select case status when 'available' then 0 when 'in_match' then 1 else 2 end as rank,
           seen,
           status,
           jsonb_build_object(
             'userId', id,
             'name', name,
             'status', status,
             'lastSeenAt', seen,
             'canChallenge', (status = 'available' and coins >= p_stake),
             'stake', p_stake,
             'isBot', false) as obj
      from shaped
     order by case status when 'available' then 0 when 'in_match' then 1 else 2 end,
              seen desc nulls last
     limit v_limit
  ) top;

  return jsonb_build_object('ok', true, 'stake', p_stake, 'format', 'blitz',
                            'online', v_online, 'windowSeconds', v_window,
                            'query', v_q,
                            'searching', v_filter,
                            'players', v_players);
end;
$$;

-- ---------------------------------------------------------------------------
-- ACLs - authenticated only (unchanged from v63/v64). This endpoint enumerates
-- scholars and their SC balances, so anon must stay locked out.
-- ---------------------------------------------------------------------------
revoke all on function public.arena_roster(integer, text, text)
  from public, anon;
grant execute on function public.arena_roster(integer, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================