-- ===========================================================================
-- scripts/migration-v101-blitz-duel.sql
--
-- Blitz Duel with Flow State — the server-authoritative 1v1 duel:
--
--   * a dedicated question bank (blitz_duel_questions) loaded ONLY from
--     src/data/flashcards/1v1-questions/ by scripts/seed-blitz-duel-questions.mjs
--   * a match row (blitz_duels) that owns the 90s server clock, the shuffled
--     32-question sequence, every answer, the flow events and the bot plan
--   * a DB-backed, atomic rate limiter (blitz_duel_rate_limits)
--   * RPCs that grade, advance and settle — the client never sends a score,
--     never reads correct_answer/explanation, and never chooses an outcome
--
-- WHY NEW TABLES INSTEAD OF arena_*
--   The 1v1 Arena (v63/v64) escrows the human stake through `arena_*` RPCs and
--   seals its rows with guard triggers. Reusing that escrow would mean editing
--   a system that /rumble depends on. Blitz gets its own tables and settles
--   through the SAME single balance mutator (_sc_apply), so the ledger has one
--   authority and the Arena is untouched.
--
-- WHY THE RPCs ARE service_role ONLY
--   Every blitz mutation has to cross the API (api/_blitz-duel.js) so the HTTP
--   status is meaningful (402 insufficient funds, 409 stale question, 429 rate
--   limit, 404 unknown match). A client-callable RPC collapses all of that into
--   one 200-shaped error object and puts a grading function in a browser's
--   hands. `p_user_id` is therefore an explicit parameter (service_role has no
--   auth.uid()); the API passes the uid it verified from the bearer token.
--
-- MONEY (server_config 'blitz_duel', overridable)
--   stake 2 SC at create  -> _sc_apply(-2, reason 'duel_stake', deterministic
--                            key md5('blitz:'||match||':stake'))
--   win   +4 gross (net +2)   key md5('blitz:'||match||':win')
--   draw  +2 refund           key md5('blitz:'||match||':refund')
--   loss  nothing further (the stake is already gone)
--   Keys are deterministic, so a double settle is a replay, never a payout.
--
-- Apply:  node scripts/_apply-v43.mjs scripts/migration-v101-blitz-duel.sql
-- Re-run safe: every statement is guarded.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Config
-- ---------------------------------------------------------------------------
-- `do nothing` on conflict DELIBERATELY: an operator may tune these values in
-- the live DB, and re-applying this file must not clobber the tuning.
insert into public.server_config (key, value, description)
values (
  'blitz_duel',
  '{
     "stake_sc": 2,
     "win_payout_sc": 4,
     "draw_refund_sc": 2,
     "match_seconds": 90,
     "default_pace": 6,
     "min_pace": 3,
     "max_pace": 12,
     "question_count": 32,
     "bot_accuracy": 0.70,
     "bot_min_interval_ms": 3500,
     "bot_max_interval_ms": 7500,
     "bot_flow_min_ms": 8000,
     "bot_flow_max_ms": 16000,
     "rate_create_per_min": 5,
     "rate_answer_per_min": 30,
     "rate_skip_per_min": 30,
     "rate_flow_per_min": 10
   }'::jsonb,
  'Blitz Duel rules: stake/payout, clock, pace bounds, bot behaviour, rate limits'
)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- 2. Question bank
-- ---------------------------------------------------------------------------
create table if not exists public.blitz_duel_questions (
  id text primary key,
  question_text text not null,
  options jsonb not null,
  correct_answer text not null check (correct_answer in ('A','B','C','D')),
  explanation jsonb,
  subject text,
  topic text,
  difficulty text,
  cognitive_level text,
  category text,
  source text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blitz_duel_questions_options_object
    check (jsonb_typeof(options) = 'object'),
  constraint blitz_duel_questions_options_complete
    check (
      options ? 'A' and options ? 'B' and options ? 'C' and options ? 'D'
      and length(coalesce(options->>'A','')) > 0
      and length(coalesce(options->>'B','')) > 0
      and length(coalesce(options->>'C','')) > 0
      and length(coalesce(options->>'D','')) > 0
    ),
  constraint blitz_duel_questions_text_present
    check (length(trim(question_text)) >= 8)
);

comment on table public.blitz_duel_questions is
  'Blitz Duel question bank. Seeded only by scripts/seed-blitz-duel-questions.mjs from the 1v1-questions JSON banks. correct_answer and explanation are NEVER returned to a client.';

create index if not exists idx_blitz_duel_questions_subject
  on public.blitz_duel_questions (subject, difficulty);
create index if not exists idx_blitz_duel_questions_topic
  on public.blitz_duel_questions (topic);

alter table public.blitz_duel_questions enable row level security;
revoke all on public.blitz_duel_questions from public, anon, authenticated;
-- service_role keeps the default grant; no client policy exists, and the
-- service role bypasses RLS, so the bank is reachable only through the API.


