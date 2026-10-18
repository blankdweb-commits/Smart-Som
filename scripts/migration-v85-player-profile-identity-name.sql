-- =============================================================
-- v85 — PLAYER PROFILES + WRITABLE DISPLAY NAME
-- =============================================================
-- Two problems this fixes:
--
-- 1. NOBODY COULD EVER SET A DISPLAY NAME.
--    profiles.identity_name exists (v22:5) and the community_profiles view
--    reads it (v22:18-26) — but v31:71 revoked table-level UPDATE on profiles
--    from clients and v31:77-79 re-granted only these columns:
--      full_name, email, phone, department, level, matric_number,
--      streak, last_active_date, cards_studied, quiz_streak,
--      max_quiz_streak, milestone
--    identity_name was named in that file's own comment as "privileged ->
--    server-write-only" and was never re-granted. No server code wrote it
--    either, and Settings.jsx had no field for it. Net effect:
--      community_profiles.display_name === 'Scholar' for EVERY account
--      _person_name(uid,'pseudonym') === 'Scholar-xxxxxx' always
--      every avatar tile in Community / GroupPage / StudyGroups / Rumble
--        rendered the letter "S"
--      Leaderboard.jsx's "Set display name -> /settings" nudge was a dead end
--    This migration re-grants the column and adds a length CHECK. Note the
--    trade-off explicitly: with a direct client UPDATE there is NO server-side
--    content filtering, so a user can set any string up to 24 chars (including
--    reserved words). A reserved-word/impersonation blocklist would need an
--    RPC instead — that is deliberately NOT claimed here.
--
-- 2. NO PROFILE VIEW EXISTED.
--    A signed-in client can read NOTHING about another user except the
--    community_profiles view (id, display_name, avatar_url, year). profiles,
--    player_stats, competitive_stats, duels, competitive_matches,
--    user_achievements and subscriptions are all own-row-only or deny-all.
--    So a profile surface has to be backed by SECURITY DEFINER RPCs, the same
--    shape as _person_name / arena_roster / friend_list / get_player_leaderboard.
--
-- PRIVACY: the name rule is unchanged and comes from the EXISTING
-- _person_pair_name(v79:28-41) — a real name is revealed only after the two
-- accounts have completed a duel together, otherwise the Scholar-xxxxxx
-- pseudonym. risk_score / risk_tier are deliberately NOT exposed (v34 keeps
-- those private).
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v85-player-profile-identity-name.sql
-- =============================================================

-- ------------------------------------------------------------
-- 1. MAKE THE DISPLAY NAME WRITABLE (the actual unblock)
-- ------------------------------------------------------------
alter table public.profiles
  drop constraint if exists profiles_identity_name_check;
alter table public.profiles
  add constraint profiles_identity_name_check
  check (char_length(coalesce(identity_name, '')) <= 24);

-- v31 revoked table-level UPDATE and granted a column subset; add the one
-- column back to that subset.
grant update (identity_name) on public.profiles to authenticated;

-- ------------------------------------------------------------
-- 2. RANK MAP — one window over the FULL base, per call.
--    The v37 lesson: WHERE filters BEFORE the window function, so ranking a
--    filtered set silently ranks against a single row and reports everyone #1.
--    Every rank here is therefore computed over ALL users with the byte-identical
--    ORDER BY as get_player_leaderboard (v74:84-91), so the profile rank and the
--    leaderboard rank can never disagree.
-- ------------------------------------------------------------
create or replace function public._player_ranks()
returns table (user_id uuid, rank int)
language sql stable security definer set search_path = public
as $$
  select b.user_id, r
  from public.v_competitive_base b
  join (
    select x.user_id, row_number() over (
             order by (x.parts ->> 'score')::int desc,
                      (x.parts ->> 'threeVThreeWins')::int desc,
                      (x.parts ->> 'oneVOneWins')::int desc,
                      (x.parts ->> 'wins')::int desc,
                      x.sc_balance desc,
                      x.user_id asc
           )::int as r
    from public.v_competitive_base x
  ) r on r.user_id = b.user_id;
