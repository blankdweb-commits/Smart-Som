// api/initiate-payment.js
// Server-side Paystack Session Initializer.
// Calls Paystack /transaction/initialize and returns a hosted
// authorization_url. On iOS/mobile Safari the injected inline popup iframe
// is unreliable, so the client redirects to this URL, pays on Paystack's
// hosted page, and Paystack redirects back to the callback (verify) URL.
//
// Products:
//   { plan_id }                          -> premium subscription (legacy)
//   { product:'anonymous_spectate', group_id }    -> one-time spectator pass
//   { product:'anonymous_membership', group_id }  -> one-time member seat
//   { product:'marketplace_product', product_id } -> first-party PolyNurse
//     product (one-time purchase; third-party listings are refused here).
import { applyCors, getSupabaseAdmin, getUserFromRequest } from './_utils.js';

const KOBOS = 100;

// The ONLY seller that may sell through the platform checkout. First-party
// products belong to this storefront; every other listing is informational.
const PLATFORM_SELLER_NAME = 'PolyNurse';

// Active member/spectator seat counts for the P2 capacity model. Best-effort:
// an un-migrated DB yields zeros rather than throwing.
async function groupSeatCounts(supabase, groupId) {
  const [{ data: members }, { data: spectators }] = await Promise.all([
    supabase.rpc('community_member_count', { p_group: groupId }).catch(() => ({ data: null })),
    supabase.rpc('community_spectator_count', { p_group: groupId }).catch(() => ({ data: null })),
  ]);
  return {
    members: typeof members === 'number' ? members : 0,
    spectators: typeof spectators === 'number' ? spectators : 0,
  };
}

// Server-side resolution of an anonymous spectator purchase: the group must be
// an ACTIVE anonymous group and the buyer must not be a member or an already
// active spectator. Returns { amount, metadata, reference } or throws an
// object { code, status } for the caller to return.
async function resolveSpectatorPurchase(supabase, user, groupIdRaw) {
  const groupId = Number(groupIdRaw);
  if (!Number.isFinite(groupId)) {
    const e = new Error('Invalid group id');
    e.code = 'INVALID_GROUP'; e.status = 400; throw e;
  }

  const { data: group, error: groupError } = await supabase
    .from('study_groups')
    .select('id, name, type, group_state, spectator_price, member_limit, free_spectator_cap')
    .eq('id', groupId)
    .maybeSingle();
  if (groupError) {
    const e = new Error('Failed to resolve group');
    e.code = 'GROUP_LOOKUP_FAILED'; e.status = 500; throw e;
  }
  if (!group) {
    const e = new Error('Group not found');
    e.code = 'GROUP_NOT_FOUND'; e.status = 404; throw e;
  }
  if (group.type !== 'anonymous') {
    const e = new Error('This group is not anonymous');
    e.code = 'NOT_ANONYMOUS'; e.status = 400; throw e;
  }
  // Spectators are only purchasable once the group has activated.
  if (group.group_state !== 'active') {
    const e = new Error('Spectator access unlocks once the Anonymous group is active');
    e.code = 'GROUP_NOT_ACTIVE'; e.status = 400; throw e;
  }
  const price = Number(group.spectator_price);
  if (!price || price <= 0) {
    const e = new Error('Not purchasable');
    e.code = 'NOT_PURCHASABLE'; e.status = 400; throw e;
  }

  // A member already has full access; an existing active spectator must not
  // be double-charged.
  const { data: member } = await supabase
    .from('study_group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (member) {
    const e = new Error('Members already have full access');
    e.code = 'ALREADY_MEMBER'; e.status = 400; throw e;
  }
  const { data: existing } = await supabase
    .from('anonymous_spectators')
    .select('reference')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) {
    const e = new Error('You already have spectator access to this group');
    e.code = 'ALREADY_SPECTATOR'; e.status = 400; throw e;
  }

  // P2 — never charge for a spectator seat while a free one is still open.
  const seats = await groupSeatCounts(supabase, groupId);
  const freeCap = group.free_spectator_cap;
  if (typeof freeCap === 'number' && seats.spectators < freeCap) {
    const e = new Error('A free spectator seat is still available');
    e.code = 'SPECTATOR_FREE_AVAILABLE'; e.status = 400; throw e;
  }
  if (typeof group.member_limit === 'number' && seats.members + seats.spectators >= group.member_limit) {
    const e = new Error('This room is at capacity');
    e.code = 'GROUP_FULL'; e.status = 400; throw e;
  }

  return {
    amount: price,
    metadata: {
      product: 'anonymous_spectate',
      group_id: groupId,
      group_name: group.name,
      user_id: user.id,
      // Kobo amount the charge must match — authoritative server price, used
      // by payments-webhook as a last-resort check even without a plan row.
      expected_amount_kobo: Math.round(price * KOBOS),
    },
    reference: `APX-SPE-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  };
}

// P2 — server-side resolution of a PAID member seat. Only requirable once the
// free founding seats are exhausted (members >= founding_member_cap); while a
// free seat is available the caller is told to use the free join instead.
async function resolveMembershipPurchase(supabase, user, groupIdRaw) {
  const groupId = Number(groupIdRaw);
  if (!Number.isFinite(groupId)) {
    const e = new Error('Invalid group id');
    e.code = 'INVALID_GROUP'; e.status = 400; throw e;
  }

  const { data: group, error: groupError } = await supabase
    .from('study_groups')
    .select('id, name, type, group_state, is_active, member_price, member_limit, founding_member_cap')
    .eq('id', groupId)
    .maybeSingle();
  if (groupError) {
    const e = new Error('Failed to resolve group');
    e.code = 'GROUP_LOOKUP_FAILED'; e.status = 500; throw e;
  }
  if (!group) {
    const e = new Error('Group not found');
    e.code = 'GROUP_NOT_FOUND'; e.status = 404; throw e;
  }
  if (group.type !== 'anonymous') {
    const e = new Error('This group is not anonymous');
    e.code = 'NOT_ANONYMOUS'; e.status = 400; throw e;
  }
  if (group.group_state === 'wiped' || group.is_active === false) {
    const e = new Error('This room has been wiped');
    e.code = 'GROUP_WIPED'; e.status = 400; throw e;
  }
  const price = Number(group.member_price);
  if (!price || price <= 0) {
    const e = new Error('Not purchasable');
    e.code = 'NOT_PURCHASABLE'; e.status = 400; throw e;
  }

  const { data: member } = await supabase
    .from('study_group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (member) {
    const e = new Error('You are already a member');
    e.code = 'ALREADY_MEMBER'; e.status = 400; throw e;
  }

  const seats = await groupSeatCounts(supabase, groupId);
  if (typeof group.member_limit === 'number' && seats.members + seats.spectators >= group.member_limit) {
    const e = new Error('This room is at capacity');
    e.code = 'GROUP_FULL'; e.status = 400; throw e;
  }
  // A free founding seat is still open — the paid path must not be used.
  if (typeof group.founding_member_cap === 'number' && seats.members < group.founding_member_cap) {
    const e = new Error('A free member seat is still available');
    e.code = 'MEMBERSHIP_FREE_AVAILABLE'; e.status = 400; throw e;
  }

  return {
    amount: price,
    metadata: {
      product: 'anonymous_membership',
      group_id: groupId,
      group_name: group.name,
      user_id: user.id,
      expected_amount_kobo: Math.round(price * KOBOS),
    },
    reference: `APX-MEM-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  };
}