-- ---------------------------------------------------------------------------
-- 3. Match rows
-- ---------------------------------------------------------------------------
create table if not exists public.blitz_duels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active','completed')),
  pace_seconds integer not null default 6
    check (pace_seconds between 3 and 12),
  stake_sc integer not null default 2 check (stake_sc > 0),
  payout_sc integer not null default 4 check (payout_sc > 0),
  question_ids text[] not null,
  question_count integer not null default 32 check (question_count > 0),
  current_index integer not null default 0 check (current_index >= 0),
  answers jsonb not null default '[]'::jsonb,
  score integer not null default 0 check (score >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  wrong_count integer not null default 0 check (wrong_count >= 0),
  skip_count integer not null default 0 check (skip_count >= 0),
  flow_events jsonb not null default '[]'::jsonb,
  flow_active boolean not null default false,
  bot_plan jsonb not null default '{}'::jsonb,
  bot_score integer,
  bot_answered integer,
  settlement jsonb,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blitz_duels_window check (ends_at > starts_at),
  constraint blitz_duels_index_bounds check (current_index <= question_count)
);

comment on table public.blitz_duels is
  'One Blitz Duel. Owns the 90s server clock, the shuffled question sequence, every answer, the flow timeline and the Scholar bot plan. Settles through _sc_apply only.';

-- ONE live match per player. A racing second create collides here and the
-- RPC returns the existing match instead of charging twice.
create unique index if not exists uq_blitz_duels_active_user
  on public.blitz_duels (user_id)
  where status = 'active';

create index if not exists idx_blitz_duels_user_created
  on public.blitz_duels (user_id, created_at desc);

alter table public.blitz_duels enable row level security;
revoke all on public.blitz_duels from public, anon, authenticated;


create or replace function public._blitz_touch()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public._blitz_touch() from public, anon, authenticated;

drop trigger if exists trg_blitz_duels_touch on public.blitz_duels;
create trigger trg_blitz_duels_touch
  before update on public.blitz_duels
  for each row execute function public._blitz_touch();


-- ---------------------------------------------------------------------------
-- 4. Rate limiting (atomic, DB-backed, service-role only)
-- ---------------------------------------------------------------------------
create table if not exists public.blitz_duel_rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, action, window_start)
);

comment on table public.blitz_duel_rate_limits is
  'Fixed-window counters for Blitz Duel abuse control. Counting happens in ONE atomic upsert inside _blitz_rate_check, so two parallel requests can never both land under the limit. Bot-driven actions never go through this table.';

create index if not exists idx_blitz_duel_rate_limits_window
  on public.blitz_duel_rate_limits (window_start);

alter table public.blitz_duel_rate_limits enable row level security;
revoke all on public.blitz_duel_rate_limits from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 5. Internal helpers
-- ---------------------------------------------------------------------------

-- Rules. The JSON in server_config overlays the defaults key-by-key, so an
-- operator can change ONE number without this file being edited.
create or replace function public._blitz_config()
returns jsonb
language sql stable
security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
           'stake_sc', 2,
           'win_payout_sc', 4,
           'draw_refund_sc', 2,
           'match_seconds', 90,
           'default_pace', 6,
           'min_pace', 3,
           'max_pace', 12,
           'question_count', 32,
           'bot_accuracy', 0.70,
           'bot_min_interval_ms', 3500,
           'bot_max_interval_ms', 7500,
           'bot_flow_min_ms', 8000,
           'bot_flow_max_ms', 16000,
           'rate_create_per_min', 5,
           'rate_answer_per_min', 30,
           'rate_skip_per_min', 30,
           'rate_flow_per_min', 10
         )
         || coalesce(
              (select value from public.server_config where key = 'blitz_duel'),
              '{}'::jsonb
            );
$$;


