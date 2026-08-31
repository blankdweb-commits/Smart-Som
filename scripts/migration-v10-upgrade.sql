-- ============================================================
-- Apex Scholars Migration v10 — Command Center Upgrade
-- Adds the infrastructure for:
--   1. user_sessions        — strict single-device session enforcement
--   2. user_quota           — free-user 50-question / 12-hour cooldown
--   3. user_question_history — per-question history (non-repetition)
--   4. difficulty_progress  — server-side difficulty unlock counts (correct only)
--   5. achievements / user_achievements
--   6. voting_polls / options / responses (user-requested, admin-approved)
--   7. daily_challenge objects
--   8. feedback_submissions (reviews & suggestions)
--   9. marketplace_* (categories/products/sellers/purchases) + verification
-- Idempotent. Safe to re-run. Compatible with migr-v3..v9.
-- ============================================================

-- ============================================================
-- 1. USER SESSIONS (single-device)
--    One active session per user enforced server-side. On a new login the
--    previous active session is revoked. Protected requests validate that
--    the caller's session is still the active one.
-- ============================================================
create table if not exists public.user_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,               -- the JWT session id / auth sub
  device_identifier text default '',      -- opaque, non-sensitive device tag
  is_active boolean not null default true,
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint user_sessions_session_unique unique (session_id)
);

create index if not exists idx_user_sessions_user on public.user_sessions(user_id, is_active);
create index if not exists idx_user_sessions_session on public.user_sessions(session_id);

alter table public.user_sessions enable row level security;

-- Users can read/update only their own session rows.
drop policy if exists "user_sessions_select_own" on public.user_sessions;
create policy "user_sessions_select_own"
  on public.user_sessions for select
  using (auth.uid() = user_id);

drop policy if exists "user_sessions_update_own" on public.user_sessions;
create policy "user_sessions_update_own"
  on public.user_sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Register a new active session, revoking all prior active sessions for the
-- same user. Returns the newly-created row's id (or the existing one's id if
-- the session_id is already known). Atomic via a single function so two
-- simultaneous logins cannot both end up active.
create or replace function public.register_session(
  p_user_id uuid,
  p_session_id text,
  p_device_identifier text default ''
)
returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  new_id bigint;
begin
  -- Revoke any prior active sessions for this user (force single-device).
  update public.user_sessions
     set is_active = false, revoked_at = now()
   where user_id = p_user_id and is_active = true;

  insert into public.user_sessions (user_id, session_id, device_identifier)
  values (p_user_id, p_session_id, coalesce(p_device_identifier, ''))
  returning id into new_id;

  return new_id;
end;
$$;

-- Is the given session currently valid & active for the user?
create or replace function public.session_is_active(
  p_user_id uuid,
  p_session_id text
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select is_active from public.user_sessions
     where user_id = p_user_id and session_id = p_session_id
     order by created_at desc limit 1
  ), false);
$$;

-- Touch last_seen for telemetry.
create or replace function public.touch_session(
  p_user_id uuid,
  p_session_id text
)
returns void
language sql security definer set search_path = public
as $$
  update public.user_sessions set last_seen = now()
   where user_id = p_user_id and session_id = p_session_id;
$$;

-- Revoke a specific session (used on sign-out).
create or replace function public.revoke_session(
  p_user_id uuid,
  p_session_id text
)
returns void
language sql security definer set search_path = public
as $$
  update public.user_sessions
     set is_active = false, revoked_at = now()
   where user_id = p_user_id and session_id = p_session_id;
$$;

-- ============================================================
-- 2. USER QUOTA (free 50/12h)
--    A single lightweight row per user. questions_remaining decremented
--    ATOMICALLY server-side; when it hits 0 a 12-hour cooldown begins.
--    Premium users never touch this path (verified server-side).
-- ============================================================
create table if not exists public.user_quota (
  id bigint generated always as identity primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  questions_remaining integer not null default 50,
  window_started_at timestamptz not null default now(),
  window_expires_at timestamptz not null default (now() + interval '12 hours'),
  updated_at timestamptz not null default now()
);

alter table public.user_quota enable row level security;

drop policy if exists "user_quota_select_own" on public.user_quota;
create policy "user_quota_select_own"
  on public.user_quota for select
  using (auth.uid() = user_id);

