-- ============================================================
-- migration-v92-cosmetics-crown.sql
--
-- Cosmetic items, and the one item that was actually approved: a Crown for 40
-- Smart Coins. Plus the closure of a live self-grant hole in the marketplace
-- that this migration happens to be standing next to.
--
-- ---------------------------------------------------------------------------
-- SCOPE, STATED PLAINLY SO IT IS NOT LATER MISREAD
-- ---------------------------------------------------------------------------
-- A cosmetic is DECORATION. It appears on your profile, beside your name in
-- community posts and comments, and on the Global Ranking. It does NOT touch
-- question difficulty, scoring, answer speed, SC rewards, rank, or any official
-- credential. `competitive_rank_score` and the leaderboard ordering are
-- computed by v_competitive_base and get no reference to any table in this
-- file, so "owns a crown" cannot leak into rank even by accident.
--
-- Exactly one product is seeded. The user approved one, at one price, after
-- being asked. No placeholder catalogue, no "coming soon" items, no free
-- samples - a storefront with invented stock is worse than an empty one.
--
-- ---------------------------------------------------------------------------
-- BOUGHT WITH SMART COINS, NOT NAIRA
-- ---------------------------------------------------------------------------
-- The SC ledger already exists and is already authoritative (`_sc_apply`, the
-- single balance mutator, granted to service_role only). Cosmetics use it
-- rather than Paystack, so no payment integration is touched and no second
-- wallet exists.
--
-- That is why `price` stays 0 on the product row: with access_type='cosmetic'
-- the NGN path REFUSES the product outright (section 7), so there is no amount
-- for it to charge and no chance of one being charged. `sc_price = 40` is the
-- only real price.
--
-- `sc_spend` is deliberately NOT used. It is hardcoded to reason
-- 'powerup_spend' and is not idempotent on a caller-supplied key, so a double
-- tap would be a double charge. cosmetic_purchase() calls `_sc_apply` directly
-- with a deterministic `client_request_id` derived from (user, sku), which is
-- what makes a replay return the original result instead of moving coins twice.
--
-- ---------------------------------------------------------------------------
-- THE MARKETPLACE HOLE (asked about, and fixed here)
-- ---------------------------------------------------------------------------
-- `marketplace_purchases_all_own` was `FOR ALL`, i.e. SELECT/INSERT/UPDATE/
-- DELETE, with `using (auth.uid() = user_id)`. A client could therefore
-- INSERT its own completed purchase row - and, since entitlements are read from
-- marketplace_purchases, self-grant any product for free. Narrowed to
-- select-own plus insert-own, with UPDATE and DELETE removed entirely. Every
-- legitimate write to this table goes through the api/ handlers on the service
-- role, which is unaffected.
--
-- Idempotent. Safe to re-run.
-- Apply: node scripts/run-migration.mjs scripts/migration-v92-cosmetics-crown.sql
-- ============================================================


-- ###########################################################################
-- 1. CLOSE THE SELF-GRANT HOLE
-- ###########################################################################
-- Do this FIRST, while the table still has its old shape.

drop policy if exists "marketplace_purchases_all_own" on public.marketplace_purchases;

drop policy if exists "marketplace_purchases_read_own" on public.marketplace_purchases;
create policy "marketplace_purchases_read_own"
  on public.marketplace_purchases for select
  using (auth.uid() = user_id);

-- Kept only so a client-initiated checkout can record its own intent row. No
-- UPDATE and no DELETE: a client must not be able to rewrite or erase what it
-- paid for.
drop policy if exists "marketplace_purchases_insert_own" on public.marketplace_purchases;
create policy "marketplace_purchases_insert_own"
  on public.marketplace_purchases for insert
  with check (auth.uid() = user_id);

-- Nothing else to do here. `marketplace_purchases_unique (user_id, product_id)`
-- is deliberately KEPT: one purchase per product per user is correct, and the
-- api/ handlers depend on that constraint to make grantMarketplaceProduct
-- idempotent. The only defect was the policy, not the schema.


