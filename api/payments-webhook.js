// api/payments-webhook.js (webhook URL: /api/payments/webhook via vercel.json rewrite)
//
// Handles charge.success for FOUR products:
//   - premium subscription (legacy): creates a subscriptions row + activates profile.
//   - anonymous_spectate: one-time spectator pass — inserts an `active`
//     anonymous_spectators row (NO subscription, NO profile activation).
//   - anonymous_membership: one-time paid member seat — grants via
//     community_anonymous_grant_membership (NO subscription).
//   - marketplace_product: first-party PolyNurse product — inserts a
//     marketplace_purchases entitlement (NO subscription; third-party listings
//     are ignored).
// Signature-verified, idempotent on the reference.
import crypto from 'crypto';
import { getSupabaseAdmin } from './_utils.js';

// One-time spectator pass from the webhook. The reference's UNIQUE constraint
// makes this safe against the callback verifier racing the webhook.
async function grantSpectator(supabase, paidAmount, metadata) {
  const groupId = Number(metadata?.group_id);
  const userId = metadata?.user_id;
  if (!Number.isFinite(groupId) || !userId) {
    return { status: 200, body: { status: 'ignored' } };
  }

  // Server-side price/state resolution — never trust payment metadata alone.
  const { data: group } = await supabase
    .from('study_groups')
    .select('id, type, group_state, spectator_price')
    .eq('id', groupId)
    .maybeSingle();
  if (!group || group.type !== 'anonymous' || group.group_state !== 'active') {
    return { status: 200, body: { status: 'ignored' } };
  }

  // Idempotency — the callback verifier may have already granted this.
  const { data: existing } = await supabase
    .from('anonymous_spectators')
    .select('id')
    .eq('reference', metadata.reference)
    .maybeSingle();
  if (existing) {
    return { status: 200, body: { status: 'already_processed' } };
  }

  const expected = Number(group.spectator_price);
  if (expected > 0 && Math.abs(paidAmount - expected) > 1) {
    console.error(`Webhook spectator amount mismatch, ref ${metadata.reference}: paid ${paidAmount}, expected ${expected}`);
    return { status: 200, body: { status: 'amount_mismatch' } };
  }

  const { error: txnError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      reference: metadata.reference,
      amount: paidAmount,
      status: 'success',
      paid_at: new Date().toISOString(),
      metadata: metadata,
    });
  // Unique on transactions.reference catches races with the verifier.
  if (txnError && txnError.code === '23505') {
    const { data: existingTxn } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', metadata.reference)
      .maybeSingle();
    if (existingTxn) return { status: 200, body: { status: 'already_processed' } };
  }
  if (txnError) throw txnError;

  const { data: grant, error: grantError } = await supabase
    .from('anonymous_spectators')
    .insert({
      group_id: groupId,
      user_id: userId,
      reference: metadata.reference,
      amount: paidAmount,
      tier: 'paid',
      status: 'active',
    })
    .select('id')
    .maybeSingle();
  // Unique on anonymous_spectators.reference — the verifier may have won.
  if (grantError && grantError.code === '23505') {
    return { status: 200, body: { status: 'already_processed' } };
  }
  if (grantError) throw grantError;

  return { status: 200, body: { status: 'spectator_granted', spectator_id: grant?.id } };
}

// P2 — one-time paid member seat from the webhook. The reference's UNIQUE
// constraint makes this safe against the callback verifier racing the webhook.
async function grantMembership(supabase, paidAmount, metadata) {
  const groupId = Number(metadata?.group_id);
  const userId = metadata?.user_id;
  if (!Number.isFinite(groupId) || !userId) {
    return { status: 200, body: { status: 'ignored' } };
  }

  const { data: group } = await supabase
    .from('study_groups')
    .select('id, type, group_state, is_active, member_price')
    .eq('id', groupId)
    .maybeSingle();
  if (!group || group.type !== 'anonymous' || group.group_state === 'wiped' || group.is_active === false) {
    return { status: 200, body: { status: 'ignored' } };
  }

  // Idempotency — the callback verifier may have already granted this.
  const { data: existing } = await supabase
    .from('anonymous_memberships')
    .select('id')
    .eq('reference', metadata.reference)
    .maybeSingle();
  if (existing) {
    return { status: 200, body: { status: 'already_processed' } };
  }

  const expected = Number(group.member_price);
  if (expected > 0 && Math.abs(paidAmount - expected) > 1) {
    console.error(`Webhook membership amount mismatch, ref ${metadata.reference}: paid ${paidAmount}, expected ${expected}`);
    return { status: 200, body: { status: 'amount_mismatch' } };
  }

  const { error: txnError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      reference: metadata.reference,
      amount: paidAmount,
      status: 'success',
      paid_at: new Date().toISOString(),
      metadata: metadata,
    });
  if (txnError && txnError.code === '23505') {
    const { data: existingTxn } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', metadata.reference)
      .maybeSingle();
    if (existingTxn) return { status: 200, body: { status: 'already_processed' } };
  }
  if (txnError) throw txnError;

  const { data: result, error: grantError } = await supabase.rpc('community_anonymous_grant_membership', {
    p_group: groupId,
    p_user: userId,
    p_reference: metadata.reference,
    p_amount: Math.round(paidAmount),
    p_tier: 'paid',
  });
  if (grantError && grantError.code === '23505') {
    return { status: 200, body: { status: 'already_processed' } };
  }
  if (grantError) throw grantError;
  if (!result?.ok) {
    return { status: 200, body: { status: 'membership_denied', code: result?.code || null } };
  }

  return { status: 200, body: { status: 'member_granted', already_member: !!result.already_member } };
}

