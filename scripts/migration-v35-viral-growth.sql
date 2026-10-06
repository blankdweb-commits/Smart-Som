-- ============================================================
-- Apex Scholars Migration v35 — VIRAL GROWTH LAYER (SERVER-AUTHORITATIVE)
-- Phase 6 of the mega-spec. Requires v30 (player_score_awards/player_stats),
-- v31 (_sc_apply SC economy), v32 (competitive_stats) FIRST.
--
-- Surfaces (all client writes locked — only SECURITY DEFINER RPCs + triggers
-- move state; rewards flow through _sc_apply):
--   1. ACHIEVEMENTS VENDOR-SIDE — user_achievements RLS is locked to SELECT-own
--      (self-awarding INSERT is removed) and `evaluate_achievements()` grants
--      unlocks from REAL server facts only (player_stats, quiz_results,
--      competitive_stats, daily_challenge, profiles.streak).
--   2. CHALLENGES — claimable rewards verified against real metrics
--      (correct_answers / duel_wins / quiz_rounds / streak_days). Idempotent.
--   3. REFERRALS — referral_code + referrer_id on profiles, `referrals` ledger,
--      apply_referral / get_my_referral, and a trigger that credits the
--      referrer's SC bonus the moment the referred user ACTIVATES.
--   4. SQUADS — one squad per user, weekly correct-answer targets aggregated
--      server-side from player_score_awards (trigger), claimable +5 SC.
--   5. PARTY ROOMS — 2-hour expiry rooms with shareable 6-char codes.
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ACHIEVEMENTS — vendor-side unlocks
-- ------------------------------------------------------------
-- Lock user_achievements to READ-ONLY for clients (the v10 "all own" policy let
-- any client insert its own unlocks — self-awarding). Only the definer RPC
-- below may add rows.
drop policy if exists "user_achievements_all_own" on public.user_achievements;
drop policy if exists "user_achievements_own_read" on public.user_achievements;
create policy "user_achievements_own_read"
  on public.user_achievements for select
  using (auth.uid() = user_id);

create or replace function public.evaluate_achievements()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_stats public.player_stats%rowtype;
  v_comp integer;
  v_daily boolean;
  v_streak integer;
  v_rows bigint;
  v_new jsonb := '[]'::jsonb;
  v_ach record;
  v_met boolean := false;
  v_type text;
  v_target numeric := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_stats from public.player_stats where user_id = v_user;
  select (coalesce(one_v_one_wins, 0) + coalesce(three_v_three_wins, 0))
    into v_comp from public.competitive_stats where user_id = v_user;
  select exists (select 1 from public.daily_challenge
                  where user_id = v_user and challenge_date = current_date
                    and completed = true)
    into v_daily;
  select coalesce(streak, 0) into v_streak from public.profiles where id = v_user;

  for v_ach in
    select a.* from public.achievements a order by a.id
  loop
    if exists (
      select 1 from public.user_achievements ua
      where ua.user_id = v_user and ua.achievement_id = v_ach.id
    ) then
      continue;
    end if;

    -- Sub-block keeps per-iteration scratch in its own scope; the result
    -- (v_met) is an OUTER variable so it stays visible after `end`.
    v_met := false;
    v_type := v_ach.criteria ->> 'type';
    v_target := coalesce((v_ach.criteria ->> 'count')::numeric,
                         (v_ach.criteria ->> 'min')::numeric,
                         (v_ach.criteria ->> 'win')::numeric, 0);
    case v_type
      when 'quizzes' then
        v_met := (select count(*) from public.quiz_results qr where qr.user_id = v_user) >= v_target;
      when 'questions' then
        v_met := coalesce(v_stats.correct_answers, 0) >= v_target;
      when 'streak' then
        -- client 'double-digits' is a per-round correct-streak (no server
        -- per-answer store) — server awards only the day-streak variant to
        -- stay honest; the wall may still mark others 'met' for display.
        if v_ach.key like 'streak-%' then
          v_met := v_streak >= v_target;
        end if;
      when 'duels' then
        v_met := v_comp >= v_target;
      when 'daily_goal' then
        v_met := v_daily;
      else
        -- narrator/fun criteria (speed, all_wrong, time_of_day, come_back,
        -- subject streaks, identity tiers) have no server-side per-answer
        -- fact store — LEFT UNAWARDED rather than client-trusted.
        v_met := false;
    end case;

    if v_met then
      insert into public.user_achievements (user_id, achievement_id)
      values (v_user, v_ach.id)
      on conflict (user_id, achievement_id) do nothing;
      if found then
        v_new := v_new || jsonb_build_object(
          'key', v_ach.key, 'name', v_ach.name, 'emoji', v_ach.emoji,
          'narrator', v_ach.narrator, 'category', v_ach.category);
      end if;
    end if;
  end loop;

  select count(*) into v_rows
    from public.user_achievements where user_id = v_user;

  return jsonb_build_object('ok', true, 'unlocked', v_new,
                            'total', v_rows, 'stats',
                            jsonb_build_object('correctAnswers', coalesce(v_stats.correct_answers, 0),
                                               'duelWins', v_comp, 'streak', v_streak,
                                               'dailyGoalDone', v_daily));
