// api/verify-payment.js
// Server-side Paystack callback verifier.
// Handles FOUR products:
//   - premium subscription (legacy): creates/extends a subscriptions row.
//   - anonymous_spectate: one-time spectator pass for the Anonymous
//     group — inserts an `active` anonymous_spectators row (NO subscription).
//   - anonymous_membership: one-time paid member seat for the Anonymous
//     group — grants via community_anonymous_grant_membership (NO subscription).
//   - marketplace_product: first-party PolyNurse product — inserts a
//     marketplace_purchases entitlement (NO subscription; third-party listings
//     are refused, matching initiate-payment).
// All verify the transaction with Paystack, validate the amount against a
// server-resolved price, and are idempotent on the reference.
import { applyCors, getSupabaseAdmin, getUserFromRequest } from './_utils.js';

const KOBOS = 100;

// Shared: record the canonical payment + transactions log. Returns true if
// the reference was already processed (idempotency guard).
async function recordPayment(supabase, user, paidAmount, reference, metadata) {
  const { error: paymentInsertError } = await supabase.from('payments').insert({
    user_id: user.id,
    email: user.email,
    amount: paidAmount,
    reference,
    status: 'success',
  });
  if (paymentInsertError) {
    const { data: recheck } = await supabase
      .from('payments')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();
    if (!recheck) throw paymentInsertError;
    return true; // already processed by a concurrent webhook
  }
  await supabase.from('transactions').upsert({
    user_id: user.id,
    reference,
    amount: paidAmount,
    status: 'success',
    paid_at: new Date().toISOString(),
    metadata: metadata || null,
  }, { onConflict: 'reference' });
  return false;
}

// One-time spectator pass: grant `active` anonymous_spectators (service role).
async function grantSpectator(supabase, user, paidAmount, metadata) {
  const groupId = Number(metadata?.group_id);
  if (!Number.isFinite(groupId)) {
    return { status: 400, body: { error: 'Invalid group id', message: 'Payment metadata is missing the group.' } };
  }

  // Server-side price/state resolution — never trust payment metadata alone.
  const { data: group } = await supabase
    .from('study_groups')
    .select('id, type, group_state, spectator_price')
    .eq('id', groupId)
    .maybeSingle();
  if (!group || group.type !== 'anonymous' || group.group_state !== 'active') {
    return { status: 400, body: { error: 'GROUP_NOT_ACTIVE', message: 'This group is not accepting spectators right now.' } };
  }
  const expected = Number(group.spectator_price);
  if (expected > 0 && Math.abs(paidAmount - expected) > 1) {
    console.error(`Spectator amount mismatch for ref ${metadata?.reference || '(unknown)'}: paid ${paidAmount}, expected ${expected}`);
    return { status: 400, body: { error: 'Payment amount does not match the spectator pass' } };
  }

  const { error: spectatorsInsertError } = await supabase.from('anonymous_spectators').insert({
    group_id: groupId,
    user_id: user.id,
    reference: metadata?.reference,
    amount: paidAmount,
    tier: 'paid',
    status: 'active',
  });
  if (spectatorsInsertError) {
    if (spectatorsInsertError.code === '23505') {
      return { status: 200, body: { success: true, message: 'Already processed', spectate: true } };
    }
    // If the unique reference lost the race, someone else already granted it.
    const { data: existing } = await supabase
      .from('anonymous_spectators')
      .select('id')
      .eq('reference', metadata?.reference)
      .maybeSingle();
    if (existing) {
      return { status: 200, body: { success: true, message: 'Already processed', spectate: true } };
    }
    throw spectatorsInsertError;
  }

  return { status: 200, body: { success: true, spectate: true, reference: metadata?.reference } };
}

