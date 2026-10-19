-- ###########################################################################
-- migration-v98-marketplace-entitlement.sql
--
-- CLOSING THE SELF-GRANT HOLE, WITHOUT LOSING THE REAL FEATURE.
--
-- THE DEFECT. migration-v92 narrowed `marketplace_purchases` from FOR ALL to
-- select-own + insert-own and kept INSERT so a client could record its own
-- intent. But the policy's WITH CHECK was only `auth.uid() = user_id`: it
-- constrained WHO you could name, never WHAT the row could SAY. A crafted
-- client could insert
--     (user_id = me, product_id = <any id>, amount = 0, status = 'complete')
-- and own any product for nothing. The UI-only gating was cosmetic - the real
-- Marketplace page additionally read `userProfile?.isPremium`, a field that
-- does not exist on userProfile, so its own Premium branch was dead code.
--
-- HONEST SCOPE, stated rather than implied:
--   - This path never minted a platform subscription. It only ever wrote a
--     `marketplace_purchases` row, and `subscriptions` has no client INSERT
--     policy at all. Premium quota, ads and timer unlocks were never affected.
--   - Live impact today was nil: the catalog holds one product (the Crown,
--     access_type='cosmetic'), marketplace_purchases is empty, and the Crown's
--     entitlement lives in `user_cosmetics` - which has no client INSERT or
--     UPDATE policy, so it was never reachable from here either.
--   - What was left open was a hole with no floor: the first paid product
--     added would have been self-grantable by anyone with a REST client.
--
-- THE REPLACEMENT. Two RPCs, both SECURITY DEFINER:
--   marketplace_claim_free_product    - a caller may claim what they are
--                                       genuinely entitled to, decided from
--                                       the product row and their live
--                                       subscription, never from a client flag.
--   admin_grant_marketplace_entitlement - the admin path, modelled on
--                                       admin_set_flashcard_access (v11),
--                                       and it writes admin_audit_log.
--
-- ACL NOTE: the explicit `revoke ... from anon` is load-bearing. This project's
-- default privileges auto-grant anon EXECUTE on new functions, so `revoke ...
-- from public` alone leaves anon able to call it - which is still true, live,
-- on admin_set_activation / admin_set_role / admin_set_flashcard_access.
--
-- Idempotent. Creates no product, grants no entitlement, deletes no row.
-- ###########################################################################

-- ###########################################################################
-- 1. Remove the write policy the client was using
-- ###########################################################################

drop policy if exists "marketplace_purchases_insert_own" on public.marketplace_purchases;

-- ###########################################################################
-- 2. marketplace_claim_free_product - server decides what is claimable
-- ###########################################################################

create or replace function public.marketplace_claim_free_product(p_product_id bigint)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_prod public.marketplace_products%rowtype;
  v_reference text;
  v_rows int := 0;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if p_product_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_PRODUCT');
  end if;

  select * into v_prod
    from public.marketplace_products
   where id = p_product_id
     and is_published
     and not is_archived;

  -- One answer for "not there", "unpublished" and "archived": the caller has no
  -- business distinguishing them.
  if v_prod.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- Cosmetics are bought with Smart Coins through cosmetic_purchase(), which
  -- has its own idempotent ledger key. Letting them be claimed here for free
  -- would be a second, un-metered path to the same entitlement.
  if v_prod.access_type = 'cosmetic' or v_prod.kind = 'cosmetic' then
    return jsonb_build_object('ok', false, 'error', 'COSMETIC_NOT_CLAIMABLE');
  end if;

  if v_prod.access_type = 'premium' then
    -- Included-with-premium is honoured against a REAL subscription row, using
    -- the same rule the client applies in AppContext: inside `expires_at` is
    -- active, inside `grace_until` is still premium.
    if not exists (
      select 1 from public.subscriptions s
       where s.user_id = v_me
         and ((s.status = 'active' and s.expires_at > now())
           or (s.grace_until > now()))
    ) then
      return jsonb_build_object('ok', false, 'error', 'PREMIUM_ONLY');
    end if;

  elsif v_prod.access_type = 'free' then
    -- "Free" has to actually be free. A published row priced above zero while
    -- labelled free is refused rather than silently given away.
    if coalesce(v_prod.price, 0) <> 0 then
      return jsonb_build_object('ok', false, 'error', 'NOT_FREE');
    end if;

  else
    -- one-time: it must go through Paystack, where the amount is resolved
    -- server-side and the grant is made by verify-payment / the webhook.
    return jsonb_build_object('ok', false, 'error', 'PAID_PRODUCT');
  end if;

  -- Deterministic reference, so a double tap, two tabs or a retried request all
  -- collapse onto the same value. `reference` is globally UNIQUE, and so is
  -- (user_id, product_id); either constraint catches a duplicate.
  v_reference := 'claim:' || md5(p_product_id::text || ':' || v_me::text);

  insert into public.marketplace_purchases
         (user_id, product_id, amount, reference, status)
  values (v_me, p_product_id, 0, v_reference, 'complete')
  on conflict (user_id, product_id) do nothing;

  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'ok', true,
    'productId', p_product_id,
    'accessType', v_prod.access_type,
    'amount', 0,
    -- true when the row was already there, so the client can say "you already
    -- have this" instead of implying a fresh grant.
    'replay', (v_rows = 0)
  );