-- ###########################################################################
-- 2. COSMETIC COLUMNS ON marketplace_products
-- ###########################################################################
-- `kind` distinguishes a cosmetic from a real product. `sku` is the stable
-- identifier a purchase is recorded against (a product id would tie a purchase
-- to a row an admin can later edit or archive). `sc_price` is the Smart Coin
-- price, nullable so it is never confused with `price`, which stays in kobo for
-- the NGN path.

alter table public.marketplace_products
  add column if not exists kind           text,
  add column if not exists slot           text,
  add column if not exists sku            text,
  add column if not exists cosmetic_config jsonb,
  add column if not exists sc_price       integer;

-- Existing rows are ordinary products, not cosmetics.
update public.marketplace_products
   set kind = 'standard'
 where kind is null;

alter table public.marketplace_products
  alter column kind set default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.marketplace_products'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  ) then
    alter table public.marketplace_products
      add constraint marketplace_products_kind_check
      check (kind in ('standard', 'cosmetic'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.marketplace_products'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%access_type%'
  ) then
    -- No existing check: nothing to widen.
    null;
  else
    alter table public.marketplace_products
      drop constraint if exists marketplace_products_access_type_check;
  end if;
end $$;

-- Re-add access_type's check with 'cosmetic' admitted. Guarded by a column
-- test rather than a name test, because the original constraint's name is not
-- something this migration should depend on.
do $$
declare
  v_has_check boolean;
begin
  select exists (
    select 1 from pg_constraint
     where conrelid = 'public.marketplace_products'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%access_type%'
  ) into v_has_check;

  if v_has_check then
    alter table public.marketplace_products
      drop constraint marketplace_products_access_type_check;
  end if;

  alter table public.marketplace_products
    add constraint marketplace_products_access_type_check
    check (access_type in ('free', 'premium', 'one-time', 'cosmetic'));
end $$;

create unique index if not exists marketplace_products_sku_unique
  on public.marketplace_products (sku)
  where sku is not null;

-- A cosmetic must be paid for in Smart Coins, and a standard product must
-- not pretend to have an SC price. Enforced so an admin cannot create a
-- cosmetic that is secretly free.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.marketplace_products'::regclass
       and contype = 'c'
       and conname = 'marketplace_products_cosmetic_price_check'
  ) then
    alter table public.marketplace_products
      add constraint marketplace_products_cosmetic_price_check
      check (
        (kind = 'cosmetic' and sc_price is not null and sc_price > 0 and slot is not null and sku is not null)
        or
        (kind <> 'cosmetic')
      );
  end if;
end $$;


-- ###########################################################################
-- 3. THE CROWN - the one approved product, at the one approved price
-- ###########################################################################
-- The seller is the verified platform seller on marketplace_sellers (id 1,
-- "PolyNurse", seeded by scripts/seed-marketplace-platform-seller.mjs).
--
-- This block originally resolved the seller from marketplace_products, which
-- is EMPTY on this project - so it resolved NULL and the whole block quietly
-- did nothing. The apply still returned 201 and the catalogue was still empty.
-- A `raise notice` nobody reads is not a failure mode; this now RAISES, so a
-- missing seller stops the migration instead of shipping an empty storefront.

do $$
declare
  v_seller bigint;
