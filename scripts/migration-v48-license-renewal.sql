-- ============================================================
-- Apex Scholars Migration v48 — NURSING LICENSE RENEWAL (S8)
--
-- Server-authoritative nursing-license lifecycle. Nothing here invents an
-- external licensing authority, CPD requirement, or legal rule that the
-- milestone did not specify — only the fields the milestone defines:
--   * 12-month validity
--   * renewal exam: 100 SC, 50 questions, >=80% to pass
--   * 24h retry cooldown after a FAILED attempt
--   * dashboard status + attempt history
--
-- Tables are READ-own for authenticated users, WRITE service_role only (the
-- API orchestrates every mutation and also charges the SC fee through the
-- canonical _sc_apply), so a client can never award itself a license or a pass.
--
-- Forward-only, idempotent (safe to re-run).
-- Requires v31 (_sc_apply) for the fee path.
-- Apply: node scripts/_apply-v43.mjs scripts/migration-v48-license-renewal.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. CENTRAL CONFIG (server_config, created in v46)
-- ------------------------------------------------------------
insert into public.server_config (key, value, description) values
  ('license_renewal',
   '{"fee_sc":100,"question_count":50,"pass_pct":80,"retry_cooldown_hours":24,"validity_months":12,"reminder_days":[30,7,1]}'::jsonb,
   'Nursing license validity + renewal exam cost/format/pass + reminder windows')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = now();

-- ------------------------------------------------------------
-- 2. NURSING LICENSES (one per user)
-- ------------------------------------------------------------
create table if not exists public.nursing_licenses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'valid' check (status in ('valid', 'expired', 'suspended')),
  renewed_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.nursing_licenses enable row level security;
revoke all on public.nursing_licenses from public, anon, authenticated;
grant select on public.nursing_licenses to authenticated;

drop policy if exists nursing_licenses_select_own on public.nursing_licenses;
create policy nursing_licenses_select_own on public.nursing_licenses
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. RENEWAL ATTEMPTS (one row per exam sitting / idempotency unit)
-- ------------------------------------------------------------
create table if not exists public.license_renewal_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  score integer,
  total integer,
  passed boolean,
  fee_sc integer not null default 0,
  batch_id uuid,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint license_renewal_attempts_client_request_key unique (user_id, client_request_id)
);

create index if not exists idx_license_attempts_user
  on public.license_renewal_attempts(user_id, started_at desc);

alter table public.license_renewal_attempts enable row level security;
revoke all on public.license_renewal_attempts from public, anon, authenticated;
grant select on public.license_renewal_attempts to authenticated;

drop policy if exists license_attempts_select_own on public.license_renewal_attempts;
create policy license_attempts_select_own on public.license_renewal_attempts
  for select using (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 4. license_ensure(uuid) — idempotently issue the first (free) license.
-- ------------------------------------------------------------
create or replace function public.license_ensure(p_user_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_validity integer;
  v_lic public.nursing_licenses;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_USER');
  end if;

  v_validity := coalesce((public.server_config_get('license_renewal')->>'validity_months')::int, 12);

  insert into public.nursing_licenses (user_id, issued_at, expires_at, status)
  values (p_user_id, now(), now() + make_interval(months => v_validity), 'valid')
  on conflict (user_id) do nothing;

  select * into v_lic from public.nursing_licenses where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'issued_at', v_lic.issued_at,
    'expires_at', v_lic.expires_at,
    'status', case when v_lic.status = 'suspended' then 'suspended'
                   when v_lic.expires_at <= now() then 'expired'
                   else 'valid' end,
    'renewed_count', v_lic.renewed_count
  );
end;
$$;

revoke all on function public.license_ensure(uuid) from public, anon, authenticated;
grant execute on function public.license_ensure(uuid) to service_role;

-- ------------------------------------------------------------
-- 5. license_apply_result(...) — atomic attempt record + (on pass) renewal.
-- Idempotent on (user_id, client_request_id). Never credits player_score.
-- ------------------------------------------------------------
create or replace function public.license_apply_result(
  p_user_id uuid,
  p_batch_id uuid,
  p_score integer,
  p_total integer,
  p_passed boolean,
  p_fee_sc integer,
  p_client_request_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_validity integer;
  v_attempt_id bigint;
  v_lic public.nursing_licenses;
begin
  if p_user_id is null or p_client_request_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_USER');
  end if;

  v_validity := coalesce((public.server_config_get('license_renewal')->>'validity_months')::int, 12);

  insert into public.license_renewal_attempts
    (user_id, started_at, submitted_at, score, total, passed, fee_sc, batch_id, client_request_id)
  values
    (p_user_id, now(), now(), p_score, p_total, p_passed, coalesce(p_fee_sc, 0), p_batch_id, p_client_request_id)
  on conflict (user_id, client_request_id) do nothing
  returning id into v_attempt_id;

  if v_attempt_id is null then
    -- Replay: the attempt was already recorded. Do NOT renew twice.
    select * into v_lic from public.nursing_licenses where user_id = p_user_id;
    return jsonb_build_object(
      'ok', true, 'replay', true, 'passed', p_passed,
      'expires_at', v_lic.expires_at, 'renewed_count', coalesce(v_lic.renewed_count, 0)
    );
  end if;

  if p_passed then
    insert into public.nursing_licenses (user_id, issued_at, expires_at, status, renewed_count)
    values (p_user_id, now(), now() + make_interval(months => v_validity), 'valid', 1)
    on conflict (user_id) do update
      set expires_at = greatest(public.nursing_licenses.expires_at, now()) + make_interval(months => v_validity),
          issued_at = now(),
          status = 'valid',
          renewed_count = public.nursing_licenses.renewed_count + 1,
          updated_at = now();
  end if;

  select * into v_lic from public.nursing_licenses where user_id = p_user_id;

  return jsonb_build_object(
    'ok', true, 'replay', false, 'attempt_id', v_attempt_id, 'passed', p_passed,
    'expires_at', v_lic.expires_at, 'renewed_count', coalesce(v_lic.renewed_count, 0)
  );
end;
$$;

revoke all on function public.license_apply_result(uuid, uuid, integer, integer, boolean, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.license_apply_result(uuid, uuid, integer, integer, boolean, integer, uuid)
  to service_role;
