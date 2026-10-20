-- ============================================================================
-- migration-v104-arena-flow.sql
--
-- ARENA FLOW STATE (per-player), modelled on the v101 Blitz Duel Flow.
--
-- Rules (identical to v101):
--   * one shared 90s clock that NEVER pauses and is NEVER extended;
--   * a pace of 3-12 seconds per question (default 6), chosen by the player;
--   * when the ring runs out, the player's CURRENT unanswered question is
--     submitted once as a SKIP worth 0 points (first-answer-wins in
--     arena_answer makes that exactly-once);
--   * no bonus, no extra time, no score change whatsoever.
--
-- Why this is a per-player event log, not one boolean on the match:
--   competitive_matches is a SHARED row, so a single flow_active column would
--   let either participant force a 3s auto-skip rhythm onto BOTH players.
--   Flow is a personal rhythm aid, so every toggle is appended with `by` (the
--   caller), `at` (server-measured elapsed ms), `active` and `pace`. The
--   caller's current state is the last event they appended; _arena_flow_state
--   reads it, _arena_flow_ms sums only THEIR on-intervals.
--
-- This migration:
--   1. competitive_matches += flow_events jsonb (append-only, default []).
--   2. _arena_flow_state(events, user)  -> {active, pace}  (internal).
--   3. _arena_flow_ms(events, user, elapsed) -> bigint     (internal).
--   4. arena_flow(match, active, pace?, rid?) -> light jsonb (client RPC).
--   5. arena_state redefined (v64 body) to expose flowActive/pace/flowOnMs.
--
-- The clock invariant is structural: this file never writes starts_at or
-- ends_at, and the only columns it touches are flow_events. escrow_amount,
-- wager_*_held, status and the answer rows are untouched, so the v63 seal,
-- settlement and exactly-once guarantees are unchanged.
--
-- INTERVAL CAST LESSON (v101, 42846): `(timestamptz - timestamptz)` is an
-- interval, and `interval::bigint` does not exist. Every elapsed computation
-- below is `(extract(epoch from ...) * 1000)::bigint`.
--
-- Idempotent: the column add is IF NOT EXISTS and every function is CREATE OR
-- REPLACE. Re-running this file is safe.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The append-only event log. One row of JSON is cheaper and far safer than
--    a child table here: the whole log is read/written under the match row
--    lock that arena_flow already takes, and it never grows past a handful of
--    events in a 90s match.
-- ---------------------------------------------------------------------------
alter table public.competitive_matches
  add column if not exists flow_events jsonb not null default '[]'::jsonb;


-- ---------------------------------------------------------------------------
-- 2. The caller's CURRENT flow state = the last event THEY appended.
--    `with ordinality` preserves array order (insertion order), so two rapid
--    toggles in the same millisecond still resolve to the newest one.
-- ---------------------------------------------------------------------------
create or replace function public._arena_flow_state(p_events jsonb, p_user uuid)
returns jsonb
language sql immutable
security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'active', coalesce((e->>'active')::boolean, false),
        'pace', coalesce((e->>'pace')::integer, 6)
      )
      from jsonb_array_elements(
             case when jsonb_typeof(p_events) = 'array'
                  then p_events else '[]'::jsonb end
           ) with ordinality as t(e, ord)
      where p_user is not null
        and e->>'by' = p_user::text
      order by ord desc
      limit 1
    ),
    jsonb_build_object('active', false, 'pace', 6)
  );
$$;


