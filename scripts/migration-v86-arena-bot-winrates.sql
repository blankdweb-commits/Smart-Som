-- =============================================================
-- v86 — TUTOR BOT WIN RATES (40 / 60 / 90) + CLOSE A COIN-BURN HOLE
-- =============================================================
-- TWO THINGS.
--
-- 1. A LIVE ESCROW HOLE, FOUND WHILE DOING THE WIN-RATE WORK.
--    v64 forces `v_stake := 0` only when p_practice is true. So a client could
--    call arena_create_match('duel', 2, NULL, 'apollo', false):
--      - stake 2 IS in _arena_rules()->stakes, so validation passes
--      - v_opp is NULL for a bot, so the OPPONENT escrow block (v64:726) is
--        skipped while _arena_hold(v_user, 2) at v64:721 still DEBITS the user
--      - settlement then releases the pot to a bot uuid that is not a profile
--    i.e. ~2 SC destroyed, reachable straight from the browser. Tutor matches
--    are meant to be free, so this closes it structurally rather than by hoping
--    the client behaves: ANY match with a bot now forces stake 0, whatever the
--    caller sends.
--
-- 2. BOT WIN RATES. _arena_bot_skill returns 0.55 / 0.62 / 0.78 and is used as
--    PER-QUESTION ANSWER ACCURACY at _arena_bot_turn:
--        elsif random()::numeric < v_skill then  -- answer correctly
--    That is not a win rate. Over a 40-question board a bot at 0.78 scores ~31
--    against a human's ~31, which is a coin flip — the outcome is emergent and
--    swings entirely with how well the human plays. Retuning those numbers
--    cannot produce 40/60/90.
--
--    So the outcome is decided ONCE per match and the bot's answers are made to
--    play it out:
--      * win_rate:  house 0.40 · zainab 0.60 · apollo 0.90
--      * accuracy:  0.93 when it must win, 0.42 when it must lose
--    The result is that the observed win rate is the stated one REGARDLESS of
--    the human, and — the important part — the scorecards always agree with the
--    winner. Nothing is shown as "bot got 38/40 but lost".
--
--    These bots only ever play at stake 0 (point 1 guarantees it), move no
--    coins, write no history row and count for no verified stats. They are a
--    difficulty ladder, not a way to win or lose money.
--
--    The roll steers WHICH ANSWERS the bot picks. It never overrides a
--    settlement: the winner still comes from _arena_score over real graded
--    points, so forfeit, grace, no-show and both-away are all untouched.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v86-arena-bot-winrates.sql
-- =============================================================

-- ------------------------------------------------------------
-- 1. CONFIG
-- ------------------------------------------------------------
insert into public.server_config (key, value, description)
values
  ('arena_bot_rules',
   '{"win_rates":{"house":0.40,"zainab":0.60,"apollo":0.90},
     "accuracy":{"win":0.93,"lose":0.42}}'::jsonb,
   'Tutor bot difficulty: per-match win probability and the answer accuracy the bot plays at when it must win or must lose. Bots are always free (stake 0).')
on conflict (key) do update
  set value = excluded.value,
      description = excluded.description,
      updated_at = now();

create or replace function public._arena_bot_rules()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select value from public.server_config where key = 'arena_bot_rules'),
    '{"win_rates":{"house":0.40,"zainab":0.60,"apollo":0.90},
      "accuracy":{"win":0.93,"lose":0.42}}'::jsonb);
$$;
revoke all on function public._arena_bot_rules() from public, anon, authenticated;

-- Probability that this bot wins a given match.
create or replace function public._arena_bot_win_rate(p_bot text)
returns numeric
language sql stable
as $$
  select coalesce(
    ((public._arena_bot_rules() -> 'win_rates') ->> p_bot)::numeric,
    0.5);
$$;
revoke all on function public._arena_bot_rules() from public, anon, authenticated;
revoke all on function public._arena_bot_win_rate(text) from public, anon, authenticated;

-- The match outcome is fixed here, once, before any question is answered.
alter table public.competitive_matches
  add column if not exists bot_will_win boolean;

-- ------------------------------------------------------------
-- 2. PRESERVE arena_create_match, then wrap it.
--    Same approach as the v84 sweep: rename the live 5-arg body to a core and
--    put a thin guard in front of it. Re-typing a ~210 line escrow function by
--    hand is exactly the kind of transcription risk that silently drops a
--    refund or a rollback.
--    Guarded on the core not already existing, so re-running is safe.
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'arena_create_match'
  ) and not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = '_arena_create_match_core'
  ) then
    execute 'alter function public.arena_create_match(text, integer, uuid, text, boolean) rename to _arena_create_match_core';
    raise notice 'renamed arena_create_match -> _arena_create_match_core (body preserved verbatim)';
  end if;
end $$;

