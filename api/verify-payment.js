// api/verify-payment.js
import { getSupabaseAdmin, getUserFromRequest } from './_utils';

export default async function handler(req, res) {
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

    const paidAmount = result.data.amount / 100;
    const planId = result.data.metadata?.plan_id;

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
    const { error: paymentInsertError } = await supabase.from('payments').insert({
      user_id: user.id,
      email: user.email,
      amount: paidAmount,
      reference,
      status: 'success'
    });
    if (paymentInsertError) {
      // A concurrent webhook may have won the race — re-check before failing.
      const { data: recheck } = await supabase
        .from('payments')
        .select('id')
        .eq('reference', reference)
        .maybeSingle();
      if (!recheck) throw paymentInsertError;
      return res.status(200).json({ success: true, message: 'Already processed' });
    }

    // 4b. Mirror into the transactions table so the admin finance dashboard
    // sees callback-verified payments too (webhook previously wrote only here).
    await supabase.from('transactions').upsert({
      user_id: user.id,
      reference,
      amount: paidAmount,
      status: 'success',
      paid_at: new Date().toISOString(),
      metadata: result.data.metadata || { plan_id: planId }
    }, { onConflict: 'reference' });

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