-- ---------------------------------------------------------------------------
-- 3. Flow ON time for ONE player = the sum of the intervals they had Flow ON,
--    measured against the server clock. Same algorithm as _blitz_flow_ms;
--    the only difference is the `by` filter. The client never sends a
--    duration, so flowOnMs can never be inflated.
-- ---------------------------------------------------------------------------
create or replace function public._arena_flow_ms(
  p_events jsonb,
  p_user uuid,
  p_elapsed_ms bigint
)
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
  if p_events is null or p_user is null
     or jsonb_typeof(p_events) <> 'array' then
    return 0;
  end if;

  for ev in
    select coalesce((e->>'at')::bigint, 0) as at_ms,
           coalesce((e->>'active')::boolean, false) as active
    from jsonb_array_elements(p_events) with ordinality as t(e, ord)
    where e->>'by' = p_user::text
    order by coalesce((e->>'at')::bigint, 0), ord
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


-- ---------------------------------------------------------------------------
-- 4. arena_flow — the ONLY client path that writes flow state.
--
--    Validation order is deliberate and matches the arena family:
--    unauth -> bad selection -> bad pace -> match -> participant -> open
--    clock -> replay -> no-op -> append.
--
--    A pace is accepted WITHOUT a toggle (p_pace alone), because tapping a
--    pace chip while Flow is on must change the rhythm without appending an
--    off/on pair.
-- ---------------------------------------------------------------------------
create or replace function public.arena_flow(
  p_match_id uuid,
  p_active boolean,
  p_pace integer default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql
security definer set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_state jsonb;
  v_elapsed bigint := 0;
  v_match_ms bigint;
  v_pace integer;
  v_event jsonb;
  v_events jsonb;
  v_seen boolean := false;
  v_changed boolean;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  if p_active is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SELECTION');
  end if;

  -- 3-12s, default 6. A malformed pace is refused before any row is read.
  if p_pace is not null and (p_pace < 3 or p_pace > 12) then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PACE');
  end if;

  -- The v63 guard trigger refuses any mutation of an escrowed row from a
  -- session that has not claimed the arena write. Same call every arena RPC
  -- makes before touching competitive_matches.
  perform public._arena_claim_write();

  select * into v_m
  from public.competitive_matches
  where id = p_match_id
  for update;

  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;

  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  if v_m.status <> 'active' then
    return jsonb_build_object(
      'ok', false, 'error', 'MATCH_CLOSED', 'status', v_m.status
    );
  end if;

  -- Flow obeys the shared clock: once it has run out there is nothing to
  -- toggle. Settlement (arena_settle) is the only thing that should run now.
  if now() >= v_m.ends_at then
    return jsonb_build_object(
      'ok', false, 'error', 'MATCH_CLOSED', 'status', 'expired'
    );
  end if;

  -- Elapsed against the SERVER clock, clamped to the match window. Never
  -- negative, never past ends_at.
  if v_m.starts_at is not null and v_m.ends_at is not null then
    v_match_ms := (extract(epoch from (v_m.ends_at - v_m.starts_at)) * 1000)::bigint;
    v_elapsed := greatest(
      0,
      least(
        ((extract(epoch from (now() - v_m.starts_at))) * 1000)::bigint,
        greatest(0, v_match_ms)
      )
    );
  end if;

  v_state := public._arena_flow_state(v_m.flow_events, v_user);
  v_pace := coalesce(p_pace, (v_state->>'pace')::integer, 6);

  -- A replayed request id is answered from the stored log, not appended again.
  if p_client_request_id is not null then
    select exists(
      select 1
      from jsonb_array_elements(v_m.flow_events) e
      where e->>'rid' = p_client_request_id::text
    ) into v_seen;
    if v_seen then
      return jsonb_build_object(
        'ok', true, 'replay', true, 'changed', false,
        'flowActive', coalesce((v_state->>'active')::boolean, false),
        'pace', coalesce((v_state->>'pace')::integer, 6),
        'flowOnMs', public._arena_flow_ms(v_m.flow_events, v_user, v_elapsed)
      );
    end if;
  end if;

  -- Setting the same state (and no new pace) is a no-op, not an event.
  v_changed :=
    (p_active <> coalesce((v_state->>'active')::boolean, false))
    or (p_pace is not null and p_pace <> coalesce((v_state->>'pace')::integer, 6));

  if not v_changed then
    return jsonb_build_object(
      'ok', true, 'replay', false, 'changed', false,
      'flowActive', coalesce((v_state->>'active')::boolean, false),
      'pace', coalesce((v_state->>'pace')::integer, 6),
      'flowOnMs', public._arena_flow_ms(v_m.flow_events, v_user, v_elapsed)
    );
  end if;

  v_event := jsonb_build_object(
    'by', v_user,
    'at', v_elapsed,
    'active', p_active,
    'pace', v_pace
  );
  if p_client_request_id is not null then
    v_event := v_event || jsonb_build_object('rid', p_client_request_id::text);
  end if;

  v_events := v_m.flow_events || jsonb_build_array(v_event);

  update public.competitive_matches
  set flow_events = v_events
  where id = v_m.id;

  return jsonb_build_object(
    'ok', true, 'replay', false, 'changed', true,
    'flowActive', p_active,
    'pace', v_pace,
    'flowOnMs', public._arena_flow_ms(v_events, v_user, v_elapsed)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. arena_state (v64 body) + Flow fields.
--
--    This REPLACES the function, so the v64 body is reproduced here in full
--    (claim -> sweep -> presence, bot/opponent resolution, myAnswers only,
--    review gate). The three additions are flowActive / pace / flowOnMs for
--    the CALLER — enough for the reconnect path to restore the ring without a
--    second round trip, and nothing about the opponent's flow.
-- ---------------------------------------------------------------------------
create or replace function public.arena_state(p_match_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_m public.competitive_matches%rowtype;
  v_rules jsonb;
  v_questions jsonb;
  v_review jsonb;
  v_bot_id uuid;
  v_my_answers jsonb;
  v_opp_live uuid;
  v_opp_score jsonb;
  v_opp_answers jsonb;
  v_remaining bigint;
  v_flow jsonb;
  v_elapsed_ms bigint := 0;
  v_flow_on bigint := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  perform public._arena_claim_write();
  perform public._arena_sweep();
  perform public._arena_touch_presence(v_user);

  select * into v_m from public.competitive_matches where id = p_match_id;
  if v_m.id is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_NOT_FOUND');
  end if;
  if not (v_m.creator_id = v_user or v_m.opponent_id = v_user) then
    return jsonb_build_object('ok', false, 'error', 'NOT_YOUR_MATCH');
  end if;

  v_rules := public._arena_rules();
  v_questions := public._cm_serve_questions(v_m.question_ids);
  if v_questions is null then
    return jsonb_build_object('ok', false, 'error', 'MATCH_TAMPERED');
  end if;

  v_bot_id := case when v_m.opponent_bot is not null
                   then public._arena_bot_id(v_m.opponent_bot) else null end;
  v_opp_live := case when v_m.creator_id = v_user then v_m.opponent_id
                     else v_m.creator_id end;

  v_my_answers := (
    select coalesce(jsonb_agg(
      jsonb_build_object('index', a.question_index, 'selected', a.selected_answer,
                         'isCorrect', a.is_correct, 'multiplier', a.multiplier,
                         'points', a.points, 'skipped', a.skipped)
      order by a.question_index), '[]'::jsonb)
    from public.competitive_match_answers a
    where a.match_id = p_match_id and a.player_id = v_user
  );

  v_opp_answers := (
    select coalesce(jsonb_agg(
      jsonb_build_object('index', a.question_index, 'selected', a.selected_answer,
                         'isCorrect', a.is_correct, 'multiplier', a.multiplier,
                         'points', a.points, 'skipped', a.skipped)
      order by a.question_index), '[]'::jsonb)
    from public.competitive_match_answers a
    where a.match_id = p_match_id
      and a.player_id = coalesce(v_opp_live, v_bot_id)
  );

  v_opp_score := public._arena_score(p_match_id, coalesce(v_opp_live, v_bot_id));

  v_remaining := case when v_m.starts_at is null then null
    else greatest(0, (extract(epoch from (v_m.ends_at - now())) * 1000)::bigint) end;

  -- Flow: the caller's own rhythm only. Elapsed uses extract(epoch), never a
  -- raw interval cast (v101 42846).
  v_flow := public._arena_flow_state(v_m.flow_events, v_user);
  if v_m.starts_at is not null and v_m.ends_at is not null then
    v_elapsed_ms := greatest(
      0,
      least(
        ((extract(epoch from (now() - v_m.starts_at))) * 1000)::bigint,
        greatest(0, (extract(epoch from (v_m.ends_at - v_m.starts_at)) * 1000)::bigint)
      )
    );
  end if;
  v_flow_on := public._arena_flow_ms(v_m.flow_events, v_user, v_elapsed_ms);

  v_review := public._arena_review(p_match_id, v_user);

  return jsonb_build_object(
    'ok', true, 'matchId', v_m.id, 'status', v_m.status,
    'mode', v_m.match_type, 'format', 'blitz',
    'stake', coalesce(v_m.stake, 0),
    'practice', (coalesce(v_m.stake, 0) = 0),
    'framework', 'NMCN', 'questionCount', v_m.question_count,
    'opponentBot', v_m.opponent_bot,
    'opponentName', public._arena_name(v_m, v_opp_live),
    'opponentIsBot', (v_m.opponent_bot is not null),
    'escrowed', coalesce(v_m.escrow_amount, 0),
    'balance', (select smart_coins from public.profiles where id = v_user),
    'creatorReady', v_m.creator_ready, 'opponentReady', v_m.opponent_ready,
    'startsAt', v_m.starts_at, 'endsAt', v_m.ends_at,
    'remainingMs', v_remaining,
    'graceSeconds', coalesce((v_rules ->> 'grace_seconds')::int, 15),
    'opponentDisconnected', (v_m.opponent_id is not null
      and v_m.disconnected_opponent_at is not null),
    'canCancel', (v_m.creator_id = v_user and v_m.starts_at is null),
    'canForfeit', (v_m.status in ('ready', 'active')),
    'myScore', public._arena_score(p_match_id, v_user),
    'opponentScore', v_opp_score,
    'flowActive', coalesce((v_flow->>'active')::boolean, false),
    'pace', coalesce((v_flow->>'pace')::integer, 6),
    'flowOnMs', coalesce(v_flow_on, 0),
    'myAnswers', v_my_answers,
    'opponentAnswers', v_opp_answers,
    'questions', v_questions,
    'review', v_review,
    'outcome', v_m.outcome,
    'abandonReason', v_m.abandon_reason);
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. ACLs.
--
--    LIVE GRANT GOTCHA: this project's default privileges auto-grant anon +
--    authenticated on every new function, so `revoke from public` alone leaves
--    those explicit grants behind. Both helpers are internal (called only from
--    SECURITY DEFINER functions, which run as the owner), so neither needs a
--    client grant. arena_flow itself IS a client RPC and is granted to
--    authenticated only.
-- ---------------------------------------------------------------------------
revoke all on function public._arena_flow_state(jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public._arena_flow_ms(jsonb, uuid, bigint)
  from public, anon, authenticated;
grant execute on function public._arena_flow_state(jsonb, uuid) to service_role;
grant execute on function public._arena_flow_ms(jsonb, uuid, bigint) to service_role;

revoke all on function public.arena_flow(uuid, boolean, integer, uuid)
  from public, anon;
grant execute on function public.arena_flow(uuid, boolean, integer, uuid)
  to authenticated, service_role;

-- arena_state was already granted by v63/v64; CREATE OR REPLACE preserves the
-- ACL, but re-assert it so a later revoke sweep cannot silently close it.
revoke all on function public.arena_state(uuid) from public, anon;
grant execute on function public.arena_state(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
