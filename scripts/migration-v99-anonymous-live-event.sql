-- ===========================================================================
-- scripts/migration-v99-anonymous-live-event.sql
--
-- The Anonymous Room becomes a TIME-LIMITED LIVE EVENT.
--
--   minimum intended duration : 40 minutes
--   default duration          : 60 minutes
--   absolute maximum          : 60 minutes  (never exceeded, for any reason)
--
-- Apply:  node scripts/_apply-v43.mjs scripts/migration-v99-anonymous-live-event.sql
-- Re-run safe: every statement is guarded.
-- ===========================================================================
--
-- THE ONE DESIGN DECISION THAT MATTERS
--
-- The deadline is a PREDICATE, not a state transition. Nothing in this file
-- makes an event "end" — every check asks the database clock a question:
--
--     public._anon_event_over(p_group)   -- now() >= event_ends_at
--
-- Because that is evaluated by Postgres inside the same transaction as the
-- write it guards, correctness does not depend on a sweep having run, a cron
-- firing, or a browser being open. There is no scheduled job on this project
-- (Vercel Hobby crons are daily-only, and community_cleanup is invoked by an
-- external scheduler that may not exist). A predicate needs no scheduler.
--
-- The sweep functions and community_anonymous_event_end() exist only to write
-- `event_ended_at` — an audit record and a signal to bulk cleanup. They are the
-- belt; the predicate is the braces. If they never run, the event still closes
-- on time and still refuses writes.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not extend an event because people are still in it. activity does not
-- touch event_started_at or event_ends_at. Reconnecting does not restart it. A
-- heartbeat does not extend it. Only a moderator/admin close can end it early,
-- and it can never be moved later — the CHECK below makes event_ends_at
-- structurally incapable of drifting away from event_started_at + duration.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------
-- event_duration_minutes has a DEFAULT of 60, so every anonymous room created
-- from here on is a 60-minute event without any caller having to ask for one.
alter table public.study_groups
  add column if not exists event_started_at      timestamptz,
  add column if not exists event_duration_minutes integer not null default 60,
  add column if not exists event_ends_at         timestamptz,
  add column if not exists event_ended_at        timestamptz,
  add column if not exists event_ended_reason    text;

comment on column public.study_groups.event_started_at is
  'Server clock at the moment the room transitioned to active. The live-event clock starts here, and only here.';
comment on column public.study_groups.event_ends_at is
  'Authoritative hard deadline. Never moved later. Derived, not stored independently: see study_groups_event_window_check.';
comment on column public.study_groups.event_ended_at is
  'When the event was marked ended (audit only). Writes are refused by _anon_event_over() whether or not this is set.';
comment on column public.study_groups.event_ended_reason is
  'deadline | moderator | admin | operational. Audit only.';

-- ---------------------------------------------------------------------------
-- 2. The constraints — enforced in SQL, not in the UI
-- ---------------------------------------------------------------------------
-- The 40-60 range is a product rule, and a CHECK is the only place it cannot
-- be bypassed by a crafted request, a stale server build, or a future caller.
alter table public.study_groups drop constraint if exists study_groups_event_duration_check;
alter table public.study_groups add constraint study_groups_event_duration_check
  check (event_duration_minutes between 40 and 60);

-- The clock cannot drift from the configured duration. This is what makes
-- "never extend beyond 60" structural rather than a matter of discipline:
-- event_ends_at is only ever accepted if it equals exactly
-- event_started_at + the configured duration.
alter table public.study_groups drop constraint if exists study_groups_event_window_check;
alter table public.study_groups add constraint study_groups_event_window_check
  check (
    event_ends_at is null
    or (
      event_started_at is not null
      and event_ends_at = event_started_at + make_interval(mins => event_duration_minutes)
    )
  );

