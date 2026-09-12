// api/payments-webhook.js (webhook URL: /api/payments/webhook via vercel.json rewrite)
//
// Handles charge.success for BOTH products:
//   - premium subscription (legacy): creates a subscriptions row + activates profile.
//   - anonymous_spectate: one-time ₦599 spectator pass — inserts an `active`
//     anonymous_spectators row (NO subscription, NO profile activation).
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

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify Paystack Signature
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;

  if (event.event === 'charge.success') {
    const { reference, amount, metadata } = event.data;
    const supabase = getSupabaseAdmin();
    const paidAmount = amount / 100; // kobo -> naira

    try {
      // Spectator product branches before any subscription logic.
      if (metadata?.product === 'anonymous_spectate') {
        const r = await grantSpectator(supabase, paidAmount, { ...(metadata || {}), reference });
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

      // 2. Resolve plan duration server-side — never trust client-sent durations.
      let durationDays = 30;
      let planName = 'Monthly';

      if (metadata?.plan_id) {
        const { data: plan } = await supabase
          .from('subscription_plans')
          .select('*')
          .eq('id', metadata.plan_id)
          .maybeSingle();
        if (plan) {
          durationDays = plan.duration_days;
          planName = plan.name;
        }
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