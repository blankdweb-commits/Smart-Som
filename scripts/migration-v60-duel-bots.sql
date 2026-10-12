-- ============================================================
-- Apex Scholars Migration v60 — DUEL TUTOR BOTS + SOLVENT ROSTER
-- POLYNURSE 1v1 Duel rebuild, part 2. Adds SERVER-AUTHORITATIVE TUTOR BOTS
-- (playable opponents for the NON-BLITZ 1v1 sudden-death duel) plus a roster
-- RPC that lists live, eligible (premium + solvent) scholars to challenge.
--
-- What this adds (from the user directive + confirmed design):
--   * BOT OPPONENTS for non-blitz 1v1 only: "The House" (legacy fallback),
--     "Nurse Zainab" (medium), "Prof. Apollo" (hard). Blitz stays HUMAN-ONLY.
--   * The bot ANSWERS FOR REAL: at settlement the server synthesizes the
--     tutor's single sudden-death answer from its skill profile. Outcome is
--     settled with the SAME sudden-death rules as a human duel
--     (correct > wrong > draw). Beating a bot pays SC but earns NO verified
--     competitive win (opponent_id stays NULL — exactly The House rule).
--   * A duel_waiting roster RPC (duel_roster) exposing live scholars who are
--     activated, premium (active subscription) and solvent for the stake, so
--     the betting screen can list them as selectable opponents.
--
-- Schema deltas (all idempotent):
--   competitive_matches += opponent_bot text (NULL | 'house' | 'apollo' | 'zainab').
--     NULL = a normal human/house match -> behaviour unchanged.
--
-- RPCs:
--   create_competitive_match(text,int,uuid,text,text default null)
--       = REPLACES the v58 4-arg (which is DROPPED so PostgREST never sees
--       PGRST203): p_bot is allowed ONLY for format='sudden_death' AND
--       mode='duel' (else BOTS_ARE_1V1 / INVALID_BOT). A bot match forces
--       opponent_id NULL, stores opponent_bot, and de-dupes per bot identity.
--   get_competitive_match(uuid)      REPLACED — also returns opponentBot.
--   complete_competitive_match(uuid) REPLACED — blitz + human sudden-death
--       paths UNCHANGED; a NEW bot branch grades the tutor and settles.
--   duel_roster(text,int,text)       NEW — eligible live opponents.
--
-- All SECURITY DEFINER. ACLs re-asserted (LIVE GRANT GOTCHA: default
-- privileges auto-grant anon+authenticated on every new function). No new
-- api/*.js — the 12-function Vercel cap is untouched.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Schema — the bot identity column.
-- ------------------------------------------------------------
alter table public.competitive_matches
  add column if not exists opponent_bot text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'competitive_matches_opponent_bot_check'
  ) then
    alter table public.competitive_matches
      add constraint competitive_matches_opponent_bot_check
      check (opponent_bot is null or opponent_bot in ('house', 'apollo', 'zainab'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. create_competitive_match — v58 4-arg REPLACED by a 5-arg with a default,
--    so existing callers (blitz / triple) keep working unchanged.
-- ------------------------------------------------------------
drop function if exists public.create_competitive_match(text, integer, uuid, text);

create or replace function public.create_competitive_match(
  p_mode text,
  p_stake integer,
  p_opponent_id uuid default null,
  p_format text default 'sudden_death',
  p_bot text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_prof public.profiles%rowtype;
  v_match_id uuid;
  v_existing uuid;
  v_qids jsonb;
  v_questions jsonb;
  v_count int := 1;
  v_wants int[] := array[8, 12, 12, 8];
  v_ids text[];
  v_opp uuid := p_opponent_id;
  v_bot text := null;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_prof from public.profiles where id = v_user;
  if v_prof.id is null then
    return jsonb_build_object('ok', false, 'error', 'NO_PROFILE');
  end if;
  if not v_prof.is_activated then
    return jsonb_build_object('ok', false, 'error', 'NOT_ACTIVATED',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  if p_mode not in ('duel', 'triple') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_MODE');
  end if;
  if p_stake not in (1, 2, 5, 10, 20) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_STAKE');
  end if;
  if p_format not in ('sudden_death', 'blitz') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_FORMAT');
  end if;

  -- Tutor bots are the NON-BLITZ 1v1 sudden-death opponents only.
  if p_bot is not null then
    if p_format <> 'sudden_death' or p_mode <> 'duel' then
      return jsonb_build_object('ok', false, 'error', 'BOTS_ARE_1V1');
    end if;
    if p_bot not in ('house', 'apollo', 'zainab') then
      return jsonb_build_object('ok', false, 'error', 'INVALID_BOT');
    end if;
    v_bot := p_bot;
    v_opp := null;   -- a bot match has no human opponent id
  end if;

  if v_opp = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;
  -- Blitz is the 1v1 DUEL LOBBY format: human opponent required, duel only.
  if p_format = 'blitz' then
    if p_mode <> 'duel' then
      return jsonb_build_object('ok', false, 'error', 'BLITZ_IS_1V1');
    end if;
    if v_opp is null then
      return jsonb_build_object('ok', false, 'error', 'HUMAN_DUEL_ONLY');
    end if;
  end if;

  -- The wager is only MOVED at settlement, but the party must be solvent to
  -- enter the hall.
  if coalesce(v_prof.smart_coins, 0) < p_stake then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  -- Blitz uses the 40-question demo board; sudden-death stays 1 question.
  if p_format = 'blitz' then
    v_count := 40;
  end if;

  -- De-duplicate racing creation (v38 semantics, now format + bot aware): the
  -- two human clients both call create at the same instant; the first owns the
  -- match and the second receives the SAME match + SAME sequence. A tutor match
  -- is de-duped per bot identity so two different tutors are two matches.
  select cm.id into v_existing
  from public.competitive_matches cm
  where cm.status in ('waiting', 'active')
    and cm.match_type = p_mode
    and cm.stake = p_stake
    and cm.format = p_format
    and cm.opponent_bot is not distinct from v_bot
    and cm.created_at > now() - interval '10 minutes'
    and (
      (cm.creator_id = v_user and cm.opponent_id is not distinct from v_opp)
      or (v_opp is not null and cm.creator_id = v_opp and cm.opponent_id = v_user)
    )
  order by cm.created_at desc
  limit 1;

  if v_existing is not null then
    v_questions := public._cm_serve_questions(
      (select cm.question_ids from public.competitive_matches cm where cm.id = v_existing));
    if v_questions is null then
      return jsonb_build_object('ok', false, 'error', 'MATCH_TAMPERED');
    end if;
    return jsonb_build_object('ok', true, 'replay', true, 'matchId', v_existing,
                              'framework', 'NMCN', 'format', p_format,
                              'opponentBot', v_bot,
                              'questionCount', jsonb_array_length(v_questions),
                              'questions', v_questions);
  end if;

  -- SERVER-SIDE balanced selection for blitz: fixed difficulty split + random
  -- subject-block walk (spread), then stored identically for BOTH players.
  -- sudden-death keeps the v38 pure-random single pick.
  if p_format = 'blitz' then
    v_ids := array(
      select z.id
      from (
        select c.id,
               c.diff_rank,
               (floor(random() * 1000000000))::int as sub_key,
               (floor(random() * 1000000000))::int as within_subject,
               row_number() over (
                 partition by c.diff_rank order by c.id
               ) as rn_by_diff
        from (
          select q.id,
                 case lower(coalesce(q.difficulty, ''))
                   when 'easy' then 0
                   when 'moderate' then 1
                   when 'hard' then 2
                   when 'expert' then 3
                   else 0
                 end as diff_rank
          from public.questions q
          where q.exam_framework = 'NMCN'
            and q.is_active
            and q.question_text is not null
            and q.correct_answer is not null
            and q.options is not null
            and jsonb_typeof(q.options) = 'array'
            and jsonb_array_length(q.options) >= 2
        ) c
      ) z
      left join (
        select t.fill_rank, t.want
        from (values (0, 8), (1, 12), (2, 12), (3, 8)) as t(fill_rank, want)
      ) t on t.fill_rank = z.diff_rank
      order by
        (case when z.rn_by_diff <= coalesce(t.want, 0) then 0 else 1 end),
        z.sub_key,
        z.within_subject
      limit v_count
    );
    v_qids := (
      select coalesce(jsonb_agg(x.id::text order by x.ord), '[]'::jsonb)
      from unnest(v_ids) with ordinality as x(id, ord)
    );
  else
    v_qids := (
      select coalesce(jsonb_agg(x.id::text), '[]'::jsonb)
      from (
        select q.id
        from public.questions q
        where q.exam_framework = 'NMCN'
          and q.is_active
          and q.question_text is not null
          and q.correct_answer is not null
          and q.options is not null
          and jsonb_typeof(q.options) = 'array'
          and jsonb_array_length(q.options) >= 2
        order by random()
        limit v_count
      ) x
    );
  end if;

  if v_qids is null or jsonb_array_length(v_qids) < 1 then
    return jsonb_build_object('ok', false, 'error', 'NO_NMCN_CANDIDATES');
  end if;

  v_questions := public._cm_serve_questions(v_qids);
  if v_questions is null then
    return jsonb_build_object('ok', false, 'error', 'NO_VALID_QUESTIONS');
  end if;

  insert into public.competitive_matches
    (match_type, stake, status, framework, format, creator_id, opponent_id,
     opponent_bot, question_ids, question_count)
  values
    (p_mode, p_stake,
     case when p_format = 'blitz' then 'waiting' else 'active' end,
     'NMCN', p_format, v_user, v_opp, v_bot, v_qids, jsonb_array_length(v_qids))
  returning id into v_match_id;

  return jsonb_build_object('ok', true, 'replay', false, 'matchId', v_match_id,
                            'framework', 'NMCN', 'format', p_format,
                            'opponentBot', v_bot,
                            'questionCount', jsonb_array_length(v_qids),
                            'questions', v_questions);
end;
$$;

-- ------------------------------------------------------------
-- 3. get_competitive_match — REPLACED to also expose opponentBot.
-- ------------------------------------------------------------
create or replace function public.get_competitive_match(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_questions jsonb;
  v_my_answers jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  v_questions := public._cm_serve_questions(v_m.question_ids);
  if v_questions is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_TAMPERED');
  end if;

  v_my_answers := (
    select coalesce(jsonb_agg(
      jsonb_build_object('index', a.question_index,
                         'selected', a.selected_answer,
                         'isCorrect', a.is_correct,
                         'multiplier', a.multiplier)
      order by a.question_index), '[]'::jsonb)
    from public.competitive_match_answers a
    where a.match_id = p_match_id and a.player_id = v_user
  );

  return jsonb_build_object('ok', true, 'matchId', v_m.id, 'status', v_m.status,
                            'mode', v_m.match_type, 'stake', v_m.stake,
                            'format', v_m.format,
                            'opponentBot', v_m.opponent_bot,
                            'framework', v_m.framework, 'questionCount', v_m.question_count,
                            'createdAt', v_m.created_at,
                            'startsAt', v_m.starts_at, 'endsAt', v_m.ends_at,
                            'myAnswers', v_my_answers,
                            'questions', v_questions);
end;
$$;

-- ------------------------------------------------------------
-- 4. complete_competitive_match — REPLACED: blitz + human sudden-death paths
--    unchanged; a NEW tutor-bot branch grades the tutor and settles.
-- ------------------------------------------------------------
create or replace function public.complete_competitive_match(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match_key text;
  v_m public.competitive_matches%rowtype;
  v_humans uuid[];
  v_human uuid;
  v_human_count int;
  v_score int;
  v_ans int;
  v_max int := -1;
  v_at_max int := 0;
  v_answered_humans int := 0;
  v_total_answers int := 0;
  v_scores jsonb := '{}'::jsonb;
  v_answered jsonb := '{}'::jsonb;
  v_deltas jsonb := '{}'::jsonb;
  v_outcomes jsonb := '{}'::jsonb;
  v_players int;
  v_stake_gain int;
  v_winner_id uuid := null;
  v_winner_name text := 'The House';
  v_draw boolean := false;
  v_delta int;
  v_oc text;
  v_settled boolean := false;
  v_bal text;
  v_res jsonb;
  v_req uuid;
  v_opp text;
  v_opp_id uuid;
  v_my_delta int := 0;
  v_my_oc text := 'draw';
  v_my_balance text := null;
  v_my_settled boolean := false;
  v_breakdown jsonb := '[]'::jsonb;
  -- tutor-bot scratch (v60)
  v_bot_name text := null;
  v_bot_skill numeric := 0;
  v_bot_correct boolean := false;
  -- blitz scratch
  v_p1 uuid;
  v_p2 uuid;
  v_s1 numeric := 0;
  v_s2 numeric := 0;
  v_w1 int := 0;
  v_w2 int := 0;
  v_l1 numeric := 0;
  v_l2 numeric := 0;
  v_a1 int := 0;
  v_a2 int := 0;
  v_blitz_scores jsonb := '{}'::jsonb;
  v_blitz_wrongs jsonb := '{}'::jsonb;
  v_blitz_latency jsonb := '{}'::jsonb;
  v_blitz_answered jsonb := '{}'::jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  -- Serialize concurrent completion by both players.
  v_match_key := 'competitive_match:' || p_match_id::text;
  perform pg_advisory_xact_lock(hashtext(v_match_key));

  -- Re-read under the lock; a completed match replays its stored verdict.
  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.status = 'completed' or v_m.status = 'abandoned' then
    return jsonb_build_object('ok', true, 'replay', true, 'status', v_m.status,
                              'matchId', p_match_id, 'outcome', v_m.outcome);
  end if;

  v_humans := array(
    select x.u from (values (v_m.creator_id), (v_m.opponent_id)) as x(u)
    where x.u is not null
  );
  v_human_count := coalesce(cardinality(v_humans), 0);
  v_players := case when v_m.match_type = 'triple' then 3 else 2 end;
  v_stake_gain := v_m.stake * (v_players - 1);

  -- ============================================================
  -- BLITZ BRANCH (1v1 Duel Lobby)
  -- ============================================================
  if v_m.format = 'blitz' then
    if v_m.starts_at is null then
      if now() > v_m.created_at + interval '10 minutes' then
        update public.competitive_matches
          set status = 'abandoned', completed_at = now(),
              outcome = jsonb_build_object('status', 'abandoned', 'reason', 'stale')
          where id = p_match_id;
        return jsonb_build_object('ok', true, 'status', 'abandoned',
                                  'error', 'MATCH_ABANDONED', 'matchId', p_match_id);
      end if;
      return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_STARTED',
                                'matchId', p_match_id);
    end if;

    if now() < v_m.ends_at then
      return jsonb_build_object('ok', false, 'error', 'BLITZ_NOT_ENDED',
                                'matchId', p_match_id, 'endsAt', v_m.ends_at,
                                'remainingMs',
                                (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint);
    end if;

    v_p1 := v_humans[1];
    v_p2 := v_humans[2];

    foreach v_human in array v_humans loop
      select coalesce(sum(
                 case
                   when a.selected_answer is null then 0
                   when a.is_correct then a.multiplier
                   else -a.multiplier
                 end
               ), 0)::numeric,
             coalesce(count(*) filter (
                 where a.selected_answer is not null and not a.is_correct), 0)::int,
             coalesce(sum(extract(epoch from (
                 a.answered_at - coalesce(v_m.starts_at, v_m.started_at))) * 1000), 0)::numeric,
             coalesce(count(*) filter (
                 where a.selected_answer is not null), 0)::int
        into v_s1, v_w1, v_l1, v_a1
      from public.competitive_match_answers a
      where a.match_id = p_match_id and a.player_id = v_p1;

      select coalesce(sum(
                 case
                   when a.selected_answer is null then 0
                   when a.is_correct then a.multiplier
                   else -a.multiplier
                 end
               ), 0)::numeric,
             coalesce(count(*) filter (
                 where a.selected_answer is not null and not a.is_correct), 0)::int,
             coalesce(sum(extract(epoch from (
                 a.answered_at - coalesce(v_m.starts_at, v_m.started_at))) * 1000), 0)::numeric,
             coalesce(count(*) filter (
                 where a.selected_answer is not null), 0)::int
        into v_s2, v_w2, v_l2, v_a2
      from public.competitive_match_answers a
      where a.match_id = p_match_id and a.player_id = v_p2;

      v_blitz_scores := jsonb_set(v_blitz_scores, array[v_p1::text], to_jsonb(v_s1));
      v_blitz_scores := jsonb_set(v_blitz_scores, array[v_p2::text], to_jsonb(v_s2));
      v_blitz_wrongs := jsonb_set(v_blitz_wrongs, array[v_p1::text], to_jsonb(v_w1));
      v_blitz_wrongs := jsonb_set(v_blitz_wrongs, array[v_p2::text], to_jsonb(v_w2));
      v_blitz_latency := jsonb_set(v_blitz_latency, array[v_p1::text], to_jsonb(round(v_l1)::bigint));
      v_blitz_latency := jsonb_set(v_blitz_latency, array[v_p2::text], to_jsonb(round(v_l2)::bigint));
      v_blitz_answered := jsonb_set(v_blitz_answered, array[v_p1::text], to_jsonb(v_a1));
      v_blitz_answered := jsonb_set(v_blitz_answered, array[v_p2::text], to_jsonb(v_a2));
      exit;
    end loop;

    v_answered_humans := (case when v_a1 > 0 then 1 else 0 end)
                       + (case when v_a2 > 0 then 1 else 0 end);

    if v_a1 > 0 or v_a2 > 0 then
      if v_s1 <> v_s2 then
        v_winner_id := case when v_s1 > v_s2 then v_p1 else v_p2 end;
      elsif v_w1 <> v_w2 then
        v_winner_id := case when v_w1 < v_w2 then v_p1 else v_p2 end;
      elsif v_l1 <> v_l2 then
        v_winner_id := case when v_l1 < v_l2 then v_p1 else v_p2 end;
      else
        v_draw := true;
      end if;
    else
      v_draw := true;
    end if;

    if v_winner_id is not null then
      select coalesce(cp.display_name, 'Rival Scholar') into v_winner_name
      from public.community_profiles cp where cp.id = v_winner_id;
    else
      v_winner_name := 'Draw';
    end if;

    foreach v_human in array v_humans loop
      v_delta := 0; v_oc := 'draw';
      if v_human = v_winner_id then
        v_delta := v_stake_gain; v_oc := 'win';
      elsif not v_draw then
        v_delta := -v_m.stake; v_oc := 'loss';
      end if;
      v_deltas := jsonb_set(v_deltas, array[v_human::text], to_jsonb(v_delta));
      v_outcomes := jsonb_set(v_outcomes, array[v_human::text], to_jsonb(v_oc));
    end loop;

    foreach v_human in array v_humans loop
      v_delta := (v_deltas ->> v_human::text)::int;
      v_oc := v_outcomes ->> v_human::text;
      v_ans := ((v_blitz_answered ->> v_human::text)::int);
      v_settled := false; v_bal := null;

      v_req := md5(v_match_key || ':' || v_human::text)::uuid;
      if v_delta <> 0 then
        v_res := public._sc_apply(
          v_human, v_delta,
          case when v_delta > 0 then 'duel_win' else 'duel_loss' end,
          'duel',
          case when v_delta > 0 then 'earn' else 'spend' end,
          'competitive_match', p_match_id::text,
          jsonb_build_object('mode', v_m.match_type, 'stake', v_m.stake,
                             'format', 'blitz', 'match_id', p_match_id::text,
                             'outcome', v_oc),
          v_req);
        if coalesce((v_res ->> 'ok')::boolean, false) then
          v_settled := true;
          v_bal := v_res ->> 'balanceAfter';
        end if;
      end if;

      if v_human = v_m.creator_id then
        v_opp_id := v_m.opponent_id;
        if v_opp_id is null then
          v_opp := coalesce(v_bot_name, 'The House');
        else
          select coalesce(cp.display_name, 'Rival Scholar') into v_opp
          from public.community_profiles cp where cp.id = v_opp_id;
        end if;
      else
        v_opp_id := v_m.creator_id;
        select coalesce(cp.display_name, 'Rival Scholar') into v_opp
        from public.community_profiles cp where cp.id = v_opp_id;
      end if;

      insert into public.duels
        (user_id, opponent, opponent_id, mode, stake, outcome, delta,
         transaction_type, client_request_id)
      values
        (v_human, v_opp, v_opp_id, v_m.match_type, v_m.stake, v_oc,
         v_delta, case when v_oc = 'win' or v_oc = 'loss' then 'duel' else 'duel_draw' end,
         v_req);

      if v_m.opponent_id is not null and v_ans > 0
         and v_answered_humans = v_human_count then
        insert into public.competitive_stats
          (user_id, competitive_matches, competitive_wins,
           one_v_one_matches, one_v_one_wins,
           three_v_three_matches, three_v_three_wins,
           last_match_at, updated_at)
        values
          (v_human, 1, case when v_oc = 'win' then 1 else 0 end,
           case when v_m.match_type = 'duel' then 1 else 0 end,
           case when v_m.match_type = 'duel' and v_oc = 'win' then 1 else 0 end,
           case when v_m.match_type = 'triple' then 1 else 0 end,
           case when v_m.match_type = 'triple' and v_oc = 'win' then 1 else 0 end,
           now(), now())
        on conflict (user_id) do update set
          competitive_matches   = public.competitive_stats.competitive_matches + 1,
          competitive_wins      = public.competitive_stats.competitive_wins
                                    + (case when v_oc = 'win' then 1 else 0 end),
          one_v_one_matches     = public.competitive_stats.one_v_one_matches
                                    + (case when v_m.match_type = 'duel' then 1 else 0 end),
          one_v_one_wins        = public.competitive_stats.one_v_one_wins
                                    + (case when v_m.match_type = 'duel' and v_oc = 'win' then 1 else 0 end),
          three_v_three_matches = public.competitive_stats.three_v_three_matches
                                    + (case when v_m.match_type = 'triple' then 1 else 0 end),
          three_v_three_wins    = public.competitive_stats.three_v_three_wins
                                    + (case when v_m.match_type = 'triple' and v_oc = 'win' then 1 else 0 end),
          last_match_at = now(),
          updated_at = now();
      end if;

      v_breakdown := v_breakdown || jsonb_build_object(
        'playerId', v_human, 'name', v_opp, 'result', v_oc,
        'delta', v_delta, 'settled', v_settled,
        'score', (v_blitz_scores ->> v_human::text)::numeric,
        'wrongs', (v_blitz_wrongs ->> v_human::text)::int,
        'answered', (v_blitz_answered ->> v_human::text)::int);

      if v_human = v_user then
        v_my_delta := v_delta; v_my_oc := v_oc;
        v_my_settled := v_settled; v_my_balance := v_bal;
      end if;

      perform public.refresh_duel_risk(v_human);
    end loop;

    update public.competitive_matches
      set status = 'completed', completed_at = now(), winner_id = v_winner_id,
          outcome = jsonb_build_object(
            'status', 'completed', 'format', 'blitz', 'reason', 'time',
            'winnerId', v_winner_id, 'winner', v_winner_name,
            'draw', v_draw, 'breakdown', v_breakdown)
      where id = p_match_id and status in ('waiting', 'active');

    return jsonb_build_object(
      'ok', true, 'status', 'completed', 'matchId', p_match_id,
      'mode', v_m.match_type, 'stake', v_m.stake, 'players', v_players,
      'format', 'blitz',
      'winnerId', v_winner_id, 'winner', v_winner_name, 'draw', v_draw,
      'youWon', (v_winner_id = v_user),
      'scores', v_blitz_scores, 'wrongs', v_blitz_wrongs,
      'latencyMs', v_blitz_latency, 'answered', v_blitz_answered,
      'outcome', v_my_oc, 'delta', v_my_delta,
      'balance', v_my_balance, 'settled', v_my_settled,
      'breakdown', v_breakdown);
  end if;
  -- ============================================================
  -- END BLITZ BRANCH — everything below is the sudden-death settlement.
  -- ============================================================

  -- Per-player FACTS from the stored answers (never from the request).
  foreach v_human in array v_humans loop
    select coalesce(count(*) filter (where is_correct), 0)::int,
           count(*)::int
      into v_score, v_ans
    from public.competitive_match_answers
    where match_id = p_match_id and player_id = v_human;

    v_scores := jsonb_set(v_scores, array[v_human::text], to_jsonb(v_score));
    v_answered := jsonb_set(v_answered, array[v_human::text], to_jsonb(v_ans));
    v_total_answers := v_total_answers + v_ans;
    if v_ans > 0 then v_answered_humans := v_answered_humans + 1; end if;
    if v_score > v_max then
      v_max := v_score; v_at_max := 1;
    elsif v_score = v_max then
      v_at_max := v_at_max + 1;
    end if;
  end loop;

  -- Nobody played -> abandon. No coins move, no history written.
  if v_total_answers = 0 then
    update public.competitive_matches
      set status = 'abandoned', completed_at = now(),
          outcome = jsonb_build_object('status', 'abandoned')
      where id = p_match_id;
    return jsonb_build_object('ok', true, 'status', 'abandoned',
                              'error', 'MATCH_ABANDONED', 'matchId', p_match_id);
  end if;

  -- Determine the winner from answered humans only.
  --   Tutor bot (v60): the tutor answers its single sudden-death question by a
  --     skill roll, then settles like a fair human duel (correct > wrong =
  --     Draw; silence = Draw/no coins).
  --   Solo/House game: the player wins iff they answered >= 1 correctly.
  --   Full human duel: unique max answer count wins; tie => draw.
  if v_m.opponent_bot is not null and v_human_count = 1 then
    v_bot_name := case v_m.opponent_bot
                    when 'apollo' then 'Prof. Apollo'
                    when 'zainab' then 'Nurse Zainab'
                    else 'The House'
                  end;
    v_bot_skill := case v_m.opponent_bot
                     when 'apollo' then 0.78
                     when 'zainab' then 0.62
                     else 0.55
                   end;
    -- The tutor answers for real: a skill roll decides its lone sudden-death
    -- answer. (Computed once; the completed-match early return makes replays
    -- read the stored verdict, so this never re-rolls.)
    v_bot_correct := random()::numeric < v_bot_skill;

    if (v_answered ->> v_humans[1]::text)::int = 0 then
      v_draw := true;                                  -- human never played
    elsif (v_scores ->> v_humans[1]::text)::int
          > (case when v_bot_correct then 1 else 0 end) then
      v_winner_id := v_humans[1];                       -- human beat the tutor
    elsif (v_scores ->> v_humans[1]::text)::int
          < (case when v_bot_correct then 1 else 0 end) then
      v_winner_id := null;                              -- tutor wins (no account)
    else
      v_draw := true;                                   -- both right / both wrong
    end if;
  elsif v_human_count = 1 then
    if v_max >= 1 then
      v_winner_id := v_humans[1];
    end if;
  elsif v_answered_humans = v_human_count then
    if v_at_max = 1 and v_max >= 1 then
      foreach v_human in array v_humans loop
        if (v_scores ->> v_human::text)::int = v_max then
          v_winner_id := v_human;
          exit;
        end if;
      end loop;
    else
      v_draw := true;
    end if;
  elsif v_max >= 1 then
    foreach v_human in array v_humans loop
      if (v_answered ->> v_human::text)::int > 0
         and (v_scores ->> v_human::text)::int = v_max then
        v_winner_id := v_human;
        exit;
      end if;
    end loop;
  end if;

  -- Per-player settlements (deterministic).
  foreach v_human in array v_humans loop
    v_score := (v_scores ->> v_human::text)::int;
    v_ans := (v_answered ->> v_human::text)::int;
    v_delta := 0; v_oc := 'draw';
    if v_human = v_winner_id then
      v_delta := v_stake_gain; v_oc := 'win';
    elsif v_draw then
      v_delta := 0; v_oc := 'draw';
    elsif v_ans = 0 then
      v_delta := 0; v_oc := 'draw';           -- forfeited: pays/earns nothing
    else
      v_delta := -v_m.stake; v_oc := 'loss';
    end if;
    v_deltas := jsonb_set(v_deltas, array[v_human::text], to_jsonb(v_delta));
    v_outcomes := jsonb_set(v_outcomes, array[v_human::text], to_jsonb(v_oc));
  end loop;

  if v_winner_id is not null then
    select coalesce(cp.display_name, 'Rival Scholar') into v_winner_name
    from public.community_profiles cp where cp.id = v_winner_id;
  elsif not v_draw then
    v_winner_name := 'The House';
  else
    v_winner_name := 'Draw';
  end if;

  -- A tutor that won the duel is the named winner in the verdict.
  if v_m.opponent_bot is not null and v_winner_id is null and not v_draw then
    v_winner_name := v_bot_name;
  end if;

  -- Apply coins (per-player unique client_request_id => no double pay even on a
  -- replayed settle pass), write history + stats, build the verdict.
  foreach v_human in array v_humans loop
    v_delta := (v_deltas ->> v_human::text)::int;
    v_oc := v_outcomes ->> v_human::text;
    v_ans := (v_answered ->> v_human::text)::int;
    v_settled := false; v_bal := null;

    v_req := md5(v_match_key || ':' || v_human::text)::uuid;
    if v_delta <> 0 then
      v_res := public._sc_apply(
        v_human, v_delta,
        case when v_delta > 0 then 'duel_win' else 'duel_loss' end,
        'duel',
        case when v_delta > 0 then 'earn' else 'spend' end,
        'competitive_match', p_match_id::text,
        jsonb_build_object('mode', v_m.match_type, 'stake', v_m.stake,
                           'match_id', p_match_id::text, 'outcome', v_oc),
        v_req);
      if coalesce((v_res ->> 'ok')::boolean, false) then
        v_settled := true;
        v_bal := v_res ->> 'balanceAfter';
      end if;
    end if;

    -- Opponent identity for the duels history row (same masking as finalize_duel).
    if v_human = v_m.creator_id then
      v_opp_id := v_m.opponent_id;
      if v_opp_id is null then
        v_opp := coalesce(v_bot_name, 'The House');
      else
        select coalesce(cp.display_name, 'Rival Scholar') into v_opp
        from public.community_profiles cp where cp.id = v_opp_id;
      end if;
    else
      v_opp_id := v_m.creator_id;
      select coalesce(cp.display_name, 'Rival Scholar') into v_opp
      from public.community_profiles cp where cp.id = v_opp_id;
    end if;

    insert into public.duels
      (user_id, opponent, opponent_id, mode, stake, outcome, delta,
       transaction_type, client_request_id)
    values
      (v_human, v_opp, v_opp_id, v_m.match_type, v_m.stake, v_oc,
       v_delta, case when v_oc = 'win' or v_oc = 'loss' then 'duel' else 'duel_draw' end,
       v_req);

    -- Verified competitive stats ONLY for a fully-played HUMAN duel (a tutor /
    -- the House pays SC but earns no verified wins) AND only for players who
    -- actually battled.
    if v_m.opponent_id is not null and v_ans > 0
       and v_answered_humans = v_human_count then
      insert into public.competitive_stats
        (user_id, competitive_matches, competitive_wins,
         one_v_one_matches, one_v_one_wins,
         three_v_three_matches, three_v_three_wins,
         last_match_at, updated_at)
      values
        (v_human, 1, case when v_oc = 'win' then 1 else 0 end,
         case when v_m.match_type = 'duel' then 1 else 0 end,
         case when v_m.match_type = 'duel' and v_oc = 'win' then 1 else 0 end,
         case when v_m.match_type = 'triple' then 1 else 0 end,
         case when v_m.match_type = 'triple' and v_oc = 'win' then 1 else 0 end,
         now(), now())
      on conflict (user_id) do update set
        competitive_matches   = public.competitive_stats.competitive_matches + 1,
        competitive_wins      = public.competitive_stats.competitive_wins
                                  + (case when v_oc = 'win' then 1 else 0 end),
        one_v_one_matches     = public.competitive_stats.one_v_one_matches
                                  + (case when v_m.match_type = 'duel' then 1 else 0 end),
        one_v_one_wins        = public.competitive_stats.one_v_one_wins
                                  + (case when v_m.match_type = 'duel' and v_oc = 'win' then 1 else 0 end),
        three_v_three_matches = public.competitive_stats.three_v_three_matches
                                  + (case when v_m.match_type = 'triple' then 1 else 0 end),
        three_v_three_wins    = public.competitive_stats.three_v_three_wins
                                  + (case when v_m.match_type = 'triple' and v_oc = 'win' then 1 else 0 end),
        last_match_at = now(),
        updated_at = now();
    end if;

    v_breakdown := v_breakdown || jsonb_build_object(
      'playerId', v_human, 'name', v_opp, 'result', v_oc,
      'delta', v_delta, 'settled', v_settled,
      'score', v_score);

    if v_human = v_user then
      v_my_delta := v_delta; v_my_oc := v_oc;
      v_my_settled := v_settled; v_my_balance := v_bal;
    end if;

    perform public.refresh_duel_risk(v_human);
  end loop;

  -- Add the tutor to the breakdown so the result screen names the opponent.
  if v_m.opponent_bot is not null and v_human_count = 1 then
    v_breakdown := v_breakdown || jsonb_build_object(
      'playerId', null, 'name', v_bot_name, 'isBot', true,
      'result', case when v_draw then 'draw'
                     when v_winner_id is null then 'win'
                     else 'loss' end,
      'delta', 0, 'settled', true,
      'score', case when v_bot_correct then 1 else 0 end);
  end if;

  update public.competitive_matches
    set status = 'completed', completed_at = now(), winner_id = v_winner_id,
        outcome = jsonb_build_object(
          'status', 'completed', 'winnerId', v_winner_id, 'winner', v_winner_name,
          'opponentBot', v_m.opponent_bot,
          'draw', v_draw, 'breakdown', v_breakdown)
    where id = p_match_id and status in ('waiting', 'active');

  return jsonb_build_object(
    'ok', true, 'status', 'completed', 'matchId', p_match_id,
    'mode', v_m.match_type, 'stake', v_m.stake, 'players', v_players,
    'opponentBot', v_m.opponent_bot,
    'winnerId', v_winner_id, 'winner', v_winner_name, 'draw', v_draw,
    'youWon', (v_winner_id = v_user),
    'outcome', v_my_oc, 'delta', v_my_delta,
    'balance', v_my_balance, 'settled', v_my_settled,
    'breakdown', v_breakdown);
end;
$$;

-- ------------------------------------------------------------
-- 5. duel_roster — list live, eligible (activated + premium + solvent)
--    scholars waiting for this mode + format so the betting screen can show
--    them as selectable opponents. Identity via community_profiles.
-- ------------------------------------------------------------
create or replace function public.duel_roster(
  p_mode text default 'duel',
  p_stake integer default 0,
  p_format text default 'sudden_death'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_players jsonb := '[]'::jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select coalesce(jsonb_agg(obj order by created_at), '[]'::jsonb) into v_players
  from (
    select dw.created_at,
           jsonb_build_object(
             'userId', dw.user_id,
             'name', coalesce(cp.display_name, 'Scholar'),
             'stake', dw.stake,
             'createdAt', dw.created_at
           ) as obj
    from public.duel_waiting dw
    join public.community_profiles cp on cp.id = dw.user_id
    join public.profiles p on p.id = dw.user_id
    where dw.user_id <> v_user
      and dw.mode = p_mode
      and dw.format = p_format
      and (p_stake = 0 or dw.stake = p_stake)
      and p.is_activated
      and coalesce(p.smart_coins, 0) >= dw.stake
      and exists (
        select 1 from public.subscriptions s
        where s.user_id = dw.user_id
          and s.status = 'active'
          and coalesce(s.expires_at, s.grace_until) > now()
      )
    order by dw.created_at asc
    limit 30
  ) r;

  return jsonb_build_object('ok', true, 'mode', p_mode, 'stake', p_stake,
                            'format', p_format, 'players', v_players);
end;
$$;

-- ------------------------------------------------------------
-- 6. ACLs (LIVE GRANT GOTCHA: default privileges auto-grant anon +
--    authenticated on every new function — revoke all three explicitly)
-- ------------------------------------------------------------
revoke all on function public.create_competitive_match(text, integer, uuid, text, text)
  from public, anon;
grant execute on function public.create_competitive_match(text, integer, uuid, text, text)
  to authenticated;

revoke all on function public.get_competitive_match(uuid)
  from public, anon;
grant execute on function public.get_competitive_match(uuid)
  to authenticated;

revoke all on function public.complete_competitive_match(uuid)
  from public, anon;
grant execute on function public.complete_competitive_match(uuid)
  to authenticated;

revoke all on function public.duel_roster(text, integer, text)
  from public, anon;
grant execute on function public.duel_roster(text, integer, text)
  to authenticated;

-- ------------------------------------------------------------
-- 7. PostgREST schema reload — makes the new/changed RPCs immediately callable
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================