$$;
revoke all on function public._player_ranks() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. ONE PLAYER'S PROFILE, as seen BY a viewer.
--    Internal: no EXECUTE grant. Both public entry points below call it.
-- ------------------------------------------------------------
create or replace function public._player_profile_obj(p_viewer uuid, p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_prof public.profiles%rowtype;
  v_parts jsonb;
  v_rank int;
  v_total int;
  v_cs public.competitive_stats%rowtype;
  v_ach jsonb;
  v_ach_count int;
  v_h2h jsonb;
  v_year text;
begin
  select * into v_prof from public.profiles where id = p_user;
  if v_prof.id is null then return null; end if;

  select parts into v_parts from public.v_competitive_base where user_id = p_user;
  select rank into v_rank from public._player_ranks() where user_id = p_user;
  select count(*) into v_total from public.v_competitive_base;

  select * into v_cs from public.competitive_stats where user_id = p_user;

  -- Latest 12 achievements + the TRUE total. These must be two separate
  -- aggregates: counting rows over a `limit 12` subquery would cap the count
  -- at 12 and quietly under-report anybody with more.
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', a.key, 'name', a.name,
           'emoji', a.emoji, 'description', a.description,
           'unlockedAt', a.unlocked_at
         ) order by a.unlocked_at desc), '[]'::jsonb)
    into v_ach
    from (
      select a.key, a.name, a.emoji, a.description, ua.unlocked_at
      from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id
      where ua.user_id = p_user
      order by ua.unlocked_at desc
      limit 12
    ) a;

  select count(*) into v_ach_count
    from public.user_achievements ua
    join public.achievements a on a.id = ua.achievement_id
   where ua.user_id = p_user;

  -- Head to head is scoped to the VIEWER only: null when they have never met,
  -- so a profile never implies a shared history that does not exist.
  if p_viewer is not null and p_viewer <> p_user then
    select jsonb_build_object(
             'played', count(*),
             'wins',   count(*) filter (where winner_id = p_viewer),
             'losses', count(*) filter (where winner_id = p_user),
             'draws',  count(*) filter (where winner_id is null)
           )
      into v_h2h
      from public.competitive_matches m
     where m.format = 'blitz'
       and m.status = 'completed'
       and ((m.creator_id = p_viewer and m.opponent_id = p_user)
         or (m.creator_id = p_user  and m.opponent_id = p_viewer));
  end if;

  v_year := case
    when v_prof.level ~ '^\d' then regexp_replace(v_prof.level, '[^0-9]', '', 'g')
    else null end;

  return jsonb_build_object(
    'userId', p_user,
    'isSelf', p_viewer = p_user,
    -- pseudonym until the two have dueled; real name after. Never 'Scholar'.
    'name', public._person_pair_name(p_viewer, p_user),
    'nameIsReal', public._arena_pair_dueled(p_viewer, p_user),
    'year', v_year,
    'joinedAt', v_prof.created_at,
    'rank', v_rank,
    'totalPlayers', v_total,
    'streak', coalesce(v_prof.streak, 0),
    'quizStreak', coalesce(v_prof.quiz_streak, 0),
    'maxQuizStreak', coalesce(v_prof.max_quiz_streak, 0),
    'smartCoins', coalesce(v_prof.smart_coins, 0),
    'competitiveScore', coalesce((v_parts ->> 'score')::int, 0),
    'scoreBreakdown', jsonb_build_object(
      'coin',  coalesce((v_parts ->> 'coin')::int, 0),
      'duels', coalesce((v_parts ->> 'duels')::int, 0),
      'perf',  coalesce((v_parts ->> 'perf')::int, 0),
      'wins',  coalesce((v_parts ->> 'wins')::int, 0),
      'matches', coalesce((v_parts ->> 'matches')::int, 0)
    ),
    'duels', jsonb_build_object(
      'oneVsOneWins', coalesce(v_cs.one_v_one_wins, 0),
      'oneVsOneMatches', coalesce(v_cs.one_v_one_matches, 0),
      'threeVsThreeWins', coalesce(v_cs.three_v_three_wins, 0),
      'threeVsThreeMatches', coalesce(v_cs.three_v_three_matches, 0)
    ),
    'answers', jsonb_build_object(
      'correct', coalesce((v_parts ->> 'correctAnswers')::int, 0),
      'total', coalesce((v_parts ->> 'totalAnswers')::int, 0)
    ),
    'achievements', v_ach,
    'achievementCount', coalesce(v_ach_count, 0),
    'headToHead', v_h2h
  );
end;
$$;
revoke all on function public._player_profile_obj(uuid, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. PUBLIC ENTRY POINTS.
--    auth.uid() is required so these are not an anonymous data-mining surface.
--    Revoking anon is mandatory on this project: the default privileges for
--    role postgres/schema public auto-grant EXECUTE to anon and authenticated.
-- ------------------------------------------------------------
create or replace function public.player_public_profile(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_obj jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  if p_user is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_USER');
  end if;

  v_obj := public._player_profile_obj(v_me, p_user);
  if v_obj is null then
    return jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  end if;
  return v_obj || jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.player_public_profile(uuid) from public, anon;
grant execute on function public.player_public_profile(uuid) to authenticated, service_role;

-- Batch form: one round trip for a whole member list (GroupPage fetches every
-- member at once instead of one call per row). Duplicates and ids the caller is
-- not allowed to see simply drop out of the result.
create or replace function public.player_public_profiles(p_users uuid[])
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_out jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;
  if p_users is null or array_length(p_users, 1) is null then
    return jsonb_build_object('ok', true, 'profiles', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(public._player_profile_obj(v_me, u.id)), '[]'::jsonb)
    into v_out
    from (select distinct unnest(p_users) as id) u
   where exists (select 1 from public.profiles p where p.id = u.id);

  return jsonb_build_object('ok', true, 'profiles', v_out);
end;
$$;
revoke all on function public.player_public_profiles(uuid[]) from public, anon;
grant execute on function public.player_public_profiles(uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =============================================================
-- DONE. Re-run safe.
-- =============================================================