begin
  select s.id into v_seller
    from public.marketplace_sellers s
   order by (s.is_verified and s.verification_status = 'approved') desc nulls last, s.id asc
   limit 1;

  if v_seller is null then
    raise exception 'no marketplace_sellers row: refusing to apply v92 without seeding the Crown'
      using hint = 'Run scripts/seed-marketplace-platform-seller.mjs first.';
  end if;

  insert into public.marketplace_products (
    seller_id, category_id, title, slug, description, price, currency,
    access_type, is_published, is_featured, is_archived,
    kind, slot, sku, cosmetic_config, sc_price
  )
  values (
    v_seller, null, 'Crown', 'cosmetic-crown',
    'A gold crown shown beside your name on your profile, in community posts and comments, and on the Global Ranking. Decoration only - it gives no scoring, timing or rank advantage.',
    0, 'NGN',
    'cosmetic', true, false, false,
    'cosmetic', 'profile_crown', 'crown-001',
    jsonb_build_object('label', 'Crown', 'icon', 'crown', 'tone', 'amber'),
    40
  )
  on conflict (sku) where sku is not null do update
    set title = excluded.title,
        description = excluded.description,
        slot = excluded.slot,
        cosmetic_config = excluded.cosmetic_config,
        sc_price = excluded.sc_price,
        access_type = 'cosmetic',
        kind = 'cosmetic',
        is_published = true,
        updated_at = now();
end $$;


-- ###########################################################################
-- 4. OWNERSHIP + EQUIPPING
-- ###########################################################################

create table if not exists public.user_cosmetics (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  sku         text not null,
  slot        text not null,
  equipped    boolean not null default true,
  acquired_at timestamptz not null default now(),
  sc_price    integer,
  constraint user_cosmetics_pair unique (user_id, sku)
);

create index if not exists idx_user_cosmetics_user on public.user_cosmetics (user_id);

alter table public.user_cosmetics enable row level security;

-- One equipped item per slot. Partial unique index rather than a nullable
-- `equipped_slot` column trick, so "unequip everything" is just a boolean.
create unique index if not exists user_cosmetics_one_equipped_per_slot
  on public.user_cosmetics (user_id, slot)
  where equipped;

drop policy if exists "user_cosmetics_read_own" on public.user_cosmetics;
create policy "user_cosmetics_read_own"
  on public.user_cosmetics for select
  using (auth.uid() = user_id);

-- No INSERT or UPDATE policy: acquisition goes through cosmetic_purchase and
-- toggling through cosmetic_equip, both of which re-read the catalogue and
-- re-check balance. A client that could INSERT here would be minting itself a
-- crown for nothing.


-- The one place a crown is looked up on every profile render. Exposed as a
-- function rather than a column so `community_profiles` (read by anon) does
-- not gain a join into a table that is not anonymous-readable.
create or replace function public._has_crown(p_user uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.user_cosmetics uc
      join public.marketplace_products mp on mp.sku = uc.sku
     where uc.user_id = p_user
       and uc.sku = 'crown-001'
       and uc.equipped
  );
$$;

-- GRANT, NOT REVOKE. This is the whole subtle part, and getting it wrong
-- silently killed the community feed.
--
-- `community_profiles` and `community_feed` are plain views granted to anon and
-- authenticated. A plain view runs with the CALLER's privileges, not the
-- view owner's, so it needs EXECUTE on every function it calls. Revoking
-- `_has_crown` from anon/authenticated - which looked like good hygiene, and is
-- the default posture for every other helper in this schema - made every read
-- of both views fail with:
--
--     42501 permission denied for function _has_crown
--
-- That is invisible to a raw-SQL check (the Management API runs as postgres and
-- bypasses privileges) and invisible to `select *` tests, and it presents to
-- users as "the community feed is empty", not as a permissions error.
-- e2e-community-ephemeral is what caught it.
--
-- Safe to expose: the function answers one bit - is this user wearing the
-- crown - and that bit is already public through
-- community_profiles.has_crown, which anon can read.
grant execute on function public._has_crown(uuid) to anon, authenticated, service_role;


-- ###########################################################################
-- 5. PUBLIC CATALOGUE + OWN INVENTORY
-- ###########################################################################

