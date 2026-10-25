-- ============================================================
-- migration-v109-rival-loans.sql
--
-- Borrower-initiated loans between accepted connections. This is deliberately
-- separate from the older Loan Shark / World Bank tables: those flows have a
-- 48-hour window and their own caps, while these loans let a scholar choose a
-- friend or rival, terms and due date.
--
-- Money movement:
--   accept: lender -principal, borrower +principal
--   repay:  borrower -(principal + interest), lender +(principal + interest)
--   default after grace: borrower -(min(balance, total_due)), lender +same
--
-- Every leg goes through public._sc_apply() in one transaction.
--
-- Idempotent and forward-only. Requires v31 (_sc_apply), v89 (relationships,
-- blocks), v94 (notifications) and v108 (SC requests / social hub).
-- Apply: node scripts/run-migration.mjs scripts/migration-v109-rival-loans.sql
-- ============================================================


-- ###########################################################################
-- 1. CONFIG
-- ###########################################################################

insert into public.server_config (key, value, description)
values (
  'social_loans',
  '{
    "enabled": true,
    "min_principal_sc": 5,
    "max_principal_sc": 50,
    "min_interest_pct": 0,
    "max_interest_pct": 25,
    "min_term_days": 1,
    "max_term_days": 14,
    "borrower_max_active": 1,
    "lender_max_active": 3,
    "lender_max_outstanding_sc": 100,
    "pending_expiry_hours": 72,
    "grace_hours": 24
  }'::jsonb,
  'Friend/rival loans: principal, interest and term caps, lender exposure, pending expiry and grace window'
)
on conflict (key) do update
  set description = excluded.description;


create or replace function public.social_loan_config()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select coalesce(
    public.server_config_get('social_loans'),
    '{"enabled":true,"min_principal_sc":5,"max_principal_sc":50,"min_interest_pct":0,"max_interest_pct":25,"min_term_days":1,"max_term_days":14,"borrower_max_active":1,"lender_max_active":3,"lender_max_outstanding_sc":100,"pending_expiry_hours":72,"grace_hours":24}'::jsonb
  );
$$;

revoke all on function public.social_loan_config() from public, anon;
grant execute on function public.social_loan_config() to authenticated, service_role;


-- ###########################################################################
-- 2. TABLE
-- ###########################################################################

create table if not exists public.social_loans (
  id                    uuid primary key default gen_random_uuid(),
  borrower_id           uuid not null references auth.users(id) on delete cascade,
  lender_id             uuid not null references auth.users(id) on delete cascade,
  principal_sc          integer not null check (principal_sc > 0),
  interest_pct          integer not null default 0,
  interest_sc           integer not null default 0 check (interest_sc >= 0),
  total_due_sc          integer not null default 0 check (total_due_sc >= 0),
  term_days             integer not null default 7,
  note                  text,
  status                text not null default 'pending'
                          check (status in ('pending','active','repaid','defaulted','cancelled','declined','expired')),
  client_request_id     uuid not null default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null default (now() + interval '72 hours'),
  accepted_at           timestamptz,
  due_at                timestamptz,
  grace_ends_at         timestamptz,
  repaid_at             timestamptz,
  defaulted_at          timestamptz,
  recovered_sc          integer not null default 0 check (recovered_sc >= 0),
  forfeited_sc          integer not null default 0 check (forfeited_sc >= 0),
  disbursement_debit_ledger_id  bigint,
  disbursement_credit_ledger_id bigint,
  repayment_debit_ledger_id     bigint,
  repayment_credit_ledger_id    bigint,
  updated_at            timestamptz not null default now(),
  constraint social_loans_no_self check (borrower_id <> lender_id),
  constraint social_loans_client_key unique (borrower_id, client_request_id)
);

create index if not exists idx_social_loans_lender_pending
  on public.social_loans (lender_id, created_at desc) where status = 'pending';
create index if not exists idx_social_loans_borrower_pending
  on public.social_loans (borrower_id, created_at desc) where status = 'pending';
create index if not exists idx_social_loans_lender_active
  on public.social_loans (lender_id, due_at) where status = 'active';
create index if not exists idx_social_loans_borrower_active
  on public.social_loans (borrower_id, due_at) where status = 'active';
create index if not exists idx_social_loans_expiry
  on public.social_loans (expires_at) where status = 'pending';
create index if not exists idx_social_loans_grace
  on public.social_loans (grace_ends_at) where status = 'active';

alter table public.social_loans enable row level security;
revoke all on public.social_loans from public, anon, authenticated;
-- No client policies: reads and writes go through the RPCs below.


