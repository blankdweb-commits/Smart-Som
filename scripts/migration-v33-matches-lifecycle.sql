-- ============================================================
-- Apex Scholars Migration v33 — SERVER-SIDE DUEL / MATCH LIFECYCLE
-- Phase 4 of the mega-spec. Requires v31 (SC economy + _sc_apply) and v32
-- (competitive_stats + ranking kernel) to be applied FIRST.
--
-- Goals:
--   1. LOCK duels writes — clients may only READ their own duel history. A
--      client that could INSERT its own duels row could self-report wins and
--      (combined with the old client-side settle) mint Smart Coins.
--   2. finalize_duel RPC = the ONE server-authoritative path that settles a
--      duel: validates mode/stake/activation, moves SC atomically via
--      _sc_apply (amount derived SERVER-side from the whitelisted stake),
--      maintains competitive_stats (human opponents only — "The House" pays SC
--      but earns NO verified wins per spec), writes the duels history row, and
--      is idempotent on a client_request_id (advisory lock + replay lookup).
--   3. competitive_stats is written ONLY here (server-side). It was created in
--      v32 with RLS select-own; this migration is its single writer.
--
-- Design notes:
--   - Amounts: win => +stake·(players-1), loss => -stake  (players = 2 duel, 3 triple).
--   - A loss settles only if the caller's balance covers the stake (_sc_apply
--     refuses a net negative balance) — a broke loser pays nothing and no win
--     is credited.
--   - House matches (opponent_id NULL): SC settles, duel history recorded,
--     competitive_stats NOT incremented (no verified wins).
--   - SECURITY DEFINER runs as the table owner (postgres), which bypasses the
--     select-own RLS on duels/competitive_stats — that's what makes writing the
--     history + stats safe while clients are locked to reads.
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. duels: settlement columns + idempotency key
-- ------------------------------------------------------------
alter table public.duels
  add column if not exists transaction_type text not null default 'duel',
  add column if not exists client_request_id uuid,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_duels_client_request
  on public.duels(user_id, client_request_id)
  where client_request_id is not null;

-- ------------------------------------------------------------
-- 2. duels RLS: SELECT own history ONLY. The client-side INSERT path
--    (used pre-v33) is removed.
-- ------------------------------------------------------------
drop policy if exists "duels_all_own" on public.duels;
drop policy if exists "duels_own_select" on public.duels;
create policy "duels_own_select"
  on public.duels for select
  using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. finalize_duel RPC — the only server-side duel settlement path
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

  v_players := case when p_mode = 'triple' then 3 else 2 end;
  v_tx      := case when p_won then 'duel_win' else 'duel_loss' end;
  v_amount  := case when p_won then p_stake * (v_players - 1) else -p_stake end;

  -- Serialize duplicate submissions for the same client_request_id so two
  -- parallel taps can never both pass the replay lookup before settling.
  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('finalize_duel:' || v_user::text || ':' || p_client_request_id::text));
  end if;

  -- Idempotency: an already-settled request returns the ORIGINAL result with
  -- the post-settlement balance — the delta is never applied twice.
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

  -- Competitive stats only for HUMAN opponents ("The House" pays SC but is a
  -- verified-win-free drill, per spec — farming the bot must not farm the rank).
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

  -- History row (owner-write bypasses the select-own RLS).
  insert into public.duels
    (user_id, opponent, opponent_id, mode, stake, outcome, delta,
     transaction_type, client_request_id)
  values
    (v_user, v_opp, p_opponent_id, p_mode, p_stake,
     case when p_won then 'win' else 'loss' end,
     v_amount, v_tx, p_client_request_id)
  returning id into v_duel_id;

  return jsonb_build_object('ok', true, 'duelId', v_duel_id, 'replay', false,
                            'outcome', case when p_won then 'win' else 'loss' end,
                            'delta', v_amount,
                            'balance', v_res ->> 'balanceAfter',
                            'balanceAfter', v_res ->> 'balanceAfter',
                            'competitive', p_opponent_id is not null);
end;
$$;

-- LIVE GRANT GOTCHA (see AGENTS.md): default privileges auto-grant anon +
-- authenticated on every new function — revoke both explicitly, then grant the
-- intended role.
revoke all on function public.finalize_duel(text, uuid, integer, boolean, uuid)
  from public, anon, authenticated;
grant execute on function public.finalize_duel(text, uuid, integer, boolean, uuid)
  to authenticated;

-- ============================================================
-- DONE.
-- ============================================================