-- Count + enforce in ONE statement: the upsert returns the post-increment
-- count, so two concurrent requests get two different integers and at most
-- one can be <= the limit.
create or replace function public._blitz_rate_check(
  p_user_id uuid,
  p_action text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count integer;
  v_retry_ms bigint;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  -- A non-positive limit disables the limiter rather than blocking everyone.
  if p_limit is null or p_limit <= 0 then
    return jsonb_build_object('ok', true, 'count', 0, 'limit', 0);
  end if;

  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.blitz_duel_rate_limits as rl
    (user_id, action, window_start, count, updated_at)
  values (p_user_id, p_action, v_window, 1, now())
  on conflict (user_id, action, window_start)
  do update set count = rl.count + 1, updated_at = now()
  returning rl.count into v_count;

  -- Opportunistic pruning so the table cannot grow without bound.
  delete from public.blitz_duel_rate_limits
  where user_id = p_user_id
    and window_start < now() - interval '1 hour';

  if v_count > p_limit then
    v_retry_ms := greatest(
      0,
      ceil(
        extract(epoch from (v_window + make_interval(secs => p_window_seconds)) - now())
        * 1000
      )
    )::bigint;
    return jsonb_build_object(
      'ok', false, 'error', 'RATE_LIMITED', 'action', p_action,
      'limit', p_limit, 'window_seconds', p_window_seconds,
      'retry_after_ms', v_retry_ms
    );
  end if;

  return jsonb_build_object('ok', true, 'count', v_count, 'limit', p_limit);
end;
$$;


-- The bot's plan is generated ONCE at create and is fully deterministic given
-- the server clock, so a reconnect recomputes the same opponent state.
create or replace function public._blitz_bot_state(p_plan jsonb, p_elapsed_ms bigint)
returns jsonb
language sql immutable
security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'answered',
      coalesce((
        select count(*)
        from jsonb_array_elements(coalesce(p_plan->'answers', '[]'::jsonb)) e
        where coalesce((e->>'at')::bigint, -1) <= p_elapsed_ms
      ), 0),
    'correct',
      coalesce((
        select count(*)
        from jsonb_array_elements(coalesce(p_plan->'answers', '[]'::jsonb)) e
        where coalesce((e->>'at')::bigint, -1) <= p_elapsed_ms
          and coalesce((e->>'correct')::boolean, false)
      ), 0),
    'flow_active',
      coalesce((
        select coalesce((f->>'active')::boolean, false)
        from jsonb_array_elements(coalesce(p_plan->'flow', '[]'::jsonb)) f
        where coalesce((f->>'at')::bigint, -1) <= p_elapsed_ms
        order by coalesce((f->>'at')::bigint, -1) desc
        limit 1
      ), false)
  );
$$;


-- Live Flow time = the sum of the intervals the human had Flow ON, measured
-- against the SERVER clock (the client never sends a duration).
create or replace function public._blitz_flow_ms(p_events jsonb, p_elapsed_ms bigint)
returns bigint
language plpgsql immutable
security definer set search_path = public, pg_temp
as $$
declare
  v_on boolean := false;
  v_prev bigint := 0;
  v_total bigint := 0;
  ev record;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  for ev in
    select coalesce((e->>'at')::bigint, 0) as at_ms,
           coalesce((e->>'active')::boolean, false) as active
    from jsonb_array_elements(p_events) e
    order by coalesce((e->>'at')::bigint, 0)
  loop
    if v_on then
      v_total := v_total + greatest(0, ev.at_ms - v_prev);
    end if;
    v_on := ev.active;
    v_prev := ev.at_ms;
  end loop;

  if v_on then
    v_total := v_total + greatest(0, p_elapsed_ms - v_prev);
  end if;

  return v_total;
end;
$$;


-- The ONLY way a question leaves the database. It selects the four options
-- by name and leaves out correct_answer and explanation entirely, because a
-- rationale routinely quotes the answer.
create or replace function public._blitz_question(p_id text)
returns jsonb
language sql stable
security definer set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', id,
    'text', question_text,
    'options', options,
    'subject', subject,
    'topic', topic,
    'difficulty', difficulty
  )
  from public.blitz_duel_questions
  where id = p_id;
$$;


-- Canonical response payload for every endpoint.
create or replace function public._blitz_state(p_match_id uuid)
returns jsonb
language plpgsql stable
security definer set search_path = public, pg_temp
as $$
declare
  m public.blitz_duels%rowtype;
  v_now timestamptz := now();
  v_match_ms bigint;
  v_elapsed bigint;
  v_bot jsonb;
  v_qid text;
