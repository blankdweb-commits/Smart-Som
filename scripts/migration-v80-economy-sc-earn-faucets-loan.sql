-- ============================================================
-- migration-v80-economy-sc-earn-faucets-loan.sql
--
-- Operator decisions applied here:
--
--   1. LIFETIME EARNINGS FROM THE LEDGER. `scEarned` was the CURRENT BALANCE
--      (AppContext + Dashboard both passed `smartCoins || 0` into identityEngine),
--      so it fell every time a user spent, and the 200 / 500 / 1000 identity
--      tiers were effectively unreachable. `sc_earned_total()` now sums POSITIVE
--      ledger amounts, which is what "earned" means and cannot shrink.
--
--   2. LOAN SHARK LICENCE IS REACHABLE. The fee stays 500 SC but the balance
--      gate drops 1,500 -> 250. Circulation is ~1,526 and the richest account
--      held 1,317, so the licence could never be bought: a dead feature.
--
--   3. PASSIVE FAUCETS OFF. Quiz performance, daily claim, challenge rewards,
--      referral bonuses and squad rewards no longer create coins. Duel/arena
--      wins are RETAINED (the intended earn path) and premium keeps its
--      one-time 30 SC.
--
--      Gated by a config flag rather than deleted, so the decision is
--      reversible without another migration.
--
-- Signatures were read from pg_proc BEFORE writing this file - notably
-- claim_squad_reward() takes NO arguments and claim_challenge_reward's second
-- argument is a client_request_id, not a user id. Getting either wrong would
-- have created a second overload instead of replacing the live one.
--
-- Idempotent. Re-run safe.
-- ============================================================

-- ---------------------------------------------------------------------------
-- 1. ECONOMY CONFIG
-- ---------------------------------------------------------------------------
insert into public.server_config (key, value)
values ('economy', '{"passive_faucets_enabled": false, "premium_bonus_sc": 30,
                    "duel_wins_enabled": true, "transfers_enabled": true}'::jsonb)
on conflict (key) do update
  set value = server_config.value || excluded.value;

-- ---------------------------------------------------------------------------
-- 2. LIFETIME EARNINGS
-- ---------------------------------------------------------------------------
create or replace function public.sc_earned_total(p_user uuid default null)
returns integer
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_user uuid := coalesce(p_user, auth.uid());
  v_total bigint;
begin
  if v_user is null then
    return 0;
  end if;
  -- Lifetime EARNED = every credit, ignoring debits. Spending, transferring,
  -- borrowing and repaying all reduce the balance but must NOT reduce "earned".
  select coalesce(sum(greatest(l.amount, 0)), 0)
    into v_total
    from public.smart_coin_ledger l
   where l.user_id = v_user
     and l.status = 'verified';
  return least(coalesce(v_total, 0), 2147483647)::integer;
end;
$$;

revoke all on function public.sc_earned_total(uuid) from public, anon;
grant execute on function public.sc_earned_total(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. FAUCET GATE - one predicate, consulted by every faucet.
-- ---------------------------------------------------------------------------
create or replace function public._sc_faucets_enabled()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    (select (c.value ->> 'passive_faucets_enabled')::boolean
       from public.server_config c where c.key = 'economy'),
    true);
$$;

revoke all on function public._sc_faucets_enabled() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. PREMIUM ONE-TIME 30 SC
--
-- Idempotent per user via the ledger, and it SKIPS anyone who already holds a
-- 'premium-30-sc-grant' row (blankdweb@gmail.com got theirs on 2026-09-05).
-- ---------------------------------------------------------------------------
with premium_users as (
  select distinct user_id
    from public.subscriptions
   where status = 'active'
     and (expires_at is null or expires_at > now())
     and (grace_until is null or grace_until > now())
), not_yet as (
  select pu.user_id
    from premium_users pu
   where not exists (
     select 1 from public.smart_coin_ledger l
      where l.user_id = pu.user_id and l.reason = 'premium-30-sc-grant'
   )
), granted as (
  update public.profiles p
     set smart_coins = coalesce(p.smart_coins, 0) + 30
    from not_yet n
   where p.id = n.user_id
  returning p.id
)
insert into public.smart_coin_ledger (user_id, amount, balance_after, reason, transaction_type, status, client_request_id)
select g.id,
       30,
       coalesce((select smart_coins from public.profiles where id = g.id), 30),
       'premium-30-sc-grant',
       'earn',
       'verified',
       md5('premium-30-sc-grant:' || g.id::text)::uuid
  from granted g
