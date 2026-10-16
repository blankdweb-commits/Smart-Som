-- ============================================================
-- migration-v74-leaderboard-all-users.sql
--
-- Makes the Global Leaderboard actually readable as a list of PEOPLE.
--
-- Verified against the live DB before writing this file:
--   * v_competitive_base already ranks EVERY profile (v37's fix is live),
--     so ranks 1..54 were already correct, contiguous and tie-free.
--   * BUT all 54 rows carried displayName = 'Scholar'
--     (community_profiles.display_name falls back to the literal 'Scholar'),
--     and 0 of 54 users have set identity_name. The board was 54 identical
--     rows, so it read as though nobody was on it.
--   * AND 47 of 54 users have no player_stats row, so playerScore /
--     totalAnswers come back NULL. Leaderboard.jsx coerced them with
--     `Number(row.playerScore || 0)`, printing a convincing but fake
--     "0 scholar pts / 0 answers" for users who simply have no stats yet.
--   * AND only the first 30 rows rendered (PAGE_SIZE = 30), while the RPC
--     clamped p_limit to a maximum of 100.
--
-- This migration changes NONE of the ordering, so no rank moves.
--
-- BALANCES ARE DELIBERATELY LEFT VISIBLE (operator decision): the RPC keeps
-- returning smartCoins for every row and the UI keeps showing the coin chip.
--
-- NOTE: playerScore / totalAnswers stay NULL. That is honest data, and the
-- client fix (Leaderboard.jsx) is what stops it rendering as a real zero.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. SHARED IDENTITY HELPER (identical copy to the one in v64, so either file
--    may be applied first; `create or replace` makes the order irrelevant).
-- ---------------------------------------------------------------------------
create or replace function public._person_name(p_user uuid, p_mode text default 'pseudonym')
returns text
language sql
stable
security definer set search_path = public
as $$
  select case p_mode
           when 'real' then coalesce(
             nullif(btrim(p.full_name), ''),
             nullif(btrim(p.identity_name), ''),
             'Scholar-' || substr(md5(p.id::text), 1, 6))
           else coalesce(
             nullif(btrim(p.identity_name), ''),
             'Scholar-' || substr(md5(p.id::text), 1, 6))
         end
    from public.profiles p
   where p.id = p_user;
$$;

revoke all on function public._person_name(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. THE LEADERBOARD - real names, and a page big enough to see everyone.
--
-- Only two things change versus v32/v37:
--   * p_limit clamp 100 -> 500 (the client asks for 100; "Load more" still
--     handles anything past that)
--   * displayName comes from _person_name(..., 'pseudonym')
-- The row_number() ordering and every tie-breaker are copied verbatim, so the
-- 1..54 ranks stay byte-identical.
-- ---------------------------------------------------------------------------
create or replace function public.get_player_leaderboard(
  p_limit integer default 50,
  p_offset integer default 0
)
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
                 'competitiveScore', (b.parts ->> 'score')::int,
                 'scoreBreakdown', jsonb_build_object(
                    'coin', (b.parts ->> 'coin')::int,
                    'duels', (b.parts ->> 'duels')::int,
                    'perf', (b.parts ->> 'perf')::int,
                    'wins', (b.parts ->> 'wins')::int,
                    'matches', (b.parts ->> 'matches')::int
                 ),
                 'threeVThreeWins', (b.parts ->> 'threeVThreeWins')::int,
                 'oneVOneWins', (b.parts ->> 'oneVOneWins')::int,
                 'playerScore', (b.parts ->> 'playerScore')::int,
                 'totalAnswers', (b.parts ->> 'totalAnswers')::int,
                 'smartCoins', (b.parts ->> 'smartCoins')::int
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

-- ---------------------------------------------------------------------------
-- 3. ACLs - identical to v32 (authenticated only). anon must stay locked out:
--    this endpoint enumerates every account's balance and rank.
-- ---------------------------------------------------------------------------
revoke all on function public.get_player_leaderboard(integer, integer)
  from public, anon;
grant execute on function public.get_player_leaderboard(integer, integer)
  to authenticated, service_role;

-- PostgREST schema-cache refresh so the replaced definition is picked up.
notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================