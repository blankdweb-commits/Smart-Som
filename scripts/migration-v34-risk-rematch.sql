-- ============================================================
-- Apex Scholars Migration v34 — DUEL RISK TIERS + REMATCH PROTECTION + RLS AUDIT
-- Phase 5 of the mega-spec. Requires v31 (SC economy), v32 (competitive_stats)
-- and v33 (finalize_duel / duels write-lock) FIRST.
--
-- Goals:
--   1. Server-authoritative duel risk profile: risk_score computed from real
--      duels/competitive_stats patterns (24h volume, rematch concentration,
--      abnormal win-rate, loss streaks) and persisted onto competitive_stats
--      (columns created in v32). Tier = safe | caution | limited | frozen.
--   2. frozen tier HARD-BLOCKS dueling — finalize_duel (v33) is replaced to
--      refuse settlers for frozen accounts. caution/limited remain playable but
--      flagged for monitoring.
--   3. Rematch protection: N duels vs the SAME opponent inside 24h moves a
--      user toward limited (never a silent hard-block — legit rematches stay
--      possible, abuse decays the risk).
--   4. RLS audit: re-assert duels select-own / competitive_stats select-own /
--      duel_waiting own-row; defensive drop of any leaked write policies.
--
-- Design:
--   refresh_duel_risk(p_user_id) is SECURITY DEFINER (service_role calls it via
--   finalize_duel). It is the ONLY writer of risk_score/risk_tier. Scores are
--   bounded 0..100. Tier thresholds: <40 safe, 40-69 caution, 70-89 limited,
--   >=90 frozen. Factors are conservative so normal play never trips it.
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Risk refresh — computes + persists the caller's risk profile
-- ------------------------------------------------------------
create or replace function public.refresh_duel_risk(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_score integer := 0;
  v_due integer;
  v_wins24 integer;
  v_matches24 integer;
  v_streak int;
  v_wr7 numeric;
  v_seen7 integer;
  v_wins7 integer;
  v_pairs integer;
  v_tier text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_USER');
  end if;

  -- Abusive daily volume (SC faucet + duel farming).
  select count(*) into v_matches24
    from public.duels
    where user_id = p_user_id and created_at > now() - interval '24 hours';
  v_due := greatest(0, v_matches24 - 8);
  v_score := v_score + least(30, v_due * 6);

  select count(*) into v_wins24
    from public.duels
    where user_id = p_user_id
      and outcome = 'win'
      and created_at > now() - interval '24 hours';
  if v_wins24 >= 12 then
    v_score := v_score + 30;
  end if;

  -- REMATCH PROTECTION: 5+ duels vs the same opponent within 24h signals
  -- collusive/stat-farming rematch loops. Accumulates risk (not a hard block).
  select coalesce(max(c), 0) into v_pairs
  from (
    select count(*) as c
      from public.duels
      where user_id = p_user_id
        and opponent_id is not null
        and created_at > now() - interval '24 hours'
      group by opponent_id
  ) t;
  if v_pairs >= 5 then
    v_score := v_score + 40;
  end if;

  -- Abnormal 7-day win rate against HUMAN opponents (House is excluded from
  -- competitive_stats but still lands in duels — restrict to human duels).
  select count(*), count(*) filter (where outcome = 'win'),
         round(count(*) filter (where outcome = 'win')::numeric
               / nullif(count(*), 0), 3)
    into v_seen7, v_wins7, v_wr7
  from public.duels
  where user_id = p_user_id
    and opponent_id is not null
    and created_at > now() - interval '7 days';
  if v_seen7 >= 5 and v_wr7 >= 0.98 then
    v_score := v_score + 40;
  end if;

  -- Loss streaks can signal throw-farming (deliberately feeding wins).
  select count(*) into v_streak
  from (
    select d.outcome
      from public.duels d
      where d.user_id = p_user_id
      order by d.created_at desc
      limit 5
  ) s
  where s.outcome = 'loss';
  if v_streak >= 5 then
    v_score := v_score + 20;
  end if;

  v_score := least(100, v_score);
  v_tier := case
    when v_score >= 90 then 'frozen'
    when v_score >= 70 then 'limited'
    when v_score >= 40 then 'caution'
    else 'safe'
  end;

  insert into public.competitive_stats (user_id, risk_score, risk_tier, updated_at)
  values (p_user_id, v_score, v_tier, now())
  on conflict (user_id) do update set
    risk_score = excluded.risk_score,
    risk_tier  = excluded.risk_tier,
    updated_at = now();

  return jsonb_build_object('ok', true, 'score', v_score, 'tier', v_tier,
                            'matches24h', v_matches24, 'wins24h', v_wins24,
                            'rematchPairs24h', v_pairs, 'wins7d', v_wins7,
                            'winRate7d', v_wr7);
end;
$$;

-- LIVE GRANT GOTCHA: default privileges auto-grant anon + authenticated —
-- refresh_duel_risk is a SERVICE-side helper (called from the definer
-- finalize_duel), NOT callable by clients.
revoke all on function public.refresh_duel_risk(uuid) from public, anon, authenticated;
grant execute on function public.refresh_duel_risk(uuid) to service_role;

-- ------------------------------------------------------------
-- 2. finalize_duel — replaced: frozen accounts cannot settle (duel refused),
--    and every settlement refreshes the caller's risk profile
-- ------------------------------------------------------------
create or replace function public.finalize_duel(
  p_mode text,
  p_opponent_id uuid default null,
  p_stake integer default 0,
  p_won boolean default false,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_tier text;
  v_players integer;
  v_amount integer;
  v_tx text;
  v_res jsonb;
  v_opp text;
  v_duel_id bigint;
  v_bal integer;
  v_delta integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;

  if not v_prof.is_activated then
    return jsonb_build_object('ok', false, 'error', 'NOT_ACTIVATED',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  -- Strict whitelist — the client can never choose stake/mode freely.
  if p_mode not in ('duel', 'triple') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MODE');
  end if;
  if p_stake not in (1, 2, 5, 10, 20) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STAKE');
  end if;
  if p_opponent_id = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;

  -- RISK GATE (Phase 5): frozen accounts cannot duel today. Re-evaluated on
  -- every settlement via refresh_duel_risk AFTER the gate, so a frozen user
  -- that cools down re-opens automatically.
  select risk_tier into v_tier
    from public.competitive_stats
    where user_id = v_user;
  if v_tier = 'frozen' then
    return jsonb_build_object('ok', false, 'error', 'DUEL_FROZEN',
                              'riskTier', v_tier, 'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  v_players := case when p_mode = 'triple' then 3 else 2 end;
  v_tx      := case when p_won then 'duel_win' else 'duel_loss' end;
  v_amount  := case when p_won then p_stake * (v_players - 1) else -p_stake end;

  -- Serialize duplicate submissions for the same client_request_id.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('finalize_duel:' || v_user::text || ':' || p_client_request_id::text));
  end if;

  -- Idempotency: an already-settled request returns the ORIGINAL result.
  if p_client_request_id is not null then
    select l.balance_after, d.delta
      into v_bal, v_delta
    from public.smart_coin_ledger l
    join public.duels d
      on d.user_id = v_user and d.client_request_id = p_client_request_id
    where l.client_request_id = p_client_request_id
    limit 1;
    if found then
      return jsonb_build_object('ok', true, 'replay', true,
                                'outcome', case when v_delta >= 0 then 'win' else 'loss' end,
                                'delta', v_delta, 'balance', v_bal, 'balanceAfter', v_bal);
    end if;
  end if;

  -- Atomic settlement (amount derived above; _sc_apply refuses a net debit
  -- below zero, idempotent on the same client_request_id as a second layer).
  v_res := public._sc_apply(
    v_user, v_amount,
    case when p_won then 'duel_win' else 'duel_loss' end,
    'duel', v_tx, 'duel', null,
    jsonb_build_object('mode', p_mode, 'opponent_id', p_opponent_id,
                       'stake', p_stake, 'won', p_won),
    p_client_request_id);

  if coalesce((v_res ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', v_res ->> 'error',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  -- Competitive stats only for HUMAN opponents (House = SC without verified wins).
  if p_opponent_id is not null then
    insert into public.competitive_stats
      (user_id, competitive_matches, competitive_wins,
       one_v_one_matches, one_v_one_wins,
       three_v_three_matches, three_v_three_wins,
       last_match_at, updated_at)
    values
      (v_user, 1, case when p_won then 1 else 0 end,
       case when p_mode = 'duel' then 1 else 0 end,
       case when p_mode = 'duel' and p_won then 1 else 0 end,
       case when p_mode = 'triple' then 1 else 0 end,
       case when p_mode = 'triple' and p_won then 1 else 0 end,
       now(), now())
    on conflict (user_id) do update set
      competitive_matches   = public.competitive_stats.competitive_matches + 1,
      competitive_wins      = public.competitive_stats.competitive_wins
                                + (case when p_won then 1 else 0 end),
      one_v_one_matches     = public.competitive_stats.one_v_one_matches
                                + (case when p_mode = 'duel' then 1 else 0 end),
      one_v_one_wins        = public.competitive_stats.one_v_one_wins
                                + (case when p_mode = 'duel' and p_won then 1 else 0 end),
      three_v_three_matches = public.competitive_stats.three_v_three_matches
                                + (case when p_mode = 'triple' then 1 else 0 end),
      three_v_three_wins    = public.competitive_stats.three_v_three_wins
                                + (case when p_mode = 'triple' and p_won then 1 else 0 end),
      last_match_at = now(),
      updated_at = now();
  end if;

  -- Opponent display name (identity masking via the public community view).
  if p_opponent_id is null then
    v_opp := 'The House';
  else
    select coalesce(cp.display_name, 'Rival Scholar') into v_opp
      from public.community_profiles cp
      where cp.id = p_opponent_id;
    if v_opp is null then v_opp := 'Rival Scholar'; end if;
  end if;

  -- History row.
  insert into public.duels
    (user_id, opponent, opponent_id, mode, stake, outcome, delta,
     transaction_type, client_request_id)
  values
    (v_user, v_opp, p_opponent_id, p_mode, p_stake,
     case when p_won then 'win' else 'loss' end,
     v_amount, v_tx, p_client_request_id)
  returning id into v_duel_id;

  -- Refresh the caller's risk profile after this settlement — a frozen user
  -- that keeps dueling stays cadence-capped; a cooled user re-opens next call.
  perform public.refresh_duel_risk(v_user);

  return jsonb_build_object('ok', true, 'duelId', v_duel_id, 'replay', false,
                            'outcome', case when p_won then 'win' else 'loss' end,
                            'delta', v_amount,
                            'balance', v_res ->> 'balanceAfter',
                            'balanceAfter', v_res ->> 'balanceAfter',
                            'competitive', p_opponent_id is not null);
end;
$$;

-- LIVE GRANT GOTCHA — re-assert the exact ACL for the replaced function.
revoke all on function public.finalize_duel(text, uuid, integer, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_duel(text, uuid, integer, boolean, uuid)
  to authenticated;

-- ------------------------------------------------------------
-- 3. RLS AUDIT — defensive re-assertion of the Phase 4/5 lockdown
-- ------------------------------------------------------------
-- duels: read your own history ONLY (the definer writes as the owner).
drop policy if exists "duels_all_own" on public.duels;
drop policy if exists "duels_own_select" on public.duels;
create policy "duels_own_select"
  on public.duels for select
  using (auth.uid() = user_id);

-- competitive_stats: read your own row ONLY — risk_score/risk_tier never leak
-- to other players and no client may write them.
drop policy if exists "competitive_stats_own_read" on public.competitive_stats;
create policy "competitive_stats_own_read"
  on public.competitive_stats for select
  using (auth.uid() = user_id);

-- duel_waiting stays client-managed strict-own (self-matchmaking + self-cleanup).
drop policy if exists "duel_waiting_own_update" on public.duel_waiting;
drop policy if exists "duel_waiting_select" on public.duel_waiting;
create policy "duel_waiting_own_update"
  on public.duel_waiting for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "duel_waiting_select"
  on public.duel_waiting for select
  using (auth.uid() is not null);

-- ============================================================
-- DONE.
-- ============================================================