-- event_ended_reason is a closed vocabulary. NULL until an authorised close.
alter table public.study_groups drop constraint if exists study_groups_event_ended_reason_check;
alter table public.study_groups add constraint study_groups_event_ended_reason_check
  check (event_ended_reason is null or event_ended_reason in ('deadline', 'moderator', 'admin', 'operational'));


-- ---------------------------------------------------------------------------
-- 3. The authoritative helpers
-- ---------------------------------------------------------------------------
-- NOTE ON THE OUT-PARAMETER TRAP: a set-returning function's result column
-- names come from its OUT parameters (pg_proc.proargnames), NOT from the alias
-- on its body's final SELECT. Naming a column in the inner query and then
-- selecting `that_alias` from outside is a 42703 that returns nothing at all.
-- See the v96 scholar_search incident recorded in AGENTS.md. These are scalar
-- functions, so this does not bite here — but it is why the return expressions
-- are written out in full every time.

-- The hard deadline, or NULL if the event has not started. NULL means "no clock
-- running yet", which is the honest answer for a room that is still waiting to
-- reach its activation threshold.
create or replace function public._anon_event_deadline(p_group bigint)
returns timestamptz
language sql stable
as $$
  select g.event_ends_at
    from public.study_groups g
   where g.id = p_group
     and g.type = 'anonymous';
$$;

-- THE predicate. True when no new interaction may be written to this event.
--
-- Two independent signals, either of which is sufficient:
--   * event_ended_at is set        -> an authorised close already happened
--   * now() >= event_ends_at       -> the deadline passed
--
-- Both are evaluated on the SERVER clock, inside the caller's transaction.
-- No client can influence either one, and a browser clock change cannot reach
-- them. A room that never started (event_ends_at IS NULL) is never "over".
create or replace function public._anon_event_over(p_group bigint)
returns boolean
language sql stable
as $$
  select coalesce(
    (
      select (g.event_ended_at is not null)
          or (g.event_ends_at is not null and now() >= g.event_ends_at)
        from public.study_groups g
       where g.id = p_group
         and g.type = 'anonymous'
    ),
    false
  );
$$;

-- The lifecycle state. Five states, derived — never stored, so it can never
-- disagree with the columns it is derived from.
--
--   scheduled    created, not yet activated
--   waiting      filling up towards minimum_members_to_activate
--   live         running, more than the ending-soon window remaining
--   ending_soon  inside the last 5 minutes (UI warning only; still writable)
--   ended        the deadline passed, or an authorised close happened
create or replace function public._anon_event_state(p_group bigint)
returns text
language sql stable
as $$
  select case
    when g.id is null or g.type is distinct from 'anonymous' then null
    -- An authorised close, or the deadline passing, both mean the same thing.
    when g.event_ended_at is not null then 'ended'
    when g.event_ends_at is not null and now() >= g.event_ends_at then 'ended'
    when g.group_state = 'wiped' then 'ended'
    -- Still gathering members. There is deliberately NO clock yet: a countdown
    -- here would be a countdown to something that has not started.
    when g.group_state = 'waiting' then 'waiting'
    -- Active but no clock: a room that was already open before this migration
    -- existed. It is genuinely live for members, so it must not be reported as
    -- waiting; it simply has no deadline to count down to, and the client
    -- renders a LIVE pill with no remaining-time figure rather than a fake one.
    when g.event_ends_at is null then 'live'
    when now() >= g.event_ends_at - interval '5 minutes' then 'ending_soon'
    else 'live'
  end
  from (select 1) seed
  left join public.study_groups g on g.id = p_group;
$$;


