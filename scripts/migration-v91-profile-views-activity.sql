-- ============================================================
-- migration-v91-profile-views-activity.sql
--
-- Two surfaces the social hub was missing: a record of who has looked at your
-- profile, and a feed of what the people you know have unlocked.
--
-- ---------------------------------------------------------------------------
-- 1. PROFILE VIEWS - TWO INDEPENDENT OPT-INS, BOTH DEFAULT OFF
-- ---------------------------------------------------------------------------
-- `show_profile_views` (owned by the profile): may anyone record that they
-- opened my profile at all? Default FALSE.
--
-- `share_visitor_identity` (owned by the viewer): may the person whose
-- profile I opened be told WHO it was? Default FALSE.
--
-- These are genuinely two different consents and collapsing them would be
-- wrong in both directions. Turning views on does NOT oblige you to appear in
-- other people's view lists - that is the second switch, and it is yours. And
-- a visitor who has not opted in still counts toward your total; the owner
-- sees "a scholar viewed your profile" with no name attached. Turning the
-- receiver's switch OFF stops recording entirely, so there is no shadow count
-- of people who declined to be counted.
--
-- Nothing is recorded for anyone who has not opted in, in either direction,
-- because the table is only ever written through profile_view_record(), which
-- enforces both. There is no backfill and no seeded history: a fresh table
-- with an empty history is the truthful state.
--
-- ---------------------------------------------------------------------------
-- 2. WHOLE-TABLE LOCKDOWN
-- ---------------------------------------------------------------------------
-- profile_views gets RLS enabled and ZERO policies - service role only. A
-- per-row policy here would still let a client run `select * from
-- profile_views` and enumerate exactly who has been looking at whom, which is
-- the one thing this feature must never leak. Every read and write goes
-- through a definer RPC that re-checks consent at call time.
--
-- ---------------------------------------------------------------------------
-- 3. THE ACTIVITY FEED
-- ---------------------------------------------------------------------------
-- Built from user_achievements joined to my accepted relationships. Names go
-- through _person_pair_name, so being someone's friend does NOT reveal their
-- real name - that stays reserved for people you have actually dueled, the
-- same rule every other social surface uses.
--
-- ---------------------------------------------------------------------------
-- 4. A TRIGGER BUG THIS FOUNDED
-- ---------------------------------------------------------------------------
-- notify_achievement_unlock iterated relationship ROWS. Because
-- respond_relationship used to write a mirrored pair (A->B AND B->A), the loop
-- ran twice for one unlock: once correctly notifying B, and once notifying A
-- that they had unlocked an achievement - with B as the actor. Since v89 there
-- is one row per pair, so the second pass can no longer misfire, but the loop
-- is rewritten to group on the DISTINCT counterpart anyway. The second pass
-- was not harmless: it wrote a false "X unlocked Y" row into A's own inbox.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v91-profile-views-activity.sql
-- ============================================================


-- ###########################################################################
-- 1a. PROFILE PRIVACY
-- ###########################################################################

create table if not exists public.profile_privacy (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  show_profile_views    boolean not null default false,
  share_visitor_identity boolean not null default false,
  updated_at            timestamptz not null default now()
);

alter table public.profile_privacy enable row level security;

-- Strictly self-scoped: nobody gets to read another account's privacy row, not
-- even to infer whether they have views enabled.
drop policy if exists "profile_privacy_self" on public.profile_privacy;
create policy "profile_privacy_self"
  on public.profile_privacy for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ###########################################################################
-- 1b. PROFILE VIEWS
-- ###########################################################################

-- A view is a STATE, not an event: "have they looked at me" with a last-seen
-- and a count. One row per (viewer, profile), so a person who opens your
-- profile daily does not manufacture a week of activity.
create table if not exists public.profile_views (
  viewer_id  uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references auth.users(id) on delete cascade,
  view_count integer not null default 1,
  viewed_at  timestamptz not null default now(),
  primary key (viewer_id, profile_id),
  constraint profile_views_no_self check (viewer_id <> profile_id)
);

create index if not exists idx_profile_views_profile
  on public.profile_views (profile_id, viewed_at desc);