begin
  select * into m from public.blitz_duels where id = p_match_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  v_match_ms := (extract(epoch from (m.ends_at - m.starts_at)) * 1000)::bigint;
  v_elapsed := greatest(
    0,
    least(((extract(epoch from (v_now - m.starts_at))) * 1000)::bigint, v_match_ms)
  );
  v_bot := public._blitz_bot_state(m.bot_plan, v_elapsed);

  -- A finished match still has questions left in the array; do not offer one.
  if m.status = 'active'
     and m.current_index < m.question_count
     and m.current_index < coalesce(array_length(m.question_ids, 1), 0) then
    v_qid := m.question_ids[m.current_index + 1];
  end if;

  return jsonb_build_object(
    'ok', true,
    'match', jsonb_build_object(
      'id', m.id,
      'status', m.status,
      'pace', m.pace_seconds,
      'stake_sc', m.stake_sc,
      'payout_sc', m.payout_sc,
      'question_count', m.question_count,
      'index', m.current_index,
      'starts_at', m.starts_at,
      'ends_at', m.ends_at,
      'server_now', v_now,
      'remaining_ms', greatest(
        0, (extract(epoch from (m.ends_at - v_now)) * 1000)::bigint
      ),
      'elapsed_ms', v_elapsed,
      'question', case when v_qid is null then null
                       else public._blitz_question(v_qid) end,
      'mine', jsonb_build_object(
        'score', m.score,
        'answered', m.correct_count + m.wrong_count,
        'correct', m.correct_count,
        'wrong', m.wrong_count,
        'skips', m.skip_count,
        'flow_active', m.flow_active,
        'flow_on_ms', public._blitz_flow_ms(m.flow_events, v_elapsed)
      ),
      'bot', jsonb_build_object(
        'score', coalesce(v_bot->'correct', '0'::jsonb),
        'answered', coalesce(v_bot->'answered', '0'::jsonb),
        'flow_active', coalesce(v_bot->'flow_active', 'false'::jsonb)
      ),
      'settlement', m.settlement
    )
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Settlement
-- ---------------------------------------------------------------------------
-- Grading and payout live here so create/answer/state can all lazy-settle a
-- match whose clock has run out without duplicating the money logic.
create or replace function public._blitz_settle_core(p_match_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  m public.blitz_duels%rowtype;
  v_match_ms bigint;
  v_bot jsonb;
  v_outcome text;
  v_delta integer := 0;
  v_charge jsonb;
  v_balance integer;
  v_flow_ms bigint;
  v_settlement jsonb;
begin
  -- FOR UPDATE re-reads the newest row version under READ COMMITTED, so a
  -- second concurrent settle sees status='completed' and replays.
  select * into m from public.blitz_duels where id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  if m.status = 'completed' then
    return jsonb_build_object(
      'ok', true, 'replay', true, 'settlement', m.settlement
    );
  end if;

  if now() < m.ends_at then
    return jsonb_build_object(
      'ok', false, 'error', 'MATCH_NOT_ENDED',
      'remaining_ms', greatest(
        0, (extract(epoch from (m.ends_at - now())) * 1000)::bigint
      )
    );
  end if;

  v_match_ms := (extract(epoch from (m.ends_at - m.starts_at)) * 1000)::bigint;
  v_bot := public._blitz_bot_state(m.bot_plan, v_match_ms);
  v_flow_ms := public._blitz_flow_ms(m.flow_events, v_match_ms);

  if m.score > (v_bot->>'correct')::integer then
    v_outcome := 'win';
  elsif m.score < (v_bot->>'correct')::integer then
    v_outcome := 'loss';
  else
    v_outcome := 'draw';
  end if;

  if v_outcome = 'win' then
    v_delta := m.payout_sc;
    v_charge := public._sc_apply(
      m.user_id, v_delta, 'duel_win', 'blitz_duel', 'earn',
      'blitz_duel', m.id::text,
      jsonb_build_object('match_id', m.id, 'outcome', v_outcome),
      (md5('blitz:' || m.id::text || ':win'))::uuid
    );
  elsif v_outcome = 'draw' then
    v_delta := m.stake_sc;
    v_charge := public._sc_apply(
      m.user_id, v_delta, 'duel_refund', 'blitz_duel', 'earn',
      'blitz_duel', m.id::text,
      jsonb_build_object('match_id', m.id, 'outcome', v_outcome),
      (md5('blitz:' || m.id::text || ':refund'))::uuid
    );
  else
    -- The stake is already gone; there is nothing to apply.
    v_charge := jsonb_build_object(
      'ok', true, 'idempotent', false, 'balanceAfter', null
    );
  end if;

  if coalesce((v_charge->>'ok')::boolean, false) = false then
    return jsonb_build_object(
      'ok', false, 'error', 'SETTLEMENT_FAILED', 'detail', v_charge->'error'
    );
  end if;

  select smart_coins into v_balance
  from public.profiles where id = m.user_id;

  v_settlement := jsonb_build_object(
    'outcome', v_outcome,
    'delta', v_delta,
    'score', m.score,
    'bot_score', (v_bot->>'correct')::integer,
    'answered', m.correct_count + m.wrong_count,
    'correct', m.correct_count,
    'wrong', m.wrong_count,
    'skips', m.skip_count,
    'flow_on_ms', v_flow_ms,
    'flow_off_ms', greatest(0, v_match_ms - v_flow_ms),
    'balance_after', v_balance,
    'settled_at', now()
  );

  update public.blitz_duels
  set status = 'completed',
      settlement = v_settlement,
      completed_at = now(),
      bot_score = (v_bot->>'correct')::integer,
      bot_answered = (v_bot->>'answered')::integer,
      flow_active = false
  where id = m.id;

  return jsonb_build_object(
    'ok', true, 'replay', false, 'settlement', v_settlement
  );
end;
$$;


-- The reply for an answer/skip/toggle that lands after the whistle: settle,
-- then hand back the results. `ok:false` is written in a SEPARATE object and
-- merged first, because jsonb `||` lets the right-hand `ok:true` from the
-- settle payload win the key otherwise.
create or replace function public._blitz_ended(p_match_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_settle jsonb;
  v_state jsonb;
begin
  v_settle := public._blitz_settle_core(p_match_id);
  if coalesce((v_settle->>'ok')::boolean, false) = false then
    return jsonb_build_object(
      'ok', false, 'error', 'SETTLEMENT_FAILED', 'detail', v_settle->'error'
    );
  end if;

  v_state := public._blitz_state(p_match_id);
  return jsonb_build_object(
           'ok', false, 'error', 'MATCH_ENDED', 'action', null
         )
         || jsonb_build_object(
              'settlement', v_settle->'settlement',
              'match', v_state->'match'
            );
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. RPCs (service_role only — reached exclusively through api/_blitz-duel.js)
-- ---------------------------------------------------------------------------

create or replace function public.blitz_duel_create(
  p_user_id uuid,
  p_pace integer default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  cfg jsonb;
  v_pace integer;
  v_count integer;
  v_stake integer;
  v_payout integer;
  v_match_seconds integer;
  v_min integer;
  v_max integer;
  v_def integer;
  v_rl jsonb;
  v_bank integer;
  v_ids text[];
  v_answers jsonb := '[]'::jsonb;
  v_flows jsonb := '[]'::jsonb;
  v_plan jsonb;
  v_t bigint := 0;
  v_on boolean := false;
  v_acc double precision;
  v_min_ms bigint;
  v_max_ms bigint;
  v_i integer;
  v_existing public.blitz_duels%rowtype;
  v_new public.blitz_duels%rowtype;
  v_charge jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  cfg := public._blitz_config();
  v_min := (cfg->>'min_pace')::integer;
  v_max := (cfg->>'max_pace')::integer;
  v_def := (cfg->>'default_pace')::integer;
  v_pace := coalesce(p_pace, v_def);

  if v_pace is null or v_pace < v_min or v_pace > v_max then
    return jsonb_build_object(
      'ok', false, 'error', 'INVALID_PACE',
      'min', v_min, 'max', v_max, 'default', v_def
    );
  end if;

  v_count := (cfg->>'question_count')::integer;
  v_stake := (cfg->>'stake_sc')::integer;
  v_payout := (cfg->>'win_payout_sc')::integer;
  v_match_seconds := (cfg->>'match_seconds')::integer;

  -- Reusing a live match is a replay, never a second stake.
  select * into v_existing
  from public.blitz_duels
  where user_id = p_user_id and status = 'active';

  if found then
    if now() < v_existing.ends_at then
      return jsonb_build_object('ok', true, 'replay', true, 'action', null)
             || public._blitz_state(v_existing.id);
    end if;
    -- Clock already ran out: settle it first, then start a fresh one.
    v_rl := public._blitz_settle_core(v_existing.id);
    if coalesce((v_rl->>'ok')::boolean, false) = false then
      return jsonb_build_object(
        'ok', false, 'error', 'SETTLEMENT_FAILED', 'detail', v_rl->'error'
      );
    end if;
  end if;

  v_rl := public._blitz_rate_check(
    p_user_id, 'create', (cfg->>'rate_create_per_min')::integer, 60
  );
  if coalesce((v_rl->>'ok')::boolean, false) = false then
    return v_rl;
  end if;

  select count(*) into v_bank from public.blitz_duel_questions;
  if v_bank < v_count then
    return jsonb_build_object(
      'ok', false, 'error', 'INSUFFICIENT_QUESTIONS',
      'available', v_bank, 'required', v_count
    );
  end if;

  -- A uniform random subset; the row_number preserves the shuffle order.
  select coalesce(array_agg(id order by rn), '{}'::text[])
  into v_ids
  from (
    select id, row_number() over () as rn
    from (
      select id from public.blitz_duel_questions order by random() limit v_count
    ) shuffled
  ) ordered;

  -- Scholar bot: a cumulative answer schedule, one correctness roll per
  -- question, and Flow toggling on its own 8-16s rhythm.
  v_acc := coalesce((cfg->>'bot_accuracy')::double precision, 0.70);
  v_min_ms := (cfg->>'bot_min_interval_ms')::bigint;
  v_max_ms := (cfg->>'bot_max_interval_ms')::bigint;

  for v_i in 0 .. v_count - 1 loop
    v_t := v_t + v_min_ms
           + floor(random() * (v_max_ms - v_min_ms + 1))::bigint;
    v_answers := v_answers || jsonb_build_array(
      jsonb_build_object(
        'q', v_i, 'at', v_t, 'correct', (random() < v_acc)
      )
    );
  end loop;

  v_t := 0;
  v_min_ms := (cfg->>'bot_flow_min_ms')::bigint;
  v_max_ms := (cfg->>'bot_flow_max_ms')::bigint;
  loop
    v_t := v_t + v_min_ms
           + floor(random() * (v_max_ms - v_min_ms + 1))::bigint;
    exit when v_t >= (v_match_seconds * 1000)::bigint;
    v_on := not v_on;
    v_flows := v_flows || jsonb_build_array(
      jsonb_build_object('at', v_t, 'active', v_on)
    );
  end loop;

  v_plan := jsonb_build_object('answers', v_answers, 'flow', v_flows);

  begin
    insert into public.blitz_duels
      (user_id, status, pace_seconds, stake_sc, payout_sc,
       question_ids, question_count, current_index,
       answers, score, correct_count, wrong_count, skip_count,
       flow_events, flow_active, bot_plan, starts_at, ends_at)
    values
      (p_user_id, 'active', v_pace, v_stake, v_payout,
       v_ids, v_count, 0,
       '[]'::jsonb, 0, 0, 0, 0,
       '[]'::jsonb, false, v_plan,
       now(), now() + make_interval(secs => v_match_seconds))
    returning * into v_new;
  exception when unique_violation then
    -- The only 23505 this table can raise is the partial unique index on an
    -- ACTIVE match per user (the PK is a fresh uuid, the FK is 23503). A
    -- racing second create therefore means "someone already holds the match".
    select * into v_existing
    from public.blitz_duels
    where user_id = p_user_id and status = 'active';
    if found then
      return jsonb_build_object('ok', true, 'replay', true, 'action', null)
             || public._blitz_state(v_existing.id);
    end if;
    raise;
  end;

  -- Stake AFTER the row exists so an overdraft can be refused without ever
  -- leaving a charged match behind.
  v_charge := public._sc_apply(
    p_user_id, -v_stake, 'duel_stake', 'blitz_duel', 'spend',
    'blitz_duel', v_new.id::text,
    jsonb_build_object('match_id', v_new.id, 'pace', v_pace),
    (md5('blitz:' || v_new.id::text || ':stake'))::uuid
  );

  if coalesce((v_charge->>'ok')::boolean, false) = false then
    delete from public.blitz_duels where id = v_new.id;
    if (v_charge->>'error') = 'INSUFFICIENT_FUNDS' then
      return jsonb_build_object(
        'ok', false, 'error', 'INSUFFICIENT_FUNDS', 'required', v_stake
      );
    end if;
    return jsonb_build_object('ok', false, 'error', 'STAKE_FAILED');
  end if;

  return jsonb_build_object('ok', true, 'replay', false, 'action', null)
         || jsonb_build_object('balance_after', v_charge->'balanceAfter')
         || public._blitz_state(v_new.id);
end;
$$;


create or replace function public.blitz_duel_state(
  p_user_id uuid,
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  m public.blitz_duels%rowtype;
  v_settle jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into m
  from public.blitz_duels
  where id = p_match_id and user_id = p_user_id;

  if not found then
    -- Never confirm that a match id exists when it is not the caller's.
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  -- A reconnect past the whistle settles here, so results never depend on the
  -- tab that happened to be open at ends_at.
  if m.status = 'active' and now() >= m.ends_at then
    v_settle := public._blitz_settle_core(m.id);
    if coalesce((v_settle->>'ok')::boolean, false) = false then
      return v_settle;
    end if;
  end if;

  return public._blitz_state(m.id);
end;
$$;


create or replace function public.blitz_duel_answer(
  p_user_id uuid,
  p_match_id uuid,
  p_question_index integer,
  p_selected text,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  cfg jsonb;
  m public.blitz_duels%rowtype;
  v_elapsed bigint;
  v_match_ms bigint;
  v_key text;
  v_sel text;
  v_correct boolean;
  v_points integer;
  v_entry jsonb;
  v_prev jsonb := null;
  v_rl jsonb;
  v_qid text;
  v_new_correct integer;
  v_new_wrong integer;
  v_action jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into m
  from public.blitz_duels
  where id = p_match_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  if m.status <> 'active' then
    return jsonb_build_object(
           'ok', false, 'error', 'MATCH_CLOSED', 'action', null
         )
         || jsonb_build_object('settlement', m.settlement);
  end if;

  -- The whistle is absolute: an answer that arrives after ends_at settles the
  -- match rather than counting.
  if now() >= m.ends_at then
    return public._blitz_ended(m.id);
  end if;

  -- Idempotency BEFORE the rate limiter: a retried request must not burn a
  -- slot on a question that was already graded.
  if p_client_request_id is not null then
    select e into v_prev
    from jsonb_array_elements(m.answers) e
    where e->>'rid' = p_client_request_id::text;

    if found then
      v_action := jsonb_build_object(
        'correct', coalesce((v_prev->>'correct')::boolean, false),
        'points', coalesce((v_prev->>'pts')::integer, 0),
        'index', coalesce((v_prev->>'q')::integer, p_question_index),
        'next_index', m.current_index,
        'finished', m.current_index >= m.question_count,
        'skipped', coalesce((v_prev->>'skipped')::boolean, false)
      );
      return jsonb_build_object('ok', true, 'replay', true, 'action', v_action)
             || jsonb_build_object('balance_after', null)
             || public._blitz_state(m.id);
    end if;
  end if;

  cfg := public._blitz_config();
  v_rl := public._blitz_rate_check(
    p_user_id, 'answer', (cfg->>'rate_answer_per_min')::integer, 60
  );
  if coalesce((v_rl->>'ok')::boolean, false) = false then
    return v_rl;
  end if;

  if p_question_index is null
     or p_question_index < 0
     or p_question_index >= m.question_count then
    return jsonb_build_object('ok', false, 'error', 'INVALID_QUESTION_INDEX');
  end if;

  if p_question_index <> m.current_index then
    return jsonb_build_object(
      'ok', false, 'error', 'QUESTION_NOT_CURRENT', 'index', m.current_index
    );
  end if;

  v_sel := upper(trim(coalesce(p_selected, '')));
  if v_sel not in ('A', 'B', 'C', 'D') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SELECTION');
  end if;

  v_qid := m.question_ids[p_question_index + 1];
  select correct_answer into v_key
  from public.blitz_duel_questions where id = v_qid;

  if v_key is null then
    return jsonb_build_object('ok', false, 'error', 'QUESTION_NOT_FOUND');
  end if;

  v_correct := (v_sel = upper(v_key));
  v_points := case when v_correct then 1 else 0 end;

  v_match_ms := (extract(epoch from (m.ends_at - m.starts_at)) * 1000)::bigint;
  v_elapsed := greatest(
    0,
    least(((extract(epoch from (now() - m.starts_at))) * 1000)::bigint, v_match_ms)
  );

  v_entry := jsonb_build_object(
    'q', p_question_index,
    'sel', v_sel,
    'correct', v_correct,
    'pts', v_points,
    'at', v_elapsed
  );
  if p_client_request_id is not null then
    v_entry := v_entry || jsonb_build_object('rid', p_client_request_id::text);
  end if;

  v_new_correct := m.correct_count + case when v_correct then 1 else 0 end;
  v_new_wrong := m.wrong_count + case when v_correct then 0 else 1 end;

  update public.blitz_duels
  set answers = m.answers || jsonb_build_array(v_entry),
      current_index = m.current_index + 1,
      score = m.score + v_points,
      correct_count = v_new_correct,
      wrong_count = v_new_wrong
  where id = m.id;

  v_action := jsonb_build_object(
    'correct', v_correct,
    'points', v_points,
    'index', p_question_index,
    'next_index', m.current_index + 1,
    'finished', (m.current_index + 1) >= m.question_count,
    'skipped', false
  );

  return jsonb_build_object('ok', true, 'replay', false, 'action', v_action)
         || public._blitz_state(m.id);
end;
$$;


create or replace function public.blitz_duel_skip(
  p_user_id uuid,
  p_match_id uuid,
  p_question_index integer,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  cfg jsonb;
  m public.blitz_duels%rowtype;
  v_elapsed bigint;
  v_match_ms bigint;
  v_entry jsonb;
  v_prev jsonb := null;
  v_rl jsonb;
  v_action jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into m
  from public.blitz_duels
  where id = p_match_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  if m.status <> 'active' then
    return jsonb_build_object(
           'ok', false, 'error', 'MATCH_CLOSED', 'action', null
         )
         || jsonb_build_object('settlement', m.settlement);
  end if;

  if now() >= m.ends_at then
    return public._blitz_ended(m.id);
  end if;

  if p_client_request_id is not null then
    select e into v_prev
    from jsonb_array_elements(m.answers) e
    where e->>'rid' = p_client_request_id::text;

    if found then
      v_action := jsonb_build_object(
        'correct', false,
        'points', 0,
        'index', coalesce((v_prev->>'q')::integer, p_question_index),
        'next_index', m.current_index,
        'finished', m.current_index >= m.question_count,
        'skipped', true
      );
      return jsonb_build_object('ok', true, 'replay', true, 'action', v_action)
             || public._blitz_state(m.id);
    end if;
  end if;

  cfg := public._blitz_config();
  v_rl := public._blitz_rate_check(
    p_user_id, 'skip', (cfg->>'rate_skip_per_min')::integer, 60
  );
  if coalesce((v_rl->>'ok')::boolean, false) = false then
    return v_rl;
  end if;

  if p_question_index is null
     or p_question_index < 0
     or p_question_index >= m.question_count then
    return jsonb_build_object('ok', false, 'error', 'INVALID_QUESTION_INDEX');
  end if;

  if p_question_index <> m.current_index then
    return jsonb_build_object(
      'ok', false, 'error', 'QUESTION_NOT_CURRENT', 'index', m.current_index
    );
  end if;

  v_match_ms := (extract(epoch from (m.ends_at - m.starts_at)) * 1000)::bigint;
  v_elapsed := greatest(
    0,
    least(((extract(epoch from (now() - m.starts_at))) * 1000)::bigint, v_match_ms)
  );

  v_entry := jsonb_build_object(
    'q', p_question_index,
    'sel', null,
    'correct', false,
    'pts', 0,
    'skipped', true,
    'at', v_elapsed
  );
  if p_client_request_id is not null then
    v_entry := v_entry || jsonb_build_object('rid', p_client_request_id::text);
  end if;

  update public.blitz_duels
  set answers = m.answers || jsonb_build_array(v_entry),
      current_index = m.current_index + 1,
      skip_count = m.skip_count + 1
  where id = m.id;

  v_action := jsonb_build_object(
    'correct', false,
    'points', 0,
    'index', p_question_index,
    'next_index', m.current_index + 1,
    'finished', (m.current_index + 1) >= m.question_count,
    'skipped', true
  );

  return jsonb_build_object('ok', true, 'replay', false, 'action', v_action)
         || public._blitz_state(m.id);
end;
$$;


create or replace function public.blitz_duel_flow(
  p_user_id uuid,
  p_match_id uuid,
  p_active boolean,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  cfg jsonb;
  m public.blitz_duels%rowtype;
  v_elapsed bigint;
  v_match_ms bigint;
  v_event jsonb;
  v_seen boolean := false;
  v_rl jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  if p_active is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SELECTION');
  end if;

  select * into m
  from public.blitz_duels
  where id = p_match_id and user_id = p_user_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  if m.status <> 'active' then
    return jsonb_build_object(
           'ok', false, 'error', 'MATCH_CLOSED', 'action', null
         )
         || jsonb_build_object('settlement', m.settlement);
  end if;

  if now() >= m.ends_at then
    return public._blitz_ended(m.id);
  end if;

  -- A replayed toggle must not count against the limit.
  if p_client_request_id is not null then
    select exists(
      select 1 from jsonb_array_elements(m.flow_events) e
      where e->>'rid' = p_client_request_id::text
    ) into v_seen;
    if v_seen then
      return jsonb_build_object('ok', true, 'replay', true, 'action', null)
             || public._blitz_state(m.id);
    end if;
  end if;

  -- No cooldown by design: the flow window is a rhythm, not a resource.
  if p_active <> m.flow_active then
    cfg := public._blitz_config();
    v_rl := public._blitz_rate_check(
      p_user_id, 'flow', (cfg->>'rate_flow_per_min')::integer, 60
    );
    if coalesce((v_rl->>'ok')::boolean, false) = false then
      return v_rl;
    end if;
  end if;

  if p_active = m.flow_active then
    return jsonb_build_object(
      'ok', true, 'replay', false, 'action',
      jsonb_build_object('flow_active', m.flow_active, 'changed', false)
    ) || public._blitz_state(m.id);
  end if;

  v_match_ms := (extract(epoch from (m.ends_at - m.starts_at)) * 1000)::bigint;
  v_elapsed := greatest(
    0,
    least(((extract(epoch from (now() - m.starts_at))) * 1000)::bigint, v_match_ms)
  );

  v_event := jsonb_build_object('at', v_elapsed, 'active', p_active);
  if p_client_request_id is not null then
    v_event := v_event || jsonb_build_object('rid', p_client_request_id::text);
  end if;

  update public.blitz_duels
  set flow_events = m.flow_events || jsonb_build_array(v_event),
      flow_active = p_active
  where id = m.id;

  return jsonb_build_object(
    'ok', true, 'replay', false, 'action',
    jsonb_build_object('flow_active', p_active, 'changed', true)
  ) || public._blitz_state(m.id);
end;
$$;


create or replace function public.blitz_duel_settle(
  p_user_id uuid,
  p_match_id uuid
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  m public.blitz_duels%rowtype;
  v_settle jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select * into m
  from public.blitz_duels
  where id = p_match_id and user_id = p_user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  v_settle := public._blitz_settle_core(m.id);
  if coalesce((v_settle->>'ok')::boolean, false) = false then
    return v_settle;
  end if;

  return jsonb_build_object(
    'ok', true,
    'replay', coalesce((v_settle->>'replay')::boolean, false),
    'action', null
  ) || public._blitz_state(m.id);
end;
$$;


create or replace function public.blitz_duel_rematch(
  p_user_id uuid,
  p_pace integer default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  return public.blitz_duel_create(p_user_id, p_pace);
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. ACLs
-- ---------------------------------------------------------------------------
-- This project's default privileges auto-grant anon + authenticated on EVERY
-- new function, so revoking from `public` alone is not enough.
do $$
declare
  v_fns text[] := array[
    '_blitz_touch()',
    '_blitz_config()',
    '_blitz_rate_check(uuid, text, integer, integer)',
    '_blitz_bot_state(jsonb, bigint)',
    '_blitz_flow_ms(jsonb, bigint)',
    '_blitz_question(text)',
    '_blitz_state(uuid)',
    '_blitz_settle_core(uuid)',
    '_blitz_ended(uuid)',
    'blitz_duel_create(uuid, integer)',
    'blitz_duel_state(uuid, uuid)',
    'blitz_duel_answer(uuid, uuid, integer, text, uuid)',
    'blitz_duel_skip(uuid, uuid, integer, uuid)',
    'blitz_duel_flow(uuid, uuid, boolean, uuid)',
    'blitz_duel_settle(uuid, uuid)',
    'blitz_duel_rematch(uuid, integer)'
  ];
  v_fn text;
begin
  foreach v_fn in array v_fns loop
    execute format('revoke all on function public.%s from public, anon, authenticated', v_fn);
    execute format('grant execute on function public.%s to service_role', v_fn);
  end loop;
end;
$$;


notify pgrst, 'reload schema';