end;
$$;

-- LIVE GRANT GOTCHA — explicit revokes, then grant the intended role.
revoke all on function public.evaluate_achievements() from public, anon, authenticated;
grant execute on function public.evaluate_achievements() to authenticated;

-- ------------------------------------------------------------
-- 2. CHALLENGES — verifiable reward claims
-- ------------------------------------------------------------
create table if not exists public.challenges (
  id bigint generated always as identity primary key,
  key text not null unique,
  title text not null,
  description text not null default '',
  emoji text not null default '🎯',
  metric text not null check (metric in ('correct_answers','duel_wins','quiz_rounds','streak_days')),
  target integer not null default 10,
  reward_sc integer not null default 5,
  repeatable boolean not null default false,
  ends_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.challenge_completions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_key text not null references public.challenges(key) on delete cascade,
  reward_sc integer not null default 5,
  client_request_id uuid,
  claimed_at timestamptz not null default now()
);

alter table public.challenges enable row level security;
alter table public.challenge_completions enable row level security;

drop policy if exists "challenges_public_read" on public.challenges;
create policy "challenges_public_read"
  on public.challenges for select using (true);

drop policy if exists "challenge_completions_own_read" on public.challenge_completions;
create policy "challenge_completions_own_read"
  on public.challenge_completions for select
  using (auth.uid() = user_id);

create unique index if not exists uq_challenge_completion_request
  on public.challenge_completions(user_id, challenge_key, client_request_id)
  where client_request_id is not null;

-- Always-on starter challenges (idempotent seed).
insert into public.challenges (key, title, description, emoji, metric, target, reward_sc, repeatable)
select v.key, v.title, v.description, v.emoji, v.metric, v.target, v.reward, v.repeatable from (values
  ('daily-drive','Daily Drive','Answer 20 questions correctly today.','🚀','correct_answers',20,5,false),
  ('arena-dogs','Arena Dogs','Win 3 duels against humans or the House.','⚔️','duel_wins',3,10,false),
  ('triple-threat-week','Triple Threat Week','Complete 15 quiz rounds this week.','📖','quiz_rounds',15,8,false),
  ('streak-scholar','Streak Scholar','Hold a 7-day study streak.','🔥','streak_days',7,12,false)
) as v(key, title, description, emoji, metric, target, reward, repeatable)
where not exists (select 1 from public.challenges where key = v.key);

