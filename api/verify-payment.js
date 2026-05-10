import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { reference, user_id } = req.body;

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

    const email = result.data.customer.email;
    const amount = result.data.amount / 100;

    // 2. Prevent duplicate processing
    const { data: existingPayment } = await supabase
      .from('payments')
      .select('*')
      .eq('reference', reference)
      .maybeSingle();

    if (existingPayment) {
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    // 3. Record Payment
    await supabase.from('payments').insert({
      user_id,
      email,
      amount,
      reference,
      status: 'success'
    });

    // 4. Activate Subscription (30 days + 2-day grace)
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const graceUntil = new Date(expiresAt.getTime() + 2 * 24 * 60 * 60 * 1000);

    await supabase.from('subscriptions').insert({
      user_id,
      status: 'active',
      expires_at: expiresAt.toISOString(),
      grace_until: graceUntil.toISOString(),
      amount
    });

    // 5. Update Profile Activation
    await supabase.from('profiles').update({ is_activated: true }).eq('id', user_id);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Payment Verification Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