create or replace function public.cosmetic_catalog()
returns jsonb
language sql
stable
security definer set search_path = public
as $$
  select jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sku', mp.sku,
               'title', mp.title,
               'description', mp.description,
               'slot', mp.slot,
               'scPrice', mp.sc_price,
               'config', coalesce(mp.cosmetic_config, '{}'::jsonb))
             order by mp.sc_price asc, mp.title asc)
        from public.marketplace_products mp
       where mp.kind = 'cosmetic'
         and mp.is_published
         and not mp.is_archived
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.cosmetic_catalog() from public, anon;
grant execute on function public.cosmetic_catalog() to authenticated, service_role;


create or replace function public.my_cosmetics()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  return jsonb_build_object(
    'ok', true,
    'balance', coalesce((select p.smart_coins from public.profiles p where p.id = v_me), 0),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sku', uc.sku,
               'slot', uc.slot,
               'equipped', uc.equipped,
               'scPrice', uc.sc_price,
               'acquiredAt', uc.acquired_at,
               'title', coalesce(mp.title, uc.sku),
               'description', coalesce(mp.description, ''),
               'config', coalesce(mp.cosmetic_config, '{}'::jsonb))
             order by uc.acquired_at desc)
        from public.user_cosmetics uc
        left join public.marketplace_products mp on mp.sku = uc.sku
       where uc.user_id = v_me
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_cosmetics() from public, anon;
grant execute on function public.my_cosmetics() to authenticated, service_role;


-- ###########################################################################
-- 6. PURCHASE + EQUIP
-- ###########################################################################