-- ###########################################################################
-- 3. INTERNAL SWEEPS
-- ###########################################################################

create or replace function public._social_loan_settle_default(p_loan_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_cfg jsonb := public.social_loan_config();
  v_hours int := coalesce((v_cfg->>'grace_hours')::int, 24);
  v_loan public.social_loans;
  v_balance int;
  v_recover int;
  v_debit jsonb;
  v_credit jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('social_loan:' || p_loan_id::text));

  select * into v_loan
    from public.social_loans
   where id = p_loan_id
     for update;

  if v_loan.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_loan.status = 'defaulted' then
    return jsonb_build_object('ok', true, 'replay', true, 'status', 'defaulted');
  end if;
  if v_loan.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'not_active', 'status', v_loan.status);
  end if;
  if v_loan.grace_ends_at is not null and now() < v_loan.grace_ends_at then
    return jsonb_build_object('ok', false, 'error', 'not_due',
                              'graceEndsAt', v_loan.grace_ends_at);
  end if;

  select coalesce(smart_coins, 0) into v_balance
    from public.profiles where id = v_loan.borrower_id;

  v_recover := least(greatest(coalesce(v_balance, 0), 0), v_loan.total_due_sc);

  if v_recover > 0 then
    v_debit := public._sc_apply(
      v_loan.borrower_id, -v_recover, 'social_loan_default', 'social', 'transfer',
      'social_loan', v_loan.id::text,
      jsonb_build_object('role', 'borrower', 'loan_id', v_loan.id),
      gen_random_uuid()
    );
    if v_debit is null or (v_debit->>'ok')::boolean is not true then
      raise exception 'social_loan_default debit failed for %', p_loan_id;
    end if;

    v_credit := public._sc_apply(
      v_loan.lender_id, v_recover, 'social_loan_default_in', 'social', 'transfer',
      'social_loan', v_loan.id::text,
      jsonb_build_object('role', 'lender', 'loan_id', v_loan.id),
      gen_random_uuid()
    );
    if v_credit is null or (v_credit->>'ok')::boolean is not true then
      raise exception 'social_loan_default credit failed for %', p_loan_id;
    end if;
  end if;

  update public.social_loans
     set status = 'defaulted',
         defaulted_at = now(),
         recovered_sc = v_recover,
         forfeited_sc = greatest(v_loan.total_due_sc - v_recover, 0),
         updated_at = now()
   where id = p_loan_id
   returning * into v_loan;

  perform public.push_notification(
    v_loan.borrower_id, 'loan_defaulted', v_loan.lender_id,
    jsonb_build_object('loanId', v_loan.id, 'amount', v_loan.total_due_sc,
                       'recovered', v_recover, 'href', '/leaderboard?tab=wallet&view=loans',
                       'title', 'Loan overdue'));
  perform public.push_notification(
    v_loan.lender_id, 'loan_defaulted_lender', v_loan.borrower_id,
    jsonb_build_object('loanId', v_loan.id, 'amount', v_loan.total_due_sc,
                       'recovered', v_recover, 'href', '/leaderboard?tab=wallet&view=loans',
                       'title', 'Loan defaulted'));

  return jsonb_build_object('ok', true, 'replay', false, 'status', 'defaulted',
                            'recovered', v_recover,
                            'forfeited', greatest(v_loan.total_due_sc - v_recover, 0),
                            'graceHours', v_hours);
end;
$$;

revoke all on function public._social_loan_settle_default(uuid) from public, anon, authenticated;
grant execute on function public._social_loan_settle_default(uuid) to service_role;


