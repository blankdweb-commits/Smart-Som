-- ===========================================================================
-- scripts/migration-v100-premium-conversion.sql
--
-- Gives the Premium conversion system a real, server-authoritative basis:
--   * subscription_plans gains the pricing metadata the UI needs
--     (reference_price, sort_order, offer_eligible) — all ADDITIVE.
--   * server_config gains the ONE authoritative offer deadline.
--   * a narrow public read surface for that deadline (and nothing else).
--   * a conversion_events table for privacy-conscious funnel measurement.
--   * two admin RPCs to change pricing and the offer, both audited and both
--     validating their inputs server-side.
--
-- Apply:  node scripts/_apply-v43.mjs scripts/migration-v100-premium-conversion.sql
-- Re-run safe: every statement is guarded.
-- ===========================================================================
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- It does not invent a price. `reference_price` is populated only for the two
-- student plans, and only from prices that ALREADY EXIST in this table:
--
--     student-bonus-7   price 550.00   <- reference 1999.90  (the real Weekly)
--     student-bonus-30  price 990.00   <- reference 6999.00  (the real Monthly)
--
-- Those two pairings are the ones migration-v36's own header documented
-- ("student-bonus-30 : N990 / 30 days (vs N6,999 Monthly)"), so they are a
-- record of a decision already taken, not a number invented to flatter the
-- discount. The UPDATE below reads the reference value out of the target row
-- rather than writing a literal, and REFUSES to write a reference for any plan
-- that does not have a named counterpart — so a future plan cannot acquire a
-- fabricated "regular price" by accident.
--
-- The base Weekly / Monthly / Yearly plans get NO reference price. There is no
-- higher price to point at for them, and the requirement is that a struck-
-- through price be substantiable.
--
-- The offer ships DISABLED with NULL dates. No countdown renders anywhere until
-- an administrator sets a window. There is no default deadline anywhere in this
-- file, because inventing one is exactly what the product rule forbids.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. subscription_plans — pricing metadata (additive only)
-- ---------------------------------------------------------------------------
alter table public.subscription_plans
  add column if not exists reference_price numeric(12,2),
  add column if not exists sort_order integer not null default 100,
  add column if not exists offer_eligible boolean not null default false;

comment on column public.subscription_plans.reference_price is
  'A GENUINE, documented price this plan is discounted from. NULL means there is no substantiated reference and the UI must show no struck-through price. Never populate it with an invented figure.';
comment on column public.subscription_plans.sort_order is
  'Display order on the pricing page. Lower first. The annual plan sorts above the weekly plan deliberately (choice architecture, not a pricing claim).';
comment on column public.subscription_plans.offer_eligible is
  'TRUE only for plans that may be bought while server_config premium_offer is open. Checkout refuses these plans outside the window, so an expired offer genuinely removes the price instead of only hiding a banner.';

-- Guard rails. A discount is only renderable if the reference is genuinely
-- above the price; a negative price is not a price.
alter table public.subscription_plans drop constraint if exists subscription_plans_price_non_negative;
alter table public.subscription_plans add constraint subscription_plans_price_non_negative
  check (price >= 0);

alter table public.subscription_plans drop constraint if exists subscription_plans_reference_above_price;
alter table public.subscription_plans add constraint subscription_plans_reference_above_price
  check (reference_price is null or reference_price > price);

alter table public.subscription_plans drop constraint if exists subscription_plans_reference_non_negative;
alter table public.subscription_plans add constraint subscription_plans_reference_non_negative
  check (reference_price is null or reference_price >= 0);


-- ---------------------------------------------------------------------------
-- 2. THE REFERENCE PRICE — derived from live rows, never a literal
-- ---------------------------------------------------------------------------
-- The COALESCE picks the REAL seeded regular price by slug-matched name. If the
-- counterpart plan is ever renamed or removed, this resolves to NULL and the
-- row keeps no reference price — which is the correct failure direction: the
-- UI then shows a plain price with no strike-through rather than a fabricated
-- one.
update public.subscription_plans sp
   set reference_price = coalesce(
         (select w.price from public.subscription_plans w
           where lower(w.name) = 'weekly' and w.id <> sp.id
           order by w.id limit 1),
         (select w.price from public.subscription_plans w
           where lower(w.name) = 'monthly' and w.id <> sp.id
           order by w.id limit 1))
 where sp.slug = 'student-bonus-7'
   and (sp.reference_price is null or sp.reference_price = 0);