// P2 — one-time paid member seat: grant via the service-role RPC (records the
// ledger row, revokes any spectator seat, re-checks capacity atomically).
async function grantMembership(supabase, user, paidAmount, metadata) {
  const groupId = Number(metadata?.group_id);
  if (!Number.isFinite(groupId)) {
    return { status: 400, body: { error: 'Invalid group id', message: 'Payment metadata is missing the group.' } };
  }

  const { data: group } = await supabase
    .from('study_groups')
    .select('id, type, group_state, is_active, member_price')
    .eq('id', groupId)
    .maybeSingle();
  if (!group || group.type !== 'anonymous' || group.group_state === 'wiped' || group.is_active === false) {
    return { status: 400, body: { error: 'GROUP_NOT_ACTIVE', message: 'This room is not accepting members right now.' } };
  }
  const expected = Number(group.member_price);
  if (expected > 0 && Math.abs(paidAmount - expected) > 1) {
    console.error(`Membership amount mismatch for ref ${metadata?.reference || '(unknown)'}: paid ${paidAmount}, expected ${expected}`);
    return { status: 400, body: { error: 'Payment amount does not match the membership fee' } };
  }

  const { data: result, error: grantError } = await supabase.rpc('community_anonymous_grant_membership', {
    p_group: groupId,
    p_user: user.id,
    p_reference: metadata?.reference,
    p_amount: Math.round(paidAmount),
    p_tier: 'paid',
  });
  if (grantError) {
    // A replay of the same reference (unique) means the seat was already granted.
    if (grantError.code === '23505') {
      return { status: 200, body: { success: true, message: 'Already processed', member: true } };
    }
    throw grantError;
  }
  if (!result?.ok) {
    return {
      status: 400,
      body: { error: result?.code || 'MEMBERSHIP_GRANT_FAILED', message: 'This room could not grant your seat right now.' },
    };
  }

  return { status: 200, body: { success: true, member: true, already_member: !!result.already_member, reference: metadata?.reference } };
}

// P3 — one charge for a multi-slot purchase. After a verified charge:
//   `for_me` seats -> buyer's normal paid membership (community_anonymous_grant_membership)
//   `gift_count` seats -> unique shareable gift codes (community_anonymous_create_gifts)
// Gifts are always deliverable (they unlock only when the room has space); only
// the buyer's own seat depends on live capacity.
async function grantMembershipsBundle(supabase, user, paidAmount, metadata) {
  const groupId = Number(metadata?.group_id);
  if (!Number.isFinite(groupId)) {
    return { status: 400, body: { error: 'Invalid group id', message: 'Payment metadata is missing the group.' } };
  }

  const { data: group } = await supabase
    .from('study_groups')
    .select('id, type, group_state, is_active, member_price')
    .eq('id', groupId)
    .maybeSingle();
  if (!group || group.type !== 'anonymous' || group.group_state === 'wiped' || group.is_active === false) {
    return { status: 400, body: { error: 'GROUP_NOT_ACTIVE', message: 'This room is not accepting members right now.' } };
  }
  const expected = Number(group.member_price);
  const total = Math.max(1, Math.min(Math.round(Number(metadata?.count) || 1), 50));
  const forMe = Number(metadata?.for_me) === 1 ? 1 : 0;
  const giftCount = Math.max(0, total - forMe);
  if (expected > 0 && Math.abs(paidAmount - expected * total) > 1) {
    console.error(`Bundle amount mismatch for ref ${metadata?.reference || '(unknown)'}: paid ${paidAmount}, expected ${expected * total}`);
    return { status: 400, body: { error: 'Payment amount does not match the bundle total' } };
  }

  // Idempotency: gifts are created once per payment reference. A concurrent
  // verify/webhook on the same charge must never mint duplicate codes.
  const { data: existingGifts } = await supabase
    .from('anonymous_membership_gifts')
    .select('id')
    .eq('reference', metadata?.reference)
    .limit(1);
  if (existingGifts?.length > 0) {
    return { status: 200, body: { success: true, message: 'Already processed', bundle: true } };
  }

  let codes = [];
  if (giftCount > 0 && metadata?.reference) {
    const { data: giftRes, error: giftError } = await supabase.rpc('community_anonymous_create_gifts', {
      p_group: groupId,
      p_buyer: user.id,
      p_count: giftCount,
      p_reference: metadata.reference,
      p_amount: Math.round(expected || paidAmount / total),
    });
    if (giftError || !giftRes?.ok) {
      if (giftError?.code === '23505') {
        return { status: 200, body: { success: true, message: 'Already processed', bundle: true } };
      }
      return { status: 400, body: { error: giftRes?.code || 'GIFT_CREATION_FAILED', message: giftError?.message || giftRes?.message || 'Gift seats could not be created.' } };
    }
    codes = (giftRes.codes || []).map((c) => ({ code: c, room_link: `/anonymous/${groupId}?gift=${c}` }));
  }

  let seat = { granted: false };
  let seatError = null;
  if (forMe === 1) {
    const { data: result, error: grantError } = await supabase.rpc('community_anonymous_grant_membership', {
      p_group: groupId,
      p_user: user.id,
      p_reference: metadata.reference,
      p_amount: Math.round(paidAmount),
      p_tier: 'paid',
    });
    if (grantError) {
      if (grantError.code === '23505') {
        seat = { granted: true, already_member: true };
      } else {
        seatError = grantError;
      }
    } else if (result?.ok) {
      seat = { granted: true, already_member: !!result.already_member };
    } else {
      seatError = result?.code || 'MEMBERSHIP_GRANT_FAILED';
    }
  }

  return {
    status: 200,
    body: {
      success: true,
      bundle: true,
      count: total,
      for_me: forMe,
      gift_count: giftCount,
      gifts: codes,
      seat,
      seat_error: seatError,
      reference: metadata?.reference,
    },
  };
}