alter table public.profile_views enable row level security;

-- Deliberately no policies. See section 2.


-- ###########################################################################
-- 1c. THE READ SIDE
-- ###########################################################################

create or replace function public.profile_privacy_get()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'showProfileViews', coalesce(
      (select p.show_profile_views from public.profile_privacy p where p.user_id = v_me), false),
    'shareVisitorIdentity', coalesce(
      (select p.share_visitor_identity from public.profile_privacy p where p.user_id = v_me), false)
  );
end;
$$;

revoke all on function public.profile_privacy_get() from public, anon;
grant execute on function public.profile_privacy_get() to authenticated, service_role;


create or replace function public.profile_privacy_set(
  p_show_profile_views    boolean default null,
  p_share_visitor_identity boolean default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  -- NULL means "leave this switch alone", so Settings can save one toggle
  -- without having to read-modify-write the other and clobber it.
  insert into public.profile_privacy (user_id, show_profile_views, share_visitor_identity)
  values (
    v_me,
    coalesce(p_show_profile_views, false),
    coalesce(p_share_visitor_identity, false)
  )
  on conflict (user_id) do update
    set show_profile_views = coalesce(p_show_profile_views, profile_privacy.show_profile_views),
        share_visitor_identity = coalesce(p_share_visitor_identity, profile_privacy.share_visitor_identity),
        updated_at = now();

  return public.profile_privacy_get();
end;
$$;

revoke all on function public.profile_privacy_set(boolean, boolean) from public, anon;
grant execute on function public.profile_privacy_set(boolean, boolean) to authenticated, service_role;


-- ###########################################################################
-- 1d. RECORD A VIEW - both consents checked at call time
-- ###########################################################################

create or replace function public.profile_view_record(p_profile uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_allowed boolean;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if p_profile is null or p_profile = v_me then
    return jsonb_build_object('ok', true, 'recorded', false);
  end if;

  -- The receiver's switch. No row, or false, means nothing is written - not
  -- an anonymous write, not a deferred one.
  select coalesce(p.show_profile_views, false) into v_allowed
    from public.profiles pr
    left join public.profile_privacy p on p.user_id = pr.id
   where pr.id = p_profile;
  if not coalesce(v_allowed, false) then
    return jsonb_build_object('ok', true, 'recorded', false);
  end if;

  -- Blocking hides you from the person you blocked, and them from you. A view
  -- is a social interaction, so it obeys the same rule as a challenge.
  if public._blocked_between(v_me, p_profile) then
    return jsonb_build_object('ok', true, 'recorded', false);
  end if;

  insert into public.profile_views (viewer_id, profile_id, view_count, viewed_at)
  values (v_me, p_profile, 1, now())
  on conflict (viewer_id, profile_id) do update
    set view_count = public.profile_views.view_count + 1,
        viewed_at = now();

  return jsonb_build_object('ok', true, 'recorded', true);
end;
$$;

revoke all on function public.profile_view_record(uuid) from public, anon;
grant execute on function public.profile_view_record(uuid) to authenticated, service_role;


-- ###########################################################################
-- 1e. READ YOUR OWN VIEW LIST
-- ###########################################################################

create or replace function public.profile_view_list(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(least(coalesce(p_limit, 50), 200), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select count(*) into v_total
    from public.profile_views
   where profile_id = v_me
     and not public._blocked_between(viewer_id, v_me);

  select coalesce(jsonb_agg(row_obj order by viewed_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'userId', v.viewer_id,
               -- The VIEWER's own switch decides whether they are named. An
               -- absent privacy row means false, so the default is unshared.
               'identified', coalesce(
                 (select vp.share_visitor_identity
                    from public.profile_privacy vp where vp.user_id = v.viewer_id), false),
               'name', case
                         when coalesce(
                                (select vp.share_visitor_identity
                                   from public.profile_privacy vp where vp.user_id = v.viewer_id), false)
                           then public._person_pair_name(v_me, v.viewer_id)
                         else null
                       end,
               'viewCount', v.view_count,
               'viewedAt', v.viewed_at) as row_obj,
             v.viewed_at
        from public.profile_views v
       where v.profile_id = v_me
         and not public._blocked_between(v.viewer_id, v_me)
       limit v_limit offset v_offset
    ) s;

  return jsonb_build_object('ok', true, 'total', v_total, 'views', v_rows);
end;
$$;

revoke all on function public.profile_view_list(integer, integer) from public, anon;
grant execute on function public.profile_view_list(integer, integer) to authenticated, service_role;


create or replace function public.profile_view_count()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  return jsonb_build_object(
    'ok', true,
    'viewers', (
      select count(*) from public.profile_views v
       where v.profile_id = v_me
         and not public._blocked_between(v.viewer_id, v_me)),
    'views', (
      select coalesce(sum(v.view_count), 0)::int from public.profile_views v
       where v.profile_id = v_me
         and not public._blocked_between(v.viewer_id, v_me))
  );
end;
$$;

revoke all on function public.profile_view_count() from public, anon;
grant execute on function public.profile_view_count() to authenticated, service_role;


-- ###########################################################################
-- 3. THE ACTIVITY FEED
-- ###########################################################################

create or replace function public.social_activity_feed(
  p_limit  integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(least(coalesce(p_limit, 40), 200), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  with counterparts as (
    -- DISTINCT, because a pair is one relationship now (v89) but the query is
    -- written so it stays correct if a legacy mirrored row ever survives.
    select distinct case when r.user_id = v_me then r.target_id else r.user_id end as other
      from public.user_relationships r
     where r.status = 'accepted'
       and (r.user_id = v_me or r.target_id = v_me)
  ),
  feed as (
    select 'you'::text as scope, ua.user_id, ua.unlocked_at,
           a.id as achievement_id, a.name, a.emoji, a.category
      from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id
     where ua.user_id = v_me
    union all
    select 'friend', ua.user_id, ua.unlocked_at,
           a.id, a.name, a.emoji, a.category
      from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id
      join counterparts c on c.other = ua.user_id
     where not public._blocked_between(v_me, ua.user_id)
  )
  select coalesce(jsonb_agg(row_obj order by unlocked_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'scope', f.scope,
               'userId', f.user_id,
               -- Your own unlocks are always named. Someone else's are named
               -- only under the same duel rule as every other surface.
               'name', case when f.user_id = v_me
                            then public._person_name(v_me, 'pseudonym')
                            else public._person_pair_name(v_me, f.user_id) end,
               'achievementId', f.achievement_id,
               'achievement', f.name,
               'emoji', coalesce(nullif(btrim(f.emoji), ''), ''),
               'category', f.category,
               'unlockedAt', f.unlocked_at) as row_obj,
             f.unlocked_at
        from feed f
       limit v_limit offset v_offset
    ) s;

  return jsonb_build_object('ok', true, 'activity', v_rows);
end;
$$;

revoke all on function public.social_activity_feed(integer, integer) from public, anon;
grant execute on function public.social_activity_feed(integer, integer) to authenticated, service_role;


-- ###########################################################################
-- 4. FIX THE ACHIEVEMENT NOTIFICATION TRIGGER
-- ###########################################################################

create or replace function public.notify_achievement_unlock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ach record;
begin
  select a.name, a.emoji into v_ach from public.achievements a where a.id = new.achievement_id;

  -- One row per DISTINCT counterpart. See section 4: iterating rows (rather
  -- than people) is what told an unlocker they had unlocked something.
  insert into public.notifications (user_id, kind, actor_id, payload)
  select s.other,
         'achievement',
         new.user_id,
         jsonb_build_object(
           'name', coalesce(v_ach.name, 'Achievement'),
           'emoji', coalesce(nullif(btrim(v_ach.emoji), ''), '🏅'))
    from (
      select case when r.user_id = new.user_id then r.target_id else r.user_id end as other
        from public.user_relationships r
       where r.status = 'accepted'
         and (r.user_id = new.user_id or r.target_id = new.user_id)
    ) s
   group by s.other;

  return new;
end;
$$;

revoke all on function public.notify_achievement_unlock() from public, anon, authenticated;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