create or replace function public.arena_create_match(
  p_mode         text     default 'duel',
  p_stake        integer  default 0,
  p_opponent_id  uuid     default null,
  p_bot          text     default null,
  p_practice     boolean  default false
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_core jsonb;
  v_bot text := p_bot;
  v_stake integer := coalesce(p_stake, 0);
  v_practice boolean := coalesce(p_practice, false);
begin
  -- THE COIN-BURN FIX. A tutor bot is never a real opponent, so a bot match is
  -- ALWAYS practice: stake forced to 0, no escrow, no history row, no verified
  -- stats — regardless of what the client asked for. p_practice=true in the
  -- core already rejects a bot-less call (PRACTICE_NEEDS_BOT) and a bot-plus-
  -- opponent call (PRACTICE_IS_SOLO), which are both nonsense anyway.
  if v_bot is not null then
    v_practice := true;
    v_stake := 0;
  end if;

  v_core := public._arena_create_match_core(p_mode, v_stake, p_opponent_id, v_bot, v_practice);

  -- Record the pre-decided outcome once, at creation, so _arena_bot_turn can
  -- play it out for the whole match and the decision is auditable.
  if coalesce((v_core ->> 'ok')::boolean, false)
     and (v_core ->> 'matchId') is not null
     and v_bot is not null then
    update public.competitive_matches
       set bot_will_win = (random()::numeric < public._arena_bot_win_rate(v_bot))
     where id = (v_core ->> 'matchId')::uuid
       and bot_will_win is null;
  end if;

  return v_core;
end;
$$;

-- The core stays internal; only the wrapper is client-facing.
revoke all on function public._arena_create_match_core(text, integer, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.arena_create_match(text, integer, uuid, text, boolean) from public, anon;
grant execute on function public.arena_create_match(text, integer, uuid, text, boolean) to authenticated, service_role;

-- ------------------------------------------------------------
-- 3. PLAY THE DECIDED OUTCOME.
--    Identical to the v63 body except for the accuracy lookup: two calibrated
--    numbers instead of one, selected by the match's pre-decided outcome.
-- ------------------------------------------------------------
create or replace function public._arena_bot_turn(p_match_id uuid, p_index int)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_m public.competitive_matches%rowtype;
  v_bot uuid;
  v_qid text;
  v_opts jsonb;
  v_correct text;
  v_wrong jsonb;
  v_is_correct boolean := false;
  v_skip boolean := false;
  v_mult int := 1;
  v_pick text;
  v_points int := 0;
  v_skill numeric;
begin
  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null or v_m.opponent_bot is null then
    return null;
  end if;
  if p_index < 0 or p_index >= v_m.question_count then
    return null;
  end if;

  v_bot := public._arena_bot_id(v_m.opponent_bot);

  if exists (
    select 1 from public.competitive_match_answers
    where match_id = p_match_id and player_id = v_bot and question_index = p_index
  ) then
    return jsonb_build_object('ok', true, 'replay', true);
  end if;

  v_qid := jsonb_array_element_text(v_m.question_ids, p_index);
  select q.options, q.correct_answer into v_opts, v_correct
  from public.questions q
  where q.id::text = v_qid and q.exam_framework = 'NMCN' and q.is_active;
  if v_opts is null or v_correct is null then
    return null;
  end if;

  -- THE ONLY CHANGE. The bot plays at 0.93 when this match was decided a win
  -- for it and 0.42 when it was decided a loss, instead of one flat skill.
  -- A null bot_will_win (a match created before v86) falls back to the old
  -- flat skill so historical rows are not rewritten retroactively.
  if v_m.bot_will_win is null then
    v_skill := public._arena_bot_skill(v_m.opponent_bot);
  else
    v_skill := coalesce(
      ((public._arena_bot_rules() -> 'accuracy')
        ->> (case when v_m.bot_will_win then 'win' else 'lose' end))::numeric,
      case when v_m.bot_will_win then 0.93 else 0.42 end);
  end if;

  -- The bot spends its ONE Double on the same deterministic mid-board question
  -- every match, so the power-up is visible and testable rather than random.
  if p_index = (v_m.question_count / 2)
     and not exists (
       select 1 from public.competitive_match_answers
       where match_id = p_match_id and player_id = v_bot and multiplier = 2
     ) then
    v_mult := 2;
  end if;

  -- Same skip semantics as a human skip: 0 points, counted as skipped.
  if random()::numeric < 0.03 then
    v_skip := true;
    v_pick := null;
    v_is_correct := false;
    v_points := 0;
  elsif random()::numeric < v_skill then
    v_is_correct := true;
    v_pick := v_correct;
    v_points := v_mult;
  else
    v_is_correct := false;
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_wrong
    from jsonb_array_elements_text(v_opts) e
    where public._cm_normalize_answer(e) <> public._cm_normalize_answer(v_correct);
    if v_wrong is null or jsonb_array_length(v_wrong) = 0 then
      v_is_correct := true;
      v_pick := v_correct;
      v_points := v_mult;
    else
      v_pick := v_wrong[(floor(random() * jsonb_array_length(v_wrong)) + 1)::int];
      v_points := 0;
    end if;
  end if;

  insert into public.competitive_match_answers
    (match_id, player_id, question_index, selected_answer, is_correct,
     multiplier, points, skipped, is_bot)
  values
    (p_match_id, v_bot, p_index, v_pick, v_is_correct,
     v_mult, v_points, v_skip, true)
    on conflict (match_id, player_id, question_index) do nothing;

  return jsonb_build_object('ok', true, 'points', v_points,
                            'correct', v_is_correct, 'skipped', v_skip);
end;
$$;
revoke all on function public._arena_bot_turn(uuid, integer) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- =============================================================
-- DONE. Re-run safe.
-- =============================================================