end;
$$;

revoke all on function public.marketplace_claim_free_product(bigint) from public, anon;
grant execute on function public.marketplace_claim_free_product(bigint) to authenticated, service_role;


-- ###########################################################################
-- 3. admin_grant_marketplace_entitlement - the admin path, audited
-- ###########################################################################
--
-- Modelled on admin_set_flashcard_access (migration-v11:77-117), which is the
-- only one of the three existing admin RPCs that also writes admin_audit_log.
-- admin_set_activation and admin_set_role do not, which is why the live audit
-- table has never held a row for either.

create or replace function public.admin_grant_marketplace_entitlement(
  p_user_id uuid,
  p_product_id bigint
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_prod public.marketplace_products%rowtype;
  v_reference text;
  v_rows int := 0;
begin
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHORIZED');
  end if;
  if p_user_id is null or p_product_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENT');
  end if;

  -- Same protection the other admin RPCs apply: a super-admin account is not a
  -- grant target.
  if exists (select 1 from public.profiles p
              where p.id = p_user_id and p.role = 'super_admin') then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_GRANT_SUPER_ADMIN');
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  end if;

  select * into v_prod from public.marketplace_products where id = p_product_id;
  if v_prod.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  -- Cosmetics are refused here too, and for the same reason initiate-payment
  -- refuses them: their entitlement lives in `user_cosmetics`, purchased with
  -- Smart Coins through cosmetic_purchase(). A row in `marketplace_purchases`
  -- would look like a grant and deliver nothing - the exact "charged for an
  -- item that grants nothing" trap. Until an admin Smart-Coin grant path
  -- exists, refusing is the honest answer.
  if v_prod.access_type = 'cosmetic' or v_prod.kind = 'cosmetic' then
    return jsonb_build_object('ok', false, 'error', 'COSMETIC_NOT_CLAIMABLE');
  end if;

  -- Deliberately NOT restricted to free products: an admin can legitimately
  -- grant a paid or premium-included product. The amount is still recorded as
  -- 0 because nothing was charged, and `metadata` carries the reason below.
  v_reference := 'admin:' || md5(p_product_id::text || ':' || p_user_id::text);

  insert into public.marketplace_purchases
         (user_id, product_id, amount, reference, status)
  values (p_user_id, p_product_id, 0, v_reference, 'complete')
  on conflict (user_id, product_id) do nothing;

  get diagnostics v_rows = row_count;

  insert into public.admin_audit_log (user_id, admin_id, action, metadata)
  values (
    p_user_id,
    auth.uid(),
    'marketplace_entitlement_grant',
    jsonb_build_object(
      'admin_id', auth.uid(),
      'product_id', p_product_id,
      'product_title', v_prod.title,
      'access_type', v_prod.access_type,
      'created', (v_rows > 0)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'productId', p_product_id,
    'userId', p_user_id,
    'amount', 0,
    'replay', (v_rows = 0)
  );
end;
$$;

revoke all on function public.admin_grant_marketplace_entitlement(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.admin_grant_marketplace_entitlement(uuid, bigint)
  to authenticated, service_role;

notify pgrst, 'reload schema';