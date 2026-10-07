-- ============================================================
-- Apex Scholars Migration v38 — COMPETITIVE MATCHES (NMCN-ONLY, SERVER-AUTHORITATIVE)
-- POLYNURSE fix: 1v1 Duel / Triple Threat must use NMCN questions ONLY, with a
-- SHARED sequence for every player, SERVER-selected questions, SERVER-graded
-- answers, and a SERVER-computed winner. The client can no longer pick a battle
-- question from flashcards (that leaked NCLEX/midwifery content into the arena)
-- and can no longer hand finalize_duel a self-declared `won` to settle SC.
--
-- Model:
--   competitive_matches        — one row per battle; the question sequence
--                                (ids) is chosen by create_competitive_match from
--                                questions WHERE exam_framework='NMCN'. There is
--                                NO framework/question parameter the client can
--                                pass; it is pinned to 'NMCN' by a CHECK
--                                constraint AND by the selection query.
--   competitive_match_answers  — one gradeable answer per (match, player, index);
--                                first-answer-wins. The client never sends a
--                                `correct` flag — submit_competitive_answer grades.
--
-- RPCs (all SECURITY DEFINER, granted authenticated only, anon/public revoked):
--   create_competitive_match(p_mode, p_stake, p_opponent_id|null)
--       Validates activation/stake/mode/balance, SELECTS the NMCN sequence
--       server-side, de-duplicates racing pair creation so BOTH human clients
--       get the SAME match + SAME questions, never returns correct_answer.
--   get_competitive_match(p_match_id)
--       Re-verifies at serving time that every stored id is still NMCN + schema
--       valid (fail-closed; a missing/ambiguous id -> MATCH_TAMPERED).
--   submit_competitive_answer(p_match_id, p_question_index, p_selected|null)
--       Server-graded; coins are NOT moved here.
--   complete_competitive_match(p_match_id)
--       Resolves the winner deterministically from STORED answers, settles SC
--       via _sc_apply with a per-player unique client_request_id (md5(match:player)),
--       writes duels history + competitive_stats (HUMAN duels only — the House
--       earns no verified wins), refreshes duel risk, is replay-safe. Draw/forfeit
--       -> no coin movement. A player who never answered pays/earns nothing
--       (blocks grief-theft where an attacker targets an idle user).
--
-- Settlement semantics (matches legacy finalize_duel economy):
--   win  => +stake * (players-1)     (players = 2 duel, 3 triple)
--   loss => -stake
--   draw => 0 (no movement)
--   forfeit (human never answered) => 0, no stats
--   A broke loser pays nothing (via _sc_apply's net-negative refusal); the
--   winner still takes the pot (the House covers the gap) — same as finalize_duel.
--
-- The tables are RLS-ENABLED with NO policies (default-deny): clients interact
-- with matches ONLY through the definer RPCs; service_role/owner bypass.
-- Idempotent. Safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tables
-- ------------------------------------------------------------
create table if not exists public.competitive_matches (
  id uuid primary key default gen_random_uuid(),
  match_type text not null check (match_type in ('duel', 'triple')),
  stake int not null check (stake in (1, 2, 5, 10, 20)),
  status text not null default 'waiting'
    check (status in ('waiting', 'active', 'completed', 'abandoned')),
  -- Pinned to NMCN at the schema level: nothing besides the server constant can
  -- ever be stored, no matter what a client sends.
  framework text not null default 'NMCN' check (framework = 'NMCN'),
  creator_id uuid not null references auth.users(id) on delete cascade,
  opponent_id uuid references auth.users(id) on delete set null,
  question_ids jsonb not null,
  question_count int not null default 1,
  winner_id uuid,
  outcome jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.competitive_match_answers (
  match_id uuid not null references public.competitive_matches(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  question_index int not null check (question_index >= 0),
  selected_answer text,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (match_id, player_id, question_index)
);

create index if not exists idx_cm_status_created on public.competitive_matches(status, created_at);
create index if not exists idx_cm_creator_status on public.competitive_matches(creator_id, status);
create index if not exists idx_cm_opponent_status on public.competitive_matches(opponent_id, status);
create index if not exists idx_cma_match on public.competitive_match_answers(match_id);

alter table public.competitive_matches enable row level security;
alter table public.competitive_match_answers enable row level security;

-- No policies: RLS is enabled with an empty policy set => deny-all for clients.
-- Only the SECURITY DEFINER RPCs (owner-context) can read/write these rows.

-- ------------------------------------------------------------
-- 2. Internal helpers (NOT client-callable)
-- ------------------------------------------------------------
-- Normalise an answer for comparison: strip an "A." / "B)" style letter prefix,
-- lower-case, trim. Used ONLY server-side for grading.
create or replace function public._cm_normalize_answer(p_text text)
returns text
language sql
immutable
as $$
  select lower(trim(regexp_replace(coalesce(p_text, ''), '^\s*[a-zA-Z]\s*[.):]\s*', '')))
$$;

-- Rebuild the client-facing question payload from STORED ids, RE-VERIFYING each
-- row is still NMCN + schema-valid AT SERVING TIME. Returns NULL (fail-closed)
-- if any stored id is missing, inactive, non-NMCN, or malformed — the match is
-- never served partially. The payload EXCLUDES correct_answer/hint/explanation.
create or replace function public._cm_serve_questions(p_ids jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_ids text[];
  v_row record;
  v_i int := 0;
begin
  v_ids := (select array_agg(v) from jsonb_array_elements_text(p_ids) v);
  if v_ids is null or array_length(v_ids, 1) = 0 then
    return null;
  end if;

  for v_row in
    select q.id::text as id, q.difficulty, q.question_type, q.question_text, q.options
    from public.questions q
    where q.id::text = any(v_ids)
      and q.exam_framework = 'NMCN'
      and q.is_active
      and q.question_text is not null
      and q.correct_answer is not null
      and q.options is not null
      and jsonb_typeof(q.options) = 'array'
      and jsonb_array_length(q.options) >= 2
    order by array_position(v_ids, q.id::text)
  loop
    v_out := v_out || jsonb_build_object(
      'index', v_i,
      'id', v_row.id,
      'difficulty', v_row.difficulty,
      'questionType', v_row.question_type,
      'question', v_row.question_text,
      'options', v_row.options
    );
    v_i := v_i + 1;
  end loop;

  if v_i <> array_length(v_ids, 1) then
    return null;
  end if;
  return v_out;
end;
$$;

-- ------------------------------------------------------------
-- 3. create_competitive_match — server picks the NMCN sequence
-- ------------------------------------------------------------
create or replace function public.create_competitive_match(
  p_mode text,
  p_stake integer,
  p_opponent_id uuid default null
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
  if p_opponent_id = v_user then
    return jsonb_build_object('ok', false, 'error', 'INVALID_OPPONENT');
  end if;

  -- The wager is only MOVED at settlement, but the party must be solvent to
  -- enter the hall.
  if coalesce(v_prof.smart_coins, 0) < p_stake then
    return jsonb_build_object('ok', false, 'error', 'INSUFFICIENT_SC',
                              'balance', coalesce(v_prof.smart_coins, 0));
  end if;

  -- De-duplicate racing creation: the two human clients both detect each other
  -- and both call create at the same instant. The first call owns the match;
  -- the second receives the SAME match and SAME NMCN sequence. House games
  -- (opponent null) de-dupe only inside a tight window so a fresh House battle
  -- is never blocked by a stale one.
  select cm.id into v_existing
  from public.competitive_matches cm
  where cm.status in ('waiting', 'active')
    and cm.match_type = p_mode
    and cm.stake = p_stake
    and cm.created_at > now()
      - case when p_opponent_id is null then interval '60 seconds' else interval '10 minutes' end
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
                              'framework', 'NMCN', 'questionCount', jsonb_array_length(v_questions),
                              'questions', v_questions);
  end if;

  -- SERVER-SIDE sequence pick: NMCN bank only. There is no parameter for a
  -- framework, a course, a client queued id, or an order — the client cannot
  -- influence which questions (or how many) are served.
  select coalesce(jsonb_agg(x.id::text), '[]'::jsonb) into v_qids
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
  ) x;

  if v_qids is null or jsonb_array_length(v_qids) < 1 then
    return jsonb_build_object('ok', false, 'error', 'NO_NMCN_CANDIDATES');
  end if;

  v_questions := public._cm_serve_questions(v_qids);
  if v_questions is null then
    return jsonb_build_object('ok', false, 'error', 'NO_VALID_QUESTIONS');
  end if;

  insert into public.competitive_matches
    (match_type, stake, status, framework, creator_id, opponent_id,
     question_ids, question_count)
  values
    (p_mode, p_stake, 'active', 'NMCN', v_user, p_opponent_id, v_qids, v_count)
  returning id into v_match_id;

  return jsonb_build_object('ok', true, 'replay', false, 'matchId', v_match_id,
                            'framework', 'NMCN', 'questionCount', v_count,
                            'questions', v_questions);
end;
$$;

-- ------------------------------------------------------------
-- 4. get_competitive_match — participants only, re-verified at serving time
-- ------------------------------------------------------------
create or replace function public.get_competitive_match(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_questions jsonb;
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

  return jsonb_build_object('ok', true, 'matchId', v_m.id, 'status', v_m.status,
                            'mode', v_m.match_type, 'stake', v_m.stake,
                            'framework', v_m.framework, 'questionCount', v_m.question_count,
                            'questions', v_questions);
end;
$$;

-- ------------------------------------------------------------
-- 5. submit_competitive_answer — SERVER-graded, first-answer-wins
-- ------------------------------------------------------------
create or replace function public.submit_competitive_answer(
  p_match_id uuid,
  p_question_index integer default 0,
  p_selected text default null
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

  -- Answer window: 30s per question, from battle start (sudden-death = 1 q).
  v_expires := v_m.started_at + (v_m.question_count * interval '30 seconds');
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

  -- FIRST-ANSWER-WINS: concurrent/double submissions collapse onto one row and a
  -- replay returns the stored (first) grade.
  begin
    insert into public.competitive_match_answers
      (match_id, player_id, question_index, selected_answer, is_correct)
    values
      (p_match_id, v_user, p_question_index, p_selected, v_is_correct)
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
    select is_correct into v_is_correct
    from public.competitive_match_answers
    where match_id = p_match_id and player_id = v_user and question_index = p_question_index;
  end if;

  return jsonb_build_object('ok', true, 'matchId', p_match_id,
                            'questionIndex', p_question_index,
                            'isCorrect', v_is_correct,
                            'replay', not v_first);
end;
$$;

-- ------------------------------------------------------------
-- 6. complete_competitive_match — deterministic winner + server settlement
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
  --   Solo/House game: the player wins iff they answered >= 1 correctly (a
  --   wrong/timeout answer => the House takes it, a real LOSS, never a draw).
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
-- 7. ACLs (LIVE GRANT GOTCHA: default privileges auto-grant anon + authenticated
--    on every new function — revoke all three explicitly)
-- ------------------------------------------------------------
revoke all on function public._cm_normalize_answer(text) from public, anon, authenticated;
revoke all on function public._cm_serve_questions(jsonb) from public, anon, authenticated;

revoke all on function public.create_competitive_match(text, integer, uuid)
  from public, anon;
grant execute on function public.create_competitive_match(text, integer, uuid)
  to authenticated;

revoke all on function public.get_competitive_match(uuid)
  from public, anon;
grant execute on function public.get_competitive_match(uuid)
  to authenticated;

revoke all on function public.submit_competitive_answer(uuid, integer, text)
  from public, anon;
grant execute on function public.submit_competitive_answer(uuid, integer, text)
  to authenticated;

revoke all on function public.complete_competitive_match(uuid)
  from public, anon;
grant execute on function public.complete_competitive_match(uuid)
  to authenticated;

-- ------------------------------------------------------------
-- 8. PostgREST schema reload — makes the new RPCs (and the freshly-created
--    evaluate_achievements) immediately callable without an old schema cache.
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

-- ============================================================
-- DONE.
-- ============================================================