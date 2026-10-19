-- ###########################################################################
-- migration-v96-scholar-search.sql
--
-- TWO PARTS, both about letting scholars see each other.
--
--   1. friend_search: the `limit 25` was a NO-OP. It sat AFTER an ungrouped
--      `jsonb_agg`, so it capped the RESULT SET (which is exactly one row,
--      because an aggregate with no GROUP BY always produces one) rather than
--      the number of profiles folded into it. Any authenticated caller that
--      passed a blank/NULL query therefore received EVERY activated profile
--      with its uuid, masked name and identity-name flag - the whole user
--      directory. Latent only because there are 8 activated accounts today.
--      Fix: cap inside a subquery so the LIMIT applies to profiles.
--
--   2. scholar_search: a new RPC that DOES include people you already relate
--      to. friend_search deliberately excludes them (it exists to help you add
--      someone new), which is why it could never be reused for "find this
--      person I already know". This one reports the relationship per row.
--
-- Both are SECURITY DEFINER with an explicit `revoke ... from anon`: this
-- project's default privileges auto-grant anon EXECUTE on new functions, so
-- `revoke ... from public` alone does NOT lock them.
--
-- Idempotent: every object is created-or-replaced / created-if-not-exists.
-- No rows are read, written or deleted by this migration.
-- ###########################################################################

-- ###########################################################################
-- 1. friend_search - move the cap inside the subquery
-- ###########################################################################

create or replace function public.friend_search(p_query text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'query', v_q,
    'results', coalesce((
      -- The candidate list is capped HERE, before the aggregate. Previously the
      -- limit sat on the outer aggregate query, where it limited one row and
      -- did nothing at all.
      select jsonb_agg(jsonb_build_object(
               'userId', s.id,
               'name', public._person_pair_name(v_user, s.id),
               'hasIdentityName', coalesce(nullif(btrim(s.identity_name), ''), '') <> ''
             ) order by lower(public._person_pair_name(v_user, s.id)))
        from (
          select p.id, p.identity_name
            from public.profiles p
           where p.id <> v_user
             and p.is_activated
             and (v_q is null
               or p.identity_name ilike '%' || v_q || '%'
               or p.full_name ilike '%' || v_q || '%'
               or substr(md5(p.id::text), 1, 6) ilike '%' || v_q || '%')
             and not exists (
               select 1 from public.user_relationships r
                where (r.user_id = v_user and r.target_id = p.id)
                   or (r.target_id = v_user and r.user_id = p.id))
             and not public._blocked_between(v_user, p.id)
           order by lower(coalesce(nullif(btrim(p.identity_name), ''), coalesce(p.full_name, '')))
           limit 25
        ) s
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.friend_search(text) from public, anon;
grant execute on function public.friend_search(text) to authenticated, service_role;


-- ###########################################################################
-- 2. scholar_search - find ANY scholar, including ones you already know
-- ###########################################################################
--
-- WHY THIS EXISTS. The Ranking tab could only page down a ranked list; there
-- was no way to look up a specific person. friend_search was the only search,
-- and it deliberately excludes anyone you already have a relationship with,
-- so it can find a stranger to add but NOT a friend you want to look up.
--
-- Privacy posture is identical to the rest of the social surface:
--   - names come from _person_pair_name, so a real name only appears once the
--     two of you have completed a duel together;
--   - blocked scholars are filtered out entirely (v89 behaviour);
--   - only activated accounts are returned;
--   - rank is included because it is already the leaderboard's primary,
--     world-visible output - it is not private data.
-- Wallet balances, score breakdowns, achievements and head-to-head are NOT
-- returned here; the profile sheet is the only surface for those, and it
-- applies its own visibility tiering (migration-v97).

create or replace function public.scholar_search(
  p_query text default null,
  p_limit int default 25
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit int := greatest(least(coalesce(p_limit, 25), 50), 1);
  v_out jsonb;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  -- _player_ranks() is materialised once rather than re-evaluated per result
  -- row.
  --
  -- Its output column is `rank`, NOT `r`. `r` is only the alias of the inner
  -- subquery inside its body; for a set-returning function Postgres names the
  -- result columns after the OUT parameters (proargnames = user_id, rank).
  -- Selecting `r` here raises `column "r" does not exist` and the whole RPC
  -- fails - which is what the first live run of e2e-relationships caught.
  with rk as materialized (
         select user_id, rank as rn from public._player_ranks()
       ),
       cand as (
         select p.id,
                p.identity_name,
                coalesce(nullif(btrim(p.identity_name), ''), coalesce(p.full_name, '')) as sort_name,
                case
                  when rel.status = 'accepted'      then rel.rel_type
                  when rel.status = 'pending' and rel.user_id = v_user then 'pending_out'
                  when rel.status = 'pending'       then 'pending_in'
                  else 'none'
                end as rel_status,
                rel.rel_type
           from public.profiles p
           -- One row per pair (v89 pair-unique index), but the caller may be on
           -- either side of it, so join both directions.
           left join public.user_relationships rel
                  on ((rel.user_id = v_user and rel.target_id = p.id)
                   or (rel.target_id = v_user and rel.user_id = p.id))
          where p.id <> v_user
            and p.is_activated
            and (v_q is null
              or p.identity_name ilike '%' || v_q || '%'
              or p.full_name ilike '%' || v_q || '%'
              or substr(md5(p.id::text), 1, 6) ilike '%' || v_q || '%')
            and not public._blocked_between(v_user, p.id)
          order by lower(coalesce(nullif(btrim(p.identity_name), ''), coalesce(p.full_name, '')))
          limit v_limit
       )
  select jsonb_build_object(
           'ok', true,
           'query', v_q,
           'results', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'userId', c.id,
                      'name', public._person_pair_name(v_user, c.id),
                      'hasIdentityName', coalesce(nullif(btrim(c.identity_name), ''), '') <> '',
                      'relStatus', c.rel_status,
                      'relType', c.rel_type,
                      'rank', rk.rn
                    ) order by lower(c.sort_name))
               from cand c
               left join rk on rk.user_id = c.id
           ), '[]'::jsonb)
         )
    into v_out;

  return v_out;
end;
$$;

revoke all on function public.scholar_search(text, int) from public, anon;
grant execute on function public.scholar_search(text, int) to authenticated, service_role;

-- PostgREST needs a fresh schema cache to see the new RPC.
notify pgrst, 'reload schema';