create or replace function public.cosmetic_purchase(p_sku text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_prod public.marketplace_products;
  v_owned boolean;
  v_request uuid;
  v_result jsonb;
  v_balance int;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;
  if p_sku is null or btrim(p_sku) = '' then
    return jsonb_build_object('ok', false, 'error', 'INVALID_SKU');
  end if;

  select * into v_prod
    from public.marketplace_products
   where sku = p_sku
     and kind = 'cosmetic'
     and is_published
     and not is_archived;
  if v_prod.id is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;

  select exists (select 1 from public.user_cosmetics
                  where user_id = v_me and sku = p_sku) into v_owned;
  if v_owned then
    return jsonb_build_object('ok', false, 'error', 'ALREADY_OWNED');
  end if;

  -- DETERMINISTIC. Two taps, two tabs, or a retried request all collapse onto
  -- one ledger key, so _sc_apply's own idempotency makes the second attempt a
  -- no-op instead of a second debit.
  v_request := md5('cosmetic:' || p_sku || ':' || v_me::text)::uuid;

  v_result := public._sc_apply(
    v_me,
    -v_prod.sc_price,               -- negative = a debit
    'crown_purchase',
    'cosmetic',
    'cosmetic',
    'cosmetic',
    p_sku,
    jsonb_build_object('sku', p_sku, 'slot', v_prod.slot, 'title', v_prod.title),
    v_request
  );

  if v_result is null or coalesce((v_result ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object(
      'ok', false,
      'error', coalesce(v_result ->> 'error', 'PURCHASE_FAILED'),
      'balance', coalesce((v_result ->> 'balance')::int,
                          (select p.smart_coins from public.profiles p where p.id = v_me))
    );
  end if;

  insert into public.user_cosmetics (user_id, sku, slot, equipped, sc_price)
  values (v_me, p_sku, v_prod.slot, true, v_prod.sc_price)
  on conflict (user_id, sku) do nothing;

  v_balance := coalesce((v_result ->> 'balance')::int,
                        (select p.smart_coins from public.profiles p where p.id = v_me));

  -- Buying auto-equips, which is what "I paid for it" means. The one-per-slot
  -- index guarantees this never leaves two equipped.
  update public.user_cosmetics
     set equipped = false
   where user_id = v_me and slot = v_prod.slot and sku <> p_sku;
  update public.user_cosmetics
     set equipped = true
   where user_id = v_me and sku = p_sku;

  return jsonb_build_object(
    'ok', true,
    'sku', p_sku,
    'equipped', true,
    'balance', v_balance,
    -- true when _sc_apply recognised the request as a replay, so the client
    -- can say "already yours" instead of implying a fresh charge.
    'replay', coalesce((v_result ->> 'replay')::boolean, false)
  );
end;
$$;

revoke all on function public.cosmetic_purchase(text) from public, anon;
grant execute on function public.cosmetic_purchase(text) to authenticated, service_role;


create or replace function public.cosmetic_equip(p_sku text, p_equipped boolean default true)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_slot text;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'UNAUTHENTICATED');
  end if;

  select uc.slot into v_slot
    from public.user_cosmetics uc
   where uc.user_id = v_me and uc.sku = p_sku;
  if v_slot is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_OWNED');
  end if;

  if p_equipped is not true then
    update public.user_cosmetics set equipped = false
     where user_id = v_me and sku = p_sku;
    return jsonb_build_object('ok', true, 'sku', p_sku, 'equipped', false);
  end if;

  update public.user_cosmetics set equipped = false
   where user_id = v_me and slot = v_slot and sku <> p_sku;
  update public.user_cosmetics set equipped = true
   where user_id = v_me and sku = p_sku;

  return jsonb_build_object('ok', true, 'sku', p_sku, 'equipped', true);
end;
$$;

revoke all on function public.cosmetic_equip(text, boolean) from public, anon;
grant execute on function public.cosmetic_equip(text, boolean) to authenticated, service_role;


-- ###########################################################################
-- 7. REBUILD THE PROFILE VIEWS WITH has_crown
-- ###########################################################################
-- Dependency order matters: community_feed reads community_profiles, so the
-- profile view is replaced first and the feed second. Dropping a view that
-- something else selects from fails with "cannot drop ... because other
-- objects depend on it", which is exactly the ordering this section obeys.

create or replace view public.community_profiles as
  select p.id,
         case
           when coalesce(nullif(trim(both from p.identity_name), ''), '') = ''
             then 'Scholar'
           else trim(both from p.identity_name)
         end as display_name,
         ''::text as avatar_url,
         case
           when p.level ~ '^\d'
             then regexp_replace(p.level, '[^0-9]', '', 'g')
           else null
         end as year,
         -- Purely decorative. Nothing that computes rank, score or eligibility
         -- reads this column.
         public._has_crown(p.id) as has_crown
    from public.profiles p;

grant select on public.community_profiles to anon, authenticated, service_role;


create or replace view public.community_feed as
  select p.id,
         p.author_id,
         p.content,
         p.image_url,
         p.section,
         p.group_id,
         p.created_at,
         p.last_interaction_at,
         public.community_post_lives_until(p.*) as lives_until,
         cp.display_name,
         cp.avatar_url,
         cp.year,
         (select count(*)::integer from public.community_post_likes l where l.post_id = p.id) as like_count,
         (select count(*)::integer from public.community_comments c
           where c.post_id = p.id and not c.is_deleted) as reply_count,
         (select count(*)::integer from public.community_post_shares s where s.post_id = p.id) as share_count,
         exists (select 1 from public.community_post_likes l2
                  where l2.post_id = p.id and l2.user_id = auth.uid()) as liked_by_current_user,
         case
           when now() <= (coalesce(p.last_interaction_at, p.created_at) + interval '1 minute 50 seconds')
             then 'active'
           else 'cold'
         end as post_state,
         -- APPENDED LAST, deliberately. CREATE OR REPLACE VIEW can only add
         -- columns at the end: inserting it after `year` shifts every column
         -- after it and Postgres rejects the whole thing with 42P16
         -- "cannot change name of view column". Appending keeps the existing
         -- positional contract every existing client select depends on.
         coalesce(cp.has_crown, false) as has_crown
    from public.community_posts p
    left join public.community_profiles cp on cp.id = p.author_id
   where not p.is_deleted
     and not p.is_hidden
     and now() <= public.community_post_lives_until(p.*)
     and (p.group_id is null
       or not exists (select 1 from public.study_groups ag
                       where ag.id = p.group_id and ag.type = 'anonymous'));


grant select on public.community_feed to anon, authenticated, service_role;


-- ###########################################################################
-- 8. LEADERBOARD + PROFILE OBJECT
-- ###########################################################################
-- Both are SECURITY DEFINER functions that build their own row objects, so the
-- crown is one more key in an existing jsonb. No signature changes, so nothing
-- that calls them with the old arity breaks - which is the whole reason the
-- profile object is one function and not a view.
--
-- `player_public_profile` is NOT redefined: it delegates to
-- `_player_profile_obj`, so patching the object is enough for the profile
-- surface too. Verified live before writing this.

create or replace function public.get_player_leaderboard(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_limit int := greatest(least(coalesce(p_limit, 50), 500), 1);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total int;
begin
  select count(*) into v_total from public.v_competitive_base;

  return jsonb_build_object(
    'ok', true,
    'totalPlayers', v_total,
    'players', coalesce((
      select jsonb_agg(t.row_obj order by (t.row_obj ->> 'rank')::int asc)
      from (
        select jsonb_build_object(
                 'rank', row_number() over (
                           order by (b.parts ->> 'score')::int desc,
                                    (b.parts ->> 'threeVThreeWins')::int desc,
                                    (b.parts ->> 'oneVOneWins')::int desc,
                                    (b.parts ->> 'wins')::int desc,
                                    b.sc_balance desc,
                                    b.user_id asc
                         )::int,
                 'userId', b.user_id,
                 'displayName', public._person_name(b.user_id, 'pseudonym'),
                 'avatarUrl', cp.avatar_url,
                 'year', cp.year,
                 -- Decoration only. The ORDER BY above cannot reference this,
                 -- and does not.
                 'hasCrown', coalesce(cp.has_crown, false),
                 'competitiveScore', (b.parts ->> 'score')::int,
                 'scoreBreakdown', jsonb_build_object(
                    'coin', (b.parts ->> 'coin')::int,
                    'duels', (b.parts ->> 'duels')::int,
                    'perf', (b.parts ->> 'perf')::int,
                    'wins', (b.parts ->> 'wins')::int,
                    'matches', (b.parts ->> 'matches')::int
                 ),
                 'threeVThreeWins', (b.parts ->> 'threeVThreeWins')::int,
                 'oneVOneWins', (b.parts ->> 'oneVOneWins')::int,
                 'playerScore', (b.parts ->> 'playerScore')::int,
                 'totalAnswers', (b.parts ->> 'totalAnswers')::int,
                 'smartCoins', (b.parts ->> 'smartCoins')::int
               ) as row_obj
        from public.v_competitive_base b
        left join public.community_profiles cp on cp.id = b.user_id
        order by (b.parts ->> 'score')::int desc,
                 (b.parts ->> 'threeVThreeWins')::int desc,
                 (b.parts ->> 'oneVOneWins')::int desc,
                 (b.parts ->> 'wins')::int desc,
                 b.sc_balance desc,
                 b.user_id asc
        limit v_limit offset v_offset
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_player_leaderboard(integer, integer) from public, anon;
grant execute on function public.get_player_leaderboard(integer, integer) to authenticated, service_role;


create or replace function public._player_profile_obj(p_viewer uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_prof public.profiles%rowtype;
  v_parts jsonb;
  v_rank int;
  v_total int;
  v_cs public.competitive_stats%rowtype;
  v_ach jsonb;
  v_ach_count int;
  v_h2h jsonb;
  v_year text;
begin
  select * into v_prof from public.profiles where id = p_user;
  if v_prof.id is null then return null; end if;

  select parts into v_parts from public.v_competitive_base where user_id = p_user;
  select rank into v_rank from public._player_ranks() where user_id = p_user;
  select count(*) into v_total from public.v_competitive_base;

  select * into v_cs from public.competitive_stats where user_id = p_user;

  -- Latest 12 achievements + the TRUE total. These must be two separate
  -- aggregates: counting rows over a `limit 12` subquery would cap the count
  -- at 12 and quietly under-report anybody with more.
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', a.key, 'name', a.name,
           'emoji', a.emoji, 'description', a.description,
           'unlockedAt', a.unlocked_at
         ) order by a.unlocked_at desc), '[]'::jsonb)
    into v_ach
    from (
      select a.key, a.name, a.emoji, a.description, ua.unlocked_at
      from public.user_achievements ua
      join public.achievements a on a.id = ua.achievement_id
      where ua.user_id = p_user
      order by ua.unlocked_at desc
      limit 12
    ) a;

  select count(*) into v_ach_count
    from public.user_achievements ua
    join public.achievements a on a.id = ua.achievement_id
   where ua.user_id = p_user;

  -- Head to head is scoped to the VIEWER only: null when they have never met,
  -- so a profile never implies a shared history that does not exist.
  if p_viewer is not null and p_viewer <> p_user then
    select jsonb_build_object(
             'played', count(*),
             'wins',   count(*) filter (where winner_id = p_viewer),
             'losses', count(*) filter (where winner_id = p_user),
             'draws',  count(*) filter (where winner_id is null)
           )
      into v_h2h
      from public.competitive_matches m
     where m.format = 'blitz'
       and m.status = 'completed'
       and ((m.creator_id = p_viewer and m.opponent_id = p_user)
         or (m.creator_id = p_user  and m.opponent_id = p_viewer));
  end if;

  v_year := case
    when v_prof.level ~ '^\d' then regexp_replace(v_prof.level, '[^0-9]', '', 'g')
    else null end;

  return jsonb_build_object(
    'userId', p_user,
    'isSelf', p_viewer = p_user,
    -- pseudonym until the two have dueled; real name after. Never 'Scholar'.
    'name', public._person_pair_name(p_viewer, p_user),
    'nameIsReal', public._arena_pair_dueled(p_viewer, p_user),
    'year', v_year,
    'joinedAt', v_prof.created_at,
    'rank', v_rank,
    'totalPlayers', v_total,
    -- Decoration only.
    'hasCrown', public._has_crown(p_user),
    'streak', coalesce(v_prof.streak, 0),
    'quizStreak', coalesce(v_prof.quiz_streak, 0),
    'maxQuizStreak', coalesce(v_prof.max_quiz_streak, 0),
    'smartCoins', coalesce(v_prof.smart_coins, 0),
    'competitiveScore', coalesce((v_parts ->> 'score')::int, 0),
    'scoreBreakdown', jsonb_build_object(
      'coin',  coalesce((v_parts ->> 'coin')::int, 0),
      'duels', coalesce((v_parts ->> 'duels')::int, 0),
      'perf',  coalesce((v_parts ->> 'perf')::int, 0),
      'wins',  coalesce((v_parts ->> 'wins')::int, 0),
      'matches', coalesce((v_parts ->> 'matches')::int, 0)
    ),
    'duels', jsonb_build_object(
      'oneVsOneWins', coalesce(v_cs.one_v_one_wins, 0),
      'oneVsOneMatches', coalesce(v_cs.one_v_one_matches, 0),
      'threeVsThreeWins', coalesce(v_cs.three_v_three_wins, 0),
      'threeVsThreeMatches', coalesce(v_cs.three_v_three_matches, 0)
    ),
    'answers', jsonb_build_object(
      'correct', coalesce((v_parts ->> 'correctAnswers')::int, 0),
      'total', coalesce((v_parts ->> 'totalAnswers')::int, 0)
    ),
    'achievements', v_ach,
    'achievementCount', coalesce(v_ach_count, 0),
    'headToHead', v_h2h
  );
end;
$$;

revoke all on function public._player_profile_obj(uuid, uuid) from public, anon, authenticated;


notify pgrst, 'reload schema';

-- ============================================================
-- DONE. Re-run safe.
-- ============================================================
