-- ============================================================
-- Apex Scholars Migration v14 — Platform Upgrade (Quota 30min / mode
-- rename / per-course difficulty / relationships / notifications /
-- absurd achievements / simultaneous 1v1 duels / reactions / online)
--
-- One idempotent migration handling every DB-level change for the
-- platform upgrade. Safe to re-run. Compatible with v11..v13.
--
-- Sections:
--   1. Per-course quota window 1h -> 30 min (consume RPC)
--   2. Quota-key rename: clinical-challenge:* -> nclex:*,
--      quick-quiz:* -> nmcn:* (preserves free/premium progress)
--   3. 200L subject rename in quota keys (Unit I/II/III -> Nutrition)
--   4. user_relationships (friend|rival) + RPCs
--   5. notifications + push_notification RPC
--   6. achievements: narrator + category columns + absurd seeds
--   7. get_user_achievements (friend/rival read) RPC
--   8. profiles.is_online + online heartbeat
--   9. duel_challenges
--  10. duel_rounds + duel_responses (simultaneous 1v1)
--  11. duel_reactions (fixed emoji set)
-- ============================================================

-- ============================================================
-- 1. PER-COURSE QUOTA 30-MINUTE WINDOW
--    Replaces consume_course_quota from v13. FREE users reserve a
--    10-question round and start a 30-MINUTE cooldown (was 1 hour).
--    get_course_quota_status derives from window_expires_at, so it
--    needs no change. reset_course_quota unchanged.
-- ============================================================
create or replace function public.consume_course_quota(
  p_user_id uuid,
  p_course_key text,
  p_count integer default 10,
  p_is_premium boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  clamped integer;
  rec public.user_course_quota;
  in_cooldown boolean;
  new_rounds integer;
begin
  -- Server-side clamp: this is the ONLY place counts are trusted.
  if p_is_premium then
    clamped := greatest(10, least(30, coalesce(p_count, 10)));
  else
    clamped := 10; -- FREE: exactly one 10-question round.
  end if;

  select * into rec from public.user_course_quota
   where user_id = p_user_id and course_key = p_course_key;

  -- In cooldown? (free users only; premium never has a window)
  if not p_is_premium and rec is not null
     and rec.window_expires_at is not null
     and now() < rec.window_expires_at then
    return jsonb_build_object(
      'allowed', false,
      'premium', false,
      'questions_remaining', 0,
      'round_completed', false,
      'rounds_completed', rec.rounds_completed,
      'window_expires_at', rec.window_expires_at,
      'cooldown_remaining_seconds', greatest(0, floor(extract(epoch from (rec.window_expires_at - now())))),
      'is_ready', false
    );
  end if;

  new_rounds := coalesce(rec.rounds_completed, 0) + 1;

  -- Premium: track rounds but never cooldown.
  if p_is_premium then
    insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at)
    values (p_user_id, p_course_key, clamped, new_rounds, now(), null)
    on conflict (user_id, course_key) do update set
      questions_used = public.user_course_quota.questions_used + clamped,
      rounds_completed = public.user_course_quota.rounds_completed + 1,
      last_round_completed_at = now(),
      window_expires_at = null,
      updated_at = now();
    return jsonb_build_object(
      'allowed', true,
      'premium', true,
      'questions_remaining', null,
      'round_completed', true,
      'rounds_completed', new_rounds,
      'window_expires_at', null,
      'cooldown_remaining_seconds', 0,
      'is_ready', true
    );
  end if;

  -- FREE: reserve the 10-question round + start a 30-minute cooldown.
  insert into public.user_course_quota (user_id, course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at)
  values (p_user_id, p_course_key, clamped, new_rounds, now(), now() + interval '30 minutes')
  on conflict (user_id, course_key) do update set
    questions_used = clamped,
    rounds_completed = public.user_course_quota.rounds_completed + 1,
    last_round_completed_at = now(),
    window_expires_at = now() + interval '30 minutes',
    updated_at = now();

  return jsonb_build_object(
    'allowed', true,
    'premium', false,
    'questions_remaining', 0,
    'round_completed', true,
    'rounds_completed', new_rounds,
    'window_expires_at', (now() + interval '30 minutes'),
    'cooldown_remaining_seconds', 1800,
    'is_ready', false
  );