-- ---------------------------------------------------------------------------
-- 4. The clock starts on ACTIVATION — via a trigger, not five patched functions
-- ---------------------------------------------------------------------------
-- WHY A TRIGGER: the waiting -> active transition happens in at least five
-- separate places (community_anonymous_join, community_anonymous_leave,
-- community_anonymous_grant_membership, community_anonymous_redeem_gift, and
-- the community_cleanup watchdog). Patching each one is five chances to miss
-- one, and a sixth activation path added next year would silently start an event
-- with no clock. A BEFORE UPDATE trigger sees every path at once, runs inside
-- the same transaction as the UPDATE, and cannot be forgotten.
--
-- IDEMPOTENCE: the guard is `event_started_at is null`. A retry, a concurrent
-- join, or a re-entrant call therefore CANNOT reset or extend the clock. This
-- is the property that makes "refreshing does not restart the event" true by
-- construction.
--
-- ONE EVENT PER ROOM ROW. Because the guard is `event_started_at is null`, a row
-- that has already run an event can never start a second one, even if it is
-- later reopened. A new event means a new room — which is exactly the shape of
-- the existing "create the next room" pathway, and it is why an ended room's
-- history can never be silently overwritten by a fresh clock.
--
-- The user chose: the timer starts when the room is ACTIVATED. A room still
-- gathering members has no clock and must show an honest waiting state instead.
create or replace function public._anon_event_on_activate()
returns trigger
language plpgsql
as $$
begin
  if new.group_state = 'active'
     and (tg_op = 'INSERT' or old.group_state is distinct from 'active')
     and new.event_started_at is null then
    new.event_started_at := now();
    new.event_ends_at    := now() + make_interval(mins => coalesce(new.event_duration_minutes, 60));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_anon_event_activate on public.study_groups;
create trigger trg_anon_event_activate
  before insert or update on public.study_groups
  for each row execute function public._anon_event_on_activate();


-- ---------------------------------------------------------------------------
-- 4b. Once an event has run, its window is IMMUTABLE
-- ---------------------------------------------------------------------------
-- THIS CLOSES A REAL HOLE, and it was found by probing rather than by reading.
--
-- study_groups_event_window_check only asserts event_ends_at =
-- event_started_at + duration. That keeps the window internally CONSISTENT, but
-- it says nothing about the window being MOVED: a statement that shifts both
-- columns forward together satisfies the CHECK perfectly. Proven live before
-- this trigger existed —
--
--   update study_groups
--      set event_started_at = event_started_at + interval '10 minutes',
--          event_ends_at    = event_ends_at    + interval '10 minutes';
--   -> HTTP 201. ACCEPTED. A ten-minute extension, exactly what the product rule
--      forbids.
--
-- So the consistency CHECK is necessary but NOT sufficient, and the deadline
-- needs its own immutability guarantee.
--
-- CONFIGURATION IS STILL ALLOWED, and this is the point of the `old.event_started_at
-- is null` early return: while a room has never run an event, the deadline may
-- be written freely — that is how a duration of 40 or 60 gets chosen, and how
-- the e2e suite pre-configures an already-elapsed window instead of waiting 40
-- minutes for one. The moment a clock exists, it is frozen.
--
-- Moderator early close is unaffected: it writes event_ended_at, never the
-- window.
create or replace function public._anon_event_clock_lock()
returns trigger
language plpgsql
as $$
begin
  -- No clock has ever run on this row, so this is configuration, not an
  -- extension. Allow it.
  if old.event_started_at is null then
    return new;
  end if;

  if new.event_started_at is distinct from old.event_started_at
     or new.event_ends_at is distinct from old.event_ends_at then
    raise exception 'EVENT_CLOCK_IMMUTABLE'
      using errcode = 'P0001',
            hint = 'A live event''s start time and deadline cannot be moved once the event has started.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_anon_event_clock_lock on public.study_groups;
create trigger trg_anon_event_clock_lock
  before update on public.study_groups
  for each row execute function public._anon_event_clock_lock();


