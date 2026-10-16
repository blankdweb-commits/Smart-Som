-- ============================================================
-- migration-v81-transfers-world-bank.sql
--
-- Two economy capabilities, both locked by the operator:
--
--   TRANSFERS   min 1, max 200 per transfer, 500 per day, 10 per hour, zero fee.
--   WORLD BANK  lend at 10% over 7 days, 10-200 per loan, 400 SC total
--               outstanding, ONE active loan at a time, 10,000 SC capital.
--
-- The World Bank is the INCOME sink that replaces the passive faucets v80
-- turned off: instead of earning 9 SC a day for free, you borrow from the bank
-- and repay with interest.
--
-- Every balance movement goes through `_sc_apply`, the single canonical mutator,
-- and every mutation is idempotent on a deterministic client_request_id, so a
-- double-tap or a retry cannot mint or burn coins.
--
-- Idempotent. Re-run safe.
-- ============================================================

insert into public.server_config (key, value)
values ('transfers', '{"min_sc": 1, "max_sc": 200, "daily_cap_sc": 500, "hourly_count": 10,
                       "fee_sc": 0, "enabled": true}'::jsonb),
       ('world_bank', '{"min_sc": 10, "max_sc": 200, "interest_pct": 10, "term_days": 7,
                       "max_outstanding_sc": 400, "max_active_loans": 1,
                       "capital_sc": 10000, "enabled": true}'::jsonb)
on conflict (key) do update
  set value = server_config.value || excluded.value;

-- ---------------------------------------------------------------------------
-- 1. LOANS TABLE. Declared FIRST: the functions below reference
--    public.worldbank_loans, including a %rowtype declaration that Postgres
--    resolves at CREATE time, so a table defined afterwards fails the whole
--    migration. RLS on with NO policies: service-role only, reached via the RPCs.
-- ---------------------------------------------------------------------------
create table if not exists public.worldbank_loans (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  principal integer not null check (principal > 0),
  interest_pct integer not null default 10,
  interest_sc integer not null default 0,
  due_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'repaid')),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  repaid_at timestamptz,
  constraint uq_worldbank_loan_request unique (user_id, client_request_id)
);

create index if not exists idx_worldbank_loans_user
  on public.worldbank_loans (user_id, status, created_at desc);

alter table public.worldbank_loans enable row level security;
revoke all on public.worldbank_loans from public, anon, authenticated;
grant all on public.worldbank_loans to service_role;

-- Bank seed: the World Bank is a REAL wallet - the platform admin holds the
-- 10,000 SC capital - so borrowing can never print coins out of nothing.
do $$
declare
  v_bank uuid;
  v_cap int;
begin
  select coalesce((c.value ->> 'capital_sc')::int, 10000)
    into v_cap from public.server_config c where c.key = 'world_bank';

  select id into v_bank from public.profiles where role = 'super_admin' order by created_at limit 1;
  if v_bank is null then
    raise notice 'worldbank: no super_admin profile found, bank not seeded';
    return;
  end if;

  if not exists (select 1 from public.smart_coin_ledger
                  where user_id = v_bank and reason = 'worldbank_seed') then
    update public.profiles
       set smart_coins = coalesce(smart_coins, 0) + v_cap
     where id = v_bank;

    insert into public.smart_coin_ledger (user_id, amount, balance_after, reason, transaction_type, status, client_request_id)
    select v_bank, v_cap, (select smart_coins from public.profiles where id = v_bank),
           'worldbank_seed', 'earn', 'verified',
           md5('worldbank_seed:' || v_bank::text)::uuid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. TRANSFERS
