// api/payments/webhook.js
import crypto from 'crypto';
import { getSupabaseAdmin } from '../_utils';

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

    try {
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
          amount: amount / 100, // Convert from kobo
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
        amount: amount / 100,
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