update public.subscription_plans sp
   set reference_price = coalesce(
         (select w.price from public.subscription_plans w
           where lower(w.name) = 'monthly' and w.id <> sp.id
           order by w.id limit 1),
         (select w.price from public.subscription_plans w
           where lower(w.name) = 'weekly' and w.id <> sp.id
           order by w.id limit 1))
 where sp.slug = 'student-bonus-30'
   and (sp.reference_price is null or sp.reference_price = 0);

-- SAFETY NET, and the reason this is a migration rather than a script: if the
-- derivation above produced a reference that is not above the price, clear it.
-- The CHECK above would refuse the UPDATE anyway, but a failed statement aborts
-- the whole apply on some runners — so this makes the file re-runnable.
update public.subscription_plans
   set reference_price = null
 where reference_price is not null
   and reference_price <= price;


-- ---------------------------------------------------------------------------
-- 3. Offer eligibility — only the student plans
-- ---------------------------------------------------------------------------
update public.subscription_plans set offer_eligible = true  where slug = 'student-bonus-7';
update public.subscription_plans set offer_eligible = true  where slug = 'student-bonus-30';
update public.subscription_plans set offer_eligible = false where slug is null;

-- Display order. The annual plan is first and the weekly plan second: that is
-- the requested choice architecture. The two student plans follow, ordered by
-- how long they last so the 30-day one reads above the 7-day one.
--
-- These assignments are keyed on the EXISTING plan names, not on ids, because
-- AppContext's FALLBACK_PLANS comment and AGENTS.md disagree about which id is
-- which (v36 inserted 30-days first, so id 4 is the 30-day plan). Matching on
-- name removes the ambiguity entirely.
update public.subscription_plans set sort_order = 1 where lower(name) = 'yearly';
update public.subscription_plans set sort_order = 2 where lower(name) = 'weekly';
update public.subscription_plans set sort_order = 3 where slug = 'student-bonus-30';
update public.subscription_plans set sort_order = 4 where slug = 'student-bonus-7';
update public.subscription_plans set sort_order = 100 where slug is null and sort_order = 100
  and lower(name) not in ('yearly', 'weekly');


-- ---------------------------------------------------------------------------
-- 4. THE OFFER WINDOW — one authoritative deadline, shipped INACTIVE
-- ---------------------------------------------------------------------------
-- `enabled` is the master switch. `starts_at` / `ends_at` are ABSOLUTE server
-- timestamps, which is what makes the countdown un-resettable: there is no
-- counter to rewind, no per-visitor state, and nothing a device clock, a
-- refresh, a cleared localStorage or a second device can influence.
insert into public.server_config (key, value, description)
values (
  'premium_offer',
  jsonb_build_object(
    'enabled', false,
    'starts_at', null,
    'ends_at', null,
    'headline', null,
    'subline', null,
    'eligibility_note', null
  ),
  'The one authoritative student-promotion window. Countdowns everywhere read these two timestamps. Shipped DISABLED with no dates on purpose: no deadline is invented until an administrator sets one.'
)
on conflict (key) do update
  set value = server_config.value || excluded.value,
      description = excluded.description,
      updated_at = now();


-- ---------------------------------------------------------------------------
-- 5. THE PUBLIC READ SURFACE — six fields, nothing else
-- ---------------------------------------------------------------------------
-- WHY A DEDICATED FUNCTION AND NOT server_config_get: that function is
-- service-role only, and widening it to `anon`/`authenticated` would expose the
-- arena rules, the loan shark thresholds, the economy switches and every other
-- operational knob in the same table. The pricing page needs a deadline and a
-- headline. This returns a deadline and a headline.
--
-- server_now travels WITH the payload so the client can measure its own clock
-- skew once instead of guessing — exactly the LiveEventBar technique, for the
-- same reason.
create or replace function public.premium_offer_public()
returns jsonb
language sql stable
security definer set search_path = public, pg_temp
as $$
  with cfg as (
    select coalesce(
      (select value from public.server_config where key = 'premium_offer'),
      '{}'::jsonb) as v
  )
  select jsonb_build_object(
    'enabled',      coalesce((v->>'enabled')::boolean, false),
    'starts_at',    nullif(v->>'starts_at', ''),
    'ends_at',      nullif(v->>'ends_at', ''),
    'headline',     nullif(v->>'headline', ''),
    'subline',      nullif(v->>'subline', ''),
    'eligibility_note', nullif(v->>'eligibility_note', ''),
    -- The effective state is computed here, on the server, from now(). A client
    -- cannot make an expired offer look active by editing its own clock, and a
    -- countdown that has passed simply reports `expired`.
    'state', case
      when coalesce((v->>'enabled')::boolean, false) = false then 'inactive'
      when nullif(v->>'starts_at', '') is null or nullif(v->>'ends_at', '') is null then 'inactive'
      when now() < (v->>'starts_at')::timestamptz then 'scheduled'
      when now() >= (v->>'ends_at')::timestamptz then 'expired'
      else 'active'
    end,
    'server_now',   now()
  )
  from cfg;