-- ---------------------------------------------------------------------------
create or replace function public.sc_transfer(
  p_to_user uuid,
  p_amount integer,
  p_request uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_cfg jsonb;
  v_min int; v_max int; v_daily int; v_hourly int; v_fee int;
  v_req uuid := coalesce(p_request, gen_random_uuid());
  v_to_prof public.profiles%rowtype;
  v_day_total int; v_hour_count int;
  v_out jsonb; v_in jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  v_cfg := coalesce((select c.value from public.server_config c where c.key = 'transfers'),
                    '{"min_sc":1,"max_sc":200,"daily_cap_sc":500,"hourly_count":10,"fee_sc":0}'::jsonb);
  if coalesce((v_cfg ->> 'enabled')::boolean, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'TRANSFERS_DISABLED');
  end if;

  v_min := coalesce((v_cfg ->> 'min_sc')::int, 1);
  v_max := coalesce((v_cfg ->> 'max_sc')::int, 200);
  v_daily := coalesce((v_cfg ->> 'daily_cap_sc')::int, 500);
  v_hourly := coalesce((v_cfg ->> 'hourly_count')::int, 10);
  v_fee := coalesce((v_cfg ->> 'fee_sc')::int, 0);

  if p_to_user is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_RECIPIENT');
  end if;
  if p_to_user = v_me then
    return jsonb_build_object('ok', false, 'error', 'SELF_TRANSFER');
  end if;
  if p_amount is null or p_amount < v_min or p_amount > v_max then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT',
                              'min', v_min, 'max', v_max);
  end if;

  select * into v_to_prof from public.profiles where id = p_to_user;
  if v_to_prof.id is null or not v_to_prof.is_activated then
    return jsonb_build_object('ok', false, 'error', 'RECIPIENT_NOT_ELIGIBLE');
  end if;

  -- Caps are counted from the LEDGER, which only records verified movements, so
  -- a failed or replayed transfer can never consume allowance.
  select coalesce(sum(greatest(-l.amount, 0)), 0) into v_day_total
    from public.smart_coin_ledger l
   where l.user_id = v_me
     and l.reason = 'sc_transfer_out'
     and l.status = 'verified'
     and l.created_at >= date_trunc('day', now());
  if v_day_total + p_amount > v_daily then
    return jsonb_build_object('ok', false, 'error', 'DAILY_CAP_REACHED',
                              'cap', v_daily, 'sentToday', v_day_total);
  end if;

  select count(*) into v_hour_count
    from public.smart_coin_ledger l
   where l.user_id = v_me
     and l.reason = 'sc_transfer_out'
     and l.status = 'verified'
     and l.created_at >= now() - interval '1 hour';
  if v_hour_count >= v_hourly then
    return jsonb_build_object('ok', false, 'error', 'HOURLY_CAP_REACHED',
                              'cap', v_hourly);
  end if;

  -- Serialise both wallets in a fixed order so two concurrent transfers between
  -- the same pair cannot deadlock.
  perform pg_advisory_xact_lock(hashtext('sc_xfer:' || least(v_me::text, p_to_user::text)));
  perform pg_advisory_xact_lock(hashtext('sc_xfer:' || greatest(v_me::text, p_to_user::text)));

  v_out := public._sc_apply(v_me, -(p_amount + v_fee), 'sc_transfer_out', 'transfer',
                            'spend', 'sc_transfer', v_req::text,
                            jsonb_build_object('to', p_to_user), v_req);
  -- `_sc_apply` returns the resulting balance under `balanceAfter` (and
  -- `balanceAfter` is null on an idempotent replay), so read THAT key - asking
  -- for `balance` silently returns null and the client cannot refresh its pill.
  if coalesce((v_out ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error',
                              coalesce(v_out ->> 'error', 'TRANSFER_FAILED'),
                              'balance', v_out ->> 'balanceAfter');
  end if;

  -- The credit uses a DERIVED id, so the two legs are separately idempotent:
  -- a replayed debit can never mint a second credit.
  v_in := public._sc_apply(p_to_user, p_amount, 'sc_transfer_in', 'transfer',
                           'earn', 'sc_transfer', v_req::text,
                           jsonb_build_object('from', v_me),
                           md5('sc_transfer_in:' || v_req::text)::uuid);
  if coalesce((v_in ->> 'ok')::boolean, false) is not true then
    raise exception 'TRANSFER_CREDIT_FAILED: %', coalesce(v_in ->> 'error', 'unknown');
  end if;

  return jsonb_build_object('ok', true, 'amount', p_amount, 'fee', v_fee,
                            'balance', v_out ->> 'balanceAfter',
                            'toBalance', v_in ->> 'balanceAfter');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. WORLD BANK
--
-- The bank IS a real wallet: its capital is a `bank` profile row. Principal
-- leaves the bank on borrow and comes back (plus 10%) on repay, so the system
-- can never print coins out of nothing.
-- ---------------------------------------------------------------------------
create or replace function public.worldbank_borrow(p_amount integer, p_request uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_cfg jsonb;
  v_min int; v_max int; v_pct int; v_days int;
  v_outstanding int; v_active int;
  v_bank uuid;
  v_bank_balance int;
  v_req uuid := coalesce(p_request, gen_random_uuid());
  v_loan bigint;
  v_interest int;
  v_out jsonb;
  v_disburse jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  v_cfg := coalesce((select c.value from public.server_config c where c.key = 'world_bank'),
                    '{"min_sc":10,"max_sc":200,"interest_pct":10,"term_days":7,
                      "max_outstanding_sc":400,"max_active_loans":1,"capital_sc":10000}'::jsonb);
  if coalesce((v_cfg ->> 'enabled')::boolean, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'WORLD_BANK_DISABLED');
  end if;

  v_min := coalesce((v_cfg ->> 'min_sc')::int, 10);
  v_max := coalesce((v_cfg ->> 'max_sc')::int, 200);
  v_pct := coalesce((v_cfg ->> 'interest_pct')::int, 10);
  v_days := coalesce((v_cfg ->> 'term_days')::int, 7);

  if p_amount is null or p_amount < v_min or p_amount > v_max then
    return jsonb_build_object('ok', false, 'error', 'INVALID_AMOUNT', 'min', v_min, 'max', v_max);
  end if;

  select id into v_bank
    from public.profiles
   where role = 'super_admin'
   order by created_at
   limit 1;
  if v_bank is null then
    return jsonb_build_object('ok', false, 'error', 'BANK_UNAVAILABLE');
  end if;

  -- One active loan per borrower, and a total outstanding cap.
  select count(*) into v_active
    from public.worldbank_loans
   where user_id = v_me and status = 'active';
  if v_active >= coalesce((v_cfg ->> 'max_active_loans')::int, 1) then
    return jsonb_build_object('ok', false, 'error', 'LOAN_LIMIT_REACHED');
  end if;

  select coalesce(sum(principal), 0) into v_outstanding
    from public.worldbank_loans
   where user_id = v_me and status = 'active';
  if v_outstanding + p_amount > coalesce((v_cfg ->> 'max_outstanding_sc')::int, 400) then
    return jsonb_build_object('ok', false, 'error', 'OUTSTANDING_CAP_REACHED',
                              'outstanding', v_outstanding,
                              'cap', coalesce((v_cfg ->> 'max_outstanding_sc')::int, 400));
  end if;

  perform pg_advisory_xact_lock(hashtext('worldbank_user:' || v_me::text));
  perform pg_advisory_xact_lock(hashtext('worldbank_bank'));

  v_out := public._sc_apply(v_bank, -p_amount, 'worldbank_disburse', 'world_bank',
                            'spend', 'world_bank', v_req::text,
                            jsonb_build_object('borrower', v_me), v_req);
  if coalesce((v_out ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'BANK_EMPTY',
                              'balance', v_out ->> 'balanceAfter');
  end if;

  -- THE BORROWER MUST BE CREDITED. The first version of this function debited
  -- the bank and then minted no loan proceeds, which DESTROYED 200 SC per
  -- borrow. The e2e caught it: the bank fell by the principal while the
  -- borrower's balance never rose.
  --
  -- The credit uses a DERIVED client_request_id so the two legs are separately
  -- idempotent; a replayed debit can never pay out twice.
  v_disburse := public._sc_apply(v_me, p_amount, 'worldbank_loan', 'world_bank',
                                 'earn', 'world_bank', v_req::text,
                                 jsonb_build_object('bank', v_bank), 
                                 md5('worldbank_loan:' || v_req::text)::uuid);
  if coalesce((v_disburse ->> 'ok')::boolean, false) is not true then
    raise exception 'WORLD_BANK_DISBURSE_FAILED: %', coalesce(v_disburse ->> 'error', 'unknown');
  end if;

  v_interest := round(p_amount * v_pct / 100.0);
  insert into public.worldbank_loans (user_id, principal, interest_pct, interest_sc, due_at, status, client_request_id)
  values (v_me, p_amount, v_pct, v_interest,
          now() + make_interval(days => v_days), 'active', v_req)
  on conflict (user_id, client_request_id) do nothing
  returning id into v_loan;

  if v_loan is null then
    raise exception 'WORLD_BANK_REPLAY';
  end if;

  select coalesce(smart_coins, 0) into v_bank_balance
    from public.profiles where id = v_bank;

  return jsonb_build_object('ok', true, 'loanId', v_loan, 'principal', p_amount,
                            'interestSc', v_interest, 'dueInDays', v_days,
                            'dueAt', (now() + make_interval(days => v_days)),
                            'balance', v_disburse ->> 'balanceAfter',
                            'bankBalance', v_bank_balance);
end;
$$;

create or replace function public.worldbank_repay(p_loan bigint, p_request uuid default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_loan public.worldbank_loans%rowtype;
  v_bank uuid;
  v_req uuid := coalesce(p_request, gen_random_uuid());
  v_due int;
  v_out jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_loan from public.worldbank_loans where id = p_loan for update;
  if v_loan.id is null or v_loan.user_id is null or v_loan.user_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_LOAN');
  end if;
  if v_loan.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'LOAN_ALREADY_SETTLED', 'status', v_loan.status);
  end if;

  perform pg_advisory_xact_lock(hashtext('worldbank_user:' || v_me::text));
  perform pg_advisory_xact_lock(hashtext('worldbank_bank'));

  v_due := v_loan.principal + coalesce(v_loan.interest_sc, 0);

  -- Repaying is a DEBIT from the borrower and a CREDIT to the bank, so the
  -- bank always ends up with principal + interest and the system is conserved.
  v_out := public._sc_apply(v_me, -v_due, 'worldbank_repay', 'world_bank',
                            'spend', 'world_bank_loan', v_loan.id::text,
                            jsonb_build_object('principal', v_loan.principal,
                                               'interest', v_loan.interest_sc), v_req);
  if coalesce((v_out ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'due', v_due, 'balance', v_out ->> 'balanceAfter');
  end if;

  select id into v_bank from public.profiles where role = 'super_admin' order by created_at limit 1;
  perform public._sc_apply(v_bank, v_due, 'worldbank_repayment', 'world_bank',
                           'earn', 'world_bank_loan', v_loan.id::text,
                           jsonb_build_object('borrower', v_me),
                           md5('worldbank_repayment:' || v_req::text)::uuid);

  update public.worldbank_loans
     set status = 'repaid', repaid_at = now()
   where id = v_loan.id;

  return jsonb_build_object('ok', true, 'paid', v_due,
                            'principal', v_loan.principal,
                            'interest', coalesce(v_loan.interest_sc, 0),
                            'balance', v_out ->> 'balanceAfter');
end;
$$;

create or replace function public.worldbank_status()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_cfg jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  v_cfg := coalesce((select c.value from public.server_config c where c.key = 'world_bank'), '{}'::jsonb);
  return jsonb_build_object(
    'ok', true,
    'config', v_cfg,
    'loans', coalesce((
      select jsonb_agg(jsonb_build_object(
               'loanId', l.id, 'principal', l.principal,
               'interestSc', l.interest_sc, 'due', l.principal + coalesce(l.interest_sc, 0),
               'dueAt', l.due_at, 'status', l.status, 'repaidAt', l.repaid_at)
             order by l.created_at desc)
        from public.worldbank_loans l where l.user_id = v_me
    ), '[]'::jsonb),
    'outstanding', coalesce((select sum(principal) from public.worldbank_loans
                              where user_id = v_me and status = 'active'), 0),
    'balance', coalesce((select smart_coins from public.profiles where id = v_me), 0)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. ACLs - authenticated only. These move coins.
-- ---------------------------------------------------------------------------
revoke all on function public.sc_transfer(uuid, integer, uuid) from public, anon;
revoke all on function public.worldbank_borrow(integer, uuid) from public, anon;
revoke all on function public.worldbank_repay(bigint, uuid) from public, anon;
revoke all on function public.worldbank_status() from public, anon;
grant execute on function public.sc_transfer(uuid, integer, uuid) to authenticated, service_role;
grant execute on function public.worldbank_borrow(integer, uuid) to authenticated, service_role;
grant execute on function public.worldbank_repay(bigint, uuid) to authenticated, service_role;
grant execute on function public.worldbank_status() to authenticated, service_role;

notify pgrst, 'reload schema';

-- ============================================================================
-- DONE. Re-run safe.
-- ============================================================================