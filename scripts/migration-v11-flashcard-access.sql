-- ============================================================
-- Apex Scholars Migration v11 — Admin-Granted Flashcards
-- Flashcards are NOT a premium feature. They are ADMIN-GRANTED.
--
-- Adds server-authoritative flashcard entitlement:
--   1. profiles.flashcard_access  — granted/revoked by admins only
--      (plus granted_by / granted_at / revoked_at audit columns)
--   2. admin_audit_log            — auditable trail of grant/revoke
--   3. admin_set_flashcard_access — SECURITY DEFINER admin RPC (re-checks
--      public.is_admin(), refuses super_admin targets, writes audit log)
--   4. can_access_flashcards()    — SECURITY DEFINER gate so the client and
--      RLS policies can verify entitlement without direct profiles SELECT
--      (users have NO profiles select-own policy, so this must be SECURITY
--       DEFINER to bypass RLS on profiles — same pattern as is_admin()).
--   5. Tighten custom_flashcards RLS: remove anonymous/public select.
--      Only authenticated users with flashcard_access = true (or admins)
--      may read custom flashcard records.
--
-- Premium status is irrelevant here — pure entitlement gating.
-- Idempotent. Safe to re-run. Compatible with migr-v3..v10.
-- ============================================================

-- ------------------------------------------------------------
-- 1. EXTEND profiles WITH FLASHCARD ENTITLEMENT
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists flashcard_access   boolean      not null default false,
  add column if not exists flashcard_granted_by uuid,
  add column if not exists flashcard_granted_at timestamptz,
  add column if not exists flashcard_revoked_at timestamptz;

-- ------------------------------------------------------------
-- 2. ADMIN AUDIT LOG
--    INSERTs happen inside the SECURITY DEFINER admin RPC (bypasses RLS).
--    SELECTs for admin auditing are covered by the is_admin() policy.
-- ------------------------------------------------------------
create table if not exists public.admin_audit_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  admin_id   uuid references auth.users(id) on delete set null,
  action     text not null,
  metadata   jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_audit_log_user
  on public.admin_audit_log(user_id, created_at desc);
create index if not exists idx_admin_audit_log_action
  on public.admin_audit_log(action);

alter table public.admin_audit_log enable row level security;

drop policy if exists "admin_audit_log_read_admin" on public.admin_audit_log;
create policy "admin_audit_log_read_admin"
  on public.admin_audit_log for select
  using (public.is_admin());

-- ------------------------------------------------------------
-- 3. GATE FUNCTION
--    SECURITY DEFINER so it bypasses RLS on profiles (users cannot
--    SELECT profiles directly). Returns the caller's entitlement only.
-- ------------------------------------------------------------
create or replace function public.can_access_flashcards()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select flashcard_access from public.profiles where id = auth.uid()), false)
$$;

-- ------------------------------------------------------------
-- 4. ADMIN GRANT / REVOKE RPC
--    Mirrors admin_set_activation / admin_set_role. SECURITY DEFINER,
--    re-checks public.is_admin() for the CALLER, refuses to touch
--    super_admin accounts, and appends to the audit log.
-- ------------------------------------------------------------
create or replace function public.admin_set_flashcard_access(
  p_user_id uuid,
  p_granted boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_target_role public.profiles.role%type;
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin role required';
  end if;

  select role into v_target_role
    from public.profiles
    where id = p_user_id;
  if not found then
    raise exception 'User not found';
  end if;

  if v_target_role = 'super_admin' then
    raise exception 'Cannot modify a super admin';
  end if;

  update public.profiles
     set flashcard_access = coalesce(p_granted, false),
         flashcard_granted_by = case when p_granted then auth.uid() else flashcard_granted_by end,
         flashcard_granted_at = case when p_granted then now() else flashcard_granted_at end,
         flashcard_revoked_at = case when not p_granted then now() else flashcard_revoked_at end
   where id = p_user_id;

  insert into public.admin_audit_log (user_id, admin_id, action, metadata)
  values (
    p_user_id,
    auth.uid(),
    case when p_granted then 'flashcard_grant' else 'flashcard_revoke' end,
    jsonb_build_object('admin_id', auth.uid(), 'granted', coalesce(p_granted, false))
  );
end;
$$;

-- ------------------------------------------------------------
-- 5. GRANTS
-- ------------------------------------------------------------
revoke all on function public.can_access_flashcards() from public;
revoke all on function public.admin_set_flashcard_access(uuid, boolean) from public;
grant execute on function public.can_access_flashcards() to authenticated;
grant execute on function public.admin_set_flashcard_access(uuid, boolean) to authenticated;

-- ------------------------------------------------------------
-- 6. TIGHTEN custom_flashcards RLS
--    Remove the old policy (which allowed `user_id is null` -> anon read)
--    and replace it with an authenticated, flashcard-access-gated policy.
--    Matrix: anon => DENIED, free => DENIED, premium-no-access => DENIED,
--            granted => ALLOWED, admin => ALLOWED.
-- ------------------------------------------------------------
drop policy if exists "custom_cards_read" on public.custom_flashcards;
create policy "custom_cards_read"
  on public.custom_flashcards for select
  using (
    public.can_access_flashcards()
    or public.is_admin()
  );

-- ============================================================
-- DONE.
-- ============================================================
