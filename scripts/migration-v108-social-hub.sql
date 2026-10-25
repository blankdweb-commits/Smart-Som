-- ============================================================
-- migration-v108-social-hub.sql
--
-- The five-tab social hub needs three things the database did not have:
--
--   1. Friend-only Smart Coin requests (recipient pays on accept).
--   2. A report queue with a real admin resolution surface.
--   3. Activity events that describe what friends actually did, rather than
--      only the achievements they unlocked.
--
-- Everything here is server-authoritative. Balances move only through
-- public._sc_apply(), reports are written only through an RPC, and the feed
-- is assembled server-side so a client can never enumerate a blocked scholar
-- or a non-friend.
--
-- Idempotent and forward-only. Requires v31 (_sc_apply), v89 (relationships,
-- blocks), v91 (profile privacy/activity), v94 (notification reader) and v97
-- (profile visibility).
-- Apply: node scripts/run-migration.mjs scripts/migration-v108-social-hub.sql
-- ============================================================


-- ###########################################################################
-- 1. SC REQUESTS
-- ###########################################################################

create table if not exists public.social_sc_requests (
  id               uuid primary key default gen_random_uuid(),
  requester_id     uuid not null references auth.users(id) on delete cascade,
  recipient_id     uuid not null references auth.users(id) on delete cascade,
  amount           integer not null check (amount between 1 and 10),
  note             text,
  status           text not null default 'pending'
                     check (status in ('pending','accepted','declined','cancelled','expired')),
  client_request_id uuid not null default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  responded_at     timestamptz,
  expires_at       timestamptz not null default (now() + interval '72 hours'),
  charge_ledger_id bigint,
  credit_ledger_id bigint,
  constraint social_sc_requests_no_self check (requester_id <> recipient_id),
  constraint social_sc_requests_client_key unique (requester_id, client_request_id)
);

create index if not exists idx_social_sc_requests_incoming
  on public.social_sc_requests (recipient_id, status, created_at desc);
create index if not exists idx_social_sc_requests_outgoing
  on public.social_sc_requests (requester_id, status, created_at desc);
create index if not exists idx_social_sc_requests_expiry
  on public.social_sc_requests (expires_at) where status = 'pending';

alter table public.social_sc_requests enable row level security;
revoke all on public.social_sc_requests from public, anon, authenticated;
-- No policies: every read and write goes through the RPCs below. A per-row
-- policy would still let one party enumerate attempts the other party made.


create or replace function public._social_pair_accepted(p_a uuid, p_b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
      from public.user_relationships r
     where r.status = 'accepted'
       and ((r.user_id = p_a and r.target_id = p_b)
         or (r.user_id = p_b and r.target_id = p_a))
  );
$$;

revoke all on function public._social_pair_accepted(uuid, uuid) from public, anon, authenticated;
grant execute on function public._social_pair_accepted(uuid, uuid) to service_role;