$$;

-- ---------------------------------------------------------------------------
-- 6. CONVERSION EVENTS — per-user, admin-readable, 180-day retention
-- ---------------------------------------------------------------------------
-- NO client policies at all, so a client cannot insert a row and so a client
-- cannot read the table; only the service role writes and admins read. The
-- shape is `admin_audit_log`'s, which is the one generic event table this
-- codebase has already proven.
--
-- metadata is jsonb and is written by a CLOSED ALLOWLIST of keys on the server
-- side (see api/feedback.js). It carries no email, no name, no payment
-- reference and no payment credential.
create table if not exists public.conversion_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversion_events_action on public.conversion_events (action, created_at desc);
create index if not exists idx_conversion_events_user on public.conversion_events (user_id, created_at desc);
create index if not exists idx_conversion_events_created on public.conversion_events (created_at desc);

alter table public.conversion_events enable row level security;

drop policy if exists "conversion_events_admin_read" on public.conversion_events;
create policy "conversion_events_admin_read"
  on public.conversion_events for select
  using (public.is_admin());

revoke all on public.conversion_events from public, anon;

-- A POLICY IS NOT A GRANT. Without this SELECT, the admin policy above is dead
-- code and every admin read fails with `permission denied for table
-- conversion_events` before RLS is consulted (proven live). Grant SELECT only —
-- the API writes through the service role, and no client INSERT/UPDATE/DELETE
-- privilege exists for any client role.
grant select on public.conversion_events to authenticated;

comment on table public.conversion_events is
  'Privacy-conscious conversion funnel: one row per event, per user, admin-readable only, 180-day retention. Never stores credentials, emails or payment references.';


-- Retention. Idempotent, bounded batches, service-role only. `p_days` defaults
-- to 180 because that is the retention the product decision names.
create or replace function public.conversion_events_prune(p_days integer default 180)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_days integer := greatest(1, coalesce(p_days, 180));
  v_deleted integer := 0;
  v_batch integer;
begin
  loop
    with doomed as (
      delete from public.conversion_events
       where id in (
         select id from public.conversion_events
          where created_at < now() - make_interval(days => v_days)
          order by id
          limit 1000
       )
      returning 1
    )
    select count(*) into v_batch from doomed;
    v_deleted := v_deleted + coalesce(v_batch, 0);
    exit when coalesce(v_batch, 0) = 0;
  end loop;
  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'retention_days', v_days);
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. ADMIN WRITE PATHS — validated, audited, and both refused by default
-- ---------------------------------------------------------------------------
-- Both follow admin_grant_marketplace_entitlement (v98): is_admin() FIRST,
-- refusal codes rather than exceptions for client-recoverable problems, and an
-- admin_audit_log row for every accepted change.
--
-- The validation is the point of this section. An administrator (or a crafted
-- client request) cannot set a negative price, cannot make a discount that
-- points the wrong way, cannot invent a reference price below the price, and
-- cannot switch on an offer whose window has already passed — which is what
-- would otherwise be a countdown to a deadline in the past.

-- 7a. pricing ----------------------------------------------------------------
create or replace function public.admin_set_plan_pricing(
  p_plan_id bigint,
  p_price numeric,
  p_reference_price numeric default null,
  p_is_active boolean default null,
  p_sort_order integer default null
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_plan record;
  v_me uuid := auth.uid();
  v_before jsonb;
  v_after jsonb;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  select * into v_plan from public.subscription_plans where id = p_plan_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- duration_days is NOT settable here on purpose. The billing interval is what
  -- a customer is agreeing to, and it is not a marketing knob.
  if p_price is null or p_price < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_PRICE',
      'message', 'Price must be zero or greater.');
  end if;
  if p_reference_price is not null and p_reference_price < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_REFERENCE_PRICE',
      'message', 'Reference price must be zero or greater.');
  end if;
  if p_reference_price is not null and p_reference_price <= p_price then
    return jsonb_build_object('ok', false, 'code', 'REFERENCE_NOT_ABOVE_PRICE',
      'message', 'A reference price must be higher than the price it is discounting, or it should be left empty.');
  end if;
  if p_sort_order is not null and p_sort_order < 0 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SORT_ORDER');
  end if;

  select jsonb_build_object('price', price, 'reference_price', reference_price,
                            'is_active', is_active, 'sort_order', sort_order)
    into v_before
    from public.subscription_plans where id = p_plan_id;

  update public.subscription_plans
     set price             = p_price,
         reference_price   = p_reference_price,
         is_active         = coalesce(p_is_active, is_active),
         sort_order        = coalesce(p_sort_order, sort_order)
   where id = p_plan_id;

  select jsonb_build_object('price', price, 'reference_price', reference_price,
                            'is_active', is_active, 'sort_order', sort_order)
    into v_after
    from public.subscription_plans where id = p_plan_id;

  insert into public.admin_audit_log (user_id, admin_id, action, metadata)
  values (p_plan_id, v_me, 'plan_pricing_change',
          jsonb_build_object('before', v_before, 'after', v_after));

  return jsonb_build_object('ok', true, 'plan_id', p_plan_id, 'after', v_after);