-- Ensure a quota row exists for a user (idempotent).
create or replace function public.ensure_quota_row(p_user_id uuid)
returns void
language sql security definer set search_path = public
as $$
  insert into public.user_quota (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;
$$;

-- Reset quota if the 12-hour window has expired. Returns void (mutates row).
create or replace function public.reset_quota_if_expired(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.user_quota
     set questions_remaining = 50,
         window_started_at = now(),
         window_expires_at = now() + interval '12 hours',
         updated_at = now()
   where user_id = p_user_id
     and now() >= window_expires_at;
end;
$$;

-- ATOMIC quota consumption: returns the new remaining count, or -1 if the
-- quota is exhausted (cooldown active) or the row is in cooldown.
-- On the transition from 1 -> 0 we START the 12h cooldown window.
create or replace function public.consume_question(p_user_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  new_remaining integer;
  expired boolean;
begin
  -- Touch the quota row / create if missing.
  perform public.ensure_quota_row(p_user_id);

  -- Reset the window if the cooldown already elapsed.
  perform public.reset_quota_if_expired(p_user_id);

  -- Single atomic guarded UPDATE: only consume when remaining > 0 and not in cooldown.
  update public.user_quota
     set questions_remaining = questions_remaining - 1,
         updated_at = now(),
         -- If we just hit 0, begin the 12-hour cooldown from now.
         window_started_at = case when questions_remaining - 1 = 0 then now() else window_started_at end,
         window_expires_at = case when questions_remaining - 1 = 0 then now() + interval '12 hours' else window_expires_at end
   where user_id = p_user_id
     and questions_remaining > 0
     and now() < window_expires_at
  returning questions_remaining into new_remaining;

  if new_remaining is null then
    -- Either in cooldown (remaining = 0) or window expired after the reset
    -- guard above re-opened it. Re-check: if we just reset, retry the consume.
    select questions_remaining into new_remaining
      from public.user_quota where user_id = p_user_id;
    if new_remaining > 0 and new_remaining is not null then
      update public.user_quota
         set questions_remaining = questions_remaining - 1,
             updated_at = now(),
             window_started_at = case when questions_remaining - 1 = 0 then now() else window_started_at end,
             window_expires_at = case when questions_remaining - 1 = 0 then now() + interval '12 hours' else window_expires_at end
       where user_id = p_user_id
       returning questions_remaining into new_remaining;
    end if;
    return coalesce(new_remaining, -1);
  end if;

  return new_remaining;
end;
$$;

-- Read the current quota state for display.
create or replace function public.get_quota_status(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  rec public.user_quota;
  expired boolean;
begin
  perform public.ensure_quota_row(p_user_id);
  perform public.reset_quota_if_expired(p_user_id);
  select * into rec from public.user_quota where user_id = p_user_id;
  if rec is null then
    return jsonb_build_object(
      'questions_remaining', 50,
      'window_started_at', now(),
      'window_expires_at', now() + interval '12 hours',
      'in_cooldown', false
    );
  end if;
  return jsonb_build_object(
    'questions_remaining', rec.questions_remaining,
    'window_started_at', rec.window_started_at,
    'window_expires_at', rec.window_expires_at,
    'in_cooldown', (rec.questions_remaining <= 0)
  );
end;
$$;

-- ============================================================
-- 3. USER QUESTION HISTORY (non-repetition)
--    Lightweight per-user per-question record. Hardcoded banks remain the
--    source of truth; this only tracks exposure/performance.
-- ============================================================
create table if not exists public.user_question_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id text not null,
  times_seen integer not null default 0,
  last_seen timestamptz,
  last_answered timestamptz,
  last_result boolean,
  correct_count integer not null default 0,
  attempt_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint user_question_history_unique unique (user_id, question_id)
);

create index if not exists idx_question_history_user on public.user_question_history(user_id, last_seen desc);

alter table public.user_question_history enable row level security;

drop policy if exists "question_history_all_own" on public.user_question_history;
create policy "question_history_all_own"
  on public.user_question_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Record an answer; upserts exposure + result counters.
create or replace function public.record_question_seen(
  p_user_id uuid,
  p_question_id text,
  p_correct boolean
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.user_question_history
    (user_id, question_id, times_seen, last_seen, last_answered, last_result,
     correct_count, attempt_count, updated_at)
  values
    (p_user_id, p_question_id, 1, now(), now(), p_correct,
     case when p_correct then 1 else 0 end, 1, now())
  on conflict (user_id, question_id) do update set
    times_seen = public.user_question_history.times_seen + 1,
    last_seen = now(),
    last_answered = now(),
    last_result = p_correct,
    correct_count = public.user_question_history.correct_count + case when p_correct then 1 else 0 end,
    attempt_count = public.user_question_history.attempt_count + 1,
    updated_at = now();
$$;

-- ============================================================
-- 4. DIFFICULTY PROGRESS (server-side unlock)
--    Counts CORRECT answers per difficulty only (as required). Unlocks are
--    computed by comparing correct_count against the required thresholds.
-- ============================================================
create table if not exists public.difficulty_progress (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  difficulty text not null,
  correct_count integer not null default 0,
  unlocked_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint difficulty_progress_unique unique (user_id, difficulty)
);

alter table public.difficulty_progress enable row level security;

drop policy if exists "difficulty_progress_all_own" on public.difficulty_progress;
create policy "difficulty_progress_all_own"
  on public.difficulty_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Increment the correct-answer counter for a difficulty (atomic, correct only).
-- Requestor-controlled correctness is NOT trusted; this is called from the
-- serverless /api path after verifying a genuine answered+correct payload.
create or replace function public.record_difficulty_correct(
  p_user_id uuid,
  p_difficulty text
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.difficulty_progress (user_id, difficulty, correct_count, unlocked_at, updated_at)
  values (p_user_id, p_difficulty, 1, null, now())
  on conflict (user_id, difficulty) do update set
    correct_count = public.difficulty_progress.correct_count + 1,
    updated_at = now();
$$;

-- Fetch unlock status for all difficulties (thresholds hardcoded per spec).
create or replace function public.get_difficulty_status(p_user_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_object_agg(difficulty, correct_count)
    into result
    from public.difficulty_progress
   where user_id = p_user_id;
  return coalesce(result, '{}'::jsonb);
end;
$$;

-- ============================================================
-- 5. ACHIEVEMENTS
-- ============================================================
create table if not exists public.achievements (
  id bigint generated always as identity primary key,
  key text not null unique,
  name text not null,
  description text not null,
  emoji text default '🏆',
  criteria jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_achievements (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id bigint not null references public.achievements(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  constraint user_achievements_unique unique (user_id, achievement_id)
);

alter table public.achievements enable row level security;
alter table public.user_achievements enable row level security;

drop policy if exists "achievements_public_read" on public.achievements;
create policy "achievements_public_read"
  on public.achievements for select using (true);

drop policy if exists "user_achievements_all_own" on public.user_achievements;
create policy "user_achievements_all_own"
  on public.user_achievements for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Seed the standard achievement catalog (idempotent).
insert into public.achievements (key, name, description, emoji, criteria)
select v.key, v.name, v.description, v.emoji, v.criteria from (values
  ('first-quiz', 'First Quiz', 'Complete your first quiz.', '🎯', '{"type":"quizzes","count":1}'::jsonb),
  ('questions-50', '50 Questions', 'Answer 50 questions total.', '📚', '{"type":"questions","count":50}'::jsonb),
  ('questions-100', '100 Questions', 'Answer 100 questions total.', '⚡', '{"type":"questions","count":100}'::jsonb),
  ('questions-500', '500 Questions', 'Answer 500 questions total.', '🔥', '{"type":"questions","count":500}'::jsonb),
  ('streak-7', '7-Day Streak', 'Maintain a 7-day study streak.', '🔥', '{"type":"streak","count":7}'::jsonb),
  ('streak-30', '30-Day Streak', 'Maintain a 30-day study streak.', '🌟', '{"type":"streak","count":30}'::jsonb),
  ('medication-master', 'Medication Master', 'Reach the Medication Master identity.', '💊', '{"type":"identity","min_tier":3}'::jsonb),
  ('clinical-strategist', 'Clinical Strategist', 'Reach the Clinical Strategist identity.', '🧠', '{"type":"identity","min_tier":5}'::jsonb),
  ('exam-ready', 'Exam Ready', 'Hit an exam readiness score of 80+.', '🛡️', '{"type":"readiness","min":80}'::jsonb),
  ('daily-goal', 'Daily Goal', 'Complete today''s daily goal.', '✅', '{"type":"daily_goal","count":1}'::jsonb)
) as v(key, name, description, emoji, criteria)
where not exists (select 1 from public.achievements where key = v.key);

-- ============================================================
-- 6. VOTING (user-requested polls, admin-approved)
--    Any authenticated user can REQUEST a poll (status=pending). An admin
--    approves it (status=active) before others can vote. Duplicate votes by
--    a user are prevented via a unique (poll_id, user_id) constraint.
-- ============================================================
create table if not exists public.voting_polls (
  id bigint generated always as identity primary key,
  creator_id uuid not null references auth.users(id) on delete set null,
  question text not null,
  status text not null default 'pending'
    check (status in ('pending','active','closed','archived')),
  closing_date timestamptz,
  is_featured boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.voting_options (
  id bigint generated always as identity primary key,
  poll_id bigint not null references public.voting_polls(id) on delete cascade,
  text text not null,
  sort_order integer not null default 0
);

create table if not exists public.voting_responses (
  id bigint generated always as identity primary key,
  poll_id bigint not null references public.voting_polls(id) on delete cascade,
  option_id bigint not null references public.voting_options(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  voted_at timestamptz not null default now(),
  constraint voting_responses_unique unique (poll_id, user_id)
);

create index if not exists idx_voting_polls_status on public.voting_polls(status, created_at desc);
create index if not exists idx_voting_options_poll on public.voting_options(poll_id);
create index if not exists idx_voting_responses_option on public.voting_responses(option_id);

alter table public.voting_polls enable row level security;
alter table public.voting_options enable row level security;
alter table public.voting_responses enable row level security;

-- Public reads active polls + their options/responses; pending/closed/archived
-- are visible to their creator and admins only.
drop policy if exists "voting_polls_select_all" on public.voting_polls;
create policy "voting_polls_select_all"
  on public.voting_polls for select
  using (status = 'active'
         or creator_id = auth.uid()
         or public.is_admin());

drop policy if exists "voting_polls_insert_authed" on public.voting_polls;
create policy "voting_polls_insert_authed"
  on public.voting_polls for insert
  with check (auth.uid() = creator_id and auth.uid() is not null);

drop policy if exists "voting_polls_admin_update" on public.voting_polls;
create policy "voting_polls_admin_update"
  on public.voting_polls for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "voting_options_select_all" on public.voting_options;
create policy "voting_options_select_all"
  on public.voting_options for select
  using (true);

drop policy if exists "voting_options_admin_all" on public.voting_options;
create policy "voting_options_admin_all"
  on public.voting_options for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "voting_options_owner_all" on public.voting_options;
create policy "voting_options_owner_all"
  on public.voting_options for all
  using (exists (
    select 1 from public.voting_polls p
    where p.id = voting_options.poll_id and p.creator_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.voting_polls p
    where p.id = voting_options.poll_id and p.creator_id = auth.uid()
  ));

drop policy if exists "voting_responses_select_all" on public.voting_responses;
create policy "voting_responses_select_all"
  on public.voting_responses for select
  using (true);

drop policy if exists "voting_responses_insert_authed" on public.voting_responses;
create policy "voting_responses_insert_authed"
  on public.voting_responses for insert
  with check (auth.uid() = user_id and auth.uid() is not null);

-- Cast a vote on an ACTIVE poll only; prevents duplicate votes (unique constraint).
create or replace function public.cast_vote(
  p_user_id uuid,
  p_poll_id bigint,
  p_option_id bigint
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  poll_status text;
begin
  select status into poll_status from public.voting_polls where id = p_poll_id;
  if poll_status is null or poll_status <> 'active' then
    raise exception 'Poll is not active';
  end if;
  -- Option must belong to the poll.
  if not exists (select 1 from public.voting_options where id = p_option_id and poll_id = p_poll_id) then
    raise exception 'Invalid option for poll';
  end if;
  insert into public.voting_responses (poll_id, option_id, user_id)
  values (p_poll_id, p_option_id, p_user_id)
  on conflict (poll_id, user_id) do update set option_id = excluded.option_id, voted_at = now();
end;
$$;

-- ============================================================
-- 7. DAILY CHALLENGE
--    One row per user per date. question_ids jsonb holds the chosen set.
-- ============================================================
create table if not exists public.daily_challenge (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_date date not null default current_date,
  question_ids jsonb not null default '[]'::jsonb,
  score integer not null default 0,
  total integer not null default 0,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_challenge_unique unique (user_id, challenge_date)
);

alter table public.daily_challenge enable row level security;

drop policy if exists "daily_challenge_all_own" on public.daily_challenge;
create policy "daily_challenge_all_own"
  on public.daily_challenge for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
-- 8. FEEDBACK SUBMISSIONS (reviews & suggestions)
--    App-level feedback (feature suggestions, marketplace/community/app
--    reviews). Question-level feedback already lives in question_feedback.
-- ============================================================
create table if not exists public.feedback_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete set null,
  type text not null default 'suggestion'
    check (type in ('app_review','feature_suggestion','quiz_feedback','marketplace_feedback','community_feedback','other')),
  message text not null,
  status text not null default 'open'
    check (status in ('open','reviewing','resolved','ignored')),
  admin_note text default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_feedback_status on public.feedback_submissions(status, created_at desc);

alter table public.feedback_submissions enable row level security;

drop policy if exists "feedback_select_own" on public.feedback_submissions;
create policy "feedback_select_own"
  on public.feedback_submissions for select
  using (auth.uid() = user_id);

drop policy if exists "feedback_insert_own" on public.feedback_submissions;
create policy "feedback_insert_own"
  on public.feedback_submissions for insert
  with check (auth.uid() = user_id and auth.uid() is not null);

drop policy if exists "feedback_admin_all" on public.feedback_submissions;
create policy "feedback_admin_all"
  on public.feedback_submissions for all
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- 9. MARKETPLACE (Apex House + verified nurse businesses)
--    NIN is NEVER stored or surfaced here — only a verified boolean badge.
-- ============================================================
create table if not exists public.marketplace_categories (
  id bigint generated always as identity primary key,
  name text not null unique,
  slug text not null unique,
  description text default '',
  icon text default '',
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.marketplace_sellers (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  business_name text not null,
  description text default '',
  contact_email text default '',
  is_verified boolean not null default false,
  verification_status text not null default 'none'
    check (verification_status in ('none','pending','approved','rejected')),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_products (
  id bigint generated always as identity primary key,
  seller_id bigint references public.marketplace_sellers(id) on delete set null,
  category_id bigint references public.marketplace_categories(id) on delete set null,
  title text not null,
  slug text unique,
  description text default '',
  price numeric(12,2) not null default 0,
  currency text not null default 'NGN',
  access_type text not null default 'one-time'
    check (access_type in ('free','premium','one-time')),
  content_url text default '',
  is_published boolean not null default true,
  is_featured boolean not null default false,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketplace_purchases (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id bigint not null references public.marketplace_products(id) on delete cascade,
  amount numeric(12,2) not null default 0,
  reference text unique,
  status text not null default 'pending'
    check (status in ('pending','complete','refunded','failed')),
  created_at timestamptz not null default now(),
  constraint marketplace_purchases_unique unique (user_id, product_id)
);

create index if not exists idx_marketplace_products_slug on public.marketplace_products(slug);
create index if not exists idx_marketplace_products_category on public.marketplace_products(category_id);
create index if not exists idx_marketplace_purchases_user on public.marketplace_purchases(user_id);

alter table public.marketplace_categories enable row level security;
alter table public.marketplace_sellers enable row level security;
alter table public.marketplace_products enable row level security;
alter table public.marketplace_purchases enable row level security;

drop policy if exists "marketplace_categories_public_read" on public.marketplace_categories;
create policy "marketplace_categories_public_read"
  on public.marketplace_categories for select using (true);

drop policy if exists "marketplace_categories_admin_all" on public.marketplace_categories;
create policy "marketplace_categories_admin_all"
  on public.marketplace_categories for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "marketplace_sellers_public_read" on public.marketplace_sellers;
create policy "marketplace_sellers_public_read"
  on public.marketplace_sellers for select using (true);

drop policy if exists "marketplace_sellers_admin_all" on public.marketplace_sellers;
create policy "marketplace_sellers_admin_all"
  on public.marketplace_sellers for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "marketplace_products_public_read" on public.marketplace_products;
create policy "marketplace_products_public_read"
  on public.marketplace_products for select
  using ((is_published and not is_archived) or public.is_admin());

drop policy if exists "marketplace_products_admin_all" on public.marketplace_products;
create policy "marketplace_products_admin_all"
  on public.marketplace_products for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "marketplace_purchases_all_own" on public.marketplace_purchases;
create policy "marketplace_purchases_all_own"
  on public.marketplace_purchases for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Seed marketplace categories (idempotent).
insert into public.marketplace_categories (name, slug, description, sort_order)
select v.name, v.slug, v.description, v.sort_order from (values
  ('Books', 'books', 'Nursing and midwifery textbooks.', 1),
  ('Study Materials', 'study-materials', 'Notes, summaries and study packs.', 2),
  ('Question Packs', 'question-packs', 'Practice question sets for NMCN/NCLEX.', 3),
  ('Revision Guides', 'revision-guides', 'Exam revision guides.', 4),
  ('Clinical Resources', 'clinical-resources', 'Clinical reference resources.', 5),
  ('Nursing Templates', 'nursing-templates', 'Care plans, forms and templates.', 6),
  ('Exam Preparation', 'exam-preparation', 'NMCN/NCLEX prep bundles.', 7)
) as v(name, slug, description, sort_order)
where not exists (select 1 from public.marketplace_categories where slug = v.slug);

-- ============================================================
-- Realtime (safe idempotent adds)
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table public.user_sessions;
exception when duplicate_object then null;
end $$;

-- ============================================================
-- DONE.
-- ============================================================