// P-MK — grant a first-party marketplace purchase entitlement. Price and the
// platform-seller check are resolved server-side; the (user_id, product_id)
// unique constraint and the reference make replay safe.
async function grantMarketplaceProduct(supabase, user, paidAmount, metadata) {
  const productId = Number(metadata?.product_id);
  if (!Number.isInteger(productId)) {
    return { status: 400, body: { error: 'Invalid product id', message: 'Payment metadata is missing the product.' } };
  }

  const { data: product } = await supabase
    .from('marketplace_products')
    .select('id, title, price, access_type, kind, is_published, is_archived, marketplace_sellers(business_name)')
    .eq('id', productId)
    .maybeSingle();
  if (!product || !product.is_published || product.is_archived) {
    return { status: 400, body: { error: 'PRODUCT_NOT_AVAILABLE', message: 'This product is no longer available.' } };
  }
  // Cosmetics are Smart-Coin only. Refused identically in all three payment
  // entry points (initiate, verify, webhook) because each of them is reachable
  // on its own: a verified payment is not proof that initiate-payment ran.
  if (product.kind === 'cosmetic' || product.access_type === 'cosmetic') {
    return { status: 400, body: { error: 'COSMETIC_NOT_CARD_PURCHASABLE', message: 'Cosmetics are purchased with Smart Coins in the Cosmetics section, not with card payment.' } };
  }
  const seller = product.marketplace_sellers;
  const isPlatform =
    seller && seller.business_name?.toLowerCase() === 'polynurse';
  if (!isPlatform) {
    return { status: 400, body: { error: 'PRODUCT_NOT_PURCHASABLE', message: 'This listing is informational only and cannot be purchased.' } };
  }
  const expected = Number(product.price);
  if (expected > 0 && Math.abs(paidAmount - expected) > 1) {
    console.error(`Marketplace amount mismatch for ref ${metadata?.reference || '(unknown)'}: paid ${paidAmount}, expected ${expected}`);
    return { status: 400, body: { error: 'Payment amount does not match the product price' } };
  }

  const { data: grant, error: grantError } = await supabase
    .from('marketplace_purchases')
    .insert({
      user_id: user.id,
      product_id: productId,
      amount: paidAmount,
      reference: metadata?.reference,
      status: 'complete',
    })
    .select('id')
    .maybeSingle();
  if (grantError) {
    // Unique on (user_id, product_id) and on reference — the webhook may have
    // already processed this charge or the user already owns the product.
    if (grantError.code === '23505') {
      return { status: 200, body: { success: true, message: 'Already processed', marketplace: true } };
    }
    const { data: existing } = await supabase
      .from('marketplace_purchases')
      .select('id')
      .eq('reference', metadata?.reference)
      .maybeSingle();
    if (existing) {
      return { status: 200, body: { success: true, message: 'Already processed', marketplace: true } };
    }
    throw grantError;
  }

  return { status: 200, body: { success: true, marketplace: true, product_id: productId, reference: metadata?.reference, grant_id: grant?.id } };
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  // SECURITY: the user identity comes from their Supabase access token,
  // never from the request body.
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { reference } = req.body;
  if (!reference) return res.status(400).json({ error: 'Missing payment reference' });

  try {
    // 1. Verify with Paystack
    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`
      }
    });

    const result = await verifyResponse.json();

    if (!result.status || result.data.status !== 'success') {
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const paidAmount = result.data.amount / KOBOS;
    const metadata = result.data.metadata || {};
    const spectatorProduct = metadata.product === 'anonymous_spectate';
    const membershipProduct = metadata.product === 'anonymous_membership';
    const bundleProduct = metadata.product === 'anonymous_memberships';
    const marketplaceProduct = metadata.product === 'marketplace_product';

    // Spectator / membership / bundle / marketplace products branch early — no
    // subscription.
    if (spectatorProduct || membershipProduct || bundleProduct || marketplaceProduct) {
      const processed = await recordPayment(supabase, user, paidAmount, reference, metadata);
      if (processed) {
        return res.status(200).json({ success: true, message: 'Already processed' });
      }
      if (marketplaceProduct) {
        const r = await grantMarketplaceProduct(supabase, user, paidAmount, { ...metadata, reference });
        return res.status(r.status).json(r.body);
      }
      if (bundleProduct) {
        const r = await grantMembershipsBundle(supabase, user, paidAmount, { ...metadata, reference });
        return res.status(r.status).json(r.body);
      }
      if (membershipProduct) {
        const r = await grantMembership(supabase, user, paidAmount, { ...metadata, reference });
        return res.status(r.status).json(r.body);
      }
      return grantSpectator(supabase, user, paidAmount, { ...metadata, reference });
    }

    // Legacy subscription product.
    const planId = metadata.plan_id;

    // 2. Resolve the plan SERVER-SIDE and validate the amount actually paid.
    let durationDays = 30;
    let planName = 'Monthly';
    let expectedPrice = null;

    if (planId) {
      const { data: plan } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', planId)
        .maybeSingle();
      if (plan) {
        durationDays = plan.duration_days;
        planName = plan.name;
        expectedPrice = Number(plan.price);
      }
    }

    if (expectedPrice !== null && Math.abs(paidAmount - expectedPrice) > 1) {
      console.error(`Amount mismatch for ref ${reference}: paid ${paidAmount}, expected ${expectedPrice}`);
      return res.status(400).json({ error: 'Payment amount does not match the selected plan' });
    }

    // 3. Prevent duplicate processing
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();

    if (existingPayment) {
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    // 3b. Guard against the webhook creating a subscription for the same
    // reference first (race condition) — treat as already processed.
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();

    if (existingSub) {
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    // 4. Record Payment (payments table = canonical payment log)
    const processed = await recordPayment(supabase, user, paidAmount, reference, metadata);
    if (processed) {
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    // 5. Activate Subscription. Renewals extend on top of any existing active
    // subscription (starting from the later of now / current expiry) so a
    // paying user never loses remaining days.
    const now = new Date();
    const { data: activeSub } = await supabase
      .from('subscriptions')
      .select('expires_at')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .gte('expires_at', now.toISOString())
      .order('expires_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const base = activeSub?.expires_at && new Date(activeSub.expires_at) > now
      ? new Date(activeSub.expires_at)
      : now;
    const expiresAt = new Date(base.getTime() + durationDays * 24 * 60 * 60 * 1000);
    const graceUntil = new Date(expiresAt.getTime() + 2 * 24 * 60 * 60 * 1000);

    const { error: subInsertError } = await supabase.from('subscriptions').insert({
      user_id: user.id,
      plan: planName.toLowerCase(),
      status: 'active',
      expires_at: expiresAt.toISOString(),
      grace_until: graceUntil.toISOString(),
      amount: paidAmount,
      reference
    });
    if (subInsertError) {
      // Unique constraint on subscriptions.reference catches webhook races.
      if (subInsertError.code === '23505') {
        return res.status(200).json({ success: true, message: 'Already processed' });
      }
      throw subInsertError;
    }

    // 6. Update Profile Activation
    await supabase.from('profiles').update({ is_activated: true }).eq('id', user.id);

    return res.status(200).json({
      success: true,
      subscriptionStatus: 'active',
      expires_at: expiresAt.toISOString()
    });

  } catch (error) {
    console.error('Payment Verification Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}