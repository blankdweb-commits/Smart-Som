-- ============================================================
-- migration-v90-arena-no-activity.sql
--
-- A challenge duel could reach the point where BOTH players had readied, the
-- shared 90-second clock had been assigned, and yet not one answer was ever
-- submitted - and there was no rule for how long that state was allowed to
-- last. The only backstop was 9.3 in _arena_sweep_core: a refund 120 seconds
-- after ready_at, via the 'no_show' reason.
--
-- 120 seconds of a 90-second match is not a fail-safe, it is a longer wait
-- than the match it is protecting. Two real people sitting in a duel that
-- neither of them is playing is indistinguishable, from the player's side,
-- from a hung app.
--
-- So: `no_activity_seconds = 30`, and a match in which neither player has
-- submitted a single answer by 30 seconds after both readied is voided and
-- BOTH stakes refunded.
--
-- ---------------------------------------------------------------------------
-- WHERE THE CLOCK STARTS, AND WHY IT IS NOT THE MATCH CLOCK
-- ---------------------------------------------------------------------------
-- The rule deliberately does NOT run against a match whose 90-second clock is
-- already open. Once the clock is running, a slow first answer is a slow
-- connection or a careful reader, and voiding it would punish exactly the
-- players a 90-second blitz is designed to reward. That case is already
-- covered by 9.1/9.2: a heartbeat gap of 10s marks a player disconnected and
-- a 15s grace past that forfeits or refunds.
--
-- The window this closes is the one nobody else covered: status='ready', the
-- clock assigned but not yet started (starts_at IS NULL), and zero answers.
-- That is precisely the state the broken challenge handoff left matches in.
--
-- ---------------------------------------------------------------------------
-- WHY A SEPARATE FUNCTION, NOT AN EDIT TO _arena_sweep_core
-- ---------------------------------------------------------------------------
-- _arena_sweep_core is the ~110-line v63/v64 body that v84 renamed in place.
-- Re-typing it to insert four lines risks silently dropping one of its refund
-- branches - the exact failure v84's header warns about. So this adds
-- _arena_no_activity_sweep() and calls it from _arena_sweep(), the thin v84
-- wrapper, which is a few lines and reviewable at a glance.
--
-- 'no_show' is reused as the resolve reason on purpose: it already means "both
-- refunded, nobody at fault" everywhere it appears - history rows, the duels
-- table and the client's post-match copy. Inventing a new reason would mean
-- teaching every one of those about a string none of them have seen.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v90-arena-no-activity.sql
-- ============================================================


-- ---------------------------------------------------------------------------
-- 1. THE RULES VALUE
-- ---------------------------------------------------------------------------
-- jsonb_set rather than `value || '...'`: it replaces the key if present and
-- adds it if absent, so this is idempotent AND does not have to restate the
-- other thirteen arena rules, which have been tuned across v63/v64/v84.

update public.server_config
   set value = jsonb_set(value, '{no_activity_seconds}', '30'::jsonb)
 where key = 'arena_rules'
   and (value ->> 'no_activity_seconds') is distinct from '30';

-- A missing arena_rules row would silently disable the whole rule, so make the
-- absence impossible rather than relying on the coalesce() defaults.
insert into public.server_config (key, value)
select 'arena_rules', jsonb_build_object('no_activity_seconds', 30)
where not exists (select 1 from public.server_config where key = 'arena_rules');


-- ---------------------------------------------------------------------------
-- 2. THE SWEEP
-- ---------------------------------------------------------------------------

create or replace function public._arena_no_activity_sweep()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_window int;
  v_voided int := 0;
  v_row record;
begin
  perform public._arena_claim_write();

  -- Deliberately tighter than no_show_seconds (120). This branch only fires
  -- when NOBODY has answered, which 9.3 also matches - 9.3 stays in place as
  -- the backstop for the pathological case where an answer exists but the
  -- clock still never opened.
  v_window := coalesce(
    (public._arena_rules() ->> 'no_activity_seconds')::int, 30);

  for v_row in
    select m.id
      from public.competitive_matches m
     where m.format = 'blitz'
       and m.status = 'ready'
       and m.starts_at is null          -- clock assigned but not opened
       and m.ready_at is not null       -- BOTH players are in
       and m.opponent_bot is null       -- never touch tutor practice
       and m.opponent_id is not null    -- two humans only
       and coalesce(m.stake, 0) > 0     -- practice is stake 0; never refundable
       and not exists (
             select 1 from public.competitive_match_answers a
              where a.match_id = m.id)  -- neither player has answered at all
       and now() > m.ready_at + make_interval(secs => v_window)
     limit 50
  loop
    perform public._arena_resolve(v_row.id, 'no_show', null, null, true);
    v_voided := v_voided + 1;
  end loop;

  return v_voided;
end;
$$;

revoke all on function public._arena_no_activity_sweep() from public, anon, authenticated;
grant execute on function public._arena_no_activity_sweep() to service_role;


-- ---------------------------------------------------------------------------
-- 3. CALL IT FROM THE SWEEP WRAPPER
-- ---------------------------------------------------------------------------
-- Same shape as v84's wrapper: claim, then the extra work, then the preserved
-- core. Every existing caller does `perform public._arena_sweep()` BY NAME, so
-- picking it up here costs no other edit anywhere in the codebase.

create or replace function public._arena_sweep()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_core jsonb;
  v_window int;
  v_expired int := 0;
  v_voided int := 0;
begin
  perform public._arena_claim_write();

  -- v90: nobody played. Runs BEFORE the core so the 30s answer wins over the
  -- core's 120s pass on the same row.
  v_voided := public._arena_no_activity_sweep();

  -- The v63/v64 behaviour, unchanged: heartbeat gaps, grace forfeits, no-show
  -- refunds, presence housekeeping.
  v_core := public._arena_sweep_core();

  -- v84: pending invites past their window.
  v_window := coalesce((public._arena_rules() ->> 'invite_expiry_seconds')::int, 600);
  update public.arena_invites
     set status = 'expired', responded_at = now()
   where status = 'pending'
     and created_at < now() - make_interval(secs => v_window);
  get diagnostics v_expired = row_count;

  return coalesce(v_core, '{}'::jsonb)
         || jsonb_build_object('invitesExpired', v_expired, 'noActivityVoided', v_voided);
end;
$$;

revoke all on function public._arena_sweep() from public, anon, authenticated;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
