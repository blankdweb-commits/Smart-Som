-- ============================================================
-- Apex Scholars Migration v6 — Per-group quiz streak (unique streak)
-- Tracks the "unique streak" a member keeps inside a specific study
-- group by passing quizzes launched from that group. A member's group
-- streak only advances when they pass a quiz stamped with that group's
-- `group_id` on a new calendar day; a missed day resets it to 1 on the
-- next pass. This is separate from the global profile quiz_streak.
-- Idempotent. Safe to re-run. Requires migr-v4c and migr-v5 first.
-- ============================================================

-- ------------------------------------------------------------
-- 1. STUDY GROUP MEMBERS — per-group quiz streak columns
-- ------------------------------------------------------------
alter table public.study_group_members add column if not exists group_quiz_streak integer not null default 0;
alter table public.study_group_members add column if not exists group_quiz_last_date date;
alter table public.study_group_members add column if not exists group_quiz_last_activity timestamptz;

create index if not exists idx_study_group_members_group_streak on public.study_group_members(group_id, group_quiz_streak desc);

-- ------------------------------------------------------------
-- 2. HELPER — bump a member's group quiz streak for a passed quiz.
--    - last_date == today     -> keep streak (no double advancing)
--    - last_date == yesterday -> streak + 1
--    - otherwise (gap)        -> reset to 1
--    Returns the new streak, or NULL when the member isn't in the group.
-- ------------------------------------------------------------
create or replace function public.bump_group_quiz_streak(p_group_id bigint, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
  v_today date := current_date;
  v_yesterday date := current_date - 1;
  v_new integer;
  v_exists boolean;
begin
  select exists (
    select 1 from public.study_group_members
    where group_id = p_group_id and user_id = p_user_id
  ) into v_exists;

  if not v_exists then
    return null;
  end if;

  select group_quiz_last_date into v_last
  from public.study_group_members
  where group_id = p_group_id and user_id = p_user_id;

  if v_last is null then
    v_new := 1;
  elsif v_last = v_today then
    v_new := null; -- already advanced today for this group
  elsif v_last = v_yesterday then
    v_new := 1 + coalesce((select group_quiz_streak from public.study_group_members where group_id = p_group_id and user_id = p_user_id), 0);
  else
    v_new := 1; -- missed a day -> reset
  end if;

  if v_new is not null then
    update public.study_group_members
    set group_quiz_streak = v_new,
        group_quiz_last_date = v_today,
        group_quiz_last_activity = now()
    where group_id = p_group_id and user_id = p_user_id;
  end if;

  return v_new;
end;
$$;

grant execute on function public.bump_group_quiz_streak(bigint, uuid) to authenticated;

-- ============================================================
-- DONE.
-- ============================================================
