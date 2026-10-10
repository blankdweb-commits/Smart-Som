-- ============================================================
-- Apex Scholars Migration v50 — LOAN SHARK (S9)
--
-- SC-only peer-to-peer lending. NO fiat, NO Paystack, NO second/shadow wallet:
-- every SC movement goes through the canonical _sc_apply ledger mutator (v31),
-- so borrowed SC lands in the SAME profiles.smart_coins balance used for wagers
-- (a borrower can duel with borrowed coins; a lender's principal has left their
-- balance and therefore cannot be double-spent or double-wagered).
--
-- Contract (all server-authoritative; clients never write these tables):
--   * Peer-to-peer: the LENDER funds the principal from their own balance on
--     accept; the BORROWER repays principal + interest back to that lender.
--   * Interest: normal loans +10% (config `interest_pct`).
--   * Repayment window: 48h (config `repayment_window_hours`).
--   * Normal lenders: <= 3 concurrent loans (config `normal_max_active_loans`).
--   * Loan Shark license: one-time 500 SC (config `shark_license_fee_sc`),
--     requires a >= 1,500 SC balance (config `shark_require_balance_sc`) and
--     raises the lender cap to 10 (config `shark_max_active_loans`).
--   * Default (48h elapsed, not repaid): sweep whatever SC the borrower has
--     (never below 0 — _sc_apply refuses overdraft) to the lender, mark the loan
--     defaulted, and increment the borrower's public `defaults_count`.
--
-- ISOLATED / NOT AUTO-EXECUTED (flagged for the operator, deliberately NOT
-- implemented here): the borrower-facing threat "you will lose licences and
-- achievements and all data from the first stage". Irreversible data destruction
-- is not a financial flow and is not part of the S9 spec; it is surfaced as a
-- warning + default history only. A future, explicit account-reset action would
-- implement it — see the report.
--
-- Forward-only, idempotent (safe to re-run). Requires v31 (_sc_apply) + v46
-- (server_config) + v49 (ref_id text).
-- Apply: node scripts/_apply-v43.mjs scripts/migration-v50-loan-shark.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. CENTRAL CONFIG
-- ------------------------------------------------------------
insert into public.server_config (key, value, description) values
  ('loan',
   '{"normal_max_active_loans":3,"shark_max_active_loans":10,"interest_pct":10,"repayment_window_hours":48,"shark_license_fee_sc":500,"shark_require_balance_sc":1500,"min_principal_sc":1,"max_principal_sc":100000}'::jsonb,
   'Loan Shark: caps, interest, repayment window and license fee/requirements')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = now();

-- ------------------------------------------------------------
-- 2. LOAN PROFILES (per-user lender license + public default history)
-- ------------------------------------------------------------
create table if not exists public.loan_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  shark_license boolean not null default false,
  shark_license_at timestamptz,
  defaults_count integer not null default 0,
  loans_taken integer not null default 0,
  loans_repaid integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.loan_profiles enable row level security;
revoke all on public.loan_profiles from public, anon, authenticated;
-- Read-own only for clients; lenders see a borrower's defaults via the API
-- (service_role), never a direct table read.
grant select on public.loan_profiles to authenticated;
drop policy if exists loan_profiles_select_own on public.loan_profiles;
create policy loan_profiles_select_own on public.loan_profiles
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. LOANS (request -> offer -> active -> repaid | defaulted)
-- ------------------------------------------------------------
create table if not exists public.loans (
  id uuid primary key default gen_random_uuid(),
  borrower_id uuid not null references auth.users(id) on delete cascade,
  lender_id uuid references auth.users(id) on delete set null,
  principal_sc integer not null check (principal_sc > 0),
  interest_pct integer not null default 10,
  interest_sc integer not null default 0,
  total_due_sc integer not null default 0,
  status text not null default 'requested'
    check (status in ('requested','offered','active','repaid','defaulted','cancelled','rejected','expired')),
  note text,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  offered_at timestamptz,
  accepted_at timestamptz,
  due_at timestamptz,
  repaid_at timestamptz,
  defaulted_at timestamptz,
  recovered_sc integer not null default 0,
  forfeited_sc integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint loans_client_request_key unique (borrower_id, client_request_id)
);

