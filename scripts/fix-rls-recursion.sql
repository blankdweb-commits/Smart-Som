-- Hotfix: RLS infinite recursion on public.profiles
-- Policies must never SELECT from the table they protect.
-- SECURITY DEFINER functions evaluate the check as the owner (RLS bypass)
-- while still returning per-user results based on auth.uid().

create or replace function public.my_role()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    exists (
      select 1 from public.profiles
      where id = auth.uid() and role in ('admin', 'super_admin')
    ), false);
$$;

-- ---- profiles ----
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id and role = public.my_role());

drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all"
  on public.profiles for select
  using (public.is_admin());

-- ---- subscriptions ----
drop policy if exists "subscriptions_admin_all" on public.subscriptions;
create policy "subscriptions_admin_all"
  on public.subscriptions for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---- testimonials ----
drop policy if exists "testimonials_admin_write" on public.testimonials;
create policy "testimonials_admin_write"
  on public.testimonials for all
  using (public.is_admin())
  with check (public.is_admin());
