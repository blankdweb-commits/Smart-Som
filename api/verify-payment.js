// api/verify-payment.js
// Server-side Paystack callback verifier.
// Handles TWO products:
//   - premium subscription (legacy): creates/extends a subscriptions row.
//   - anonymous_spectate: one-time ₦599 spectator pass for the Anonymous
//     group — inserts an `active` anonymous_spectators row (NO subscription).
// Both verify the transaction with Paystack, validate the amount against a
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

    // Spectator product branches early — no subscription is created.
    if (spectatorProduct) {
      const processed = await recordPayment(supabase, user, paidAmount, reference, metadata);
      if (processed) {
        return res.status(200).json({ success: true, message: 'Already processed' });
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