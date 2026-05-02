import { getSupabaseAdmin, generateProductKey } from './_utils';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // 1. Verify Webhook Signature
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const hash = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const body = req.body;
  const supabase = getSupabaseAdmin();

  if (body.event === 'charge.success') {
    const { reference, customer, amount, metadata } = body.data;
    const email = customer.email;
    const userId = metadata?.user_id;

    // 2. Log Transaction
    await supabase.from('transactions').insert({
      user_id: userId,
      reference,
      amount: amount / 100,
      status: 'success',
      metadata: body.data
    });

    // 3. Find/Create Profile
    let userRecordId = userId;
    if (!userRecordId) {
      const { data: profile } = await supabase.from('profiles').select('id').eq('email', email).single();
      if (profile) userRecordId = profile.id;
    }

    if (userRecordId) {
      // 4. Generate & Assign Product Key
      const key = generateProductKey();

      // Update profile status
      await supabase.from('profiles').update({
        is_activated: true,
        last_payment_date: new Date().toISOString()
      }).eq('id', userRecordId);

      // Create Subscription Record
      await supabase.from('subscriptions').insert({
        user_id: userRecordId,
        product_key: key,
        status: 'active',
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      });

      // Insert into product_keys table for redundancy/manual recovery
      await supabase.from('product_keys').insert({
        key: key, // In production, consider hashing this
        status: 'used',
        assigned_to: userRecordId,
        activated_at: new Date().toISOString()
      });
    }
  }

  return res.status(200).json({ status: 'ok' });
}