// P3 — multi-slot purchase from the webhook (mirrors verify-payment). Gifts are
// created once per reference (idempotent against the callback verifier); the
// buyer's own seat is granted when `for_me` is set.
async function grantMembershipsBundle(supabase, paidAmount, metadata) {
  const groupId = Number(metadata?.group_id);
  const userId = metadata?.user_id;
  if (!Number.isFinite(groupId) || !userId) {
    return { status: 200, body: { status: 'ignored' } };
  }

  const { data: group } = await supabase
    .from('study_groups')
    .select('id, type, group_state, is_active, member_price')
    .eq('id', groupId)
    .maybeSingle();
  if (!group || group.type !== 'anonymous' || group.group_state === 'wiped' || group.is_active === false) {
    return { status: 200, body: { status: 'ignored' } };
  }

  // Idempotency — tips of the race: the verifier may have already minted codes.
  const { data: existing } = await supabase
    .from('anonymous_membership_gifts')
    .select('id')
    .eq('reference', metadata.reference)
    .limit(1);
  if (existing?.length > 0) {
    return { status: 200, body: { status: 'already_processed' } };
  }

  const expected = Number(group.member_price);
  const total = Math.max(1, Math.min(Math.round(Number(metadata?.count) || 1), 50));
  const forMe = Number(metadata?.for_me) === 1 ? 1 : 0;
  const giftCount = Math.max(0, total - forMe);
  if (expected > 0 && Math.abs(paidAmount - expected * total) > 1) {
    console.error(`Webhook bundle amount mismatch, ref ${metadata.reference}: paid ${paidAmount}, expected ${expected * total}`);
    return { status: 200, body: { status: 'amount_mismatch' } };
  }

  const { error: txnError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      reference: metadata.reference,
      amount: paidAmount,
      status: 'success',
      paid_at: new Date().toISOString(),
      metadata: metadata,
    });
  if (txnError && txnError.code === '23505') {
    const { data: existingTxn } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', metadata.reference)
      .maybeSingle();
    if (existingTxn) return { status: 200, body: { status: 'already_processed' } };
  }
  if (txnError) throw txnError;

  let codes = [];
  if (giftCount > 0) {
    const { data: giftRes, error: giftError } = await supabase.rpc('community_anonymous_create_gifts', {
      p_group: groupId,
      p_buyer: userId,
      p_count: giftCount,
      p_reference: metadata.reference,
      p_amount: Math.round(expected || paidAmount / total),
    });
    if (giftError && giftError.code === '23505') {
      return { status: 200, body: { status: 'already_processed' } };
    }
    if (giftError || !giftRes?.ok) {
      return { status: 200, body: { status: 'gift_creation_failed', code: giftRes?.code || null } };
    }
    codes = (giftRes.codes || []).map((c) => c.code);
  }

  let seatStatus = null;
  if (forMe === 1) {
    const { data: result, error: grantError } = await supabase.rpc('community_anonymous_grant_membership', {
      p_group: groupId,
      p_user: userId,
      p_reference: metadata.reference,
      p_amount: Math.round(paidAmount),
      p_tier: 'paid',
    });
    if (grantError && grantError.code === '23505') {
      seatStatus = 'already_granted';
    } else if (grantError) {
      seatStatus = 'grant_error';
    } else if (result?.ok) {
      seatStatus = result.already_member ? 'already_member' : 'member_granted';
    } else {
      seatStatus = 'membership_denied';
    }
  }

  return { status: 200, body: { status: 'bundle_processed', count: total, for_me: forMe, gift_count: giftCount, gift_codes: codes, seat: seatStatus } };
}

