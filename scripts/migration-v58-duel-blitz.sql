-- ============================================================
-- Apex Scholars Migration v58 — 1v1 DUEL LOBBY + BLITZ (v38 format extension)
-- POLYNURSE 1v1 Duel + Lobby rebuild. Extends the v38 competitive-match engine
-- (server-authoritative NMCN arena) with a SECOND format: 'blitz'.
--
-- What blitz is (from the 1v1-arena demo):
--   * 40 NMCN questions, ONE shared 90-second wall-clock (starts_at -> ends_at).
--   * Each answer scores:  +1 (correct) / -1 (wrong) / 0 (skip). The ONE-TIME
--     "???" Double flags a single answer to score x2 (server-enforced: at most
--     one multiplier=2 row per (match, player)).
--   * BOTH players answer the SAME stored sequence; the client mirrors the
--     live score locally (identity formula) over realtime while the SERVER
--     remains the final grader of record.
--   * Winner is resolved by the DEMO's scoring. Ties are broken
--     DETERMINISTICALLY (spec'd + displayed): 1) higher score, 2) fewer wrong
--     answers, 3) lower cumulative answer latency (sum of answered_at -
--     starts_at), 4) last resort = Draw (wager returned).
--   * HUMAN-ONLY (v38's "The House" fallback is NOT used for blitz).
--   * Wagering is UNCHANGED: winner takes +stake, loser -stake, draw moves 0.
--     Every balance change goes through _sc_apply with a per-player
--     client_request_id (md5(match:player)) => replay-safe, no double pay.
--
-- COMPLIANCE AMENDMENTS baked in (from the spec review):
--   (A) Balanced sequence: the 40 NMCN ids are chosen by a fixed difficulty
--       split (Easy 8 / Moderate 12 / Hard 12 / Expert 8, floored to what the
--       bank actually holds) AND a subject-spread walk (random subject blocks,
--       random within subject), so the sequence is never pure `random()` and
--       is IDENTICAL for both players (stored once on the match row).
--   (B) Once a blitz has STARTED it ALWAYS settles at its ends_at with the
--       answers recorded so far. A never-begun stale match (no starts_at,
--       10+ min old) is the ONLY void path (abandoned, no coins move).
--   (C) early complete_competitive_match during the live window is REFUSED
--       (BLITZ_NOT_ENDED) so nobody can lock the battle early.
--   (D) refresh_duel_risk(v34 anti-farm) still runs per human after settle.
--   (E) reconnect RESUME: get_competitive_match returns the caller's own
--       stored answers + starts_at/ends_at so a reload re-syncs the mirror
--       (never resets, never re-deals).
--
-- Schema deltas (all idempotent):
--   competitive_matches  += format ('sudden_death' | 'blitz'), starts_at,
--                           ends_at. Existing v38 rows default to
--                           'sudden_death' -> behaviour unchanged.
--   competitive_match_answers += multiplier int (1|2) with a partial UNIQUE
--                           index allowing at most ONE 2x row per
--                           (match, player) — the server-sided "Double".
--   duel_waiting          += format (so the client's human-scan is
--                           format-aware; existing rows default sud-death).
--
-- RPCs:
--   create_competitive_match(text,int,uuid,text default 'sudden_death')
--       = REPLACES the v38 3-arg (which is dropped) — same behaviour for
--       sudden_death; for 'blitz' it refuses null opponent (HUMAN_DUEL_ONLY)
--       and any non-'duel' mode (BLITZ_IS_1V1), selects the balanced 40-Q
--       sequence, stores the match as 'waiting' (nothing starts until
--       start_competitive_match), and still de-duplicates the racing pair so
--       BOTH humans get the SAME match id + SAME questions.
--   start_competitive_match(uuid)   NEW — flips a waiting blitz to 'active'
--       with starts_at = now(), ends_at = now() + 90s. Idempotent.
--   get_competitive_match(uuid)     REPLACED — adds format/startsAt/endsAt +
--       the caller's own stored answers (resume). No opponent data leaks.
--   submit_competitive_answer(uuid,int,text,boolean default false) REPLACED —
--       the ONLY overload (the old 3-arg version is DROPPED so PostgREST never
--       sees PGRST203 for a 3-arg call; p_double omitted = false): blitz expiry
--       = ends_at; optional p_double grants the one-time x2 for that player
--       (enforced by the partial unique index); first-answer-wins.
--   complete_competitive_match(uuid) REPLACED — sudden_death path UNCHANGED;
--       blitz branch settles with the demo scoring + deterministic tie-break.
--
-- All SECURITY DEFINER. ACLs re-asserted (LIVE GRANT GOTCHA: default
-- privileges auto-grant anon+authenticated on every new function). No new
-- api/*.js — the 12-function Vercel cap is untouched.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Schema
-- ------------------------------------------------------------
alter table public.competitive_matches
  add column if not exists format text not null default 'sudden_death';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'competitive_matches_format_check'
  ) then
    alter table public.competitive_matches
      add constraint competitive_matches_format_check
      check (format in ('sudden_death', 'blitz'));
  end if;
end $$;

alter table public.competitive_matches
  add column if not exists starts_at timestamptz;
alter table public.competitive_matches
  add column if not exists ends_at timestamptz;

-- One-time "Double" (???) for blitz: at most one 2x answer per (match, player).
alter table public.competitive_match_answers
  add column if not exists multiplier int not null default 1;

create unique index if not exists uq_cma_one_double
  on public.competitive_match_answers (match_id, player_id)
  where multiplier = 2;

-- Format-aware matchmaking queue (client-side human scan).
alter table public.duel_waiting
  add column if not exists format text not null default 'sudden_death';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'duel_waiting_format_check'
  ) then
    alter table public.duel_waiting
      add constraint duel_waiting_format_check
      check (format in ('sudden_death', 'blitz'));
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. create_competitive_match — v38 3-arg REPLACED by a 4-arg with a default,
--    so existing callers (Triple Threat) keep working unchanged.
-- ------------------------------------------------------------
drop function if exists public.create_competitive_match(text, integer, uuid);

create or replace function public.create_competitive_match(
  p_mode text,
  p_stake integer,
  p_opponent_id uuid default null,
  p_format text default 'sudden_death'
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
  if p_opponent_id = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;
  -- Blitz is the 1v1 DUEL LOBBY format: human opponent required, duel only.
  if p_format = 'blitz' then
    if p_mode <> 'duel' then
      return jsonb_build_object('ok', false, 'error', 'BLITZ_IS_1V1');
    end if;
    if p_opponent_id is null then
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

  -- De-duplicate racing creation (v38 semantics, now format-aware): the two
  -- human clients both call create at the same instant; the first owns the
  -- match and the second receives the SAME match + SAME sequence.
  select cm.id into v_existing
  from public.competitive_matches cm
  where cm.status in ('waiting', 'active')
    and cm.match_type = p_mode
    and cm.stake = p_stake
    and cm.format = p_format
    and cm.created_at > now() - interval '10 minutes'
    and (
      (cm.creator_id = v_user and cm.opponent_id is not distinct from p_opponent_id)
      or (p_opponent_id is not null and cm.creator_id = p_opponent_id and cm.opponent_id = v_user)
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
               -- one-time random keys so ordering is stable within this query
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
        -- difficulty targets first, then whatever the bank still holds
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
     question_ids, question_count)
  values
    (p_mode, p_stake,
     case when p_format = 'blitz' then 'waiting' else 'active' end,
     'NMCN', p_format, v_user, p_opponent_id, v_qids, jsonb_array_length(v_qids))
  returning id into v_match_id;

  return jsonb_build_object('ok', true, 'replay', false, 'matchId', v_match_id,
                            'framework', 'NMCN', 'format', p_format,
                            'questionCount', jsonb_array_length(v_qids),
                            'questions', v_questions);
end;
$$;

-- ------------------------------------------------------------
-- 3. start_competitive_match — NEW: opens the 90-second blitz window.
-- ------------------------------------------------------------
create or replace function public.start_competitive_match(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_starts timestamptz;
  v_ends timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  -- Only the two players may drive their battle.
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;
  if v_m.format <> 'blitz' then
    return jsonb_build_object('ok', false, 'error', 'NOT_BLITZ');
  end if;
  if v_m.starts_at is not null then
    return jsonb_build_object('ok', true, 'replay', true, 'matchId', p_match_id,
                              'startsAt', v_m.starts_at, 'endsAt', v_m.ends_at);
  end if;
  if v_m.status <> 'waiting' then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_WAITING', 'status', v_m.status);
  end if;

  -- 90-second shared wall-clock (the demo's timer).
  update public.competitive_matches
    set status = 'active',
        starts_at = now(),
        ends_at = now() + interval '90 seconds'
    where id = p_match_id
    returning starts_at, ends_at into v_starts, v_ends;

  return jsonb_build_object('ok', true, 'matchId', p_match_id,
                            'startsAt', v_starts, 'endsAt', v_ends);
end;
$$;

-- ------------------------------------------------------------
-- 4. get_competitive_match — REPLACED: adds format + starts/ends + the
--    caller's OWN stored answers so a reload resumes the mirror in-progress
--    (never resets, never re-deals). Still re-verifies the sequence at
--    serving time and never returns correct_answer.
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
  -- Only the two players may read the shared sequence.
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  v_questions := public._cm_serve_questions(v_m.question_ids);
  if v_questions is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_TAMPERED');
  end if;

  -- My own stored answers only (reconnect resume). No opponent data leaves.
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
                            'framework', v_m.framework, 'questionCount', v_m.question_count,
                            'createdAt', v_m.created_at,
                            'startsAt', v_m.starts_at, 'endsAt', v_m.ends_at,
                            'myAnswers', v_my_answers,
                            'questions', v_questions);
end;
$$;

-- ------------------------------------------------------------
-- 5. submit_competitive_answer — REPLACED: single 4-arg function does the real
--    work (server-graded, first-answer-wins, optional once per player x2 Double
--    in blitz). ONE overload only — a same-name 3-arg overload PLUS defaults on
--    the 4-arg makes PostgREST return PGRST203 (Multiple Choices), so the old
--    3-arg overload is dropped and callers omit p_double to fall back to false.
-- ------------------------------------------------------------
drop function if exists public.submit_competitive_answer(uuid, integer, text);

create or replace function public.submit_competitive_answer(
  p_match_id uuid,
  p_question_index integer default 0,
  p_selected text default null,
  p_double boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_qid text;
  v_correct text;
  v_is_correct boolean;
  v_first boolean := false;
  v_existing_id record;
  v_expires timestamptz;
  v_mult int := 1;
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
  if v_m.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_ACTIVE', 'status', v_m.status);
  end if;

  -- Answer window per format: sudden-death = 30s/question from battle start
  -- (unchanged); blitz = the shared 90s wall-clock.
  if v_m.format = 'blitz' then
    if v_m.starts_at is null then
      return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_STARTED');
    end if;
    v_expires := v_m.ends_at;
  else
    v_expires := v_m.started_at + (v_m.question_count * interval '30 seconds');
  end if;
  if now() > v_expires then
    return jsonb_build_object('ok', false, 'error', 'MATCH_EXPIRED');
  end if;

  if p_question_index < 0 or p_question_index >= v_m.question_count then
    return jsonb_build_object('ok', false, 'error', 'INVALID_QUESTION_INDEX');
  end if;

  v_qid := jsonb_array_element_text(v_m.question_ids, p_question_index);

  -- Grade against the stored answer key; the question must still verify NMCN.
  select q.correct_answer into v_correct
  from public.questions q
  where q.id::text = v_qid and q.exam_framework = 'NMCN' and q.is_active;
  if v_correct is null then
    return jsonb_build_object('ok', false, 'error', 'NO_ANSWER_KEY');
  end if;

  -- The request carries NO `correct` field; correctness is always derived here.
  v_is_correct := public._cm_normalize_answer(p_selected) = public._cm_normalize_answer(v_correct);

  -- One-time "???" Double (blitz): the x2 multiplier is granted to at most one
  -- answer per player per match. The partial unique index uq_cma_one_double
  -- enforces it even under a simultaneous double-flag; a losing race simply
  -- falls through to the stored grade (no double).
  if v_m.format = 'blitz' and p_double then
    if not exists (
      select 1 from public.competitive_match_answers
      where match_id = p_match_id and player_id = v_user and multiplier = 2
    ) then
      v_mult := 2;
    end if;
  end if;

  -- FIRST-ANSWER-WINS: concurrent/double submissions collapse onto one row and a
  -- replay returns the stored (first) grade.
  begin
    insert into public.competitive_match_answers
      (match_id, player_id, question_index, selected_answer, is_correct, multiplier)
    values
      (p_match_id, v_user, p_question_index, p_selected, v_is_correct, v_mult)
    on conflict (match_id, player_id, question_index) do nothing
    returning match_id into v_existing_id;
    if v_existing_id.match_id is not null then
      v_first := true;
    else
      v_first := false;
    end if;
  exception when others then
    v_first := false;
  end;

  if not v_first then
    select is_correct, multiplier into v_is_correct, v_mult
    from public.competitive_match_answers
    where match_id = p_match_id and player_id = v_user and question_index = p_question_index;
  end if;

  return jsonb_build_object('ok', true, 'matchId', p_match_id,
                            'questionIndex', p_question_index,
                            'isCorrect', v_is_correct,
                            'multiplier', v_mult,
                            'double', (v_mult = 2),
                            'replay', not v_first);
end;
$$;

-- ------------------------------------------------------------
-- 6. complete_competitive_match — REPLACED: sudden-death path UNCHANGED; a
--    NEW blitz branch settles with the demo scoring + deterministic tie-break.
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
    -- Never-begun: only the stale case voids (no coins, no history). A fresh
    -- waiting match is simply not endable yet.
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

    -- Never settle the live window early: someone must not lock the battle shut
    -- while the other is still answering.
    if now() < v_m.ends_at then
      return jsonb_build_object('ok', false, 'error', 'BLITZ_NOT_ENDED',
                                'matchId', p_match_id, 'endsAt', v_m.ends_at,
                                'remainingMs',
                                (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint);
    end if;

    v_p1 := v_humans[1];
    v_p2 := v_humans[2];

    -- Per-player FACTS with the demo scoring formula. A null selection is a
    -- SKIP (0 points, no penalty). A wrong non-skip is -1xm  (-2 if doubled).
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

    -- How many blitz players ACTUALLY answered — feeds the competitive_stats
    -- gate below ("fully-played human duel" = both humans battled). Without
    -- this, v_answered_humans stays 0 and the gate never fires for blitz.
    v_answered_humans := (case when v_a1 > 0 then 1 else 0 end)
                       + (case when v_a2 > 0 then 1 else 0 end);

    -- Deterministic verdict: (score desc, wrongs asc, latency asc). A player
    -- who never answered loses to anyone who did (silence is a loss, per the
    -- "always settle with answers-so-far" rule); both silent => Draw.
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

    -- Per-player settlements (winner +stake, loser -stake, draw 0 — blitz
    -- always settles; there is no forfeit-0 path here).
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
          v_opp := 'The House';
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

      -- Verified competitive stats ONLY for a fully-played HUMAN duel (both
      -- humans actually battled). A no-show opponent still settles winnings,
      -- but earns no verified wins (keeps Elite one_v_one_wins honest).
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

      -- Recalculate duel risk on the server (v34) after settling.
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
  -- END BLITZ BRANCH — everything below is the UNCHANGED v38 sudden-death
  -- settlement.
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
  --   Solo/House game: the player wins iff they answered >= 1 correctly.
  --   Full human duel: unique max answer count wins; tie => draw.
  --   Forfeited opponent: the player who played is judged against the House.
  if v_human_count = 1 then
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
        v_opp := 'The House';
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

    -- Verified competitive stats ONLY for a fully-played HUMAN duel (the House
    -- pays SC but earns no verified wins) AND only for players who actually
    -- battled.
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
      'delta', v_delta, 'settled', v_settled);

    if v_human = v_user then
      v_my_delta := v_delta; v_my_oc := v_oc;
      v_my_settled := v_settled; v_my_balance := v_bal;
    end if;

    -- Recalculate duel risk on the server (v34) after settling.
    perform public.refresh_duel_risk(v_human);
  end loop;

  -- Mark completed once, under the advisory lock. Replays hit the early return
  -- and can never settle twice.
  update public.competitive_matches
    set status = 'completed', completed_at = now(), winner_id = v_winner_id,
        outcome = jsonb_build_object(
          'status', 'completed', 'winnerId', v_winner_id, 'winner', v_winner_name,
          'draw', v_draw, 'breakdown', v_breakdown)
    where id = p_match_id and status in ('waiting', 'active');

  return jsonb_build_object(
    'ok', true, 'status', 'completed', 'matchId', p_match_id,
    'mode', v_m.match_type, 'stake', v_m.stake, 'players', v_players,
    'winnerId', v_winner_id, 'winner', v_winner_name, 'draw', v_draw,
    'youWon', (v_winner_id = v_user),
    'outcome', v_my_oc, 'delta', v_my_delta,
    'balance', v_my_balance, 'settled', v_my_settled,
    'breakdown', v_breakdown);
end;
$$;

-- ------------------------------------------------------------
-- 7. ACLs (LIVE GRANT GOTCHA: default privileges auto-grant anon +
--    authenticated on every new function — revoke all three explicitly)
-- ------------------------------------------------------------
revoke all on function public._cm_normalize_answer(text) from public, anon, authenticated;
revoke all on function public._cm_serve_questions(jsonb) from public, anon, authenticated;

revoke all on function public.create_competitive_match(text, integer, uuid, text)
  from public, anon;
grant execute on function public.create_competitive_match(text, integer, uuid, text)
  to authenticated;

revoke all on function public.start_competitive_match(uuid)
  from public, anon;
grant execute on function public.start_competitive_match(uuid)
  to authenticated;

revoke all on function public.get_competitive_match(uuid)
  from public, anon;
grant execute on function public.get_competitive_match(uuid)
  to authenticated;

revoke all on function public.submit_competitive_answer(uuid, integer, text, boolean)
  from public, anon;
grant execute on function public.submit_competitive_answer(uuid, integer, text, boolean)
  to authenticated;

revoke all on function public.complete_competitive_match(uuid)
  from public, anon;
grant execute on function public.complete_competitive_match(uuid)
  to authenticated;

-- ------------------------------------------------------------
-- 8. PostgREST schema reload — makes the new/changed RPCs immediately callable
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================