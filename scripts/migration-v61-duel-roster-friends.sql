-- ============================================================
-- Apex Scholars Migration v61 - DUEL ROSTER + FRIEND FLAGS
-- Updates duel_roster to return is_friend/is_rival relative to caller
-- ============================================================

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
             'createdAt', dw.created_at,
             'is_friend', exists(
               select 1 from public.user_relationships r
               where r.status = 'accepted' and r.rel_type = 'friend'
                 and ((r.user_id = v_user and r.target_id = dw.user_id)
                   or (r.user_id = dw.user_id and r.target_id = v_user))
             ),
             'is_rival', exists(
               select 1 from public.user_relationships r
               where r.status = 'accepted' and r.rel_type = 'rival'
                 and ((r.user_id = v_user and r.target_id = dw.user_id)
                   or (r.user_id = dw.user_id and r.target_id = v_user))
             )
           ) as obj
    from public.duel_waiting dw
    join public.community_profiles cp on cp.id = dw.user_id
    join public.profiles p on p.id = dw.user_id
    where dw.user_id <> v_user
      and dw.mode = p_mode
      and dw.format = p_format
      and (p_stake = 0 or dw.stake = p_stake)
      and p.is_activated
      and exists (
        select 1 from public.subscriptions s
        where s.user_id = dw.user_id
          and s.status = 'active'
          and coalesce(s.expires_at, s.grace_until) > now()
      )
      and coalesce(p.smart_coins, 0) >= dw.stake
    order by dw.created_at asc
    limit 30
  ) r;

  return jsonb_build_object('ok', true, 'mode', p_mode, 'stake', p_stake,
                            'format', p_format, 'players', v_players);
end;
$$;

revoke all on function public.duel_roster(text, integer, text) from public, anon;
grant execute on function public.duel_roster(text, integer, text) to authenticated;

notify pgrst, 'reload schema';