// P-MK — first-party marketplace purchase from the webhook. The reference's
// UNIQUE (and the (user_id, product_id) unique) makes this safe against the
// callback verifier racing the webhook.
async function grantMarketplaceProduct(supabase, paidAmount, metadata) {
  const productId = Number(metadata?.product_id);
  const userId = metadata?.user_id;
  if (!Number.isInteger(productId) || !userId) {
    return { status: 200, body: { status: 'ignored' } };
  }

  // Server-side price/platform resolution — never trust payment metadata alone.
  const { data: product } = await supabase
    .from('marketplace_products')
    .select('id, price, access_type, kind, is_published, is_archived, marketplace_sellers(business_name)')
    .eq('id', productId)
    .maybeSingle();
  if (!product || !product.is_published || product.is_archived) {
    return { status: 200, body: { status: 'ignored' } };
  }
  // Cosmetics are Smart-Coin only (see initiate-payment.js). A webhook for one
  // can only arrive from a forged or hand-crafted charge, and granting it would
  // write a marketplace_purchases row for an item whose real entitlement lives
  // in user_cosmetics - i.e. the payer gets charged for nothing. Ignore.
  if (product.kind === 'cosmetic' || product.access_type === 'cosmetic') {
    console.error(`Webhook refused cosmetic product ${productId} (ref ${metadata.reference}): cosmetics are Smart-Coin only.`);
    return { status: 200, body: { status: 'ignored' } };
  }
  const seller = product.marketplace_sellers;
  const isPlatform =
    seller && seller.business_name?.toLowerCase() === 'polynurse';
  if (!isPlatform) {
    return { status: 200, body: { status: 'ignored' } };
  }

  // Idempotency — the callback verifier may have already granted this.
  const { data: existing } = await supabase
    .from('marketplace_purchases')
    .select('id')
    .eq('reference', metadata.reference)
    .maybeSingle();
  if (existing) {
    return { status: 200, body: { status: 'already_processed' } };
  }

  const expected = Number(product.price);
  if (expected > 0 && Math.abs(paidAmount - expected) > 1) {
    console.error(`Webhook marketplace amount mismatch, ref ${metadata.reference}: paid ${paidAmount}, expected ${expected}`);
    return { status: 200, body: { status: 'amount_mismatch' } };
  }

  const { error: txnError } = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      reference: metadata.reference,
      amount: paidAmount,
      status: 'success',
      paid_at: new Date().toISOString(),
      metadata: metadata,
    });
  // Unique on transactions.reference catches races with the verifier.
  if (txnError && txnError.code === '23505') {
    const { data: existingTxn } = await supabase
      .from('transactions')
      .select('id')
      .eq('reference', metadata.reference)
      .maybeSingle();
    if (existingTxn) return { status: 200, body: { status: 'already_processed' } };
  }
  if (txnError) throw txnError;

  const { data: grant, error: grantError } = await supabase
    .from('marketplace_purchases')
    .insert({
      user_id: userId,
      product_id: productId,
      amount: paidAmount,
      reference: metadata.reference,
      status: 'complete',
    })
    .select('id')
    .maybeSingle();
  // Unique on reference / (user_id, product_id) — the verifier may have won.
  if (grantError && grantError.code === '23505') {
    return { status: 200, body: { status: 'already_processed' } };
  }
  if (grantError) throw grantError;

  return { status: 200, body: { status: 'marketplace_granted', purchase_id: grant?.id } };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Paystack Signature
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  // Constant-time compare. `!==` on strings short-circuits at the first
  // differing character, so the time taken to reject a forged signature leaks
  // how many leading bytes were correct — a byte-at-a-time oracle for
  // reconstructing the real HMAC. timingSafeEqual has no such branch.
  //
  // It THROWS on a length mismatch, so the incoming value is length-checked
  // first: sha512 hex is always 128 chars, the expected length is public, and
  // leaking it discloses nothing.
  const provided = typeof req.headers['x-paystack-signature'] === 'string'
    ? req.headers['x-paystack-signature']
    : '';
  const expectedBuf = Buffer.from(hash, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');

  const signatureValid = providedBuf.length === expectedBuf.length
    && crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!signatureValid) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;

  if (event.event === 'charge.success') {
    const { reference, amount, metadata } = event.data;
    const supabase = getSupabaseAdmin();
    const paidAmount = amount / 100; // kobo -> naira

    try {
      // Spectator / membership products branch before any subscription logic.
      if (metadata?.product === 'anonymous_spectate') {
        const r = await grantSpectator(supabase, paidAmount, { ...(metadata || {}), reference });
        return res.status(r.status).json(r.body);
      }
      if (metadata?.product === 'anonymous_membership') {
        const r = await grantMembership(supabase, paidAmount, { ...(metadata || {}), reference });
        return res.status(r.status).json(r.body);
      }
      if (metadata?.product === 'anonymous_memberships') {
        const r = await grantMembershipsBundle(supabase, paidAmount, { ...(metadata || {}), reference });
        return res.status(r.status).json(r.body);
      }
      if (metadata?.product === 'marketplace_product') {
        const r = await grantMarketplaceProduct(supabase, paidAmount, { ...(metadata || {}), reference });
        return res.status(r.status).json(r.body);
      }

      // Legacy subscription path.
      // 0. Idempotency — the callback verifier may have already processed this
      // reference. Never create a duplicate subscription.
      const { data: existingSub } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('reference', reference)
        .maybeSingle();

      if (existingSub) {
        return res.status(200).json({ status: 'already_processed' });
      }

      const { data: existingTxn } = await supabase
        .from('transactions')
        .select('id')
        .eq('reference', reference)
        .maybeSingle();

      if (existingTxn) {
        return res.status(200).json({ status: 'already_processed' });
      }

      // 1. Log Transaction
      const { error: txnError } = await supabase
        .from('transactions')
        .insert({
          user_id: metadata?.user_id,
          reference,
          amount: paidAmount,
          status: 'success',
          paid_at: new Date().toISOString(),
          metadata: metadata
        });

      if (txnError) throw txnError;

      // 2. Resolve plan + expected amount server-side — never trust client
      // sent durations or amounts. Charge amounts below a plan's price are
      // rejected outright (no subscription grant).
      //
      // NO PLAN ID ⇒ NO SUBSCRIPTION. The Paystack PUBLIC key is public, so the
      // whole `metadata` object on a charge.success event is attacker-authored:
      // anyone can initialize a ₦1 transaction that omits plan_id and even
      // self-certifies `expected_amount_kobo`. Trusting either one as the
      // expected amount means the amount guard compares the paid figure with a
      // number the payer supplied, and 30 days of Premium ships for ₦1. Only the
      // server's own plan table decides what was bought, so an unresolvable plan
      // mints nothing and the transaction is logged for review.
      if (!metadata?.plan_id) {
        console.error(`Webhook subscription carried no plan_id for ref ${reference} — no grant`);
        return res.status(200).json({ status: 'plan_unresolved' });
      }

      const { data: plan } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', metadata.plan_id)
        .maybeSingle();

      if (!plan) {
        console.error(`Webhook plan ${metadata.plan_id} no longer exists for ref ${reference} — no grant`);
        return res.status(200).json({ status: 'plan_unresolved' });
      }

      if (plan.is_active === false) {
        console.error(`Webhook plan ${metadata.plan_id} is inactive for ref ${reference} — no grant`);
        return res.status(200).json({ status: 'plan_unavailable' });
      }

      const durationDays = plan.duration_days;
      const planName = plan.name;
      const expectedPrice = Number(plan.price);

      if (Math.abs(paidAmount - expectedPrice) > 1) {
        console.error(`Webhook amount mismatch, ref ${reference}: paid ${paidAmount}, expected ${expectedPrice}`);
        return res.status(200).json({ status: 'amount_mismatch' });
      }

      // 3. Create the subscription directly.
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
      const graceUntil = new Date(expiresAt.getTime() + 2 * 24 * 60 * 60 * 1000);

      const { error: subError } = await supabase.from('subscriptions').insert({
        user_id: metadata?.user_id,
        plan: planName.toLowerCase(),
        status: 'active',
        expires_at: expiresAt.toISOString(),
        grace_until: graceUntil.toISOString(),
        amount: paidAmount,
        reference
      });

      // Unique constraint on subscriptions.reference catches callback races.
      if (subError && subError.code !== '23505') throw subError;

      // 4. Activate the user profile.
      if (metadata?.user_id) {
        await supabase
          .from('profiles')
          .update({ is_activated: true })
          .eq('id', metadata.user_id);
      }

      return res.status(200).json({ status: 'success' });
    } catch (error) {
      console.error('Webhook processing error:', error);
      return res.status(500).json({ error: 'Internal processing error' });
    }
  }

  return res.status(200).json({ status: 'ignored' });
}