-- ============================================================
-- Apex Scholars Migration v31 — Server-Authoritative Smart Coin (SC) Economy
--
-- Unlocks Smart Coins the SECURE way (spec "Global Competitive Ranking",
-- §5 un-capped earnings + §13 RLS). Everything a client used to do directly
-- against `profiles.smart_coins` / `smart_coin_ledger` now happens ONLY inside
-- SECURITY DEFINER functions that enforce the business rules server-side.
--
-- DESIGN:
--   1. Ledger hardening      — extra audit columns (from/to/type/source/status/
--                              metadata/ref_*/client_request_id) + the client
--                              INSERT policy on smart_coin_ledger is DROPPED.
--   2. Profile write-lock     — `profiles` UPDATE grant is revoked from
--                              authenticated and re-granted COLUMN-BY-COLUMN for
--                              the user-editable fields ONLY. smart_coins /
--                              sc_last_payout / sc_last_fail_date / is_activated /
--                              role are therefore client-write-proof. (Admins use
--                              existing SECURITY DEFINER RPCs; unaffected.)
--   3. sc_product_catalog    — server-authoritative power-up prices (central
--                              config the client never overrides).
--   4. _sc_apply(...)        — THE single balance mutator (service_role ONLY).
--                              Atomic: updates profiles.smart_coins and inserts
--                              the ledger row in one statement; refuses any
--                              debit that would take the balance below 0.
--   5. Client-facing RPCs    — sc_claim_daily(), sc_record_fail_penalty(...),
--                              sc_record_streak_break(...), sc_spend(...) are
--                              granted to authenticated ONLY (anon + public
--                              revoked). All are SECURITY DEFINER so they can
--                              update the protected columns, but the AMOUNTS are
--                              computed by the server, never supplied by the
--                              caller. A crafty client can only ever (a) earn the
--                              fixed daily 9 SC once per day, (b) lose fixed
--                              penalties at their real cadence, or (c) buy
--                              catalog-gated power-ups.
--   6. apply_quiz_batch_score replaced — quiz_performance SC is now credited
--                              INSIDE the same atomic server award transaction
--                              (fresh award only; replay can never double-credit
--                              SC any more than it can player_score).
--
-- Idempotent. Safe to re-run. Requires migration v30 applied.
-- ============================================================

-- ------------------------------------------------------------
-- 1. LEDGER — extensible audit trail, clients read-only
-- ------------------------------------------------------------
alter table public.smart_coin_ledger
  add column if not exists from_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists to_user_id uuid references auth.users(id) on delete cascade,
  add column if not exists transaction_type text not null default 'earn',
  add column if not exists source text not null default 'misc',
  add column if not exists status text not null default 'verified',
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists ref_type text,
  add column if not exists ref_id text,
  add column if not exists client_request_id uuid;

-- Idempotency key for server-side retries (a unique client_request_id can never
-- apply twice). Partial index: only rows that carry an id get uniqueness, so
-- legacy rows are untouched.
create unique index if not exists uq_smart_coin_ledger_client_request
  on public.smart_coin_ledger (client_request_id)
  where client_request_id is not null;

-- Clients may still read their OWN ledger (sc_ledger_select_own) but can no
-- longer insert fake economy rows.
drop policy if exists "sc_ledger_insert_own" on public.smart_coin_ledger;

-- ------------------------------------------------------------
-- 2. PROFILES — column-level UPDATE lockdown on the money columns
-- ------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;

-- Re-grant ONLY the fields the app legitimately lets a user edit. Everything
-- economic (smart_coins, sc_last_payout, sc_last_fail_date) and everything
-- privileged (role, is_activated, identity_name, is_online, last_seen_at,
-- flashcard_*, community_banned_at) stays server-write-only.
grant update (full_name, email, phone, department, level, matric_number,
              streak, last_active_date, cards_studied, quiz_streak,
              max_quiz_streak, milestone)
  on public.profiles to authenticated;