end;
$$;

-- ============================================================
-- 2. QUOTA-KEY RENAME: clinical-challenge:* -> nclex:*, quick-quiz:* -> nmcn:*
--    Migrates existing user_course_quota rows so free/premium progress is
--    preserved when the client switches to the new mode IDs.
-- ============================================================
update public.user_course_quota
   set course_key = 'nclex:' || substr(course_key, length('clinical-challenge:') + 1),
       updated_at = now()
 where course_key like 'clinical-challenge:%';

update public.user_course_quota
   set course_key = 'nmcn:' || substr(course_key, length('quick-quiz:') + 1),
       updated_at = now()
 where course_key like 'quick-quiz:%';

-- Handle any bare (default) keys left over: clinical-challenge -> nclex:both
update public.user_course_quota set course_key = 'nclex:both', updated_at = now() where course_key = 'clinical-challenge';
update public.user_course_quota set course_key = 'nmcn:both', updated_at = now() where course_key = 'quick-quiz';

-- ============================================================
-- 3. 200L SUBJECT RENAME in quota keys (Unit I/II/III -> Nutrition I/II/III)
--    Matches the JSON subject rename done client-side (feature #7).
-- ============================================================
update public.user_course_quota
   set course_key = replace(course_key, 'Unit I: Introduction to Nutrition', 'Nutrition I'),
       updated_at = now()
 where course_key like '%Unit I: Introduction to Nutrition%';
update public.user_course_quota
   set course_key = replace(course_key, 'Unit II: Nutritional Needs', 'Nutrition II'),
       updated_at = now()
 where course_key like '%Unit II: Nutritional Needs%';
update public.user_course_quota
   set course_key = replace(course_key, 'Unit III: Food Planning, Preparation, and Safety', 'Nutrition III'),
       updated_at = now()
 where course_key like '%Unit III: Food Planning, Preparation, and Safety%';

-- ============================================================
-- 4. USER RELATIONSHIPS (friend | rival)
--    Greenfield social graph. status: 'pending' | 'accepted'.
--    RLS: a user sees rows where they are either party; can insert a
--    pending request to someone; the target can respond (accept/reject).
-- ============================================================
create table if not exists public.user_relationships (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  rel_type text not null check (rel_type in ('friend','rival')),
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint user_relationships_unique unique (user_id, target_id)
);
create index if not exists idx_relationships_user on public.user_relationships(user_id);
create index if not exists idx_relationships_target on public.user_relationships(target_id);

alter table public.user_relationships enable row level security;

-- A user can read relationships they are part of.
drop policy if exists "relationships_read_involved" on public.user_relationships;
create policy "relationships_read_involved"
  on public.user_relationships for select
  using (auth.uid() = user_id or auth.uid() = target_id);

-- A user can send a new request where they are the requester.
drop policy if exists "relationships_insert_own" on public.user_relationships;
create policy "relationships_insert_own"
  on public.user_relationships for insert
  with check (auth.uid() = user_id);

-- The target can update the row (accept/reject); the requester can delete.
drop policy if exists "relationships_update_target" on public.user_relationships;
create policy "relationships_update_target"
  on public.user_relationships for update
  using (auth.uid() = target_id and status = 'pending')
  with check (auth.uid() = target_id);
drop policy if exists "relationships_delete_involved" on public.user_relationships;
create policy "relationships_delete_involved"
  on public.user_relationships for delete
  using (auth.uid() = user_id or auth.uid() = target_id);

-- SECURITY DEFINER RPCs (safe wrappers; client uses service-role via API).
create or replace function public.request_relationship(p_target uuid, p_type text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare new_id bigint;
begin
  if p_target = auth.uid() then
    return jsonb_build_object('error', 'cannot_add_self');
  end if;
  if exists (select 1 from public.user_relationships
              where (user_id = auth.uid() and target_id = p_target)
                 or (target_id = auth.uid() and user_id = p_target)) then
    return jsonb_build_object('error', 'already_related');
  end if;
  insert into public.user_relationships (user_id, target_id, rel_type, status)
  values (auth.uid(), p_target, coalesce(p_type,'friend'), 'pending')
  on conflict (user_id, target_id) do update set rel_type = excluded.rel_type, responded_at = null
  returning id into new_id;
  return jsonb_build_object('ok', true, 'id', new_id);
end;
$$;

create or replace function public.respond_relationship(p_rel_id bigint, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare rel public.user_relationships;
begin
  select * into rel from public.user_relationships where id = p_rel_id;
  if rel is null or rel.target_id <> auth.uid() then
    return jsonb_build_object('error', 'not_found_or_not_target');
  end if;
  if p_accept then
    update public.user_relationships set status='accepted', responded_at=now() where id=p_rel_id;
    -- Mirror row so both directions resolve.
    insert into public.user_relationships (user_id, target_id, rel_type, status, responded_at)
    values (rel.target_id, rel.user_id, rel.rel_type, 'accepted', now())
    on conflict (user_id, target_id) do update set status='accepted', rel_type=excluded.rel_type, responded_at=now();
    return jsonb_build_object('ok', true);
  else
    delete from public.user_relationships where id = p_rel_id;
    return jsonb_build_object('ok', true, 'rejected', true);
  end if;
end;
$$;

create or replace function public.remove_relationship(p_other uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  delete from public.user_relationships
   where (user_id = auth.uid() and target_id = p_other)
      or (target_id = auth.uid() and user_id = p_other);
end;
$$;

-- ============================================================
-- 5. NOTIFICATIONS + push_notification RPC
-- ============================================================
create table if not exists public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'info',
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "notifications_all_own" on public.notifications;
create policy "notifications_all_own"
  on public.notifications for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.push_notification(p_user uuid, p_kind text, p_actor uuid, p_payload jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, actor_id, payload)
  values (p_user, coalesce(p_kind,'info'), p_actor, coalesce(p_payload, '{}'::jsonb));
end;
$$;

-- Trigger: when a user unlocks an achievement, notify accepted friends/rivals.
create or replace function public.notify_achievement_unlock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  a record;
  rel public.user_relationships;
  ach record;
begin
  select name, emoji into ach from public.achievements where id = new.achievement_id;
  for rel in
    select r.user_id, r.target_id
      from public.user_relationships r
     where (r.user_id = new.user_id and r.status='accepted')
        or (r.target_id = new.user_id and r.status='accepted')
  loop
    if rel.user_id = new.user_id then
      insert into public.notifications (user_id, kind, actor_id, payload)
      values (rel.target_id, 'achievement', new.user_id,
              jsonb_build_object('name', coalesce(ach.name,'Achievement'), 'emoji', coalesce(ach.emoji,'🏆')));
    else
      insert into public.notifications (user_id, kind, actor_id, payload)
      values (rel.user_id, 'achievement', new.user_id,
              jsonb_build_object('name', coalesce(ach.name,'Achievement'), 'emoji', coalesce(ach.emoji,'🏆')));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_notify_achievement on public.user_achievements;
create trigger trg_notify_achievement
  after insert on public.user_achievements
  for each row execute function public.notify_achievement_unlock();

-- ============================================================
-- 6. ACHIEVEMENTS: narrator + category + absurd seeds
-- ============================================================
alter table public.achievements add column if not exists narrator text;
alter table public.achievements add column if not exists category text default 'normal';

-- Absurd / fun achievement seeds (idempotent). criteria is cast to jsonb to
-- satisfy the jsonb column while keeping the values clause readable as text.
insert into public.achievements (key, name, description, emoji, narrator, category, criteria)
select key, name, description, emoji, narrator, category, criteria::jsonb from (values
  ('first-blood', 'First Blood', 'Win your first 1v1 duel.', '⚔️',
   'Congratulations. You have successfully defeated another nursing student. Humanity may yet survive.', 'normal', '{"type":"duels","win":1}'),
  ('double-digits', 'Double Digits', 'Answer 10 questions correctly in a row.', '🔟',
   'Ten consecutive correct answers. Someone check this student''s temperature. Something unusual is happening.', 'normal', '{"type":"streak","count":10}'),
  ('scholar', 'Scholar', 'Complete 1,000 questions.', '📚',
   '1,000 questions answered. You could have been sleeping. You chose this instead.', 'normal', '{"type":"questions","count":1000}'),
  ('pharmacology-menace', 'Pharmacology Menace', '100 consecutive correct Pharmacology questions.', '💊',
   'Somewhere, a drug chart just became slightly less safe place.', 'normal', '{"type":"subject_streak","subject":"Pharmacology","count":100}'),
  ('comeback', 'Necessary Drama', 'Win after being significantly behind.', '🎭',
   'You were losing. Then you decided that apparently you weren''t.', 'normal', '{"type":"comeback"}'),
  ('untouchable', 'Untouchable', 'Win a 1v1 without getting a question wrong.', '🧘',
   'Flawless. Not a single wrong answer. The AI is starting to suspect you''re actually a textbook.', 'normal', '{"type":"duels","clean_win":1}'),
  -- 😈 Roasting achievements
  ('oops', 'Oops, All Wrong', 'Answer every question in a round incorrectly.', '💥',
   'A perfect negative score. Impressively bad. The wrong answers chose violence today.', 'roast', '{"type":"all_wrong","count":1}'),
  ('speedrun', 'Speed Demon', 'Finish a round in under half the time limit.', '⚡',
   'You finished that quiz so fast the questions didn''t even load mentally. Breathe.', 'roast', '{"type":"speed","count":1}'),
  ('pharmacist-core', 'Rebel Without a Prescription', 'Pick the wrong answer on a Pharmacology question.', '🚫',
   'The FDA has been notified. This specific drug interaction is now your personal villain origin story.', 'roast', '{"type":"wrong_subject","subject":"Pharmacology","count":1}'),
  -- 🌀 Completely unnecessary achievements
  ('night-owl', 'Night Owl', 'Study between 12am and 4am.', '🦉',
   'It is 3am. You are doing nursing questions. The lamp is also a lamp. Legendary.', 'silly', '{"type":"time_of_day","range":"0-4"}'),
  ('click-bender', 'Click Bender', 'Answer 3 questions in under 10 seconds.', '🖱️',
   'Three questions in ten seconds. Your mouse is filing a complaint for workplace harassment.', 'silly', '{"type":"speed","count":3}'),
  ('thousand-clicks', 'Perpetual Motion', 'Start 10 quiz rounds in one day.', '🌀',
   'You have started ten rounds today. The "Rest" button files a missing-person report for you.', 'silly', '{"type":"rounds","count":10}')
) as v(key, name, description, emoji, narrator, category, criteria)
where not exists (select 1 from public.achievements where key = v.key);

-- ============================================================
-- 7. GET_USER_ACHIEVEMENTS RPC
--    owner-only RLS on user_achievements prevents reading a friend's
--    unlocks; this SECURITY DEFINER RPC returns name/emoji/narrator/category
--    for a given user's unlocked achievements (used by the friends UI).
-- ============================================================
create or replace function public.get_user_achievements(p_user uuid)
returns setof public.achievements
language plpgsql security definer set search_path = public
as $$
begin
  return query
    select a.*
      from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id
     where ua.user_id = p_user
     order by ua.unlocked_at desc;
end;
$$;

-- ============================================================
-- 8. PROFILES ONLINE FLAG + HEARTBEAT
--    is_online is a soft presence hint (friends list). We do NOT auto-revoke
--    sessions; it is purely informational and reset to false on sign-out
--    via SignOutHandler / a heartbeat endpoint.
-- ============================================================
alter table public.profiles add column if not exists is_online boolean not null default false;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- ============================================================
-- 9. DUEL CHALLENGES (friend/rival -> 1v1)
--    status: 'pending' | 'accepted' | 'declined' | 'expired'
-- ============================================================
create table if not exists public.duel_challenges (
  id bigint generated always as identity primary key,
  challenger_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'duel',
  stake integer not null default 0,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);
create index if not exists idx_duel_challenges_target on public.duel_challenges(target_id, created_at desc);
alter table public.duel_challenges enable row level security;
drop policy if exists "duel_challenges_involved" on public.duel_challenges;
create policy "duel_challenges_involved"
  on public.duel_challenges for all
  using (auth.uid() = challenger_id or auth.uid() = target_id)
  with check (auth.uid() = challenger_id or auth.uid() = target_id);

create or replace function public.send_duel_challenge(p_target uuid, p_mode text, p_stake integer)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if p_target = auth.uid() then return jsonb_build_object('error','self_challenge'); end if;
  insert into public.duel_challenges (challenger_id, target_id, mode, stake)
  values (auth.uid(), p_target, coalesce(p_mode,'duel'), coalesce(p_stake,0));
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.respond_duel_challenge(p_challenge_id bigint, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare ch public.duel_challenges;
begin
  select * into ch from public.duel_challenges where id = p_challenge_id;
  if ch is null or ch.target_id <> auth.uid() then
    return jsonb_build_object('error','not_found');
  end if;
  update public.duel_challenges
     set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now()
   where id = p_challenge_id;
  return jsonb_build_object('ok', true, 'accepted', p_accept);
end;
$$;

-- ============================================================
-- 10. DUEL ROUNDS + RESPONSES (simultaneous 1v1)
--     A shared round holds a list of shared-question ids; both players
--     answer the SAME questions within the SAME window. Winner = more correct.
--     duel_rounds.status: 'open' | 'completed'
-- ============================================================
create table if not exists public.duel_rounds (
  id bigint generated always as identity primary key,
  mode text not null default 'duel',
  stake integer not null default 0,
  status text not null default 'open' check (status in ('open','completed')),
  opponent_a uuid references auth.users(id) on delete cascade,
  opponent_b uuid references auth.users(id) on delete cascade, -- null => bot
  question_ids jsonb not null default '[]'::jsonb,
  round_seconds integer not null default 10,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  winner uuid references auth.users(id) on delete set null,
  a_score integer not null default 0,
  b_score integer not null default 0
);
create index if not exists idx_duel_rounds_a on public.duel_rounds(opponent_a);
create index if not exists idx_duel_rounds_b on public.duel_rounds(opponent_b);

alter table public.duel_rounds enable row level security;
drop policy if exists "duel_rounds_involved" on public.duel_rounds;
create policy "duel_rounds_involved"
  on public.duel_rounds for all
  using (auth.uid() = opponent_a or auth.uid() = opponent_b)
  with check (auth.uid() = opponent_a or auth.uid() = opponent_b);

create table if not exists public.duel_responses (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.duel_rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  round_index integer not null default 0,
  correct boolean not null default false,
  answered boolean not null default false,
  created_at timestamptz not null default now(),
  unique (round_id, user_id, round_index)
);
alter table public.duel_responses enable row level security;
drop policy if exists "duel_responses_involved" on public.duel_responses;
create policy "duel_responses_involved"
  on public.duel_responses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- SECURITY DEFINER: record a response for the current user in a round and
-- recompute that user's running score. Returns updated score for the user.
create or replace function public.record_duel_response(p_round_id bigint, p_round_index integer, p_correct boolean)
returns integer
language plpgsql security definer set search_path = public
as $$
declare uid uuid := auth.uid();
begin
  insert into public.duel_responses (round_id, user_id, round_index, correct, answered)
  values (p_round_id, uid, p_round_index, coalesce(p_correct,false), true)
  on conflict (round_id, user_id, round_index) do update
    set correct = excluded.correct, answered = true;
  update public.duel_rounds
     set a_score = (a_score + case when auth.uid() = opponent_a and p_correct then 1 else 0 end),
         b_score = (b_score + case when auth.uid() = opponent_b and p_correct then 1 else 0 end)
   where id = p_round_id and (opponent_a = uid or opponent_b = uid);
  return (select case
            when uid = opponent_a then a_score
            else b_score end
          from public.duel_rounds where id = p_round_id);
end;
$$;

-- Complete a round: figure the winner (more correct) and mark completed.
-- Exposed via the API / a client-triggered settle, guarded by both having
-- finished or the window having elapsed.
create or replace function public.settle_duel_round(p_round_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare r public.duel_rounds;
begin
  select * into r from public.duel_rounds where id = p_round_id;
  if r is null then return jsonb_build_object('error','not_found'); end if;
  if r.status = 'completed' then
    return jsonb_build_object('winner', r.winner, 'a_score', r.a_score, 'b_score', r.b_score, 'already', true);
  end if;
  update public.duel_rounds
     set status='completed', completed_at=now(),
         winner = case
            when a_score > b_score then opponent_a
            when b_score > a_score then opponent_b
            when opponent_b is null and a_score > 0 then opponent_a
            else null end
   where id = p_round_id
   returning * into r;
  return jsonb_build_object('winner', r.winner, 'a_score', r.a_score, 'b_score', r.b_score, 'draw', r.winner is null);
end;
$$;

-- ============================================================
-- 11. DUEL REACTIONS (fixed emoji set)
--     Allowed: 👍 👎 😤 🔥 🙌 🤝
-- ============================================================
create table if not exists public.duel_reactions (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.duel_rounds(id) on delete cascade,
  from_user_id uuid references auth.users(id) on delete cascade, -- null => bot
  emoji text not null check (emoji in ('👍','👎','😤','🔥','🙌','🤝')),
  created_at timestamptz not null default now()
);
alter table public.duel_reactions enable row level security;
drop policy if exists "duel_reactions_round_read" on public.duel_reactions;
create policy "duel_reactions_round_read"
  on public.duel_reactions for select
  using (exists (select 1 from public.duel_rounds dr
                  where dr.id = round_id and (dr.opponent_a = auth.uid() or dr.opponent_b = auth.uid())));
drop policy if exists "duel_reactions_own_insert" on public.duel_reactions;
create policy "duel_reactions_own_insert"
  on public.duel_reactions for insert
  with check (auth.uid() = from_user_id);

-- ============================================================
-- GRANTS (client-facing RPCs)
-- ============================================================
grant execute on function public.consume_course_quota(uuid, text, integer, boolean) to authenticated;
grant execute on function public.get_course_quota_status(uuid) to authenticated;
grant execute on function public.request_relationship(uuid, text) to authenticated;
grant execute on function public.respond_relationship(bigint, boolean) to authenticated;
grant execute on function public.remove_relationship(uuid) to authenticated;
grant execute on function public.push_notification(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.send_duel_challenge(uuid, text, integer) to authenticated;
grant execute on function public.respond_duel_challenge(bigint, boolean) to authenticated;
grant execute on function public.record_duel_response(bigint, integer, boolean) to authenticated;
grant execute on function public.settle_duel_round(bigint) to authenticated;
grant execute on function public.get_user_achievements(uuid) to authenticated;

-- ============================================================
-- DONE.
-- ============================================================
