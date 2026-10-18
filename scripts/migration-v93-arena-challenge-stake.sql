-- ============================================================
-- migration-v93-arena-challenge-stake.sql
--
-- A one-line inconsistency in the arena, with a misleading consequence.
--
-- THE BUG. `arena_challenge_targets` computed the stake it advertised as
--
--     select min((t::int)::int) from jsonb_array_elements_text(
--              coalesce(_arena_rules() -> 'stakes', '[2]')) t
--
-- and arena_rules.stakes is [1, 2, 5, 10, 20], so `min` is 1. The arena's
-- actual format is a FIXED 2 SC stake - `arena_rules.stake_fixed` is 2,
-- `arena_invite`'s own default parameter is 2, and every piece of client copy
-- says "2 SC". So the server told the client "the stake is 1", the client
-- ignored it and sent 2, and 2 was escrowed.
--
-- WHY IT MATTERED. `stake` is not decorative in that function: it is the
-- affordability threshold, twice.
--
--   * `canChallenge`  -> f.coins >= v_stake   (may this opponent afford it?)
--   * `callerBlocked` -> v_me_coins < v_stake  (may I afford it at all?)
--
-- With v_stake = 1, a scholar holding 1 SC was told they COULD challenge,
-- and then arena_invite escrowed 2 - a coin balance the server had just
-- certified as sufficient. The refusal only arrived at the moment the coins
-- were about to move, which is the worst possible moment.
--
-- WHY A NEW MIGRATION AND NOT AN EDIT TO v89. v89 is ALREADY APPLIED. Editing
-- an applied migration file rewrites the record of what that migration did,
-- and the project's own precedent (v28) is to correct a migration in place
-- ONLY when it was never applied. This is a follow-up, so it gets its own
-- numbered file.
--
-- THE FIX. Read `stake_fixed` - the authoritative number - and fall back to
-- min(stakes) only if it is missing, then to 2. The fallback order matters:
-- stake_fixed first, because it is the declared format, and min(stakes) only
-- as a last resort for a rules blob that has not been migrated.
--
-- NOT CHANGED HERE: `arena_invite` still accepts any stake in `stakes`, so a
-- client can still request 1, 5, 10 or 20 SC. That is a separate decision
-- about the payment path and was explicitly left alone - this migration only
-- makes the server REPORT the stake it is actually running.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v93-arena-challenge-stake.sql
-- ============================================================

create or replace function public.arena_challenge_targets(
  p_limit  integer default 100,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_stake int := coalesce(
    -- THE FIX. stake_fixed is the declared format of the arena and is what
    -- arena_invite defaults to and what every client copy already prints.
    nullif(public._arena_rules() ->> 'stake_fixed', '')::int,
    -- Only if stake_fixed is absent: the smallest allowed stake.
    (select min((t::int)::int)
       from jsonb_array_elements_text(
              coalesce(public._arena_rules() -> 'stakes', '[2]'::jsonb)) t
      where (t::text) ~ '^\s*\d+\s*$'),
    2);
  v_me_coins int := 0;
  v_me_activated boolean := false;
  v_me_busy boolean := false;
  v_limit int := greatest(least(coalesce(p_limit, 100), 500), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select coalesce(p.smart_coins, 0), coalesce(p.is_activated, false)
    into v_me_coins, v_me_activated
    from public.profiles p where p.id = v_me;
  v_me_busy := (public._arena_in_active_match(v_me) is not null);

  select count(*) into v_total from public.v_competitive_base;

  with ranked as (
    -- Byte-identical ordering to get_player_leaderboard (v74), so a target row
    -- can be merged onto its leaderboard row by userId without a second sort.
    select v.user_id,
           row_number() over (
             order by (v.parts ->> 'score')::int desc,
                      (v.parts ->> 'threeVThreeWins')::int desc,
                      (v.parts ->> 'oneVOneWins')::int desc,
                      (v.parts ->> 'wins')::int desc,
                      v.sc_balance desc,
                      v.user_id asc
           )::int as rank
      from public.v_competitive_base v
  ),
  scoped as (
    select r.user_id, r.rank
      from ranked r
     where r.user_id <> v_me          -- never list or allow challenging yourself
     order by r.rank asc
     limit v_limit offset v_offset
  ),
  facts as (
    select s.user_id, s.rank,
           coalesce(pb.is_activated, false) as activated,
           coalesce(pb.smart_coins, 0) as coins
      from scoped s
      left join public.profiles pb on pb.id = s.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'rank', f.rank,
           'userId', f.user_id,
           'name', public._person_pair_name(v_me, f.user_id),
           'inMatch', x.busy,
           -- Caller-side refusals: if any of these is set, NOTHING in the list
           -- can be challenged, so the client disables the tab rather than
           -- rendering live-looking buttons that the server will refuse.
           'callerBlocked', case
                              when not v_me_activated then 'NOT_ACTIVATED'
                              when v_me_busy then 'ALREADY_IN_MATCH'
                              when v_me_coins < v_stake then 'INSUFFICIENT_SC'
                              else null end,
           'canChallenge', f.activated
                              and f.coins >= v_stake
                              and not x.busy
                              and not x.open_pair
                              and not x.blocked,
           'reason', case
                       when x.blocked then 'BLOCKED'
                       when not f.activated then 'OPPONENT_NOT_ACTIVATED'
                       when x.busy then 'OPPONENT_BUSY'
                       when f.coins < v_stake then 'OPPONENT_INSUFFICIENT_SC'
                       when x.open_pair then 'INVITE_ALREADY_OPEN'
                       else null end
         ) order by f.rank asc), '[]'::jsonb)
    into v_rows
    from facts f
    cross join lateral (
      select (public._arena_in_active_match(f.user_id) is not null) as busy,
             exists (
               select 1 from public.arena_invites i
                where i.status = 'pending'
                  and ((i.from_user = v_me and i.to_user = f.user_id)
                    or (i.to_user = v_me and i.from_user = f.user_id))
             ) as open_pair,
             public._blocked_between(v_me, f.user_id) as blocked
    ) x;

  return jsonb_build_object(
    'ok', true,
    'stake', v_stake,
    'totalPlayers', v_total,
    'players', v_rows
  );
end;
$$;

revoke all on function public.arena_challenge_targets(integer, integer) from public, anon;
grant execute on function public.arena_challenge_targets(integer, integer) to authenticated, service_role;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
