-- ============================================================
-- Apex Scholars Migration v57 — ANONYMOUS GIFTING (P3)
--
-- Multi-slot purchases + single-slot gifting for Anonymous rooms:
--
--   1. BUNDLE PURCHASE. A buyer pays `count × member_price` in ONE
--      Paystack transaction for a room. `for_me` (0|1) seats go to
--      the buyer immediately (a normal paid membership). The rest
--      become GIFT seats.
--
--   2. GIFT SEATS. Each gifted slot produces ONE unique, shareable
--      code (ONE slot per gift code, room-scoped). Purchases NEVER
--      add capacity — a gift is usable (redeemable) only when the
--      room has a free seat (members + spectators < member_limit).
--      Redemption grants a normal paid member seat (tier `gift`).
--      A wiped room expires its unclaimed gifts.
--
--   3. ONLY the payment verifier/webhook (service_role) may create
--      gifts; only after a verified charge. Redemption is also a
--      service_role RPC driven by the app server (the claimant is
--      the `p_user` argument, verified from the session token).
--
-- Idempotent. Safe to re-run. Requires v56.
-- Apply: node scripts/_apply-v43.mjs scripts/migration-v57-anonymous-gifting.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. GIFT LEDGER (service-role only; no client RLS policies)
-- ------------------------------------------------------------
create table if not exists public.anonymous_membership_gifts (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.study_groups(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  code text not null unique,
  reference text not null,
  amount integer not null check (amount >= 0),
  status text not null default 'unclaimed',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by uuid,
  constraint anonymous_membership_gifts_status_check
    check (status in ('unclaimed', 'claimed', 'expired'))
);

create index if not exists idx_anon_gifts_buyer_status
  on public.anonymous_membership_gifts(buyer_id, status);
create index if not exists idx_anon_gifts_group_status
  on public.anonymous_membership_gifts(group_id, status);
create index if not exists idx_anon_gifts_reference
  on public.anonymous_membership_gifts(reference);

alter table public.anonymous_membership_gifts enable row level security;
revoke all on public.anonymous_membership_gifts from public, anon, authenticated;

-- A redeemed gift grants ONE normal paid member seat, recorded with the distinct
-- tier `gift` (auditable origin). Widen the v56 memberships tier check to allow it.
alter table public.anonymous_memberships drop constraint if exists anonymous_memberships_tier_check;
alter table public.anonymous_memberships
  add constraint anonymous_memberships_tier_check check (tier in ('free', 'paid', 'gift'));

-- ------------------------------------------------------------
-- 2. community_anonymous_create_gifts — issue `count` gift seats
--    for a verified payment. Returns the shareable codes.
-- ------------------------------------------------------------
create or replace function public.community_anonymous_create_gifts(
  p_group bigint,
  p_buyer uuid,
  p_count integer,
  p_reference text,
  p_amount integer
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_count integer;
  v_codes text[];
  v_code text;
  v_inserted boolean;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;
  if v_gr.group_state = 'wiped' or v_gr.is_active = false then
    return jsonb_build_object('ok', false, 'code', 'GROUP_WIPED');
  end if;

  v_count := least(greatest(coalesce(p_count, 1), 1), 50);
  v_codes := '{}';

  -- Replay-safe: ONE checkout = ONE batch. The same payment reference must
  -- never mint a second batch (verify re-runs + webhook replays both call
  -- this after their own guards). Claimed/expired rows still count.
  if exists (select 1 from public.anonymous_membership_gifts
              where reference = p_reference) then
    return jsonb_build_object('ok', true, 'count', 0, 'codes', '[]'::jsonb);
  end if;

  for i in 1..v_count loop
    -- Generate a unique 8-char code (no 0/O/I/L/1 — avoid user confusion when
    -- they type the code). Retry on the rare collision; a fresh random salt
    -- makes a loop spin.
    v_inserted := false;
    while not v_inserted loop
      v_code := upper(regexp_replace(
        substr(md5(now()::text || random()::text || p_reference || i::text), 1, 10),
        '[0OIL1]', 'X', 'g'));
      v_code := substr(v_code, 1, 8);
      begin
        insert into public.anonymous_membership_gifts
          (group_id, buyer_id, code, reference, amount, status)
        values (p_group, p_buyer, v_code, p_reference, greatest(coalesce(p_amount, 0), 0), 'unclaimed');
        v_inserted := true;
      exception when unique_violation then
        v_inserted := false;
      end;
    end loop;
    v_codes := v_codes || v_code;
  end loop;

  return jsonb_build_object('ok', true, 'count', array_length(v_codes, 1), 'codes', to_jsonb(v_codes));
end;
$$;

-- ------------------------------------------------------------
-- 3. community_anonymous_redeem_gift — claim ONE gift seat.
--    Capacity is checked at REDEMPTION time (purchases never add
--    capacity; an unusable gift stays unclaimed until a seat frees).
-- ------------------------------------------------------------
create or replace function public.community_anonymous_redeem_gift(
  p_group bigint,
  p_user uuid,
  p_code text
)
returns jsonb
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare
  v_gr record;
  v_gift record;
  v_count bigint;
  v_spec bigint;
  v_role text;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;
  if v_gr.type is distinct from 'anonymous' then
    return jsonb_build_object('ok', false, 'code', 'NOT_ANONYMOUS');
  end if;
  if v_gr.group_state = 'wiped' or v_gr.is_active = false then
    return jsonb_build_object('ok', false, 'code', 'GROUP_WIPED');
  end if;

  select * into v_gift from public.anonymous_membership_gifts
   where group_id = p_group and upper(trim(p_code)) = code
   for update;
  if v_gift is null then
    return jsonb_build_object('ok', false, 'code', 'INVALID_GIFT');
  end if;
  if v_gift.status = 'claimed' then
    return jsonb_build_object('ok', false, 'code', 'GIFT_ALREADY_CLAIMED');
  end if;
  if v_gift.status = 'expired' then
    return jsonb_build_object('ok', false, 'code', 'GIFT_EXPIRED');
  end if;

  if exists (select 1 from public.profiles pr where pr.id = p_user and pr.community_banned_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'BANNED');
  end if;

  v_role := public.community_role_for_group(p_user, p_group);
  if v_role in ('member', 'admin') then
    -- Already holds a seat in this room — do NOT consume the gift code.
    return jsonb_build_object('ok', false, 'code', 'ALREADY_MEMBER',
      'message', 'You already have a seat in this room.');
  end if;

  v_count := public.community_member_count(p_group);
  v_spec := public.community_spectator_count(p_group);
  if v_count + v_spec >= v_gr.member_limit then
    -- Purchases never add capacity: the gift must wait for a free seat.
    return jsonb_build_object('ok', false, 'code', 'GROUP_FULL',
      'message', 'This room is at capacity. This gift will be usable as soon as a seat frees up.',
      'member_count', v_count, 'spectator_count', v_spec, 'member_limit', v_gr.member_limit);
  end if;

  -- A gift redemption revokes any spectator seat the claimant holds.
  update public.anonymous_spectators
     set status = 'revoked', revoked_at = now()
   where group_id = p_group and user_id = p_user and status = 'active';

  insert into public.anonymous_memberships (group_id, user_id, reference, amount, tier, status)
  values (p_group, p_user, 'gift:' || v_gift.code, v_gift.amount, 'gift', 'active')
  on conflict (group_id, user_id) do nothing;

  insert into public.study_group_members (group_id, user_id, role)
  values (p_group, p_user, 'member')
  on conflict (group_id, user_id) do nothing;

  update public.anonymous_membership_gifts
     set status = 'claimed', claimed_at = now(), claimed_by = p_user
   where id = v_gift.id;

  v_count := public.community_member_count(p_group);
  if v_gr.group_state = 'waiting' and v_count >= v_gr.minimum_members_to_activate then
    update public.study_groups set group_state = 'active', updated_at = now() where id = p_group;
  end if;

  return jsonb_build_object('ok', true, 'claimed', true,
    'gift_id', v_gift.id, 'code', v_gift.code,
    'member_count', v_count,
    'group_state', (select group_state from public.study_groups where id = p_group),
    'member_limit', v_gr.member_limit);
end;
$$;

-- ------------------------------------------------------------
-- 4. community_anonymous_wipe — ALSO expire unclaimed gifts (a wiped
--    room is dead; its unused gift seats can never be redeemed).
-- ------------------------------------------------------------
create or replace function public.community_anonymous_wipe(p_group bigint)
returns void
language plpgsql volatile
security definer set search_path = public, pg_temp
as $$
declare v_gr record;
begin
  perform pg_advisory_xact_lock(hashtext('community:anon:' || p_group::text));

  select * into v_gr from public.study_groups where id = p_group for update;
  if v_gr is null then
    return;
  end if;

  update public.study_groups
     set group_state = 'wiped', is_active = false, updated_at = now()
   where id = p_group;

  update public.community_posts
     set is_deleted = true, is_hidden = true
   where group_id = p_group and is_deleted = false;

  update public.anonymous_spectators
     set status = 'revoked', revoked_at = now()
   where group_id = p_group and status = 'active';

  update public.anonymous_memberships
     set status = 'revoked', revoked_at = now()
   where group_id = p_group and status = 'active';

  update public.anonymous_membership_gifts
     set status = 'expired'
   where group_id = p_group and status = 'unclaimed';

  delete from public.study_group_members where group_id = p_group;
end;
$$;

-- ------------------------------------------------------------
-- 5. GRANTS — gifting RPCs service_role ONLY (this project's default
--    privileges auto-grant EXECUTE on every new function).
-- ------------------------------------------------------------
revoke execute on function public.community_anonymous_create_gifts(bigint, uuid, integer, text, integer) from public, anon, authenticated;
grant execute on function public.community_anonymous_create_gifts(bigint, uuid, integer, text, integer) to service_role;

revoke execute on function public.community_anonymous_redeem_gift(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.community_anonymous_redeem_gift(bigint, uuid, text) to service_role;

revoke execute on function public.community_anonymous_wipe(bigint) from public, anon, authenticated;
grant execute on function public.community_anonymous_wipe(bigint) to service_role;

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================