// P3 — server-side resolution of a MULTI-SLOT member purchase. ONE Paystack
// transaction covers `count` seats at `count × member_price` (no bundle
// discount tiers). `for_me`(0|1) seats become a NORMAL paid membership for the
// buyer (same capacity/founding-cap checks as the single-seat product); the
// remainder become GIFT seats — `count` unique shareable codes, each good for
// ONE member seat and only while the room has a free slot. Purchases never add
// capacity: an unusable gift stays unclaimed until a seat frees.
const MAX_BUNDLE = 50;
async function resolveMembershipsPurchase(supabase, user, body) {
  const groupId = Number(body.group_id);
  if (!Number.isFinite(groupId)) {
    const e = new Error('Invalid group id');
    e.code = 'INVALID_GROUP'; e.status = 400; throw e;
  }
  let total = Number(body.count);
  if (!Number.isFinite(total)) total = 1;
  total = Math.max(1, Math.min(Math.round(total), MAX_BUNDLE));
  const forMe = body.for_me === true || Number(body.for_me) === 1 ? 1 : 0;
  const giftCount = total - forMe;

  const { data: group, error: groupError } = await supabase
    .from('study_groups')
    .select('id, name, type, group_state, is_active, member_price, member_limit, founding_member_cap')
    .eq('id', groupId)
    .maybeSingle();
  if (groupError) {
    const e = new Error('Failed to resolve group');
    e.code = 'GROUP_LOOKUP_FAILED'; e.status = 500; throw e;
  }
  if (!group) {
    const e = new Error('Group not found');
    e.code = 'GROUP_NOT_FOUND'; e.status = 404; throw e;
  }
  if (group.type !== 'anonymous') {
    const e = new Error('This group is not anonymous');
    e.code = 'NOT_ANONYMOUS'; e.status = 400; throw e;
  }
  if (group.group_state === 'wiped' || group.is_active === false) {
    const e = new Error('This room has been wiped');
    e.code = 'GROUP_WIPED'; e.status = 400; throw e;
  }
  const price = Number(group.member_price);
  if (!price || price <= 0) {
    const e = new Error('Not purchasable');
    e.code = 'NOT_PURCHASABLE'; e.status = 400; throw e;
  }

  const seats = await groupSeatCounts(supabase, groupId);
  if (typeof group.member_limit === 'number' && seats.members + seats.spectators >= group.member_limit) {
    const e = new Error('This room is at capacity. Purchases never add seats — gift seats unlock as room space frees.');
    e.code = 'GROUP_FULL'; e.status = 400; throw e;
  }
  if (forMe === 1) {
    // Buyer needs a REAL seat now: refuse when they already hold one, when a
    // free founding seat is still open, or when the room is full.
    const { data: member } = await supabase
      .from('study_group_members')
      .select('user_id')
      .eq('group_id', groupId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (member) {
      const e = new Error('You are already a member. Gift-only bundles (remove "include me") can still be purchased.');
      e.code = 'ALREADY_MEMBER'; e.status = 400; throw e;
    }
    if (typeof group.founding_member_cap === 'number' && seats.members < group.founding_member_cap) {
      const e = new Error('A free member seat is still available');
      e.code = 'MEMBERSHIP_FREE_AVAILABLE'; e.status = 400; throw e;
    }
  }

  const amount = price * total;
  return {
    amount,
    metadata: {
      product: 'anonymous_memberships',
      group_id: groupId,
      group_name: group.name,
      user_id: user.id,
      count: total,
      for_me: forMe,
      gift_count: giftCount,
      unit_price: price,
      expected_amount_kobo: Math.round(amount * KOBOS),
    },
    reference: `APX-GFT-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  };
}

// P-MK — server-side resolution of a FIRST-PARTY marketplace purchase. Only
// products sold by the PolyNurse platform seller are checkout-eligible; a
// third-party listing is REFUSED here (not merely hidden in the UI) with an
// explicit error. Price is resolved server-side — never trusted from the body.
async function resolveMarketplacePurchase(supabase, user, productIdRaw) {
  const productId = Number(productIdRaw);
  if (!Number.isInteger(productId) || productId <= 0) {
    const e = new Error('Invalid product id');
    e.code = 'INVALID_PRODUCT'; e.status = 400; throw e;
  }

  const { data: product, error: productError } = await supabase
    .from('marketplace_products')
    .select('id, title, price, access_type, kind, sc_price, is_published, is_archived, seller_id, marketplace_sellers(business_name)')
    .eq('id', productId)
    .maybeSingle();
  if (productError) {
    const e = new Error('Failed to resolve product');
    e.code = 'PRODUCT_LOOKUP_FAILED'; e.status = 500; throw e;
  }
  if (!product) {
    const e = new Error('Product not found');
    e.code = 'PRODUCT_NOT_FOUND'; e.status = 404; throw e;
  }
  if (!product.is_published || product.is_archived) {
    const e = new Error('This product is not available for purchase');
    e.code = 'PRODUCT_NOT_AVAILABLE'; e.status = 400; throw e;
  }

  // Platform gate — only first-party PolyNurse products reach the checkout.
  const seller = product.marketplace_sellers;
  const isPlatform =
    seller && seller.business_name?.toLowerCase() === PLATFORM_SELLER_NAME.toLowerCase();
  if (!isPlatform) {
    const e = new Error('This product is listed by a third-party seller and cannot be purchased on PolyNurse.');
    e.code = 'THIRD_PARTY_NOT_PURCHASABLE'; e.status = 403; throw e;
  }

  // Cosmetics are bought with Smart Coins, never Naira. This has to be refused
  // HERE, explicitly, rather than falling through to the price guard: the
  // Crown's `price` is deliberately 0, so the `!(price > 0)` check below would
  // refuse it anyway — but with the wrong code and a message about a product
  // nobody can buy, and only by accident.
  //
  // The refusal is load-bearing in the other direction too. Cosmetic
  // entitlement is granted by the cosmetic_purchase() RPC against
  // user_cosmetics; a Paystack order for a cosmetic would write a
  // marketplace_purchases row and NOTHING else, so the payer would be charged
  // for an item they never receive. Refusing is the only safe answer.
  if (product.kind === 'cosmetic' || product.access_type === 'cosmetic') {
    const e = new Error('Cosmetics are purchased with Smart Coins in the Cosmetics section, not with card payment.');
    e.code = 'COSMETIC_NOT_CARD_PURCHASABLE'; e.status = 400; throw e;
  }

  if (product.access_type === 'free') {
    const e = new Error('This product is free — no payment is required.');
    e.code = 'FREE_PRODUCT'; e.status = 400; throw e;
  }
  if (product.access_type === 'premium') {
    const e = new Error('This product is included with a premium subscription and is not sold separately.');
    e.code = 'PREMIUM_ONLY'; e.status = 400; throw e;
  }
  const price = Number(product.price);
  if (!(price > 0)) {
    const e = new Error('This product is not purchasable');
    e.code = 'NOT_PURCHASABLE'; e.status = 400; throw e;
  }

  // Entitlement — a first-party product is purchased once per account.
  const { data: owned } = await supabase
    .from('marketplace_purchases')
    .select('id')
    .eq('user_id', user.id)
    .eq('product_id', productId)
    .eq('status', 'complete')
    .maybeSingle();
  if (owned) {
    const e = new Error('You already own this product');
    e.code = 'ALREADY_OWNED'; e.status = 400; throw e;
  }

  return {
    amount: price,
    metadata: {
      product: 'marketplace_product',
      product_id: productId,
      product_title: product.title,
      seller_name: seller.business_name,
      user_id: user.id,
      // Kobo amount the charge must match — authoritative server price, used
      // by payments-webhook as a last-resort check even without a product row.
      expected_amount_kobo: Math.round(price * KOBOS),
    },
    reference: `APX-MKT-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  };
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ error: 'Payment gateway is not configured' });
  }

  // SECURITY: identity comes from the Supabase access token, never the body.
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { plan_id, product, group_id, product_id } = req.body || {};

  try {
    let amount;
    let reference;
    let metadata;

    if (product === 'marketplace_product') {
      // First-party marketplace product — one-time purchase, no subscription.
      const spec = await resolveMarketplacePurchase(supabase, user, product_id);
      amount = spec.amount;
      metadata = spec.metadata;
      reference = spec.reference;
    } else if (product === 'anonymous_spectate') {
      // One-time spectator pass — no subscription is involved.
      const spec = await resolveSpectatorPurchase(supabase, user, group_id);
      amount = spec.amount;
      metadata = spec.metadata;
      reference = spec.reference;
    } else if (product === 'anonymous_membership') {
      // One-time paid member seat — no subscription is involved.
      const spec = await resolveMembershipPurchase(supabase, user, group_id);
      amount = spec.amount;
      metadata = spec.metadata;
      reference = spec.reference;
    } else if (product === 'anonymous_memberships') {
      // P3 — one charge for `count` seats (self + gifts), converted after verify.
      const spec = await resolveMembershipsPurchase(supabase, user, req.body);
      amount = spec.amount;
      metadata = spec.metadata;
      reference = spec.reference;
    } else {
      if (!plan_id) return res.status(400).json({ error: 'Missing plan id' });
      // Server-side plan resolution — never trust client-supplied amounts.
      const { data: plan, error: planError } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', plan_id)
        .eq('is_active', true)
        .maybeSingle();
      if (planError || !plan) {
        return res.status(400).json({ error: 'Invalid subscription plan' });
      }
      amount = Number(plan.price);
      reference = `APX-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      metadata = {
        plan_id: plan.id,
        plan_name: plan.name,
        user_id: user.id,
        // Kobo amount the charge must match — authoritative server price, used
        // by payments-webhook as a last-resort check even without a plan row.
        expected_amount_kobo: Math.round(amount * KOBOS),
      };
    }

    // Live callback URL — Paystack redirects the payer back here after payment.
    const origin =
      process.env.APP_URL ||
      req.headers.origin ||
      req.headers['x-forwarded-proto'] + '://' + req.headers.host ||
      'http://localhost:5173';
    const callback_url = `${origin.replace(/\/$/, '')}/payments/verify`;

    const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(amount * KOBOS),
        currency: 'NGN',
        reference,
        callback_url,
        metadata
      })
    });

    const result = await initRes.json();
    if (!initRes.ok || !result.status || !result.data) {
      console.error('Paystack initialize failed:', initRes.status, JSON.stringify(result).slice(0, 500));
      return res.status(502).json({ error: result.message || 'Payment gateway rejected the request' });
    }

    return res.status(200).json({
      success: true,
      authorization_url: result.data.authorization_url,
      reference: result.data.reference || reference
    });
  } catch (error) {
    console.error('Payment initiation error:', error);
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'Internal Server Error', message: error.message });
  }
}