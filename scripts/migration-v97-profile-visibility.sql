-- ###########################################################################
-- migration-v97-profile-visibility.sql
--
-- WHO IS ALLOWED TO SEE WHAT ON A PROFILE.
--
-- The request: opening another scholar's profile should reveal only their
-- display name, their Smart Coins and their duel record. Achievements,
-- head-to-head, streaks, score breakdown, rank, answers graded, join date and
-- the Crown badge are for the owner, their friends and their rivals.
--
-- WHY THIS HAD TO TOUCH TWO FUNCTIONS, NOT ONE.
-- _player_profile_obj was the obvious target, but it was not the only leak.
-- get_player_leaderboard returned, for EVERY ranked row, to ANY authenticated
-- caller with no viewer check at all: smartCoins, competitiveScore,
-- scoreBreakdown{coin,duels,perf,wins,matches}, oneVOneWins,
-- threeVThreeWins and playerScore. Trimming only the profile sheet would have
-- been cosmetic - the same numbers would still arrive in the leaderboard
-- payload. Both are trimmed here.
--
-- STILL PUBLIC, AND NOT CHANGEABLE HERE (stated plainly rather than implied):
-- `identity_name` and `year` are published by `community_profiles`, a plain
-- view GRANTED TO ANON since migration v22/v85. They are world-readable
-- before login and this migration does not change that.
--
-- WHY SCORE-BREAKDOWN IS DROPPED RATHER THAN KEPT. The `coin` term is
-- least(1000, round(1000 * ln(1 + smart_coins) / ln(251))), which is exactly
-- invertible: smart_coins = 251^(coin/1000) - 1. Publishing it hands over the
-- wallet balance while looking like an opaque score. The caller asked for
-- coins to be visible, so Smart Coins is returned directly and the derived
-- term is dropped rather than shipped as a disguised copy of the same secret.
--
-- BLOCKING. A blocked pair falls to the `public` tier rather than to "not
-- found". That is deliberate and consistent with the rest of the platform:
-- a block filters friend lists, search results and challenge targets, but the
-- leaderboard has always shown every ranked scholar regardless, so hiding the
-- profile while the row stays visible would be a half-measure that implies
-- more privacy than the platform actually provides.
--
-- Idempotent: both functions are created-or-replaced. No table, row or grant
-- outside these two functions is touched.
-- ###########################################################################

-- ###########################################################################
-- 1. _player_profile_obj - three visibility tiers
-- ###########################################################################
--
--   self      -> everything (it is their own profile)
--   connected -> an ACCEPTED friend/rival relationship, and not blocked
--   public    -> everyone else: name, Smart Coins, duel record. Nothing more.
--
-- The relationship is read from BOTH directions because migration-v89 made
-- `user_relationships` one row per unordered pair, and the caller can be
-- sitting on either side of it.
--
-- The achievements and head-to-head aggregates are computed INSIDE the
-- `if v_full` branch. They are not computed-then-discarded: the point is that
-- an unauthorised caller never causes the rows to be read at all.

