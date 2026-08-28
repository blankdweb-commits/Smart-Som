-- ============================================================
-- Apex Scholars Migration v4d — Admin User Management
-- Gives admins a safe server-side path to activate/deactivate
-- accounts and to promote/demote the admin role, plus assigns
-- the operator's account (blankdweb@gmail.com) as an admin.
--
-- Client RLS only allows admins to READ all profiles
-- (profiles_admin_read_all). Writes are therefore exposed as
-- SECURITY DEFINER RPCs that re-check public.is_admin() for the
-- CALLER and refuse to touch super_admin accounts.
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ACTIVATION RPC
-- ------------------------------------------------------------
create or replace function public.admin_set_activation(p_user_id uuid, p_activated boolean)
returns void
language plpgsql
security definer set search_path = public
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
     set is_activated = coalesce(p_activated, false)
   where id = p_user_id;
end;
$$;

-- ------------------------------------------------------------
-- 2. ROLE RPC (promote/demote admin)
-- ------------------------------------------------------------
create or replace function public.admin_set_role(p_user_id uuid, p_new_role text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_target_role public.profiles.role%type;
  v_caller_role text := public.my_role();
begin
  if not public.is_admin() then
    raise exception 'Not authorized: admin role required';
  end if;

  if p_new_role not in ('student', 'admin', 'super_admin') then
    raise exception 'Invalid role: %', p_new_role;
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

  if p_new_role = 'super_admin' and v_caller_role <> 'super_admin' then
    raise exception 'Only a super admin can grant the super admin role';
  end if;

  update public.profiles
     set role = p_new_role,
         is_activated = case
           when p_new_role in ('admin', 'super_admin') then true
           else is_activated
         end
   where id = p_user_id;
end;
$$;

-- ------------------------------------------------------------
-- 3. GRANTS
-- ------------------------------------------------------------
revoke all on function public.admin_set_activation(uuid, boolean) from public;
revoke all on function public.admin_set_role(uuid, text) from public;
grant execute on function public.admin_set_activation(uuid, boolean) to authenticated;
grant execute on function public.admin_set_role(uuid, text) to authenticated;

-- ------------------------------------------------------------
-- 4. ASSIGN OPERATOR ACCOUNT AS ADMIN
--    (profiles.email is populated from auth.users at signup)
-- ------------------------------------------------------------
update public.profiles
   set role = 'admin', is_activated = true
 where email = 'blankdweb@gmail.com'
   and role <> 'super_admin';

-- ============================================================
-- DONE.
-- ============================================================