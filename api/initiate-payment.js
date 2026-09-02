// api/initiate-payment.js
// Server-side Paystack Session Initializer.
// Calls Paystack /transaction/initialize and returns a hosted
// authorization_url. On iOS/mobile Safari the injected inline popup iframe
// is unreliable, so the client redirects to this URL, pays on Paystack's
// hosted page, and Paystack redirects back to the callback (verify) URL.
import { getSupabaseAdmin, getUserFromRequest } from './_utils.js';

const KOBOS = 100;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ error: 'Payment gateway is not configured' });
  }

  // SECURITY: identity comes from the Supabase access token, never the body.
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { plan_id } = req.body || {};
  if (!plan_id) return res.status(400).json({ error: 'Missing plan id' });

  try {
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

    const reference = `APX-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;

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
        amount: Math.round(Number(plan.price) * KOBOS),
        currency: 'NGN',
        reference,
        callback_url,
        metadata: {
          plan_id: plan.id,
          plan_name: plan.name,
          user_id: user.id
        }
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
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}