create or replace function public.claim_challenge_reward(
  p_challenge_key text,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_ch public.challenges%rowtype;
  v_value integer := 0;
  v_res jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_ch from public.challenges where key = p_challenge_key;
  if v_ch.key is null then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_CHALLENGE');
  end if;
  if not v_ch.is_active or (v_ch.ends_at is not null and v_ch.ends_at <= now()) then
    return jsonb_build_object('ok', false, 'error', 'CHALLENGE_CLOSED');
  end if;

  if p_client_request_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('challenge:' || v_user::text || ':' || p_challenge_key || ':' || p_client_request_id::text));
  end if;

  -- Non-repeatable challenges award once per user.
  if not v_ch.repeatable and exists (
    select 1 from public.challenge_completions cc
    where cc.user_id = v_user and cc.challenge_key = p_challenge_key
  ) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_CLAIMED');
  end if;

  -- VERIFY the metric server-side — the client cannot declare completion.
  v_value := case v_ch.metric
    when 'correct_answers' then
      (select coalesce(correct_answers, 0) from public.player_stats where user_id = v_user)
    when 'duel_wins' then
      (select coalesce(one_v_one_wins, 0) + coalesce(three_v_three_wins, 0)
         from public.competitive_stats where user_id = v_user)
    when 'quiz_rounds' then
      (select count(*) from public.quiz_results qr where qr.user_id = v_user)
    when 'streak_days' then
      (select coalesce(streak, 0) from public.profiles where id = v_user)
    else -1
  end;
  if v_value < 0 then
    return jsonb_build_object('ok', false, 'error', 'INVALID_METRIC');
  end if;
  if v_value < v_ch.target then
    return jsonb_build_object('ok', false, 'error', 'NOT_COMPLETE',
                              'metric', v_ch.metric, 'value', v_value,
                              'target', v_ch.target);
  end if;

  v_res := public._sc_apply(
    v_user, v_ch.reward_sc, 'challenge_' || v_ch.key, 'challenge', 'award',
    'challenge', v_ch.key,
    jsonb_build_object('metric', v_ch.metric, 'value', v_value, 'target', v_ch.target),
    p_client_request_id);
  if coalesce((v_res ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'error', v_res ->> 'error');
  end if;

  insert into public.challenge_completions
    (user_id, challenge_key, reward_sc, client_request_id)
  values (v_user, p_challenge_key, v_ch.reward_sc, p_client_request_id);

  return jsonb_build_object('ok', true, 'reward', v_ch.reward_sc,
                            'balance', v_res ->> 'balanceAfter',
                            'title', v_ch.title, 'value', v_value,
                            'target', v_ch.target);
end;
$$;

revoke all on function public.claim_challenge_reward(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_challenge_reward(text, uuid) to authenticated;

-- ------------------------------------------------------------
-- 3. REFERRALS — apply, invite, and credit-on-activation
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists referrer_id uuid references auth.users(id) on delete set null;

create index if not exists idx_profiles_referral_code on public.profiles(referral_code);

create table if not exists public.referrals (
  id bigint generated always as identity primary key,
  referrer_id uuid not null references auth.users(id) on delete cascade,
  referred_id uuid not null references auth.users(id) on delete cascade,
  reward_sc integer not null default 15,
  status text not null default 'pending' check (status in ('pending','credited')),
  created_at timestamptz not null default now(),
  credited_at timestamptz,
  constraint referrals_referred_unique unique (referred_id)
);

alter table public.referrals enable row level security;
drop policy if exists "referrals_involved_read" on public.referrals;
create policy "referrals_involved_read"
  on public.referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- Apply an invite code (sets referrer + opens a pending ledger row; credit
-- happens on the referred user's activation).
create or replace function public.apply_referral(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_referrer uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if p_code is null or btrim(p_code) = '' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;

  select id into v_referrer
    from public.profiles
   where referral_code = upper(btrim(p_code));
  if v_referrer is null then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_CODE');
  end if;
  if v_referrer = v_user then
    return jsonb_build_object('ok', false, 'error', 'SELF_REFERRAL');
  end if;

  if exists (select 1 from public.referrals where referred_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_REFERRED');
  end if;

  update public.profiles set referrer_id = v_referrer, updated_at = now()
   where id = v_user;

  insert into public.referrals (referrer_id, referred_id)
  values (v_referrer, v_user)
  on conflict (referred_id) do nothing;

  return jsonb_build_object('ok', true, 'referrer', v_referrer);
end;
$$;

-- My invite code (created on demand) + live referral tally.
create or replace function public.get_my_referral()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_count int;
  v_sum int;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select referral_code into v_code from public.profiles where id = v_user;
  if v_code is null then
    v_code := upper(substr(replace(md5(v_user::text), '-', ''), 1, 8));
    update public.profiles set referral_code = v_code, updated_at = now()
     where id = v_user and referral_code is null;
  end if;

  select count(*), coalesce(sum(case when status = 'credited' then reward_sc else 0 end), 0)
    into v_count, v_sum
  from public.referrals where referrer_id = v_user;

  return jsonb_build_object('ok', true, 'code', v_code, 'count', v_count,
                            'creditedSc', v_sum);
end;
$$;

-- Bonus credits the moment the referred account ACTIVATES (server +/- authority:
-- runs as the owner, bypasses profiles RLS; SC via _sc_apply).
create or replace function public.credit_referral_bonus()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_ref public.referrals%rowtype;
  v_res jsonb;
begin
  if TG_OP = 'UPDATE'
     and new.is_activated = true
     and coalesce(old.is_activated, false) = false
     and new.referrer_id is not null then

    select * into v_ref from public.referrals
     where referred_id = new.id and status = 'pending';
    if v_ref.id is not null and exists (
      select 1 from public.profiles where id = v_ref.referrer_id
    ) then
      v_res := public._sc_apply(
        v_ref.referrer_id, v_ref.reward_sc, 'referral_bonus', 'referral',
        'award', 'referral', new.id::text,
        jsonb_build_object('referred_id', new.id), null);
      if coalesce((v_res ->> 'ok')::boolean, false) is true then
        update public.referrals
           set status = 'credited', credited_at = now()
         where id = v_ref.id and status = 'pending';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_referral_credit_on_activation on public.profiles;
create trigger trg_referral_credit_on_activation
  after update of is_activated on public.profiles
  for each row execute function public.credit_referral_bonus();

revoke all on function public.apply_referral(text) from public, anon, authenticated;
grant execute on function public.apply_referral(text) to authenticated;

revoke all on function public.get_my_referral() from public, anon, authenticated;
grant execute on function public.get_my_referral() to authenticated;

-- ------------------------------------------------------------
-- 4. SQUADS — one squad per user, server-tracked weekly targets
-- ------------------------------------------------------------
create table if not exists public.squads (
  id bigint generated always as identity primary key,
  name text not null unique,
  code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  weekly_target_correct integer not null default 200,
  week_start date not null default current_date,
  week_correct integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.squad_members (
  squad_id bigint not null references public.squads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member','owner')),
  joined_at timestamptz not null default now(),
  constraint squad_members_user_unique unique (user_id),
  constraint squad_members_squad_user_unique unique (squad_id, user_id)
);

create table if not exists public.squad_rewards (
  id bigint generated always as identity primary key,
  squad_id bigint not null references public.squads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  reward_sc integer not null default 5,
  credited_at timestamptz not null default now(),
  constraint squad_rewards_user_week_unique unique (user_id, week_start)
);

alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
alter table public.squad_rewards enable row level security;

drop policy if exists "squads_auth_read" on public.squads;
create policy "squads_auth_read"
  on public.squads for select using (auth.uid() is not null);

drop policy if exists "squad_members_own_read" on public.squad_members;
create policy "squad_members_own_read"
  on public.squad_members for select using (auth.uid() = user_id);

drop policy if exists "squad_rewards_own_read" on public.squad_rewards;
create policy "squad_rewards_own_read"
  on public.squad_rewards for select using (auth.uid() = user_id);

-- Roll a squad into the new week if its stored week_start is stale (server-side).
create or replace function public._squad_roll_week(p_squad_id bigint)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.squads
     set week_start = current_date, week_correct = 0, updated_at = now()
   where id = p_squad_id
     and week_start < current_date;
end;
$$;

-- Server-tracked progress: every verified award (apply_quiz_batch_score insert)
-- advances its user's squad for the current week. Runs as the owner inside the
-- definer award path, so quiz scores can never be self-reported.
create or replace function public.squad_weekly_progress()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_squad bigint;
begin
  select squad_id into v_squad
    from public.squad_members where user_id = new.user_id;
  if v_squad is not null then
    perform public._squad_roll_week(v_squad);
    update public.squads
       set week_correct = week_correct + new.correct_delta, updated_at = now()
     where id = v_squad;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_squad_weekly_progress on public.player_score_awards;
create trigger trg_squad_weekly_progress
  after insert on public.player_score_awards
  for each row execute function public.squad_weekly_progress();

create or replace function public.create_squad(p_name text, p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_squad bigint;
  v_code text;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;
  if p_name is null or btrim(p_name) = '' then return jsonb_build_object('ok', false, 'error', 'INVALID_NAME'); end if;
  if exists (select 1 from public.squad_members where user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_SQUAD');
  end if;

  -- A blank/absent code is auto-generated so a squad can NEVER own the empty
  -- string (which would be joinable with a blank input).
  if p_code is null or btrim(p_code) = '' then
    loop
      v_code := upper(substr(replace(md5(v_user::text || '-' || gen_random_uuid()::text), '-', ''), 1, 6));
      exit when not exists (select 1 from public.squads where code = v_code);
    end loop;
  else
    v_code := upper(btrim(p_code));
  end if;

  insert into public.squads (name, code, owner_id)
  values (btrim(p_name), v_code, v_user)
  returning id into v_squad;

  insert into public.squad_members (squad_id, user_id, role)
  values (v_squad, v_user, 'owner');

  return jsonb_build_object('ok', true, 'squadId', v_squad, 'code', v_code);
end;
$$;

create or replace function public.join_squad(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_squad bigint;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;
  if p_code is null or btrim(p_code) = '' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_CODE');
  end if;
  if exists (select 1 from public.squad_members where user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_SQUAD');
  end if;

  select id into v_squad from public.squads where code = upper(btrim(p_code));
  if v_squad is null then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_SQUAD_CODE');
  end if;

  insert into public.squad_members (squad_id, user_id, role)
  values (v_squad, v_user, 'member')
  on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true, 'squadId', v_squad);
end;
$$;

create or replace function public.leave_squad()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_squad bigint;
  v_role text;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;

  select squad_id, role into v_squad, v_role
    from public.squad_members where user_id = v_user;
  if v_squad is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_IN_SQUAD');
  end if;

  delete from public.squad_members where user_id = v_user;

  -- An owner leaving disbands an empty squad (members left already).
  if v_role = 'owner' and not exists (
    select 1 from public.squad_members where squad_id = v_squad
  ) then
    delete from public.squads where id = v_squad;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_my_squad()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_squad public.squads%rowtype;
  v_members jsonb := '[]'::jsonb;
  v_row record;
  v_rewarded boolean;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;

  select s.* into v_squad
    from public.squad_members m join public.squads s on s.id = m.squad_id
   where m.user_id = v_user;
  if v_squad.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_IN_SQUAD');
  end if;

  perform public._squad_roll_week(v_squad.id);

  for v_row in
    select m.user_id, m.role, m.joined_at,
           coalesce(p.full_name, '') as full_name
      from public.squad_members m
      left join public.profiles p on p.id = m.user_id
     where m.squad_id = v_squad.id
     order by m.joined_at asc
  loop
    v_members := v_members || jsonb_build_object(
      'userId', v_row.user_id, 'role', v_row.role,
      'joinedAt', v_row.joined_at, 'fullName', v_row.full_name);
  end loop;

  select exists (select 1 from public.squad_rewards
                  where user_id = v_user and week_start = v_squad.week_start)
    into v_rewarded;

  return jsonb_build_object('ok', true,
    'squad', jsonb_build_object('id', v_squad.id, 'name', v_squad.name,
      'code', v_squad.code, 'ownerId', v_squad.owner_id,
      'weeklyTarget', v_squad.weekly_target_correct,
      'weekStart', v_squad.week_start, 'weekCorrect', v_squad.week_correct,
      'targetMet', v_squad.week_correct >= v_squad.weekly_target_correct),
    'members', v_members, 'rewardedThisWeek', v_rewarded);
end;
$$;

-- Each member may claim the +5 SC once per week once the squad hits target.
create or replace function public.claim_squad_reward()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_squad public.squads%rowtype;
  v_res jsonb;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;

  select s.* into v_squad
    from public.squad_members m join public.squads s on s.id = m.squad_id
   where m.user_id = v_user;
  if v_squad.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_IN_SQUAD');
  end if;

  perform public._squad_roll_week(v_squad.id);

  if exists (select 1 from public.squad_rewards
              where user_id = v_user and week_start = v_squad.week_start) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_CLAIMED');
  end if;
  if v_squad.week_correct < v_squad.weekly_target_correct then
    return jsonb_build_object('ok', false, 'error', 'TARGET_NOT_MET',
                              'weekCorrect', v_squad.week_correct,
                              'weeklyTarget', v_squad.weekly_target_correct);
  end if;

  v_res := public._sc_apply(
    v_user, 5, 'squad_weekly_target', 'squad', 'award', 'squad',
    v_squad.id::text, jsonb_build_object('squadId', v_squad.id,
                                         'week', v_squad.week_start), null);

  insert into public.squad_rewards (squad_id, user_id, week_start)
  values (v_squad.id, v_user, v_squad.week_start);

  return jsonb_build_object('ok', true, 'reward', 5,
                            'balance', v_res ->> 'balanceAfter');
end;
$$;

do $$
declare _fn text;
begin
  foreach _fn in array array[
    'create_squad(text, text)', 'join_squad(text)', 'leave_squad()',
    'get_my_squad()', 'claim_squad_reward()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', _fn);
    execute format('grant execute on function public.%s to authenticated', _fn);
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- 5. PARTY ROOMS — 2-hour shareable study rooms
-- ------------------------------------------------------------
create table if not exists public.quiz_rooms (
  id bigint generated always as identity primary key,
  code text not null unique,
  host_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Study Room',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);

create table if not exists public.room_members (
  room_id bigint not null references public.quiz_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  constraint room_members_user_unique unique (user_id),
  constraint room_members_room_user_unique unique (room_id, user_id)
);

alter table public.quiz_rooms enable row level security;
alter table public.room_members enable row level security;

drop policy if exists "quiz_rooms_auth_read_active" on public.quiz_rooms;
create policy "quiz_rooms_auth_read_active"
  on public.quiz_rooms for select
  using (auth.uid() is not null);

drop policy if exists "room_members_own_read" on public.room_members;
create policy "room_members_own_read"
  on public.room_members for select using (auth.uid() = user_id);

create or replace function public.create_room(p_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text;
  v_room bigint;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;
  if exists (select 1 from public.room_members where user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_ROOM');
  end if;

  v_code := upper(substr(replace(md5(gen_random_uuid()::text), '-', ''), 1, 6));

  insert into public.quiz_rooms (code, host_id, name)
  values (v_code, v_user, case when p_name is null or btrim(p_name) = ''
                               then 'Study Room' else btrim(p_name) end)
  returning id into v_room;

  insert into public.room_members (room_id, user_id)
  values (v_room, v_user);

  return jsonb_build_object('ok', true, 'roomId', v_room, 'code', v_code);
end;
$$;

create or replace function public.join_room(p_code text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room record;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;
  if exists (select 1 from public.room_members where user_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_IN_ROOM');
  end if;

  select * into v_room
    from public.quiz_rooms
   where code = upper(btrim(p_code)) and is_active = true;
  if v_room.id is null or v_room.expires_at <= now() then
    if v_room.id is not null then
      update public.quiz_rooms set is_active = false where id = v_room.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'ROOM_GONE');
  end if;

  insert into public.room_members (room_id, user_id)
  values (v_room.id, v_user)
  on conflict (user_id) do nothing;

  return jsonb_build_object('ok', true, 'roomId', v_room.id, 'code', v_room.code,
                            'name', v_room.name, 'hostId', v_room.host_id);
end;
$$;

create or replace function public.leave_room()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room record;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;

  select r.* into v_room
    from public.room_members m join public.quiz_rooms r on r.id = m.room_id
   where m.user_id = v_user;
  if v_room.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_IN_ROOM');
  end if;

  delete from public.room_members where user_id = v_user;

  if v_room.host_id = v_user and not exists (
    select 1 from public.room_members where room_id = v_room.id
  ) then
    update public.quiz_rooms set is_active = false where id = v_room.id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.get_active_rooms()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_row record;
begin
  -- Expire stale rooms eagerly on read.
  update public.quiz_rooms set is_active = false
   where is_active = true and expires_at <= now();

  for v_row in
    select r.id, r.code, r.name, r.host_id, r.created_at,
           (r.expires_at - now()) as ttl,
           (select count(*) from public.room_members m where m.room_id = r.id) as members
      from public.quiz_rooms r
     where r.is_active = true
     order by r.created_at desc
     limit 50
  loop
    v_out := v_out || jsonb_build_object(
      'id', v_row.id, 'code', v_row.code, 'name', v_row.name,
      'hostId', v_row.host_id, 'memberCount', v_row.members,
      'expiresInSeconds', greatest(extract(epoch from v_row.ttl)::int, 0));
  end loop;

  return jsonb_build_object('ok', true, 'rooms', v_out);
end;
$$;

create or replace function public.get_my_room()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_room record;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED'); end if;

  select r.* into v_room
    from public.room_members m join public.quiz_rooms r on r.id = m.room_id
   where m.user_id = v_user;
  if v_room.id is null or v_room.expires_at <= now() then
    if v_room.id is not null then
      update public.quiz_rooms set is_active = false where id = v_room.id;
    end if;
    return jsonb_build_object('ok', false, 'error', 'NOT_IN_ROOM');
  end if;

  return jsonb_build_object('ok', true, 'roomId', v_room.id, 'code', v_room.code,
                            'name', v_room.name, 'hostId', v_room.host_id,
                            'memberCount', (select count(*) from public.room_members m where m.room_id = v_room.id));
end;
$$;

do $$
declare _fn text;
begin
  foreach _fn in array array[
    'create_room(text)', 'join_room(text)', 'leave_room()',
    'get_active_rooms()', 'get_my_room()'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', _fn);
    execute format('grant execute on function public.%s to authenticated', _fn);
  end loop;
end;
$$;

-- ============================================================
-- DONE.
-- ============================================================