-- ---------------------------------------------------------------------------
-- 5. No new seat may be granted into an ended event
-- ---------------------------------------------------------------------------
-- WHY TRIGGERS AGAIN, INSTEAD OF PATCHING SIX RPCs: every seat-granting path
-- in this codebase funnels through an INSERT into one of two tables —
--   study_group_members  (member seats: join, paid grant, gift redeem)
--   anonymous_spectators (spectator seats: free spectate, paid spectate pass)
-- A BEFORE INSERT trigger therefore covers the community API, the Paystack
-- verify handler AND the payments webhook (which calls the RPCs directly and
-- would otherwise bypass any JS-level guard), plus any future path. That is
-- what stops the real-money bug: a gift code or spectator pass redeemed after
-- the deadline would otherwise charge real money for a seat in a closed room.
--
-- Rooms that never started (event_ends_at IS NULL) are untouched, so room
-- creation and the first-visitor path are unaffected.
create or replace function public._anon_event_seat_guard()
returns trigger
language plpgsql
as $$
declare
  v_group bigint;
begin
  -- Both guarded tables key on `group_id`: study_group_members (v4c) and
  -- anonymous_spectators (v29) are both (group_id, user_id) shaped.
  v_group := new.group_id;
  if public._anon_event_over(v_group) then
    raise exception 'EVENT_ENDED'
      using errcode = 'P0001',
            hint = 'This live event has closed. New seats cannot be granted.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_anon_event_member_seat on public.study_group_members;
create trigger trg_anon_event_member_seat
  before insert on public.study_group_members
  for each row execute function public._anon_event_seat_guard();

drop trigger if exists trg_anon_event_spectator_seat on public.anonymous_spectators;
create trigger trg_anon_event_spectator_seat
  before insert on public.anonymous_spectators
  for each row execute function public._anon_event_seat_guard();


