-- ============================================================
-- Apex Scholars Migration v12 — Per-Subject Simulated Cooldown
--
-- Adds per-subject quota tracking used by the Course Selector UI so
-- free users see which subjects are READY vs awaiting the 12h cooldown
-- window. Premium users never hit this path (server short-circuits).
--
-- Idempotent. Safe to re-run. Compatible with migr-v3..v11.
-- ============================================================

create table if not exists public.user_subject_quota (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  questions_used integer not null default 0,
  last_used_at timestamptz not null default now(),
  window_expires_at timestamptz not null default (now() + interval '12 hours'),
  constraint user_subject_quota_user_subject_key unique (user_id, subject)
);

create index if not exists idx_subject_quota_user on public.user_subject_quota(user_id);

alter table public.user_subject_quota enable row level security;

drop policy if exists "subject_quota_all_own" on public.user_subject_quota;
create policy "subject_quota_all_own"
  on public.user_subject_quota for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Record subject usage (called from the quota consume endpoint).
-- Resets the window first if the previous 12h window already elapsed, then
-- increments the running count for the current window.
create or replace function public.record_subject_usage(
  p_user_id uuid,
  p_subject text,
  p_count integer default 1
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  -- Re-open a fresh 12h window if the prior window elapsed.
  update public.user_subject_quota
     set questions_used = greatest(0, 0),
         last_used_at = now(),
         window_expires_at = now() + interval '12 hours',
         updated_at = now()
   where user_id = p_user_id
     and subject = p_subject
     and now() >= window_expires_at;

  -- Increment (or create) the running total for the current window.
  insert into public.user_subject_quota (user_id, subject, questions_used, last_used_at)
  values (p_user_id, p_subject, greatest(1, abs(coalesce(p_count, 1))), now())
  on conflict (user_id, subject) do update set
    questions_used = public.user_subject_quota.questions_used + abs(coalesce(p_count, 1)),
    last_used_at = now(),
    updated_at = now();
end;
$$;

-- Fetch per-subject quota status for the Course Selector UI.
-- Returns a json object keyed by subject with usage + cooldown seconds.
create or replace function public.get_subject_quota_status(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_object_agg(subject, jsonb_build_object(
    'questions_used', questions_used,
    'last_used_at', last_used_at,
    'window_expires_at', window_expires_at,
    'cooldown_remaining_seconds', greatest(0, floor(extract(epoch from (window_expires_at - now()))))
  )) into result
  from public.user_subject_quota
  where user_id = p_user_id
    and now() < window_expires_at;

  return coalesce(result, '{}'::jsonb);
end;
$$;

-- Reset per-subject quota for a user (used on sign-out/reset if needed).
create or replace function public.reset_subject_quota(p_user_id uuid)
returns void
language sql security definer set search_path = public
as $$
  delete from public.user_subject_quota where user_id = p_user_id;
$$;

grant execute on function public.record_subject_usage(uuid, text, integer) to authenticated;
grant execute on function public.get_subject_quota_status(uuid) to authenticated;
grant execute on function public.reset_subject_quota(uuid) to authenticated;

-- ============================================================
-- DONE.
-- ============================================================