end;
$$;

-- 7b. the offer window --------------------------------------------------------
create or replace function public.admin_set_premium_offer(
  p_enabled boolean,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_headline text default null,
  p_subline text default null,
  p_eligibility_note text default null
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_before jsonb;
  v_state text;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_AUTHORIZED');
  end if;

  if p_enabled then
    if p_starts_at is null or p_ends_at is null then
      return jsonb_build_object('ok', false, 'code', 'MISSING_DATES',
        'message', 'An active offer needs both a start and an end.');
    end if;
    if p_ends_at <= p_starts_at then
      return jsonb_build_object('ok', false, 'code', 'END_BEFORE_START',
        'message', 'The offer must end after it starts.');
    end if;
    -- A window that has already elapsed is refused, because it is a countdown
    -- to a deadline in the past. This is the check that stops "expired offer
    -- still showing as live" from being reachable through configuration.
    if p_ends_at <= now() then
      return jsonb_build_object('ok', false, 'code', 'OFFER_ALREADY_ENDED',
        'message', 'That end time is in the past, so the offer would never be active.');
    end if;
  end if;

  select value into v_before from public.server_config where key = 'premium_offer';

  insert into public.server_config (key, value, description)
  values ('premium_offer',
    jsonb_build_object(
      'enabled', coalesce(p_enabled, false),
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'headline', nullif(trim(coalesce(p_headline, '')), ''),
      'subline', nullif(trim(coalesce(p_subline, '')), ''),
      'eligibility_note', nullif(trim(coalesce(p_eligibility_note, '')), '')
    ),
    'The one authoritative student-promotion window. Countdowns everywhere read these two timestamps.')
  on conflict (key) do update
    set value = excluded.value, description = excluded.description, updated_at = now();

  select public.premium_offer_public() ->> 'state' into v_state;

  insert into public.admin_audit_log (user_id, admin_id, action, metadata)
  values (coalesce(v_me, auth.uid()), v_me, 'premium_offer_change',
          jsonb_build_object('before', v_before, 'state_after', v_state));

  return jsonb_build_object('ok', true, 'state', v_state,
                           'offer', public.premium_offer_public());
end;
$$;


-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
-- THE LIVE GRANT GOTCHA: this project's DEFAULT PRIVILEGES auto-grant
-- anon+authenticated EXECUTE on every new function in schema public, so a bare
-- `revoke ... from public` leaves those explicit grants in place.
--
-- premium_offer_public is readable by anon deliberately: the pricing surface is
-- behind RequireAuth today, but the guest preview and the public Landing page
-- must not crash on a missing value, and six fields (a window, two strings, an
-- eligibility note and a server clock) leak nothing operational.
revoke execute on function public.premium_offer_public() from public, anon;
grant execute on function public.premium_offer_public() to anon, authenticated, service_role;

-- Admin writers: authenticated (they are gated by is_admin() inside), which is
-- the same grant the three existing admin RPCs use.
revoke execute on function public.admin_set_plan_pricing(bigint, numeric, numeric, boolean, integer)
  from public, anon;
grant execute on function public.admin_set_plan_pricing(bigint, numeric, numeric, boolean, integer)
  to authenticated, service_role;

revoke execute on function public.admin_set_premium_offer(boolean, timestamptz, timestamptz, text, text, text)
  from public, anon;
grant execute on function public.admin_set_premium_offer(boolean, timestamptz, timestamptz, text, text, text)
  to authenticated, service_role;

-- Retention runs from the service role only.
revoke execute on function public.conversion_events_prune(integer) from public, anon, authenticated;
grant execute on function public.conversion_events_prune(integer) to service_role;

notify pgrst, 'reload schema';

-- ===========================================================================
-- DONE. Re-run safe.
-- ===========================================================================
