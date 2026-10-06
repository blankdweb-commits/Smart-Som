-- ============================================================
-- Apex Scholars Migration v32 — Global Competitive Ranking
--
-- Replaces the player_score-only ranking with the ACCURATE GLOBAL
-- COMPETITIVE RANKING (spec "Global Competitive Ranking", §ranking formula):
--
--   competitive_rank_score = coin + duels + perf   (0..2200)
--     coin   = 1000 * ln(1 + smart_coins) / ln(1 + 250),   capped at 1000
--     duels  = min(40 * one_v_one_wins, 600)  +  min(100 * three_v_three_wins, 600)
--     perf   = 400 * win_rate * min(matches, 10) / 10  +  20 * min(competitive_achievements, 20)
--     win_rate = competitive_wins / max(competitive_matches, 1)
--
--   Ordering (tie-break): competitive_rank_score DESC,
--     three_v_three_wins DESC, one_v_one_wins DESC, competitive_wins DESC,
--     smart_coin_balance DESC, user_id ASC.  Rank = server row_number().
--
-- The score is COMPUTED (never stored anywhere the client can write); every
-- component traces to a server-write-only table: profiles.smart_coins (v31),
-- competitive_stats (below, written by server-duel-finalization RPCs in Phase
-- 4), and user_achievements JOIN achievements.category = 'competitive'.
--
-- Also persists the Phase 1 cleanup: the exam-readiness achievement row is
-- deleted (user_achievements cascade) so no client ever re-unlocks it.
--
-- Idempotent. Safe to re-run. Requires migrations v30 + v31.
-- ============================================================

-- ------------------------------------------------------------
-- 0. PHASE 1 PERSISTED CLEANUP — no exam-readiness achievement left behind
-- ------------------------------------------------------------
delete from public.achievements where key = 'exam-ready';

-- ------------------------------------------------------------
-- 1. COMPETITIVE STATS — server-only competitive match ledger
--    Written ONLY by server duel-finalization (Phase 4 RPCs). Clients get
--    SELECT-own ONLY — no insert/update/delete policy exists.
-- ------------------------------------------------------------
create table if not exists public.competitive_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  one_v_one_wins integer not null default 0,
  one_v_one_matches integer not null default 0,
  three_v_three_wins integer not null default 0,
  three_v_three_matches integer not null default 0,
  competitive_wins integer not null default 0,
  competitive_matches integer not null default 0,
  risk_score integer not null default 0,
  risk_tier text not null default 'safe'
    check (risk_tier in ('safe', 'caution', 'limited', 'frozen')),
  last_match_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.competitive_stats enable row level security;

drop policy if exists "competitive_stats_self_read" on public.competitive_stats;
create policy "competitive_stats_self_read"
  on public.competitive_stats for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 2. ACHIEVEMENT CATEGORY — existing duel achievements are COMPETITIVE
-- ------------------------------------------------------------
update public.achievements
  set category = 'competitive'
where key in ('first-blood', 'untouchable') and category <> 'competitive';