create or replace function public._social_sweep_sc_requests(p_user uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_count integer;
begin
  if p_user is null then return 0; end if;

  update public.social_sc_requests
     set status = 'expired',
         responded_at = coalesce(responded_at, now())
   where status = 'pending'
     and expires_at <= now()
     and (requester_id = p_user or recipient_id = p_user);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public._social_sweep_sc_requests(uuid) from public, anon, authenticated;
grant execute on function public._social_sweep_sc_requests(uuid) to service_role;


create or replace function public.social_sc_request(
  p_recipient uuid,
  p_amount integer,
  p_note text default null,
  p_client_request_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_amount integer := coalesce(p_amount, 0);
  v_id uuid;
  v_sent_today int;
  v_received_today int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_recipient is null or p_recipient = v_me then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  if v_amount < 1 or v_amount > 10 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount', 'min', 1, 'max', 10);
  end if;
  if public._blocked_between(v_me, p_recipient) then
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  if not public._social_pair_accepted(v_me, p_recipient) then
    return jsonb_build_object('ok', false, 'error', 'not_friends');
  end if;

  perform pg_advisory_xact_lock(hashtext('sc_request:' || least(v_me, p_recipient)::text || '>' || greatest(v_me, p_recipient)::text));
  perform public._social_sweep_sc_requests(v_me);

  if exists (
    select 1 from public.social_sc_requests q
     where q.status = 'pending'
       and ((q.requester_id = v_me and q.recipient_id = p_recipient)
         or (q.requester_id = p_recipient and q.recipient_id = v_me))
       and q.created_at > now() - interval '60 seconds'
  ) then
    return jsonb_build_object('ok', false, 'error', 'cooldown');
  end if;

  select count(*) into v_sent_today
    from public.social_sc_requests q
   where q.requester_id = v_me and q.created_at > now() - interval '24 hours';
  if v_sent_today >= 3 then
    return jsonb_build_object('ok', false, 'error', 'sent_limit', 'limit', 3);
  end if;

  select count(*) into v_received_today
    from public.social_sc_requests q
   where q.recipient_id = p_recipient and q.created_at > now() - interval '24 hours';
  if v_received_today >= 30 then
    return jsonb_build_object('ok', false, 'error', 'received_limit', 'limit', 30);
  end if;

  insert into public.social_sc_requests
    (requester_id, recipient_id, amount, note, client_request_id)
  values
    (v_me, p_recipient, v_amount, nullif(left(coalesce(p_note, ''), 160), ''),
     coalesce(p_client_request_id, gen_random_uuid()))
  on conflict (requester_id, client_request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select q.id into v_id
      from public.social_sc_requests q
     where q.requester_id = v_me
       and q.client_request_id = coalesce(p_client_request_id, gen_random_uuid());
    return jsonb_build_object('ok', true, 'replay', true, 'requestId', v_id);
  end if;

  insert into public.notifications (user_id, kind, actor_id, payload)
  values (
    p_recipient,
    'sc_request',
    v_me,
    jsonb_build_object(
      'amount', v_amount,
      'requestId', v_id,
      'href', '/leaderboard?tab=requests',
      'title', 'Smart Coin request'
    )
  );

  return jsonb_build_object('ok', true, 'replay', false, 'requestId', v_id,
                            'amount', v_amount);
end;
$$;

revoke all on function public.social_sc_request(uuid, integer, text, uuid) from public, anon;
grant execute on function public.social_sc_request(uuid, integer, text, uuid) to authenticated, service_role;


create or replace function public.social_sc_request_respond(p_request_id uuid, p_accept boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_req public.social_sc_requests;
  v_debit jsonb;
  v_credit jsonb;
  v_charge_id bigint;
  v_credit_id bigint;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_request_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if p_accept is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_response');
  end if;

  perform public._social_sweep_sc_requests(v_me);

  select * into v_req
    from public.social_sc_requests q
   where q.id = p_request_id
     for update;

  if v_req.id is null or v_req.recipient_id <> v_me then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_req.status = 'accepted' and p_accept then
    return jsonb_build_object('ok', true, 'replay', true, 'status', 'accepted');
  end if;
  if v_req.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', v_req.status, 'status', v_req.status);
  end if;
  if v_req.expires_at <= now() then
    update public.social_sc_requests
       set status = 'expired', responded_at = now()
     where id = v_req.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if public._blocked_between(v_me, v_req.requester_id) then
    update public.social_sc_requests
       set status = 'declined', responded_at = now()
     where id = v_req.id;
    return jsonb_build_object('ok', false, 'error', 'blocked');
  end if;
  if not public._social_pair_accepted(v_me, v_req.requester_id) then
    update public.social_sc_requests
       set status = 'declined', responded_at = now()
     where id = v_req.id;
    return jsonb_build_object('ok', false, 'error', 'not_friends');
  end if;

  if not p_accept then
    update public.social_sc_requests
       set status = 'declined', responded_at = now()
     where id = v_req.id;
    insert into public.notifications (user_id, kind, actor_id, payload)
    values (v_req.requester_id, 'sc_request_declined', v_me,
            jsonb_build_object('amount', v_req.amount, 'requestId', v_req.id,
                               'href', '/leaderboard?tab=requests'));
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;

  v_debit := public._sc_apply(
    v_me, -v_req.amount, 'social_sc_request', 'social', 'transfer',
    'social_sc_request', v_req.id::text,
    jsonb_build_object('role', 'recipient', 'request_id', v_req.id),
    gen_random_uuid()
  );
  if v_debit is null or (v_debit->>'ok')::boolean is not true then
    return jsonb_build_object('ok', false, 'error', 'insufficient_funds',
                              'balance', coalesce((v_debit->>'balanceAfter')::int, null));
  end if;

  v_credit := public._sc_apply(
    v_req.requester_id, v_req.amount, 'social_sc_request', 'social', 'transfer',
    'social_sc_request', v_req.id::text,
    jsonb_build_object('role', 'requester', 'request_id', v_req.id),
    gen_random_uuid()
  );
  if v_credit is null or (v_credit->>'ok')::boolean is not true then
    raise exception 'social_sc_request credit failed for %', v_req.id;
  end if;

  v_charge_id := (v_debit->>'ledgerId')::bigint;
  v_credit_id := (v_credit->>'ledgerId')::bigint;

  update public.social_sc_requests
     set status = 'accepted',
         responded_at = now(),
         charge_ledger_id = v_charge_id,
         credit_ledger_id = v_credit_id
   where id = v_req.id;

  insert into public.notifications (user_id, kind, actor_id, payload)
  values (v_req.requester_id, 'sc_request_accepted', v_me,
          jsonb_build_object('amount', v_req.amount, 'requestId', v_req.id,
                             'href', '/leaderboard?tab=requests'));

  return jsonb_build_object('ok', true, 'status', 'accepted',
                            'amount', v_req.amount,
                            'balanceAfter', (v_debit->>'balanceAfter')::int);
end;
$$;

revoke all on function public.social_sc_request_respond(uuid, boolean) from public, anon;
grant execute on function public.social_sc_request_respond(uuid, boolean) to authenticated, service_role;


create or replace function public.social_sc_request_cancel(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  update public.social_sc_requests
     set status = 'cancelled', responded_at = now()
   where id = p_request_id
     and requester_id = v_me
     and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end;
$$;

revoke all on function public.social_sc_request_cancel(uuid) from public, anon;
grant execute on function public.social_sc_request_cancel(uuid) to authenticated, service_role;


create or replace function public.social_sc_requests_list(
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(least(coalesce(p_limit, 40), 100), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_incoming jsonb;
  v_outgoing jsonb;
  v_history jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  perform public._social_sweep_sc_requests(v_me);

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_incoming
    from (
      select jsonb_build_object(
               'requestId', q.id,
               'userId', q.requester_id,
               'name', public._person_pair_name(v_me, q.requester_id),
               'amount', q.amount,
               'note', q.note,
               'status', q.status,
               'createdAt', q.created_at,
               'expiresAt', q.expires_at,
               'canRespond', true
             ) as row_obj,
             q.created_at
        from public.social_sc_requests q
       where q.recipient_id = v_me
         and q.status = 'pending'
         and q.expires_at > now()
         and not public._blocked_between(v_me, q.requester_id)
       limit v_limit offset v_offset
    ) s;

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_outgoing
    from (
      select jsonb_build_object(
               'requestId', q.id,
               'userId', q.recipient_id,
               'name', public._person_pair_name(v_me, q.recipient_id),
               'amount', q.amount,
               'note', q.note,
               'status', q.status,
               'createdAt', q.created_at,
               'expiresAt', q.expires_at,
               'canCancel', true
             ) as row_obj,
             q.created_at
        from public.social_sc_requests q
       where q.requester_id = v_me
         and q.status = 'pending'
         and q.expires_at > now()
       limit v_limit offset v_offset
    ) s;

  select coalesce(jsonb_agg(row_obj order by responded_at desc nulls last), '[]'::jsonb)
    into v_history
    from (
      select jsonb_build_object(
               'requestId', q.id,
               'userId', case when q.requester_id = v_me then q.recipient_id else q.requester_id end,
               'name', public._person_pair_name(v_me,
                         case when q.requester_id = v_me then q.recipient_id else q.requester_id end),
               'direction', case when q.requester_id = v_me then 'outgoing' else 'incoming' end,
               'amount', q.amount,
               'status', q.status,
               'createdAt', q.created_at,
               'respondedAt', q.responded_at
             ) as row_obj,
             q.responded_at
        from public.social_sc_requests q
       where q.status <> 'pending'
         and (q.requester_id = v_me or q.recipient_id = v_me)
       limit least(v_limit, 20) offset v_offset
    ) s;

  return jsonb_build_object(
    'ok', true,
    'incoming', v_incoming,
    'outgoing', v_outgoing,
    'history', v_history
  );
end;
$$;

revoke all on function public.social_sc_requests_list(integer, integer) from public, anon;
grant execute on function public.social_sc_requests_list(integer, integer) to authenticated, service_role;


-- ###########################################################################
-- 2. REPORTS
-- ###########################################################################

create table if not exists public.social_reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references auth.users(id) on delete cascade,
  reported_id    uuid not null references auth.users(id) on delete cascade,
  context_type   text not null default 'profile'
                   check (context_type in ('profile','community_post','community_reply','duel','other')),
  context_id     text,
  reason         text not null
                   check (reason in ('harassment','spam','cheating','impersonation','inappropriate','other')),
  details        text,
  status         text not null default 'open'
                   check (status in ('open','reviewing','resolved','dismissed')),
  resolution_note text,
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  constraint social_reports_no_self check (reporter_id <> reported_id)
);

create index if not exists idx_social_reports_queue
  on public.social_reports (status, created_at desc);
create index if not exists idx_social_reports_reported
  on public.social_reports (reported_id, created_at desc);

alter table public.social_reports enable row level security;
revoke all on public.social_reports from public, anon, authenticated;


create or replace function public.social_report_create(
  p_reported uuid,
  p_context_type text default 'profile',
  p_context_id text default null,
  p_reason text default 'other',
  p_details text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_context text := coalesce(nullif(btrim(p_context_type), ''), 'profile');
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'other');
  v_id uuid;
  v_today int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;
  if p_reported is null or p_reported = v_me then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  if v_context not in ('profile','community_post','community_reply','duel','other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_context');
  end if;
  if v_reason not in ('harassment','spam','cheating','impersonation','inappropriate','other') then
    return jsonb_build_object('ok', false, 'error', 'invalid_reason');
  end if;

  select count(*) into v_today
    from public.social_reports r
   where r.reporter_id = v_me and r.created_at > now() - interval '24 hours';
  if v_today >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited', 'limit', 10);
  end if;

  if exists (
    select 1 from public.social_reports r
     where r.reporter_id = v_me
       and r.reported_id = p_reported
       and r.status in ('open','reviewing')
       and coalesce(r.context_type, '') = v_context
       and coalesce(r.context_id, '') = coalesce(left(p_context_id, 160), '')
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_reported');
  end if;

  insert into public.social_reports
    (reporter_id, reported_id, context_type, context_id, reason, details)
  values
    (v_me, p_reported, v_context, nullif(left(coalesce(p_context_id, ''), 160), ''),
     v_reason, nullif(left(coalesce(p_details, ''), 500), ''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'reportId', v_id, 'status', 'open');
end;
$$;

revoke all on function public.social_report_create(uuid, text, text, text, text) from public, anon;
grant execute on function public.social_report_create(uuid, text, text, text, text) to authenticated, service_role;


create or replace function public.social_reports_admin_list(
  p_status text default 'open',
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_limit int := greatest(least(coalesce(p_limit, 50), 100), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_rows jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(jsonb_agg(row_obj order by created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id', r.id,
               'reporterId', r.reporter_id,
               'reporterName', coalesce(nullif(btrim(rp.identity_name), ''), rp.full_name,
                                        public._person_pair_name(auth.uid(), r.reporter_id)),
               'reportedId', r.reported_id,
               'reportedName', coalesce(nullif(btrim(tp.identity_name), ''), tp.full_name,
                                        public._person_pair_name(auth.uid(), r.reported_id)),
               'contextType', r.context_type,
               'contextId', r.context_id,
               'reason', r.reason,
               'details', r.details,
               'status', r.status,
               'resolutionNote', r.resolution_note,
               'createdAt', r.created_at,
               'reviewedAt', r.reviewed_at
             ) as row_obj,
             r.created_at
        from public.social_reports r
        left join public.profiles rp on rp.id = r.reporter_id
        left join public.profiles tp on tp.id = r.reported_id
       where v_status is null
          or (v_status = 'open' and r.status in ('open','reviewing'))
          or r.status = v_status
       order by r.created_at desc
       limit v_limit offset v_offset
    ) s;

  return jsonb_build_object('ok', true, 'reports', v_rows);
end;
$$;

revoke all on function public.social_reports_admin_list(text, integer, integer) from public, anon;
grant execute on function public.social_reports_admin_list(text, integer, integer) to authenticated, service_role;


create or replace function public.social_report_resolve(
  p_report_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_status not in ('reviewing','resolved','dismissed') then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  update public.social_reports
     set status = p_status,
         resolution_note = nullif(left(coalesce(p_note, ''), 500), ''),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_report_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.social_report_resolve(uuid, text, text) from public, anon;
grant execute on function public.social_report_resolve(uuid, text, text) to authenticated, service_role;


-- ###########################################################################
-- 3. FRIEND SUGGESTIONS
-- ###########################################################################

create or replace function public.friend_suggestions(p_limit integer default 6)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(least(coalesce(p_limit, 6), 20), 1);
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  with my_friends as (
    select distinct case when r.user_id = v_me then r.target_id else r.user_id end as other
      from public.user_relationships r
     where r.status = 'accepted'
       and (r.user_id = v_me or r.target_id = v_me)
  ),
  candidates as (
    select case when r.user_id = f.other then r.target_id else r.user_id end as candidate,
           count(distinct f.other) as mutual
      from public.user_relationships r
      join my_friends f on f.other in (r.user_id, r.target_id)
     where r.status = 'accepted'
       and (r.user_id = f.other or r.target_id = f.other)
       and case when r.user_id = f.other then r.target_id else r.user_id end <> v_me
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'userId', c.candidate,
           'name', public._person_pair_name(v_me, c.candidate),
           'mutualCount', c.mutual,
           'online', coalesce(p.is_online, false),
           'lastSeenAt', p.last_seen_at,
           'smartCoins', coalesce(p.smart_coins, 0),
           'streak', coalesce(p.streak, 0)
         ) order by c.mutual desc, lower(public._person_pair_name(v_me, c.candidate))), '[]'::jsonb)
    into v_rows
    from candidates c
    join public.profiles p on p.id = c.candidate
   where p.is_activated
     and not public._blocked_between(v_me, c.candidate)
     and not exists (
       select 1 from public.user_relationships x
        where (x.user_id = v_me and x.target_id = c.candidate)
           or (x.target_id = v_me and x.user_id = c.candidate))
   limit v_limit;

  return jsonb_build_object('ok', true, 'suggestions', coalesce(v_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.friend_suggestions(integer) from public, anon;
grant execute on function public.friend_suggestions(integer) to authenticated, service_role;


-- ###########################################################################
-- 4. ACTIVITY EVENTS
-- ###########################################################################

create table if not exists public.social_activity_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null
                check (kind in ('study','duel_win','rank_up','streak')),
  title       text not null,
  detail      text,
  emoji       text,
  event_key   text not null,
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  constraint social_activity_events_key unique (user_id, event_key)
);

create index if not exists idx_social_activity_events_user
  on public.social_activity_events (user_id, occurred_at desc);
create index if not exists idx_social_activity_events_recent
  on public.social_activity_events (occurred_at desc);

alter table public.social_activity_events enable row level security;
revoke all on public.social_activity_events from public, anon, authenticated;


create or replace function public._social_activity_log(
  p_user uuid,
  p_kind text,
  p_title text,
  p_detail text,
  p_emoji text,
  p_event_key text,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null or p_event_key is null then return; end if;
  insert into public.social_activity_events
    (user_id, kind, title, detail, emoji, event_key, metadata, occurred_at)
  values
    (p_user, p_kind, left(coalesce(p_title, 'Activity'), 160),
     nullif(left(coalesce(p_detail, ''), 240), ''),
     nullif(left(coalesce(p_emoji, ''), 16), ''),
     p_event_key, coalesce(p_metadata, '{}'::jsonb), coalesce(p_occurred_at, now()))
  on conflict (user_id, event_key) do nothing;
end;
$$;

revoke all on function public._social_activity_log(uuid, text, text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public._social_activity_log(uuid, text, text, text, text, text, jsonb, timestamptz)
  to service_role;


create or replace function public.social_activity_on_quiz()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.passed then
    perform public._social_activity_log(
      new.user_id,
      'study',
      'Completed a study round',
      concat_ws(' - ',
        nullif(btrim(coalesce(new.subject, '')), ''),
        nullif(btrim(coalesce(new.difficulty, '')), ''),
        format('%s/%s', new.score, new.total)),
      '📚',
      'quiz:' || new.id::text,
      jsonb_build_object('quizId', new.id, 'subject', new.subject,
                         'difficulty', new.difficulty, 'score', new.score,
                         'total', new.total),
      new.created_at
    );
  end if;
  return new;
end;
$$;

revoke all on function public.social_activity_on_quiz() from public, anon, authenticated;

drop trigger if exists trg_social_activity_quiz on public.quiz_results;
create trigger trg_social_activity_quiz
  after insert on public.quiz_results
  for each row execute function public.social_activity_on_quiz();


create or replace function public.social_activity_on_match()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'completed'
     and new.winner_id is not null
     and (tg_op = 'INSERT' or old.status is distinct from 'completed'
          or old.winner_id is distinct from new.winner_id) then
    perform public._social_activity_log(
      new.winner_id,
      'duel_win',
      case when new.match_type = 'triple' then 'Won a 3v3 duel' else 'Won a 1v1 duel' end,
      format('%s SC stake', new.stake),
      '⚔️',
      'match-win:' || new.id::text,
      jsonb_build_object('matchId', new.id, 'matchType', new.match_type,
                         'stake', new.stake),
      coalesce(new.completed_at, now())
    );
  end if;
  return new;
end;
$$;

revoke all on function public.social_activity_on_match() from public, anon, authenticated;

drop trigger if exists trg_social_activity_match on public.competitive_matches;
create trigger trg_social_activity_match
  after insert or update of status, winner_id on public.competitive_matches
  for each row execute function public.social_activity_on_match();


create or replace function public.social_activity_on_streak()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.streak is not null and new.streak >= 3
     and new.streak > coalesce(old.streak, 0)
     and (new.streak in (3, 7, 14, 30, 50, 100) or mod(new.streak, 30) = 0) then
    perform public._social_activity_log(
      new.id,
      'streak',
      format('%s-day study streak', new.streak),
      'Consistency compounds.',
      '🔥',
      'streak:' || new.streak::text,
      jsonb_build_object('streak', new.streak),
      now()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.social_activity_on_streak() from public, anon, authenticated;

drop trigger if exists trg_social_activity_streak on public.profiles;
create trigger trg_social_activity_streak
  after update of streak on public.profiles
  for each row execute function public.social_activity_on_streak();


create or replace function public.social_activity_on_competitive_stats()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_rank int;
begin
  if coalesce(new.one_v_one_wins, 0) <= coalesce(old.one_v_one_wins, 0)
     and coalesce(new.three_v_three_wins, 0) <= coalesce(old.three_v_three_wins, 0) then
    return new;
  end if;

  select r.rank into v_rank
    from (
      select b.user_id,
             row_number() over (
               order by (b.parts ->> 'score')::int desc,
                        (b.parts ->> 'threeVThreeWins')::int desc,
                        (b.parts ->> 'oneVOneWins')::int desc,
                        (b.parts ->> 'wins')::int desc,
                        b.sc_balance desc,
                        b.user_id asc
             ) as rank
        from public.v_competitive_base b
    ) r
   where r.user_id = new.user_id;

  if v_rank is not null and v_rank <= 50 then
    perform public._social_activity_log(
      new.user_id,
      'rank_up',
      format('Reached global rank #%s', v_rank),
      'Climbed into the top 50.',
      '🏅',
      'rank:' || v_rank::text,
      jsonb_build_object('rank', v_rank),
      now()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.social_activity_on_competitive_stats() from public, anon, authenticated;

drop trigger if exists trg_social_activity_rank on public.competitive_stats;
create trigger trg_social_activity_rank
  after update of one_v_one_wins, three_v_three_wins on public.competitive_stats
  for each row execute function public.social_activity_on_competitive_stats();


create or replace function public.social_activity_feed(
  p_limit integer default 40,
  p_offset integer default 0
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_limit int := greatest(least(coalesce(p_limit, 40), 100), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  with counterparts as (
    select distinct case when r.user_id = v_me then r.target_id else r.user_id end as other
      from public.user_relationships r
     where r.status = 'accepted'
       and (r.user_id = v_me or r.target_id = v_me)
  )
  select coalesce(jsonb_agg(row_obj order by occurred_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id', e.id,
               'scope', case when e.user_id = v_me then 'you' else 'friend' end,
               'userId', e.user_id,
               'name', case when e.user_id = v_me
                            then public._person_name(v_me, 'pseudonym')
                            else public._person_pair_name(v_me, e.user_id) end,
               'kind', e.kind,
               'title', e.title,
               'detail', e.detail,
               'emoji', e.emoji,
               'metadata', e.metadata,
               'occurredAt', e.occurred_at
             ) as row_obj,
             e.occurred_at
        from public.social_activity_events e
       where (e.user_id = v_me or e.user_id in (select other from counterparts))
         and not public._blocked_between(v_me, e.user_id)
       order by e.occurred_at desc
       limit v_limit offset v_offset
    ) s;

  return jsonb_build_object('ok', true, 'activity', coalesce(v_rows, '[]'::jsonb));
end;
$$;

revoke all on function public.social_activity_feed(integer, integer) from public, anon;
grant execute on function public.social_activity_feed(integer, integer) to authenticated, service_role;


-- Backfill the last 30 days so a fresh deploy does not show an empty rail for
-- accounts that already have history. Event keys make this re-run safe.
insert into public.social_activity_events
  (user_id, kind, title, detail, emoji, event_key, metadata, occurred_at)
select q.user_id,
       'study',
       'Completed a study round',
       concat_ws(' - ',
         nullif(btrim(coalesce(q.subject, '')), ''),
         nullif(btrim(coalesce(q.difficulty, '')), ''),
         format('%s/%s', q.score, q.total)),
       '📚',
       'quiz:' || q.id::text,
       jsonb_build_object('quizId', q.id, 'subject', q.subject,
                          'difficulty', q.difficulty, 'score', q.score,
                          'total', q.total),
       q.created_at
  from public.quiz_results q
 where q.passed
   and q.created_at > now() - interval '30 days'
 order by q.created_at desc
 limit 500
on conflict (user_id, event_key) do nothing;

insert into public.social_activity_events
  (user_id, kind, title, detail, emoji, event_key, metadata, occurred_at)
select m.winner_id,
       'duel_win',
       case when m.match_type = 'triple' then 'Won a 3v3 duel' else 'Won a 1v1 duel' end,
       format('%s SC stake', m.stake),
       '⚔️',
       'match-win:' || m.id::text,
       jsonb_build_object('matchId', m.id, 'matchType', m.match_type,
                          'stake', m.stake),
       coalesce(m.completed_at, m.started_at, m.created_at)
  from public.competitive_matches m
 where m.status = 'completed'
   and m.winner_id is not null
   and coalesce(m.completed_at, m.started_at, m.created_at) > now() - interval '30 days'
 order by coalesce(m.completed_at, m.started_at, m.created_at) desc
 limit 500
on conflict (user_id, event_key) do nothing;

insert into public.social_activity_events
  (user_id, kind, title, detail, emoji, event_key, metadata, occurred_at)
select p.id,
       'streak',
       format('%s-day study streak', p.streak),
       'Consistency compounds.',
       '🔥',
       'streak:' || p.streak::text,
       jsonb_build_object('streak', p.streak),
       now()
  from public.profiles p
 where p.streak >= 3
on conflict (user_id, event_key) do nothing;


-- ###########################################################################
-- 5. FRIEND LIST - presence and lightweight card facts
-- ###########################################################################

create or replace function public.friend_list()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'friends', coalesce((
      select jsonb_agg(obj order by lower(name))
        from (
          select distinct on (other_user)
                 obj,
                 other_user, name, rel_type, responded_at
            from (
              select case when r.user_id = v_user then r.target_id else r.user_id end as other_user,
                     r.rel_type,
                     r.responded_at,
                     public._person_pair_name(v_user,
                       case when r.user_id = v_user then r.target_id else r.user_id end) as name,
                     jsonb_build_object(
                       'userId', case when r.user_id = v_user then r.target_id else r.user_id end,
                       'name', public._person_pair_name(v_user,
                         case when r.user_id = v_user then r.target_id else r.user_id end),
                       'relType', r.rel_type,
                       'since', r.responded_at,
                       'online', coalesce(p.is_online, false),
                       'lastSeenAt', p.last_seen_at,
                       'smartCoins', coalesce(p.smart_coins, 0),
                       'streak', coalesce(p.streak, 0)) as obj
                from public.user_relationships r
                left join public.profiles p
                  on p.id = case when r.user_id = v_user then r.target_id else r.user_id end
               where r.status = 'accepted'
                 and (r.user_id = v_user or r.target_id = v_user)
                 and not public._blocked_between(v_user,
                       case when r.user_id = v_user then r.target_id else r.user_id end)
            ) s
           order by other_user, (rel_type = 'friend') desc, responded_at desc nulls last
        ) t
    ), '[]'::jsonb),
    'incoming', coalesce((
      select jsonb_agg(obj order by created_at)
        from (
          select jsonb_build_object(
                   'requestId', i.id,
                   'userId', i.user_id,
                   'name', public._person_pair_name(v_user, i.user_id),
                   'relType', i.rel_type,
                   'createdAt', i.created_at) as obj,
                 i.created_at
            from public.user_relationships i
           where i.status = 'pending'
             and i.target_id = v_user
             and not public._blocked_between(v_user, i.user_id)
        ) t
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(obj order by created_at)
        from (
          select jsonb_build_object(
                   'requestId', i.id,
                   'userId', i.target_id,
                   'name', public._person_pair_name(v_user, i.target_id),
                   'relType', i.rel_type,
                   'createdAt', i.created_at) as obj,
                 i.created_at
            from public.user_relationships i
           where i.status = 'pending'
             and i.user_id = v_user
             and not public._blocked_between(v_user, i.target_id)
        ) t
    ), '[]'::jsonb),
    'blocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'userId', b.blocked_id,
               'name', public._person_pair_name(v_user, b.blocked_id)
             ) order by b.created_at desc)
        from public.user_blocks b
       where b.blocker_id = v_user
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.friend_list() from public, anon;
grant execute on function public.friend_list() to authenticated, service_role;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
