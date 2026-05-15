import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Verify Signature
  if (!process.env.PAYSTACK_SECRET_KEY) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(500).json({ error: 'Paystack configuration missing' });
    }
    console.warn('PAYSTACK_SECRET_KEY missing. Skipping signature check in dev.');
  } else {
    const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
      .update(JSON.stringify(req.body))
      .digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase configuration missing' });
  }

  const event = req.body;

  if (event.event === 'charge.success') {
    const { reference, customer, amount, metadata } = event.data;
    const email = customer.email;
    const actualAmount = amount / 100;
    const planId = metadata?.plan_id;

    try {
      // Find User
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (!profile) return res.status(404).json({ error: 'User not found' });

      // Prevent duplicate
      const { data: existing } = await supabase
        .from('payments')
        .select('id')
        .eq('reference', reference)
        .maybeSingle();

      if (existing) return res.status(200).json({ message: 'Handled' });

      // Insert Payment
      await supabase.from('payments').insert({
        user_id: profile.id,
        email,
        amount: actualAmount,
        reference,
        status: 'success'
      });

      // 3. Resolve Plan Details
      let durationDays = 30; // Default to Monthly
      let planName = 'Monthly';

      if (planId) {
        const { data: plan } = await supabase.from('subscription_plans').select('*').eq('id', planId).maybeSingle();
        if (plan) {
          durationDays = plan.duration_days;
          planName = plan.name;
        }
      } else {
        // Fallback by amount if metadata missing
        if (actualAmount >= 49999) { durationDays = 365; planName = 'Yearly'; }
        else if (actualAmount <= 2000) { durationDays = 7; planName = 'Weekly'; }
      }

      // Activate Subscription
      const now = new Date();
      const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);
      const graceUntil = new Date(expiresAt.getTime() + 2 * 24 * 60 * 60 * 1000);

      await supabase.from('subscriptions').insert({
        user_id: profile.id,
        plan: planName.toLowerCase(),
        status: 'active',
        expires_at: expiresAt.toISOString(),
        grace_until: graceUntil.toISOString(),
        amount: actualAmount
      });

      // Activate Profile
      await supabase.from('profiles').update({ is_activated: true }).eq('id', profile.id);

      return res.status(200).json({ message: 'Success' });
    } catch (err) {
      console.error('Webhook Error:', err);
      return res.status(500).json({ error: 'Internal Error' });
    }
  }

  return res.status(200).json({ message: 'Ignored' });
}