create or replace function public._social_loan_sweep(p_user uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_row record;
  v_count int := 0;
begin
  if p_user is null then return 0; end if;

  for v_row in
    select id, borrower_id
      from public.social_loans
     where status = 'pending'
       and expires_at <= now()
       and (borrower_id = p_user or lender_id = p_user)
     order by expires_at
     limit 50
     for update skip locked
  loop
    update public.social_loans
       set status = 'expired', updated_at = now()
     where id = v_row.id;

    perform public.push_notification(
      v_row.borrower_id, 'loan_expired', null,
      jsonb_build_object('loanId', v_row.id, 'href', '/leaderboard?tab=wallet&view=loans',
                         'title', 'Loan request expired'));
    v_count := v_count + 1;
  end loop;

  for v_row in
    select id
      from public.social_loans
     where status = 'active'
       and grace_ends_at is not null
       and grace_ends_at <= now()
       and (borrower_id = p_user or lender_id = p_user)
     order by grace_ends_at
     limit 50
     for update skip locked
  loop
    perform public._social_loan_settle_default(v_row.id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public._social_loan_sweep(uuid) from public, anon, authenticated;
grant execute on function public._social_loan_sweep(uuid) to service_role;


-- ###########################################################################
-- 4. BORROWER REQUESTS
-- ###########################################################################

create or replace function public.social_loan_request(
  p_lender_id uuid,
  p_principal integer,
  p_interest_pct integer default 0,
  p_term_days integer default 7,
  p_note text default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_cfg jsonb := public.social_loan_config();
  v_min int := coalesce((v_cfg->>'min_principal_sc')::int, 5);
  v_max int := coalesce((v_cfg->>'max_principal_sc')::int, 50);
  v_min_pct int := coalesce((v_cfg->>'min_interest_pct')::int, 0);
  v_max_pct int := coalesce((v_cfg->>'max_interest_pct')::int, 25);
  v_min_days int := coalesce((v_cfg->>'min_term_days')::int, 1);
  v_max_days int := coalesce((v_cfg->>'max_term_days')::int, 14);
  v_expiry_hours int := coalesce((v_cfg->>'pending_expiry_hours')::int, 72);
  v_interest int := coalesce(p_interest_pct, 0);
  v_term int := coalesce(p_term_days, 7);
  v_interest_sc int;
  v_active int;
  v_client uuid := coalesce(p_client_request_id, gen_random_uuid());
  v_loan public.social_loans;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if coalesce((v_cfg->>'enabled')::boolean, true) is not true then
    return jsonb_build_object('ok', false, 'error', 'disabled');
  end if;
  if p_lender_id is null or p_lender_id = v_me then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  if p_principal is null or p_principal < v_min or p_principal > v_max then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount', 'min', v_min, 'max', v_max);
  end if;
  if v_interest < v_min_pct or v_interest > v_max_pct then
    return jsonb_build_object('ok', false, 'error', 'invalid_interest', 'min', v_min_pct, 'max', v_max_pct);
  end if;
  if v_term < v_min_days or v_term > v_max_days then
    return jsonb_build_object('ok', false, 'error', 'invalid_term', 'min', v_min_days, 'max', v_max_days);
  end if;
  if not public._social_pair_accepted(v_me, p_lender_id) then
    return jsonb_build_object('ok', false, 'error', 'not_connected');
  end if;
  if public._blocked_between(v_me, p_lender_id) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;

  perform pg_advisory_xact_lock(hashtext('social_loan_borrower:' || v_me::text));
  perform public._social_loan_sweep(v_me);

  select count(*) into v_active
    from public.social_loans
   where borrower_id = v_me and status = 'active';
  if v_active >= coalesce((v_cfg->>'borrower_max_active')::int, 1) then
    return jsonb_build_object('ok', false, 'error', 'borrower_has_active_loan',
                              'limit', coalesce((v_cfg->>'borrower_max_active')::int, 1));
  end if;

  v_interest_sc := round(p_principal * v_interest / 100.0)::int;

  insert into public.social_loans
    (borrower_id, lender_id, principal_sc, interest_pct, interest_sc,
     total_due_sc, term_days, note, client_request_id, expires_at)
  values
    (v_me, p_lender_id, p_principal, v_interest, v_interest_sc,
     p_principal + v_interest_sc, v_term,
     nullif(left(coalesce(p_note, ''), 200), ''), v_client,
     now() + make_interval(hours => v_expiry_hours))
  on conflict (borrower_id, client_request_id) do nothing
  returning * into v_loan;

  if v_loan.id is null then
    select * into v_loan
      from public.social_loans
     where borrower_id = v_me and client_request_id = v_client;
    return jsonb_build_object('ok', true, 'replay', true, 'loan', to_jsonb(v_loan));
  end if;

  perform public.push_notification(
    p_lender_id, 'loan_request', v_me,
    jsonb_build_object('loanId', v_loan.id, 'amount', v_loan.principal_sc,
                       'interest', v_loan.interest_pct, 'termDays', v_loan.term_days,
                       'href', '/leaderboard?tab=wallet&view=loans',
                       'title', 'Loan request'));

  return jsonb_build_object('ok', true, 'replay', false, 'loan', to_jsonb(v_loan));
end;
$$;

revoke all on function public.social_loan_request(uuid, integer, integer, integer, text, uuid)
  from public, anon;
grant execute on function public.social_loan_request(uuid, integer, integer, integer, text, uuid)
  to authenticated, service_role;


-- ###########################################################################
-- 5. LENDER ACCEPTS / DECLINES
-- ###########################################################################

create or replace function public.social_loan_respond(p_loan_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_cfg jsonb := public.social_loan_config();
  v_active_cap int := coalesce((v_cfg->>'lender_max_active')::int, 3);
  v_outstanding_cap int := coalesce((v_cfg->>'lender_max_outstanding_sc')::int, 100);
  v_grace_hours int := coalesce((v_cfg->>'grace_hours')::int, 24);
  v_loan public.social_loans;
  v_lender_active int;
  v_lender_outstanding int;
  v_borrower_active int;
  v_debit jsonb;
  v_credit jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_loan_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_accept is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_response');
  end if;

  perform public._social_loan_sweep(v_me);
  perform pg_advisory_xact_lock(hashtext('social_loan:' || p_loan_id::text));

  select * into v_loan
    from public.social_loans
   where id = p_loan_id
     for update;

  if v_loan.id is null or v_loan.lender_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_loan.status = 'active' and p_accept then
    return jsonb_build_object('ok', true, 'replay', true, 'status', 'active',
                              'loan', to_jsonb(v_loan));
  end if;
  if v_loan.status = 'declined' and not p_accept then
    return jsonb_build_object('ok', true, 'replay', true, 'status', 'declined');
  end if;
  if v_loan.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', v_loan.status, 'status', v_loan.status);
  end if;
  if v_loan.expires_at <= now() then
    update public.social_loans
       set status = 'expired', updated_at = now()
     where id = v_loan.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if public._blocked_between(v_me, v_loan.borrower_id)
     or not public._social_pair_accepted(v_me, v_loan.borrower_id) then
    update public.social_loans
       set status = 'declined', updated_at = now()
     where id = v_loan.id;
    return jsonb_build_object('ok', false, 'error', 'not_connected');
  end if;

  if not p_accept then
    update public.social_loans
       set status = 'declined', updated_at = now()
     where id = v_loan.id;

    perform public.push_notification(
      v_loan.borrower_id, 'loan_declined', v_me,
      jsonb_build_object('loanId', v_loan.id, 'amount', v_loan.principal_sc,
                         'href', '/leaderboard?tab=wallet&view=loans',
                         'title', 'Loan request declined'));
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  select count(*), coalesce(sum(principal_sc), 0)
    into v_lender_active, v_lender_outstanding
    from public.social_loans
   where lender_id = v_me and status = 'active';

  if v_lender_active >= v_active_cap then
    return jsonb_build_object('ok', false, 'error', 'lender_active_limit',
                              'limit', v_active_cap, 'active', v_lender_active);
  end if;
  if v_lender_outstanding + v_loan.principal_sc > v_outstanding_cap then
    return jsonb_build_object('ok', false, 'error', 'lender_exposure_limit',
                              'limit', v_outstanding_cap,
                              'outstanding', v_lender_outstanding,
                              'requested', v_loan.principal_sc);
  end if;

  select count(*) into v_borrower_active
    from public.social_loans
   where borrower_id = v_loan.borrower_id and status = 'active';
  if v_borrower_active >= coalesce((v_cfg->>'borrower_max_active')::int, 1) then
    return jsonb_build_object('ok', false, 'error', 'borrower_has_active_loan');
  end if;

  v_debit := public._sc_apply(
    v_me, -v_loan.principal_sc, 'social_loan_principal_out', 'social', 'transfer',
    'social_loan', v_loan.id::text,
    jsonb_build_object('role', 'lender', 'loan_id', v_loan.id),
    gen_random_uuid()
  );
  if v_debit is null or (v_debit->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'error', 'lender_insufficient_funds',
                              'required', v_loan.principal_sc);
  end if;

  v_credit := public._sc_apply(
    v_loan.borrower_id, v_loan.principal_sc, 'social_loan_principal_in', 'social', 'transfer',
    'social_loan', v_loan.id::text,
    jsonb_build_object('role', 'borrower', 'loan_id', v_loan.id),
    gen_random_uuid()
  );
  if v_credit is null or (v_credit->>'ok')::boolean is not true then
    raise exception 'social_loan_respond credit failed for loan %', p_loan_id;
  end if;

  update public.social_loans
     set status = 'active',
         accepted_at = now(),
         due_at = now() + make_interval(days => v_loan.term_days),
         grace_ends_at = now() + make_interval(days => v_loan.term_days)
                              + make_interval(hours => v_grace_hours),
         disbursement_debit_ledger_id = (v_debit->>'ledgerId')::bigint,
         disbursement_credit_ledger_id = (v_credit->>'ledgerId')::bigint,
         updated_at = now()
   where id = p_loan_id
   returning * into v_loan;

  perform public.push_notification(
    v_loan.borrower_id, 'loan_accepted', v_me,
    jsonb_build_object('loanId', v_loan.id, 'amount', v_loan.principal_sc,
                       'dueAt', v_loan.due_at, 'href', '/leaderboard?tab=wallet&view=loans',
                       'title', 'Loan funded'));

  return jsonb_build_object('ok', true, 'replay', false, 'status', 'active',
                            'loan', to_jsonb(v_loan),
                            'balanceAfter', (v_debit->>'balanceAfter')::int);
end;
$$;

revoke all on function public.social_loan_respond(uuid, boolean) from public, anon;
grant execute on function public.social_loan_respond(uuid, boolean) to authenticated, service_role;


-- ###########################################################################
-- 6. BORROWER REPAYS
-- ###########################################################################

create or replace function public.social_loan_repay(p_loan_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_loan public.social_loans;
  v_debit jsonb;
  v_credit jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_loan_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  perform public._social_loan_sweep(v_me);
  perform pg_advisory_xact_lock(hashtext('social_loan:' || p_loan_id::text));

  select * into v_loan
    from public.social_loans
   where id = p_loan_id
     for update;

  if v_loan.id is null or v_loan.borrower_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_loan.status = 'repaid' then
    return jsonb_build_object('ok', true, 'replay', true, 'status', 'repaid',
                              'loan', to_jsonb(v_loan));
  end if;
  if v_loan.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', v_loan.status, 'status', v_loan.status);
  end if;

  v_debit := public._sc_apply(
    v_me, -v_loan.total_due_sc, 'social_loan_repayment', 'social', 'transfer',
    'social_loan', v_loan.id::text,
    jsonb_build_object('role', 'borrower', 'loan_id', v_loan.id),
    gen_random_uuid()
  );
  if v_debit is null or (v_debit->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'error', 'insufficient_funds',
                              'required', v_loan.total_due_sc);
  end if;

  v_credit := public._sc_apply(
    v_loan.lender_id, v_loan.total_due_sc, 'social_loan_repayment_in', 'social', 'transfer',
    'social_loan', v_loan.id::text,
    jsonb_build_object('role', 'lender', 'loan_id', v_loan.id),
    gen_random_uuid()
  );
  if v_credit is null or (v_credit->>'ok')::boolean is not true then
    raise exception 'social_loan_repay credit failed for loan %', p_loan_id;
  end if;

  update public.social_loans
     set status = 'repaid',
         repaid_at = now(),
         repayment_debit_ledger_id = (v_debit->>'ledgerId')::bigint,
         repayment_credit_ledger_id = (v_credit->>'ledgerId')::bigint,
         updated_at = now()
   where id = p_loan_id
   returning * into v_loan;

  perform public.push_notification(
    v_loan.lender_id, 'loan_repaid', v_me,
    jsonb_build_object('loanId', v_loan.id, 'amount', v_loan.total_due_sc,
                       'href', '/leaderboard?tab=wallet&view=loans',
                       'title', 'Loan repaid'));

  return jsonb_build_object('ok', true, 'replay', false, 'status', 'repaid',
                            'loan', to_jsonb(v_loan),
                            'balanceAfter', (v_debit->>'balanceAfter')::int);
end;
$$;

revoke all on function public.social_loan_repay(uuid) from public, anon;
grant execute on function public.social_loan_repay(uuid) to authenticated, service_role;


-- ###########################################################################
-- 7. BORROWER CANCELS A PENDING REQUEST
-- ###########################################################################

create or replace function public.social_loan_cancel(p_loan_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  perform public._social_loan_sweep(v_me);

  update public.social_loans
     set status = 'cancelled', updated_at = now()
   where id = p_loan_id
     and borrower_id = v_me
     and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.social_loan_cancel(uuid) from public, anon;
grant execute on function public.social_loan_cancel(uuid) to authenticated, service_role;


-- ###########################################################################
-- 8. LIST
-- ###########################################################################

create or replace function public.social_loans_list(
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(least(coalesce(p_limit, 40), 100), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_incoming jsonb;
  v_outgoing jsonb;
  v_active jsonb;
  v_history jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  perform public._social_loan_sweep(v_me);

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_incoming
    from (
      select jsonb_build_object(
               'loanId', l.id,
               'side', 'lender',
               'userId', l.borrower_id,
               'name', public._person_pair_name(v_me, l.borrower_id),
               'principal', l.principal_sc,
               'interestPct', l.interest_pct,
               'interestSc', l.interest_sc,
               'totalDue', l.total_due_sc,
               'termDays', l.term_days,
               'note', l.note,
               'status', l.status,
               'createdAt', l.created_at,
               'expiresAt', l.expires_at,
               'canRespond', true
             ) as row_obj,
             l.created_at
        from public.social_loans l
       where l.lender_id = v_me
         and l.status = 'pending'
         and l.expires_at > now()
         and not public._blocked_between(v_me, l.borrower_id)
       order by l.created_at desc
       limit v_limit offset v_offset
    ) s;

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_outgoing
    from (
      select jsonb_build_object(
               'loanId', l.id,
               'side', 'borrower',
               'userId', l.lender_id,
               'name', public._person_pair_name(v_me, l.lender_id),
               'principal', l.principal_sc,
               'interestPct', l.interest_pct,
               'interestSc', l.interest_sc,
               'totalDue', l.total_due_sc,
               'termDays', l.term_days,
               'note', l.note,
               'status', l.status,
               'createdAt', l.created_at,
               'expiresAt', l.expires_at,
               'canCancel', true
             ) as row_obj,
             l.created_at
        from public.social_loans l
       where l.borrower_id = v_me
         and l.status = 'pending'
         and l.expires_at > now()
       order by l.created_at desc
       limit v_limit offset v_offset
    ) s;

  select coalesce(jsonb_agg(row_obj order by due_at), '[]'::jsonb)
    into v_active
    from (
      select jsonb_build_object(
               'loanId', l.id,
               'side', case when l.borrower_id = v_me then 'borrower' else 'lender' end,
               'userId', case when l.borrower_id = v_me then l.lender_id else l.borrower_id end,
               'name', public._person_pair_name(v_me,
                         case when l.borrower_id = v_me then l.lender_id else l.borrower_id end),
               'principal', l.principal_sc,
               'interestPct', l.interest_pct,
               'interestSc', l.interest_sc,
               'totalDue', l.total_due_sc,
               'termDays', l.term_days,
               'note', l.note,
               'status', l.status,
               'acceptedAt', l.accepted_at,
               'dueAt', l.due_at,
               'graceEndsAt', l.grace_ends_at,
               'overdue', now() > l.due_at,
               'canRepay', l.borrower_id = v_me
             ) as row_obj,
             l.due_at
        from public.social_loans l
       where l.status = 'active'
         and (l.borrower_id = v_me or l.lender_id = v_me)
       limit v_limit offset v_offset
    ) s;

  select coalesce(jsonb_agg(row_obj order by finished_at desc nulls last), '[]'::jsonb)
    into v_history
    from (
      select jsonb_build_object(
               'loanId', l.id,
               'side', case when l.borrower_id = v_me then 'borrower' else 'lender' end,
               'userId', case when l.borrower_id = v_me then l.lender_id else l.borrower_id end,
               'name', public._person_pair_name(v_me,
                         case when l.borrower_id = v_me then l.lender_id else l.borrower_id end),
               'principal', l.principal_sc,
               'interestPct', l.interest_pct,
               'interestSc', l.interest_sc,
               'totalDue', l.total_due_sc,
               'status', l.status,
               'createdAt', l.created_at,
               'finishedAt', coalesce(l.repaid_at, l.defaulted_at, l.updated_at),
               'recoveredSc', l.recovered_sc,
               'forfeitedSc', l.forfeited_sc
             ) as row_obj,
             coalesce(l.repaid_at, l.defaulted_at, l.updated_at) as finished_at
        from public.social_loans l
       where l.status in ('repaid','defaulted','cancelled','declined','expired')
         and (l.borrower_id = v_me or l.lender_id = v_me)
       order by coalesce(l.repaid_at, l.defaulted_at, l.updated_at) desc
       limit least(v_limit, 25) offset v_offset
    ) s;

  return jsonb_build_object(
    'ok', true,
    'incoming', coalesce(v_incoming, '[]'::jsonb),
    'outgoing', coalesce(v_outgoing, '[]'::jsonb),
    'active', coalesce(v_active, '[]'::jsonb),
    'history', coalesce(v_history, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.social_loans_list(integer, integer) from public, anon;
grant execute on function public.social_loans_list(integer, integer) to authenticated, service_role;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