create or replace function public._player_profile_obj(p_viewer uuid, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public
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
  v_rel text := 'none';
  v_blocked boolean := false;
  v_full boolean := false;
  v_obj jsonb;
begin
  select * into v_prof from public.profiles where id = p_user;
  if v_prof.id is null then return null; end if;

  -- ---- the visibility tier -------------------------------------------------
  if p_viewer is null then
    v_full := false;
  elsif p_viewer = p_user then
    v_full := true;
  else
    select case when r.status = 'accepted' then 'accepted' else 'pending' end
      into v_rel
      from public.user_relationships r
     where (r.user_id = p_viewer and r.target_id = p_user)
        or (r.target_id = p_viewer and r.user_id = p_user)
     limit 1;

    v_blocked := public._blocked_between(p_viewer, p_user);
    v_full := (v_rel = 'accepted' and not v_blocked);
  end if;

  v_cs := null;

  if v_full then
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

    v_year := case
      when v_prof.level ~ '^\d' then regexp_replace(v_prof.level, '[^0-9]', '', 'g')
      else null end;
  end if;

  -- ---- the tier every viewer gets -----------------------------------------
  v_obj := jsonb_build_object(
    'userId', p_user,
    'isSelf', p_viewer = p_user,
    -- Tells the client WHY the rest is missing, so the sheet can say something
    -- true instead of looking broken.
    'visibility', case
      when p_viewer is null then 'public'
      when p_viewer = p_user then 'self'
      when v_full then 'connected'
      else 'public'
    end,
    -- pseudonym until the two have dueled; real name after. Never 'Scholar'.
    'name', public._person_pair_name(p_viewer, p_user),
    'nameIsReal', public._arena_pair_dueled(p_viewer, p_user),
    'smartCoins', coalesce(v_prof.smart_coins, 0),
    'duels', jsonb_build_object(
      'oneVsOneWins', coalesce(v_cs.one_v_one_wins, 0),
      'oneVsOneMatches', coalesce(v_cs.one_v_one_matches, 0),
      'threeVsThreeWins', coalesce(v_cs.three_v_three_wins, 0),
      'threeVsThreeMatches', coalesce(v_cs.three_v_three_matches, 0)
    )
  );

  -- ---- everything else: owner, friends and rivals only ---------------------
  if v_full then
    v_obj := v_obj || jsonb_build_object(
      'year', v_year,
      'joinedAt', v_prof.created_at,
      'rank', v_rank,
      'totalPlayers', v_total,
      -- Decoration only; never part of any ORDER BY.
      'hasCrown', public._has_crown(p_user),
      'streak', coalesce(v_prof.streak, 0),
      'quizStreak', coalesce(v_prof.quiz_streak, 0),
      'maxQuizStreak', coalesce(v_prof.max_quiz_streak, 0),
      'competitiveScore', coalesce((v_parts ->> 'score')::int, 0),
      'scoreBreakdown', jsonb_build_object(
        'coin',  coalesce((v_parts ->> 'coin')::int, 0),
        'duels', coalesce((v_parts ->> 'duels')::int, 0),
        'perf',  coalesce((v_parts ->> 'perf')::int, 0),
        'wins',  coalesce((v_parts ->> 'wins')::int, 0),
        'matches', coalesce((v_parts ->> 'matches')::int, 0)
      ),
      'answers', jsonb_build_object(
        'correct', coalesce((v_parts ->> 'correctAnswers')::int, 0),
        'total', coalesce((v_parts ->> 'totalAnswers')::int, 0)
      ),
      'achievements', v_ach,
      'achievementCount', coalesce(v_ach_count, 0),
      'headToHead', v_h2h
    );
  end if;

  return v_obj;
end;
$$;

revoke all on function public._player_profile_obj(uuid, uuid) from public, anon, authenticated;
grant execute on function public._player_profile_obj(uuid, uuid) to service_role;


-- ###########################################################################
-- 2. get_player_leaderboard - drop the personal figures from every row
-- ###########################################################################
--
-- REMOVED from each row: smartCoins, competitiveScore, scoreBreakdown,
-- oneVOneWins, threeVThreeWins, playerScore.
-- KEPT: rank, userId, displayName, avatarUrl, year, hasCrown, totalAnswers.
--
-- RANKING IS UNCHANGED. This is the part that is easy to get wrong: both the
-- inner `order by ... limit/offset` and the outer `jsonb_agg(... order by ...)`
-- read from `v_competitive_base b.parts` and from `row_obj ->> 'rank'`, never
-- from the fields being deleted. `rank` is kept in the output precisely
-- because the outer aggregate orders by it. The tie-break chain
-- (score desc, threeVThreeWins, oneVOneWins, wins, sc_balance, user_id) is
-- byte-for-byte the same, so no row can move.

create or replace function public.get_player_leaderboard(p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_limit int := greatest(least(coalesce(p_limit, 50), 500), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
begin
  select count(*) into v_total from public.v_competitive_base;

  return jsonb_build_object(
    'ok', true,
    'totalPlayers', v_total,
    'players', coalesce((
      select jsonb_agg(t.row_obj order by (t.row_obj ->> 'rank')::int asc)
      from (
        select jsonb_build_object(
                 'rank', row_number() over (
                           order by (b.parts ->> 'score')::int desc,
                                    (b.parts ->> 'threeVThreeWins')::int desc,
                                    (b.parts ->> 'oneVOneWins')::int desc,
                                    (b.parts ->> 'wins')::int desc,
                                    b.sc_balance desc,
                                    b.user_id asc
                         )::int,
                 'userId', b.user_id,
                 'displayName', public._person_name(b.user_id, 'pseudonym'),
                 'avatarUrl', cp.avatar_url,
                 'year', cp.year,
                 -- Decoration only. The ORDER BY above cannot reference this,
                 -- and does not.
                 'hasCrown', coalesce(cp.has_crown, false),
                 -- "no graded rounds yet" is distinguished from a real zero,
                 -- so NULL is preserved rather than coalesced here.
                 'totalAnswers', (b.parts ->> 'totalAnswers')::int
               ) as row_obj
        from public.v_competitive_base b
        left join public.community_profiles cp on cp.id = b.user_id
        order by (b.parts ->> 'score')::int desc,
                 (b.parts ->> 'threeVThreeWins')::int desc,
                 (b.parts ->> 'oneVOneWins')::int desc,
                 (b.parts ->> 'wins')::int desc,
                 b.sc_balance desc,
                 b.user_id asc
        limit v_limit offset v_offset
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_player_leaderboard(int, int) from public, anon;
grant execute on function public.get_player_leaderboard(int, int) to authenticated, service_role;

notify pgrst, 'reload schema';