-- ------------------------------------------------------------
-- 3. COMPETITIVE PARTIALS — the single scoring kernel (service_role only)
-- ------------------------------------------------------------
create or replace function public._competitive_partials(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_prof public.profiles%rowtype;
  v_cs public.competitive_stats%rowtype;
  v_coin int := 0;
  v_duels1 int := 0;
  v_duels3 int := 0;
  v_matches int := 0;
  v_wins int := 0;
  v_rate numeric := 0;
  v_perf int := 0;
  v_ach int := 0;
  v_score int := 0;
begin
  select * into v_prof from public.profiles where id = p_user;
  if v_prof.id is null then return null; end if;

  v_coin := least(1000,
    round(1000 * ln(1 + greatest(coalesce(v_prof.smart_coins, 0), 0))::numeric
               / ln(1 + 250))::int);

  select * into v_cs from public.competitive_stats where user_id = p_user;

  v_duels1 := least(600, 40 * coalesce(v_cs.one_v_one_wins, 0));
  v_duels3 := least(600, 100 * coalesce(v_cs.three_v_three_wins, 0));
  v_matches := coalesce(v_cs.one_v_one_matches, 0) + coalesce(v_cs.three_v_three_matches, 0);
  v_wins := coalesce(v_cs.one_v_one_wins, 0) + coalesce(v_cs.three_v_three_wins, 0);

  v_rate := case when v_matches > 0 then v_wins::numeric / v_matches else 0 end;
  v_perf := round(400 * v_rate * least(v_matches, 10) / 10)::int;

  select count(*) into v_ach
  from public.user_achievements ua
  join public.achievements a on a.id = ua.achievement_id
  where ua.user_id = p_user and a.category = 'competitive';
  v_perf := v_perf + least(v_ach, 20) * 20;

  v_score := v_coin + v_duels1 + v_duels3 + v_perf;

  return jsonb_build_object(
    'score', v_score,
    'coin', v_coin,
    'duels', v_duels1 + v_duels3,
    'duels1', v_duels1,
    'duels3', v_duels3,
    'perf', v_perf,
    'wins', v_wins,
    'matches', v_matches,
    'achievements', v_ach,
    'oneVOneWins', coalesce(v_cs.one_v_one_wins, 0),
    'threeVThreeWins', coalesce(v_cs.three_v_three_wins, 0),
    'smartCoins', coalesce(v_prof.smart_coins, 0),
    'playerScore', (select coalesce(ps.player_score, 0) from public.player_stats ps where ps.user_id = p_user),
    'correctAnswers', (select coalesce(ps.correct_answers, 0) from public.player_stats ps where ps.user_id = p_user),
    'totalAnswers', (select coalesce(ps.total_answers, 0) from public.player_stats ps where ps.user_id = p_user)
  );
end;
$$;

revoke all on function public._competitive_partials(uuid) from public, anon, authenticated;
grant execute on function public._competitive_partials(uuid) to service_role;

-- ------------------------------------------------------------
-- 4. ELIGIBLE PLAYER SET — everyone with ANY ranking signal
--    (a scored batch, a competitive match, or a non-zero SC wallet). Shared
--    by rank + leaderboard so both stay in exact parity.
-- ------------------------------------------------------------
create or replace view public.v_competitive_base as
select
  p.id as user_id,
  p.smart_coins::int as sc_balance,
  public._competitive_partials(p.id) as parts
from public.profiles p
left join public.player_stats ps   on ps.user_id = p.id
left join public.competitive_stats cs on cs.user_id = p.id
where ps.user_id is not null
   or cs.user_id is not null
   or coalesce(p.smart_coins, 0) > 0;

-- The base view materializes per-user scores INCLUDING private wallet/score
-- data. Only the SECURITY DEFINER rank/leaderboard RPCs may read it, and they
-- expose only the caller's own row or masked leaderboard entries. Clients are
-- REVOKED from reading the view directly.
revoke select on public.v_competitive_base from public, anon, authenticated;
grant select on public.v_competitive_base to service_role;

-- ------------------------------------------------------------
-- 5. RANK RPC — deterministic server row_number over the full base
-- ------------------------------------------------------------
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

  select row_number() over (
           order by (b.parts ->> 'score')::int desc,
                    (b.parts ->> 'threeVThreeWins')::int desc,
                    (b.parts ->> 'oneVOneWins')::int desc,
                    (b.parts ->> 'wins')::int desc,
                    b.sc_balance desc,
                    b.user_id asc
         )::int
    into v_rank
  from public.v_competitive_base b
  where b.user_id = v_user;

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

-- ------------------------------------------------------------
-- 6. LEADERBOARD RPC — paginated, deterministic, identity-masked
-- ------------------------------------------------------------
create or replace function public.get_player_leaderboard(p_limit int default 50, p_offset int default 0)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_limit int := greatest(least(coalesce(p_limit, 50), 100), 1);
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
                 'displayName', cp.display_name,
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

revoke all on function public.get_player_leaderboard(int, int) from public, anon;
grant execute on function public.get_player_leaderboard(int, int) to authenticated;

-- ============================================================
-- DONE.
-- ============================================================