-- ---------------------------------------------------------------------------
-- 6. community_anonymous_event_end — exactly-once closure, for the audit trail
-- ---------------------------------------------------------------------------
-- The predicate already refuses writes at the deadline whether or not this has
-- ever run. This exists to RECORD that the event ended and why, so the ending
-- screen can show a real end time and so bulk cleanup has something to query.
--
-- Advisory-locked on the group so two concurrent end requests serialise, and
-- guarded on `event_ended_at is null` so the second one is a no-op that reports
-- `already_ended` instead of moving the recorded time.
--
-- The `reason` is validated against the same closed vocabulary as the CHECK, so
-- a caller cannot invent a new reason string.
create or replace function public.community_anonymous_event_end(
  p_group bigint,
  p_reason text default 'deadline'
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
begin
  if p_reason is null or p_reason not in ('deadline', 'moderator', 'admin', 'operational') then
    return jsonb_build_object('ok', false, 'code', 'BAD_REASON');
  end if;

  perform pg_advisory_xact_lock(hashtext('anon_event:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null or v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;

  if v_gr.event_ended_at is not null then
    return jsonb_build_object(
      'ok', true, 'already_ended', true,
      'ended_at', v_gr.event_ended_at,
      'reason', v_gr.event_ended_reason,
      'state', public._anon_event_state(p_group)
    );
  end if;

  update public.study_groups
     set event_ended_at = now(),
         event_ended_reason = p_reason
   where id = p_group;

  return jsonb_build_object(
    'ok', true, 'already_ended', false,
    'ended_at', now(),
    'ends_at', v_gr.event_ends_at,
    'state', public._anon_event_state(p_group)
  );
end;
$$;

-- A bulk sweep for the cleanup endpoint. Iterates every anonymous room that has
-- a deadline in the past and has not been recorded as ended. Advisory-locked
-- per room by community_anonymous_event_end itself.
create or replace function public.community_anonymous_event_sweep(
  p_now timestamptz default null
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_row record;
  v_res jsonb;
  v_cut timestamptz := coalesce(p_now, now());
  v_ended integer := 0;
  v_list jsonb := '[]'::jsonb;
begin
  for v_row in
    select g.id
      from public.study_groups g
     where g.type = 'anonymous'
       and g.event_ended_at is null
       and g.event_ends_at is not null
       and g.event_ends_at <= v_cut
     order by g.id
     limit 500
  loop
    -- community_anonymous_event_end returns jsonb, NOT a boolean. Testing it
    -- directly as an IF condition is a 22P02 ("invalid input syntax for type
    -- boolean") and takes the whole sweep down — caught by probing, not by
    -- reading. Read the `ok` field instead.
    v_res := public.community_anonymous_event_end(v_row.id, 'deadline');
    if coalesce((v_res ->> 'ok')::boolean, false) then
      v_ended := v_ended + 1;
      v_list := v_list || jsonb_build_object('group', v_row.id);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'events_ended', v_ended, 'ended', v_list);
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. The membership watchdog is suspended while an event is live
-- ---------------------------------------------------------------------------
-- WHY: the watchdog releases seats idle for 15 minutes and wipes the room below
-- 5 members. Both are correct behaviour for an open-ended room and fatal for a
-- 40-minute event — a mostly-idle room would shed seats at 15 minutes and wipe
-- itself long before reaching the minimum intended duration. The operator chose
-- to suspend it for the live window rather than change the thresholds.
--
-- WHAT IS NOT SUSPENDED, and this is the important part:
--   * membership_touch still stamps activity — the count stays honest
--   * presence still runs — online/offline is unaffected
--   * members can still LEAVE voluntarily, and the host can still hard-close
--   * the wipe still fires the moment the event is over (the branch below only
--     skips while the event is genuinely live)
-- The cost, stated plainly: during a live event the room is not wiped by member
-- count. The moderator early-close path (community_anonymous_event_end with
-- reason 'moderator') is the mitigation, and the ending screen is the visible
-- surface for it.
create or replace function public.community_membership_reconcile(
  p_group bigint,
  p_deadline integer default null,
  p_warning integer default null
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_cfg jsonb;
  v_deadline integer;
  v_warning integer;
  v_released integer := 0;
  v_warned jsonb := '[]'::jsonb;
  v_count bigint;
  v_wipe boolean := false;
  v_event_live boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('community:membership:' || p_group::text));

  v_cfg := coalesce(public.server_config_get('anonymous_membership'), '{}'::jsonb);
  v_deadline := coalesce(p_deadline, (v_cfg->>'activity_deadline_seconds')::int, 900);
  v_warning := coalesce(p_warning, (v_cfg->>'warning_seconds')::int, 600);

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null or v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;

  -- True only while a clock is genuinely running and has not passed. An event
  -- that never started (waiting room) leaves this false and behaves exactly as
  -- v51 left it.
  v_event_live := v_gr.event_started_at is not null
                  and v_gr.event_ended_at is null
                  and v_gr.event_ends_at is not null
                  and now() < v_gr.event_ends_at;

  if v_gr.group_state = 'active' and v_event_live then
    -- Live event: report the count, touch nothing. No idle release, no wipe.
    v_count := public.community_member_count(p_group);
  elsif v_gr.group_state = 'active' then
    -- Members due a warning (idle >= warning seconds, still within the deadline).
    select coalesce(jsonb_agg(distinct m.user_id), '[]'::jsonb) into v_warned
      from public.study_group_members m
     where m.group_id = p_group
       and coalesce(m.role, 'member') <> 'owner'
       and m.last_activity_at <= now() - make_interval(secs => v_warning)
       and m.last_activity_at > now() - make_interval(secs => v_deadline)
       and (m.warning_sent_at is null or m.warning_sent_at < m.last_activity_at);

    -- Stamp the warning so it is delivered once per idle streak.
    update public.study_group_members m
       set warning_sent_at = now()
     where m.group_id = p_group
       and coalesce(m.role, 'member') <> 'owner'
       and m.last_activity_at <= now() - make_interval(secs => v_warning)
       and m.last_activity_at > now() - make_interval(secs => v_deadline)
       and (m.warning_sent_at is null or m.warning_sent_at < m.last_activity_at);

    -- Members idle past the deadline lose their seat (owner exempt).
    with dropped as (
      delete from public.study_group_members m
       where m.group_id = p_group
         and coalesce(m.role, 'member') <> 'owner'
         and m.last_activity_at <= now() - make_interval(secs => v_deadline)
      returning 1
    )
    select count(*) into v_released from dropped;

    v_count := public.community_member_count(p_group);
    if v_count < v_gr.minimum_members_to_remain_active then
      perform public.community_anonymous_wipe(p_group);
      v_wipe := true;
    end if;
  elsif v_gr.group_state = 'waiting' then
    -- v51 behaviour, unchanged: a waiting room sheds offline members but has
    -- no wipe watchdog.
    with dropped as (
      delete from public.study_group_members m
       where m.group_id = p_group
         and coalesce(m.role, 'member') <> 'owner'
         and m.last_activity_at <= now() - make_interval(secs => v_deadline)
      returning 1
    )
    select count(*) into v_released from dropped;

    v_count := public.community_member_count(p_group);
  else
    -- wiped / anything else: nothing to release, just report the live count.
    v_count := public.community_member_count(p_group);
  end if;

  return jsonb_build_object(
    'ok', true,
    'member_count', v_count,
    'released', v_released,
    'warned', v_warned,
    'wipe', v_wipe,
    'event_live', v_event_live
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
-- THE LIVE GRANT GOTCHA: this project's DEFAULT PRIVILEGES auto-grant
-- anon+authenticated EXECUTE on every new function in schema public, so a bare
-- `revoke ... from public` leaves those explicit grants in place and anon can
-- still call the function. Every revoke below therefore names public, anon AND
-- authenticated explicitly.
--
-- The three helpers (_anon_event_deadline / _anon_event_over / _anon_event_state)
-- are deliberately readable by anon: community_profiles and community_feed are
-- plain views granted to anon and they run with the CALLER's privileges, so a
-- public preview surface needs to be able to ask "is this event over?" without
-- a service-role round trip. They expose no roster, no messages and no identity —
-- only the room's own clock.

revoke execute on function public.community_anonymous_event_end(bigint, text)
  from public, anon, authenticated;
grant execute on function public.community_anonymous_event_end(bigint, text)
  to service_role;

revoke execute on function public.community_anonymous_event_sweep(timestamptz)
  from public, anon, authenticated;
grant execute on function public.community_anonymous_event_sweep(timestamptz)
  to service_role;

revoke execute on function public.community_membership_reconcile(bigint, integer, integer)
  from public, anon, authenticated;
grant execute on function public.community_membership_reconcile(bigint, integer, integer)
  to service_role;

revoke execute on function public._anon_event_deadline(bigint) from public, anon, authenticated;
grant execute on function public._anon_event_deadline(bigint) to anon, authenticated, service_role;

revoke execute on function public._anon_event_over(bigint) from public, anon, authenticated;
grant execute on function public._anon_event_over(bigint) to anon, authenticated, service_role;

revoke execute on function public._anon_event_state(bigint) from public, anon, authenticated;
grant execute on function public._anon_event_state(bigint) to anon, authenticated, service_role;

-- The trigger functions are only ever called BY a trigger. No grant.


-- ---------------------------------------------------------------------------
-- 9. Existing rooms
-- ---------------------------------------------------------------------------
-- Existing rooms are NOT retro-fitted with a clock. A room that is already
-- active started before this migration existed, and inventing a start time for
-- it would either expire it immediately or grant it a free hour. It gets a
-- duration of 60 so the CHECK holds, and its first re-activation (or a
-- moderator reopening it) stamps the clock through the trigger like any other.
--
-- The clamp makes this explicit and idempotent rather than relying on the
-- column default, which would not repair a row that had been written with an
-- out-of-range value by some other path.
update public.study_groups
   set event_duration_minutes = 60
 where type = 'anonymous'
   and (event_duration_minutes is null or event_duration_minutes < 40 or event_duration_minutes > 60);

notify pgrst, 'reload schema';

-- ===========================================================================
-- DONE. Re-run safe.
-- ===========================================================================
