-- ============================================================
-- migration-v110-wallet-pins.sql
--
-- Six-digit wallet PINs. The PIN protects /wallet only:
--   * wallet overview and World Bank status reads
--   * transfers, World Bank borrows and World Bank repayments
--
-- The hash is produced by the API with Node crypto.scrypt and is never stored
-- in plaintext. This table is service-role only: clients have no direct table
-- access and no policies are created.
--
-- Five wrong attempts lock the user for 15 minutes. The failure counter is
-- serialized by an advisory lock so parallel guesses cannot bypass it.
--
-- Idempotent and forward-only.
-- Apply: node scripts/run-migration.mjs scripts/migration-v110-wallet-pins.sql
-- ============================================================

create table if not exists public.wallet_pins (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  pin_hash            text not null,
  failed_attempts     integer not null default 0 check (failed_attempts >= 0),
  locked_until        timestamptz,
  last_failed_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.wallet_pins enable row level security;
revoke all on public.wallet_pins from public, anon, authenticated;
-- No client policies. The API uses the service role.

create or replace function public.wallet_pin_record_failure(
  p_user uuid,
  p_max_attempts integer default 5,
  p_lock_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.wallet_pins;
  v_attempts int;
  v_retry int;
  v_max int := greatest(coalesce(p_max_attempts, 5), 1);
  v_lock int := greatest(coalesce(p_lock_minutes, 15), 1);
begin
  if p_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  perform pg_advisory_xact_lock(hashtext('wallet_pin:' || p_user::text));

  select * into v_row
    from public.wallet_pins
   where user_id = p_user
     for update;

  if v_row.user_id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_PIN');
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    v_retry := greatest(1, ceil(extract(epoch from (v_row.locked_until - now())))::int);
    return jsonb_build_object(
      'ok', false,
      'error', 'LOCKED',
      'retryAfterSeconds', v_retry
    );
  end if;

  -- A lock that has expired starts a fresh attempt window.
  if v_row.locked_until is not null then
    v_attempts := 1;
  else
    v_attempts := coalesce(v_row.failed_attempts, 0) + 1;
  end if;

  if v_attempts >= v_max then
    v_retry := v_lock * 60;
    update public.wallet_pins
       set failed_attempts = v_attempts,
           locked_until = now() + make_interval(mins => v_lock),
           last_failed_at = now(),
           updated_at = now()
     where user_id = p_user;

    return jsonb_build_object(
      'ok', false,
      'error', 'LOCKED',
      'retryAfterSeconds', v_retry
    );
  end if;

  update public.wallet_pins
     set failed_attempts = v_attempts,
         locked_until = null,
         last_failed_at = now(),
         updated_at = now()
   where user_id = p_user;

  return jsonb_build_object(
    'ok', false,
    'error', 'INCORRECT',
    'attemptsRemaining', greatest(v_max - v_attempts, 0)
  );
end;
$$;

revoke all on function public.wallet_pin_record_failure(uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.wallet_pin_record_failure(uuid, integer, integer)
  to service_role;

notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