create index if not exists idx_loans_open on public.loans(status) where status = 'requested';
create index if not exists idx_loans_lender on public.loans(lender_id, status);
create index if not exists idx_loans_borrower on public.loans(borrower_id, status);
create index if not exists idx_loans_due on public.loans(due_at) where status = 'active';

alter table public.loans enable row level security;
revoke all on public.loans from public, anon, authenticated;
grant select on public.loans to authenticated;
drop policy if exists loans_select_party on public.loans;
create policy loans_select_party on public.loans
  for select using (auth.uid() = lender_id or auth.uid() = borrower_id);

-- ------------------------------------------------------------
-- 4. Config helper
-- ------------------------------------------------------------
create or replace function public.loan_config()
returns jsonb
language sql
stable
security definer set search_path = public, pg_temp
as $$
  select coalesce(
    public.server_config_get('loan'),
    '{"normal_max_active_loans":3,"shark_max_active_loans":10,"interest_pct":10,"repayment_window_hours":48,"shark_license_fee_sc":500,"shark_require_balance_sc":1500,"min_principal_sc":1,"max_principal_sc":100000}'::jsonb
  );
$$;

-- ------------------------------------------------------------
-- 5. loan_shark_buy — one-time lender license
-- ------------------------------------------------------------
create or replace function public.loan_shark_buy(p_user_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_cfg jsonb := public.loan_config();
  v_fee integer := coalesce((v_cfg->>'shark_license_fee_sc')::int, 500);
  v_req integer := coalesce((v_cfg->>'shark_require_balance_sc')::int, 1500);
  v_bal integer;
  v_licensed boolean;
  v_charge jsonb;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  perform pg_advisory_xact_lock(hashtext('loan_shark:' || p_user_id::text));

  insert into public.loan_profiles (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select shark_license into v_licensed from public.loan_profiles where user_id = p_user_id;
  if v_licensed then
    return jsonb_build_object('ok', true, 'replay', true, 'shark_license', true);
  end if;

  select smart_coins into v_bal from public.profiles where id = p_user_id;
  if coalesce(v_bal, 0) < v_req then
    return jsonb_build_object('ok', false, 'error', 'BALANCE_TOO_LOW',
      'required_sc', v_req, 'balance', coalesce(v_bal, 0));
  end if;

  v_charge := public._sc_apply(p_user_id, -v_fee, 'loan_shark_license', 'loan',
    'spend', 'loan_shark', null, jsonb_build_object('product', 'loan_shark_license'),
    coalesce(p_client_request_id, gen_random_uuid()));
  if v_charge is null or (v_charge->>'ok')::boolean is not true then
    return coalesce(v_charge, jsonb_build_object('ok', false, 'error', 'CHARGE_FAILED'));
  end if;

  update public.loan_profiles
    set shark_license = true, shark_license_at = now(), updated_at = now()
    where user_id = p_user_id;

  return jsonb_build_object('ok', true, 'replay', false, 'shark_license', true,
    'balance_after', (v_charge->>'balanceAfter')::int);
end;
$$;

-- ------------------------------------------------------------
-- 6. loan_request — borrower opens a request
-- ------------------------------------------------------------
create or replace function public.loan_request(
  p_borrower_id uuid, p_principal integer, p_client_request_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_cfg jsonb := public.loan_config();
  v_min integer := coalesce((v_cfg->>'min_principal_sc')::int, 1);
  v_max integer := coalesce((v_cfg->>'max_principal_sc')::int, 100000);
  v_pct integer := coalesce((v_cfg->>'interest_pct')::int, 10);
  v_loan public.loans;
begin
  if p_borrower_id is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  if p_principal is null or p_principal < v_min or p_principal > v_max then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT', 'min', v_min, 'max', v_max);
  end if;

  insert into public.loan_profiles (user_id) values (p_borrower_id)
    on conflict (user_id) do nothing;

  insert into public.loans
    (borrower_id, principal_sc, interest_pct, interest_sc, total_due_sc, status, note, client_request_id)
  values
    (p_borrower_id, p_principal, v_pct,
     round(p_principal * v_pct / 100.0)::int,
     p_principal + round(p_principal * v_pct / 100.0)::int,
     'requested', nullif(left(coalesce(p_note, ''), 200), ''), coalesce(p_client_request_id, gen_random_uuid()))
  on conflict (borrower_id, client_request_id) do nothing
  returning * into v_loan;

  if v_loan.id is null then
    select * into v_loan from public.loans
      where borrower_id = p_borrower_id and client_request_id = coalesce(p_client_request_id, gen_random_uuid());
    return jsonb_build_object('ok', true, 'replay', true, 'loan', to_jsonb(v_loan));
  end if;

  update public.loan_profiles set loans_taken = loans_taken + 1, updated_at = now()
    where user_id = p_borrower_id;

  return jsonb_build_object('ok', true, 'replay', false, 'loan', to_jsonb(v_loan));
end;
$$;

-- ------------------------------------------------------------
-- 7. loan_offer — a lender claims an open request
-- ------------------------------------------------------------
create or replace function public.loan_offer(p_lender_id uuid, p_loan_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_cfg jsonb := public.loan_config();
  v_shark boolean;
  v_cap integer;
  v_active integer;
  v_loan public.loans;
begin
  if p_lender_id is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  perform pg_advisory_xact_lock(hashtext('loan:' || p_loan_id::text));

  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_FOUND'); end if;
  if v_loan.borrower_id = p_lender_id then
    return jsonb_build_object('ok', false, 'error', 'SELF_LENDING');
  end if;
  if v_loan.status <> 'requested' then
    return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_OPEN', 'status', v_loan.status);
  end if;

  insert into public.loan_profiles (user_id) values (p_lender_id)
    on conflict (user_id) do nothing;
  select shark_license into v_shark from public.loan_profiles where user_id = p_lender_id;
  v_cap := case when v_shark then coalesce((v_cfg->>'shark_max_active_loans')::int, 10)
                else coalesce((v_cfg->>'normal_max_active_loans')::int, 3) end;

  select count(*) into v_active from public.loans
    where lender_id = p_lender_id and status in ('offered','active');
  if v_active >= v_cap then
    return jsonb_build_object('ok', false, 'error', 'LENDER_LIMIT', 'cap', v_cap, 'shark_license', v_shark);
  end if;

  update public.loans
    set lender_id = p_lender_id, status = 'offered', offered_at = now(), updated_at = now()
    where id = p_loan_id
    returning * into v_loan;

  return jsonb_build_object('ok', true, 'loan', to_jsonb(v_loan));
end;
$$;

-- ------------------------------------------------------------
-- 8. loan_accept — borrower accepts an offer: transfer principal P2P
-- ------------------------------------------------------------
create or replace function public.loan_accept(p_user_id uuid, p_loan_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_cfg jsonb := public.loan_config();
  v_hours integer := coalesce((v_cfg->>'repayment_window_hours')::int, 48);
  v_loan public.loans;
  v_debit jsonb;
  v_credit jsonb;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  perform pg_advisory_xact_lock(hashtext('loan:' || p_loan_id::text));

  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_FOUND'); end if;
  if v_loan.borrower_id <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'NOT_BORROWER');
  end if;
  if v_loan.status = 'active' then
    return jsonb_build_object('ok', true, 'replay', true, 'loan', to_jsonb(v_loan));
  end if;
  if v_loan.status <> 'offered' then
    return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_OFFERED', 'status', v_loan.status);
  end if;

  -- Debit the lender's principal (refuses below 0), then credit the borrower.
  -- Both run in this one transaction: if the credit fails, the debit rolls back.
  v_debit := public._sc_apply(v_loan.lender_id, -v_loan.principal_sc, 'loan_principal_out', 'loan',
    'transfer', 'loan', v_loan.id::text, jsonb_build_object('role', 'lender', 'loan_id', v_loan.id),
    gen_random_uuid());
  if v_debit is null or (v_debit->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false,
      'error', coalesce(v_debit->>'error', 'LENDER_INSUFFICIENT_FUNDS'));
  end if;

  v_credit := public._sc_apply(v_loan.borrower_id, v_loan.principal_sc, 'loan_principal_in', 'loan',
    'transfer', 'loan', v_loan.id::text, jsonb_build_object('role', 'borrower', 'loan_id', v_loan.id),
    gen_random_uuid());
  if v_credit is null or (v_credit->>'ok')::boolean is not true then
    raise exception 'loan_accept credit failed for loan %', p_loan_id;
  end if;

  update public.loans
    set status = 'active', accepted_at = now(),
        due_at = now() + make_interval(hours => v_hours),
        updated_at = now()
    where id = p_loan_id
    returning * into v_loan;

  return jsonb_build_object('ok', true, 'replay', false, 'loan', to_jsonb(v_loan),
    'borrower_balance', (v_credit->>'balanceAfter')::int);
end;
$$;

-- ------------------------------------------------------------
-- 9. loan_repay — borrower repays principal + interest to the lender
-- ------------------------------------------------------------
create or replace function public.loan_repay(p_user_id uuid, p_loan_id uuid, p_client_request_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_loan public.loans;
  v_debit jsonb;
  v_credit jsonb;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  perform pg_advisory_xact_lock(hashtext('loan:' || p_loan_id::text));

  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_FOUND'); end if;
  if v_loan.borrower_id <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'NOT_BORROWER');
  end if;
  if v_loan.status = 'repaid' then
    return jsonb_build_object('ok', true, 'replay', true, 'loan', to_jsonb(v_loan));
  end if;
  if v_loan.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_ACTIVE', 'status', v_loan.status);
  end if;

  v_debit := public._sc_apply(v_loan.borrower_id, -v_loan.total_due_sc, 'loan_repayment', 'loan',
    'spend', 'loan', v_loan.id::text, jsonb_build_object('role', 'borrower', 'loan_id', v_loan.id),
    coalesce(p_client_request_id, gen_random_uuid()));
  if v_debit is null or (v_debit->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'error', coalesce(v_debit->>'error', 'INSUFFICIENT_FUNDS'),
      'required_sc', v_loan.total_due_sc);
  end if;

  v_credit := public._sc_apply(v_loan.lender_id, v_loan.total_due_sc, 'loan_repayment_in', 'loan',
    'earn', 'loan', v_loan.id::text, jsonb_build_object('role', 'lender', 'loan_id', v_loan.id),
    gen_random_uuid());
  if v_credit is null or (v_credit->>'ok')::boolean is not true then
    raise exception 'loan_repay credit failed for loan %', p_loan_id;
  end if;

  update public.loans
    set status = 'repaid', repaid_at = now(), updated_at = now()
    where id = p_loan_id
    returning * into v_loan;

  update public.loan_profiles set loans_repaid = loans_repaid + 1, updated_at = now()
    where user_id = v_loan.borrower_id;

  return jsonb_build_object('ok', true, 'replay', false, 'loan', to_jsonb(v_loan),
    'borrower_balance', (v_debit->>'balanceAfter')::int);
end;
$$;

-- ------------------------------------------------------------
-- 10. loan_reject / loan_cancel — pre-active drops
-- ------------------------------------------------------------
create or replace function public.loan_reject(p_user_id uuid, p_loan_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_loan public.loans;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  perform pg_advisory_xact_lock(hashtext('loan:' || p_loan_id::text));
  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_FOUND'); end if;
  -- The borrower rejects an offer; the lender withdraws their own offer.
  if v_loan.status = 'offered' and v_loan.borrower_id = p_user_id then
    update public.loans set status = 'rejected', updated_at = now() where id = p_loan_id returning * into v_loan;
    return jsonb_build_object('ok', true, 'loan', to_jsonb(v_loan));
  end if;
  if v_loan.status = 'offered' and v_loan.lender_id = p_user_id then
    update public.loans set status = 'requested', lender_id = null, offered_at = null, updated_at = now()
      where id = p_loan_id returning * into v_loan;
    return jsonb_build_object('ok', true, 'withdrawn', true, 'loan', to_jsonb(v_loan));
  end if;
  return jsonb_build_object('ok', false, 'error', 'NOT_ACTIONABLE', 'status', v_loan.status);
end;
$$;

create or replace function public.loan_cancel(p_user_id uuid, p_loan_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare v_loan public.loans;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'NO_USER'); end if;
  perform pg_advisory_xact_lock(hashtext('loan:' || p_loan_id::text));
  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_FOUND'); end if;
  if v_loan.borrower_id <> p_user_id then
    return jsonb_build_object('ok', false, 'error', 'NOT_BORROWER');
  end if;
  if v_loan.status not in ('requested','offered') then
    return jsonb_build_object('ok', false, 'error', 'NOT_ACTIONABLE', 'status', v_loan.status);
  end if;
  update public.loans set status = 'cancelled', updated_at = now() where id = p_loan_id returning * into v_loan;
  return jsonb_build_object('ok', true, 'loan', to_jsonb(v_loan));
end;
$$;

-- ------------------------------------------------------------
-- 11. loan_mark_default — authorized (partial) recovery after due
-- ------------------------------------------------------------
create or replace function public.loan_mark_default(p_caller_id uuid, p_loan_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_loan public.loans;
  v_bal integer;
  v_recover integer;
  v_debit jsonb;
  v_credit jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('loan:' || p_loan_id::text));

  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.id is null then return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_FOUND'); end if;
  if v_loan.status = 'defaulted' then
    return jsonb_build_object('ok', true, 'replay', true, 'loan', to_jsonb(v_loan));
  end if;
  if v_loan.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'LOAN_NOT_ACTIVE', 'status', v_loan.status);
  end if;
  -- Only the lender (authorized recovery) or the system (null caller) may act.
  if p_caller_id is not null and p_caller_id <> v_loan.lender_id then
    return jsonb_build_object('ok', false, 'error', 'NOT_LENDER');
  end if;
  if v_loan.due_at is not null and now() < v_loan.due_at then
    return jsonb_build_object('ok', false, 'error', 'NOT_DUE', 'due_at', v_loan.due_at);
  end if;

  select coalesce(smart_coins, 0) into v_bal from public.profiles where id = v_loan.borrower_id;
  v_recover := least(greatest(coalesce(v_bal, 0), 0), v_loan.total_due_sc);

  if v_recover > 0 then
    v_debit := public._sc_apply(v_loan.borrower_id, -v_recover, 'loan_default_recovery', 'loan',
      'transfer', 'loan', v_loan.id::text, jsonb_build_object('role', 'borrower', 'loan_id', v_loan.id),
      gen_random_uuid());
    if v_debit is null or (v_debit->>'ok')::boolean is not true then
      raise exception 'loan_default debit failed for loan %', p_loan_id;
    end if;
    v_credit := public._sc_apply(v_loan.lender_id, v_recover, 'loan_default_recovery_in', 'loan',
      'transfer', 'loan', v_loan.id::text, jsonb_build_object('role', 'lender', 'loan_id', v_loan.id),
      gen_random_uuid());
    if v_credit is null or (v_credit->>'ok')::boolean is not true then
      raise exception 'loan_default credit failed for loan %', p_loan_id;
    end if;
  end if;

  update public.loans
    set status = 'defaulted', defaulted_at = now(),
        recovered_sc = v_recover, forfeited_sc = v_loan.total_due_sc - v_recover,
        updated_at = now()
    where id = p_loan_id
    returning * into v_loan;

  update public.loan_profiles set defaults_count = defaults_count + 1, updated_at = now()
    where user_id = v_loan.borrower_id;

  return jsonb_build_object('ok', true, 'replay', false, 'loan', to_jsonb(v_loan),
    'recovered_sc', v_recover, 'forfeited_sc', v_loan.total_due_sc - v_recover);
end;
$$;

-- ------------------------------------------------------------
-- 12. GRANTS — every mutator is service_role only (the API orchestrates).
--    loan_config is callable by the API; nothing here is client-executable.
-- ------------------------------------------------------------
revoke all on function public.loan_config() from public, anon, authenticated;
revoke all on function public.loan_shark_buy(uuid, uuid) from public, anon, authenticated;
revoke all on function public.loan_request(uuid, integer, uuid, text) from public, anon, authenticated;
revoke all on function public.loan_offer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.loan_accept(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.loan_repay(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.loan_reject(uuid, uuid) from public, anon, authenticated;
revoke all on function public.loan_cancel(uuid, uuid) from public, anon, authenticated;
revoke all on function public.loan_mark_default(uuid, uuid) from public, anon, authenticated;

grant execute on function public.loan_config() to service_role;
grant execute on function public.loan_shark_buy(uuid, uuid) to service_role;
grant execute on function public.loan_request(uuid, integer, uuid, text) to service_role;
grant execute on function public.loan_offer(uuid, uuid) to service_role;
grant execute on function public.loan_accept(uuid, uuid, uuid) to service_role;
grant execute on function public.loan_repay(uuid, uuid, uuid) to service_role;
grant execute on function public.loan_reject(uuid, uuid) to service_role;
grant execute on function public.loan_cancel(uuid, uuid) to service_role;
grant execute on function public.loan_mark_default(uuid, uuid) to service_role;
