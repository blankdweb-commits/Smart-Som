-- ============================================================
-- v37 — RANK EVERY REGISTERED USER (no placeholder ranks)
-- Rewrites v_competitive_base (from v32) to include ALL profiles,
-- not just users with "any ranking signal". Every signed-in account
-- now has an ACTUAL competitive rank (score 0 at the bottom until
-- they earn coins/duels/batches), so the Dashboard Global Rank card
-- and Quiz header never show a placeholder dash for a registered user.
-- Both rank RPCs (get_my_player_rank / get_player_leaderboard) read
-- ONLY this view, so they automatically rank the full base; their
-- determinism/ordering formula is untouched.
--
-- IDEMPOTENT: create or replace view re-runs clean; grants re-asserted.
-- ============================================================

create or replace view public.v_competitive_base as
select
  p.id as user_id,
  p.smart_coins::int as sc_balance,
  public._competitive_partials(p.id) as parts
from public.profiles p;

-- The base view materializes per-user scores INCLUDING private wallet/score
-- data. Only the SECURITY DEFINER rank/leaderboard RPCs may read it, and they
-- expose only the caller's own row or masked leaderboard entries. Clients are
-- (still) REVOKED from reading the view directly.
revoke select on public.v_competitive_base from public, anon, authenticated;
grant select on public.v_competitive_base to service_role;

-- ============================================================
-- FIX get_my_player_rank: it ranked with
--   select row_number() over (...) into v_rank
--   from v_competitive_base where user_id = v_user;
-- WHERE filters BEFORE the window function, so the window ran over a SINGLE
-- row -> EVERY user was reported "#1" (a placeholder). Rewrite to rank the
-- FULL base (identical ORDER BY as get_player_leaderboard, so own-rank and
-- leaderboard stay in exact parity), then extract the caller's row.
-- ============================================================
create or replace function public.get_my_player_rank(p_user_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user_id, auth.uid());
  v_parts jsonb;
  v_rank int;
  v_total int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select count(*) into v_total from public.v_competitive_base;

  select parts into v_parts from public.v_competitive_base where user_id = v_user;
  if v_parts is null then
    return jsonb_build_object(
      'ok', true,
      'competitiveRank', null,
      'competitiveScore', 0,
      'scoreBreakdown', jsonb_build_object('coin', 0, 'duels', 0, 'duels1', 0, 'duels3', 0,
                                           'perf', 0, 'wins', 0, 'matches', 0,
                                           'achievements', 0),
      'playerScore', 0, 'correctAnswers', 0, 'totalAnswers', 0,
      'totalPlayers', v_total,
      'totalDuelists', v_total
    );
  end if;

  select x.rank into v_rank
  from (
    select b.user_id,
           row_number() over (
             order by (b.parts ->> 'score')::int desc,
                      (b.parts ->> 'threeVThreeWins')::int desc,
                      (b.parts ->> 'oneVOneWins')::int desc,
                      (b.parts ->> 'wins')::int desc,
                      b.sc_balance desc,
                      b.user_id asc
           )::int as rank
    from public.v_competitive_base b
  ) x
  where x.user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'competitiveRank', v_rank,
    'competitiveScore', (v_parts ->> 'score')::int,
    'scoreBreakdown', jsonb_build_object(
      'coin', (v_parts ->> 'coin')::int,
      'duels', (v_parts ->> 'duels')::int,
      'duels1', (v_parts ->> 'duels1')::int,
      'duels3', (v_parts ->> 'duels3')::int,
      'perf', (v_parts ->> 'perf')::int,
      'wins', (v_parts ->> 'wins')::int,
      'matches', (v_parts ->> 'matches')::int,
      'achievements', (v_parts ->> 'achievements')::int
    ),
    'playerScore', (v_parts ->> 'playerScore')::int,
    'correctAnswers', (v_parts ->> 'correctAnswers')::int,
    'totalAnswers', (v_parts ->> 'totalAnswers')::int,
    'totalPlayers', v_total,
    'totalDuelists', v_total
  );
end;
$$;

revoke all on function public.get_my_player_rank(uuid) from public, anon;
grant execute on function public.get_my_player_rank(uuid) to authenticated;

-- ============================================================
-- DONE.
-- ============================================================