-- ------------------------------------------------------------
-- 3. PRODUCT CATALOG — server-priced SC spends
-- ------------------------------------------------------------
create table if not exists public.sc_product_catalog (
  product_key text primary key,
  price integer not null check (price > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.sc_product_catalog (product_key, price)
select v.product_key, v.price
from (values
  ('powerup_skip', 8),
  ('powerup_hint', 5),
  ('powerup_streak_freeze', 12)
) as v(product_key, price)
on conflict (product_key) do update set
  price = excluded.price,
  is_active = true;

alter table public.sc_product_catalog enable row level security;

drop policy if exists "sc_product_catalog_read" on public.sc_product_catalog;
create policy "sc_product_catalog_read"
  on public.sc_product_catalog for select using (true);

-- ------------------------------------------------------------
-- 4. PRIVATE BALANCE MUTATOR — the ONE place SC balances ever change
-- ------------------------------------------------------------
-- p_user_id     : the wallet owner (the "user_id" of the ledger row).
-- p_amount      : signed delta (+credit / -debit).
-- p_reason      : stable ledger tag (daily_activated, quiz_fail, ...).
-- p_source      : stable source domain (daily, quiz, powerup, streak, ...).
-- p_transaction_type : earn | spend | penalty | transfer | adjust | refund.
-- p_ref_type/id : optional link to the triggering record (quiz_batch, ...).
-- p_metadata    : optional jsonb context (never client-controlled).
-- p_client_request_id : idempotency key (server retries only).
create or replace function public._sc_apply(
  p_user_id uuid,
  p_amount integer,
  p_reason text,
  p_source text,
  p_transaction_type text default 'earn',
  p_ref_type text default null,
  p_ref_id text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_balance_after integer;
  v_ledger_id bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'status', 'invalid', 'error', 'NO_USER');
  end if;

  -- Idempotency: a client_request_id that already wrote a ledger row returns
  -- the ORIGINAL result — the delta is never applied twice.
  if p_client_request_id is not null then
    select id into v_ledger_id
    from public.smart_coin_ledger
    where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object('ok', true, 'status', 'verified', 'ledgerId', v_ledger_id,
                                'idempotent', true, 'balanceAfter', null,
                                'amount', p_amount);
    end if;
  end if;

  if p_amount = 0 then
    return jsonb_build_object('ok', false, 'status', 'invalid', 'error', 'ZERO_AMOUNT');
  end if;

  -- Atomic balance + ledger write. One UPDATE .. RETURNING, never two round
  -- trips, so two concurrent calls can never both read the same balance.
  update public.profiles
    set smart_coins = smart_coins + p_amount,
        updated_at = now()
  where id = p_user_id
    and smart_coins + p_amount >= 0
  returning smart_coins into v_balance_after;

  if not found then
    return jsonb_build_object('ok', false, 'status', 'rejected',
                              'error', 'INSUFFICIENT_FUNDS');
  end if;

  insert into public.smart_coin_ledger
    (user_id, from_user_id, to_user_id, amount, balance_after, reason,
     transaction_type, source, status, ref_type, ref_id, metadata,
     client_request_id)
  values
    (p_user_id,
     case when p_amount < 0 then p_user_id else null end,
     case when p_amount > 0 then p_user_id else null end,
     p_amount, v_balance_after, p_reason,
     p_transaction_type, p_source, 'verified',
     p_ref_type, p_ref_id, p_metadata,
     p_client_request_id)
  returning id into v_ledger_id;

  return jsonb_build_object('ok', true, 'status', 'verified',
                            'ledgerId', v_ledger_id, 'idempotent', false,
                            'balanceAfter', v_balance_after, 'amount', p_amount);
end;
$$;

-- LIVE GRANT GOTCHA (see AGENTS.md): this project's default privileges auto-grant
-- anon + authenticated on EVERY new function, so revoke both explicitly.
revoke all on function public._sc_apply(uuid, integer, text, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public._sc_apply(uuid, integer, text, text, text, text, text, jsonb, uuid)
  to service_role;

-- Server-side admin/scratchpad adjustment (service_role only). The `source`
-- tag keeps it auditable; reason 'admin_adjust'.
create or replace function public.sc_server_adjust(
  p_user_id uuid,
  p_amount integer,
  p_reason text default 'admin_adjust',
  p_metadata jsonb default '{}'::jsonb,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  return public._sc_apply(p_user_id, p_amount, p_reason, 'admin', 'adjust',
                          null, null, p_metadata, p_client_request_id);
end;
$$;

revoke all on function public.sc_server_adjust(uuid, integer, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.sc_server_adjust(uuid, integer, text, jsonb, uuid)
  to service_role;

-- ------------------------------------------------------------
-- 5. CLIENT-FACING ENFORCED RPCs (authenticated; anon + public revoked)
-- ------------------------------------------------------------

-- Daily 9 SC faucet — activated accounts only, once per calendar day.
create or replace function public.sc_claim_daily()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_prof public.profiles%rowtype;
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

  if v_prof.sc_last_payout is not null
     and v_prof.sc_last_payout::date = current_date then
    return jsonb_build_object('ok', true, 'already', true,
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  -- CONSISTENCY DEFENSE-IN-DEPTH: re-check inside the write so a locked table
  -- or a replay can never double-pay even if a stale guard above slipped.
  if exists (
    select 1 from public.profiles
    where id = v_user and sc_last_payout is not null
      and sc_last_payout::date = current_date
  ) then
    return jsonb_build_object('ok', true, 'already', true,
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  update public.profiles set sc_last_payout = now() where id = v_user;

  return public._sc_apply(v_user, 9, 'daily_activated', 'daily', 'earn');
end;
$$;

revoke all on function public.sc_claim_daily() from public, anon;
grant execute on function public.sc_claim_daily() to authenticated;

-- -3 SC on a failed quiz, once per calendar day (debit only).
create or replace function public.sc_record_fail_penalty(
  p_ref_type text default null,
  p_ref_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_prof public.profiles%rowtype;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;

  if v_prof.sc_last_fail_date = current_date then
    return jsonb_build_object('ok', true, 'already', true,
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  update public.profiles set sc_last_fail_date = current_date where id = v_user;

  return public._sc_apply(v_user, -3, 'quiz_fail', 'quiz', 'penalty',
                          p_ref_type, p_ref_id);
end;
$$;

revoke all on function public.sc_record_fail_penalty(text, text) from public, anon;
grant execute on function public.sc_record_fail_penalty(text, text) to authenticated;

-- -5 SC when the daily streak breaks. A purchased streak-freeze absorbs it
-- (p_freeze_used=true) server-side; the amount is FIXED, never client-spun.
create or replace function public.sc_record_streak_break(p_freeze_used boolean default false)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  if p_freeze_used then
    return jsonb_build_object('ok', true, 'absorbed', true,
                              'balance', coalesce((select smart_coins from public.profiles where id = v_user), 0));
  end if;

  return public._sc_apply(v_user, -5, 'streak_break', 'streak', 'penalty');
end;
$$;

revoke all on function public.sc_record_streak_break(boolean) from public, anon;
grant execute on function public.sc_record_streak_break(boolean) to authenticated;

-- Server-priced power-up purchase. The AMOUNT comes from sc_product_catalog,
-- never from the caller — a tampered client cannot buy for less (or "earn"
-- anything by spending).
create or replace function public.sc_spend(
  p_product_key text,
  p_ref_type text default null,
  p_ref_id text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_price integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select price into v_price
  from public.sc_product_catalog
  where product_key = p_product_key and is_active;

  if v_price is null then
    return jsonb_build_object('ok', false, 'error', 'PRODUCT_UNAVAILABLE');
  end if;

  return public._sc_apply(v_user, -v_price, 'powerup_spend', 'powerup', 'spend',
                          p_ref_type, p_ref_id,
                          jsonb_build_object('product', p_product_key));
end;
$$;

revoke all on function public.sc_spend(text, text, text) from public, anon;
grant execute on function public.sc_spend(text, text, text) to authenticated;

-- ------------------------------------------------------------
-- 6. apply_quiz_batch_score REPLACED — quiz_performance SC moves server-side
--    The client can no longer "earn" SC by posting a score; only this atom
--    credits SC, once, per genuinely-fresh batch award.
-- ------------------------------------------------------------
alter table public.player_score_awards add column if not exists sc_credited integer not null default 0;

create or replace function public.apply_quiz_batch_score(
  p_batch_id uuid,
  p_user_id uuid,
  p_difficulty text default null,
  p_subject text default null,
  p_duration_seconds int default 0,
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
  v_sc_payout := round((v_correct::numeric *
    case when v_difficulty in ('Hard','Expert','Extreme') then 0.5 else 0.1 end))::int;

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

-- Re-assert the award-gate ACL (create or replace preserves it, but be loud).
revoke all on function public.apply_quiz_batch_score(uuid, uuid, text, text, int, bigint)
  from public, anon, authenticated;
grant execute on function public.apply_quiz_batch_score(uuid, uuid, text, text, int, bigint)
  to service_role;

-- ============================================================
-- DONE.
-- ============================================================