-- The live unique index is on client_request_id ALONE and is PARTIAL
-- (`where client_request_id is not null`), so the conflict target must repeat
-- both the column and the predicate - a bare `on conflict (user_id,
-- client_request_id)` cannot infer it and raises 42P10.
on conflict (client_request_id) where client_request_id is not null do nothing;

-- ---------------------------------------------------------------------------
-- 5. LOAN SHARK LICENCE GATE 1500 -> 250
-- ---------------------------------------------------------------------------
update public.server_config
   set value = jsonb_set(value, '{shark_require_balance_sc}', '250'::jsonb)
 where key = 'loan';

-- ---------------------------------------------------------------------------
-- 6. DISABLE THE PASSIVE FAUCETS
--
-- Signatures preserved exactly. Each returns FAUCETS_DISABLED with the caller's
-- current balance, so an existing client shows a real reason instead of a
-- mysterious zero award.
-- ---------------------------------------------------------------------------

-- sc_claim_daily() - +9/day.
create or replace function public.sc_claim_daily()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if not public._sc_faucets_enabled() then
    return jsonb_build_object('ok', false, 'error', 'FAUCETS_DISABLED',
                              'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0));
  end if;
  return jsonb_build_object('ok', false, 'error', 'DAILY_DISABLED');
end;
$$;

-- sc_record_fail_penalty(text, text) - originally -3/day for a failed round.
-- Disabling this matters most: charging someone for failing a quiz while also
-- removing the ways to earn was the worst of both worlds.
-- The live signatures carry parameter DEFAULTS; dropping them in a `create or
-- replace` raises 42P13 ("cannot remove parameter defaults"). They are copied
-- verbatim here.
create or replace function public.sc_record_fail_penalty(p_ref_type text default null, p_ref_id text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  return jsonb_build_object('ok', true, 'amount', 0, 'balance',
    coalesce((select smart_coins from public.profiles where id = v_user), 0));
end;
$$;

-- claim_challenge_reward(text, uuid) - second arg is a client_request_id.
create or replace function public.claim_challenge_reward(p_challenge_key text, p_client_request_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if not public._sc_faucets_enabled() then
    return jsonb_build_object('ok', false, 'error', 'FAUCETS_DISABLED',
                              'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0));
  end if;
  return jsonb_build_object('ok', false, 'error', 'CHALLENGE_REWARD_DISABLED');
end;
$$;

-- claim_squad_reward() - NO ARGUMENTS in the live schema.
create or replace function public.claim_squad_reward()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if not public._sc_faucets_enabled() then
    return jsonb_build_object('ok', false, 'error', 'FAUCETS_DISABLED',
                              'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0));
  end if;
  return jsonb_build_object('ok', false, 'error', 'SQUAD_REWARD_DISABLED');
end;
$$;

-- Quiz performance: apply_quiz_batch_score credited `round(score * 0.1|0.5)`
-- inside the atomic award. The SC credit is removed; player_score (the ranking
-- signal) is untouched, so quizzes still move you up the leaderboard.
create or replace function public.apply_quiz_batch_score(
  p_batch_id uuid,
  p_user_id uuid,
  p_difficulty text default null,
  p_subject text default null,
  p_duration_seconds integer default 0,
  p_group_id bigint default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$

declare
  v_batch public.quiz_batches%rowtype;
  v_user uuid;
  v_award public.player_score_awards%rowtype;
  v_stats public.player_stats%rowtype;
  v_difficulty text;
  v_subject text;
  v_duration int;
  v_group_id bigint;
  v_correct int := 0;
  v_total int := 0;
  v_pct numeric;
  v_threshold int;
  v_passed boolean;
  v_result_id bigint;
  v_replay boolean := false;
  v_fresh boolean := false;
  v_sc_payout int := 0;
  v_sc_awarded boolean := false;
  v_sc_res jsonb;
  v_sc_balance integer := 0;
begin
  v_user := coalesce(auth.uid(), p_user_id);
  if v_user is null then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_batch from public.quiz_batches where id = p_batch_id;
  if not found then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'BATCH_NOT_FOUND');
  end if;
  if v_batch.user_id is distinct from v_user then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'FORBIDDEN');
  end if;

  select * into v_award from public.player_score_awards where batch_id = p_batch_id;
  v_replay := v_award.batch_id is not null;

  update public.quiz_batches
    set status = 'completed', completed_at = coalesce(completed_at, now())
  where id = p_batch_id and status in ('reserved', 'started');

  select count(*) filter (where answered and correct),
         count(*) filter (where answered)
    into v_correct, v_total
  from public.quiz_batch_questions
  where batch_id = p_batch_id;

  v_difficulty := case when p_difficulty in ('Easy','Moderate','Hard','Expert','Master','Extreme') then p_difficulty else 'Easy' end;
  v_subject := left(coalesce(nullif(p_subject, ''), ''), 120);
  v_duration := greatest(0, least(coalesce(p_duration_seconds, 0), 60 * 60 * 24 * 7));
  v_group_id := p_group_id;
  if v_group_id is not null
     and not exists (select 1 from public.study_group_members m where m.user_id = v_user and m.group_id = v_group_id)
     and not public.is_admin() then
    v_group_id := null;
  end if;

  v_pct := case when v_total > 0 then ceil(v_correct * 100.0 / v_total) else 0 end;
  v_threshold := case v_difficulty
    when 'Easy' then 50 when 'Moderate' then 60 when 'Hard' then 70
    when 'Expert' then 75 when 'Master' then 80 when 'Extreme' then 85
    else 60 end;
  v_passed := v_pct >= v_threshold;

  insert into public.quiz_results
    (user_id, mode, difficulty, subject, score, total, passed, duration_seconds, group_id, batch_id)
  values
    (v_user, v_batch.mode, v_difficulty, v_subject, v_correct, v_total, v_passed, v_duration, v_group_id, p_batch_id)
  on conflict (batch_id) do nothing;

  select id into v_result_id from public.quiz_results where batch_id = p_batch_id;

  -- SC performance payout formula (matches the client's historical rate set):
  -- Hard/Expert/Extreme pay 0.5 SC per correct answer, everything else 0.1.
  -- The wallet is integer, so the (score × rate) product is rounded.
  -- v80: passive faucets are OFF, so a quiz round no longer pays coins.
  -- player_score is untouched - quizzes still move you up the leaderboard,
  -- they just do not create Smart Coins. Duel/arena wins still do.
  v_sc_payout := case when public._sc_faucets_enabled()
    then round((v_correct::numeric *
      case when v_difficulty in ('Hard','Expert','Extreme') then 0.5 else 0.1 end))::int
    else 0 end;

  if not v_replay then
    insert into public.player_score_awards
      (batch_id, user_id, player_score_delta, correct_delta, total_delta,
       sc_credited, awarded_at)
    values
      (p_batch_id, v_user, v_correct, v_correct, v_total, v_sc_payout, now())
    on conflict (batch_id) do nothing
    returning * into v_award;
  end if;

  -- Single, atomic fresh-award stage: player_score AND the SC wallet move
  -- together and ONLY on the fresh award, so a retry/replay can never double
  -- credit either of them.
  if not v_replay and v_award.batch_id is not null then
    v_fresh := true;

    insert into public.player_stats
      (user_id, player_score, correct_answers, total_answers, score_achieved_at, updated_at)
    values
      (v_user, v_award.player_score_delta, v_award.correct_delta, v_award.total_delta,
       case when v_award.player_score_delta > 0 then now() end, now())
    on conflict (user_id) do update set
      player_score    = public.player_stats.player_score + excluded.player_score,
      correct_answers = public.player_stats.correct_answers + excluded.correct_answers,
      total_answers   = public.player_stats.total_answers + excluded.total_answers,
      score_achieved_at = case
        when excluded.player_score > 0 then now()
        else public.player_stats.score_achieved_at
      end,
      updated_at = now();

    if v_sc_payout > 0 then
      v_sc_res := public._sc_apply(v_user, v_sc_payout, 'quiz_performance', 'quiz',
                                   'earn', 'quiz_batch',
                                   p_batch_id::text,
                                   jsonb_build_object('course', v_batch.mode,
                                                      'score', v_correct,
                                                      'total', v_total));
      v_sc_awarded := coalesce((v_sc_res ->> 'ok')::boolean, false);
    end if;
  end if;

  select coalesce(smart_coins, 0) into v_sc_balance
  from public.profiles where id = v_user;

  select * into v_stats from public.player_stats where user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'awarded', v_fresh,
    'replay', v_replay,
    'resultId', v_result_id,
    'score', v_correct,
    'total', v_total,
    'passed', v_passed,
    'correctAnswers', v_correct,
    'totalAnswers', v_total,
    'playerScore', coalesce(v_stats.player_score, 0),
    'correctAnswersTotal', coalesce(v_stats.correct_answers, 0),
    'totalAnswersTotal', coalesce(v_stats.total_answers, 0),
    'scAwarded', v_sc_awarded,
    'scBalance', v_sc_balance,
    'difficulty', v_difficulty,
    'subject', v_subject,
    'mode', v_batch.mode,
    'groupId', v_group_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. REFERRAL BONUSES PAID BY A TRIGGER
--
-- The bonus fires on activation, so the flag has to be honoured inside the
-- trigger. The referral ROW is still written (the social graph stays real) but
-- reward_sc is 0 and no coins move.
-- ---------------------------------------------------------------------------
create or replace function public.credit_referral_bonus()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ref uuid;
begin
  if new.is_activated is not true or old.is_activated is true then
    return new;
  end if;

  select p.referrer_id into v_ref from public.profiles p where p.id = new.id;
  if v_ref is null then
    return new;
  end if;

  if not public._sc_faucets_enabled() then
    insert into public.referrals (referrer_id, referred_id, status, reward_sc, credited_at)
    values (v_ref, new.id, 'credited', 0, now())
    on conflict (referred_id) do nothing;
    return new;
  end if;

  insert into public.referrals (referrer_id, referred_id, status, reward_sc, credited_at)
  values (v_ref, new.id, 'credited', 15, now())
  on conflict (referred_id) do update
    set reward_sc = 15, credited_at = now(), status = 'credited';

  update public.profiles
     set smart_coins = coalesce(smart_coins, 0) + 15
   where id = v_ref;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. ACLs re-asserted (this project auto-grants anon+authenticated by default).
-- ---------------------------------------------------------------------------
revoke all on function public.sc_claim_daily() from public, anon;
revoke all on function public.sc_record_fail_penalty(text, text) from public, anon;
revoke all on function public.claim_challenge_reward(text, uuid) from public, anon;
revoke all on function public.claim_squad_reward() from public, anon;
revoke all on function public.credit_referral_bonus() from public, anon, authenticated;

grant execute on function public.sc_claim_daily() to authenticated, service_role;
grant execute on function public.sc_record_fail_penalty(text, text) to authenticated, service_role;
grant execute on function public.claim_challenge_reward(text, uuid) to authenticated, service_role;
grant execute on function public.claim_squad_reward() to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================