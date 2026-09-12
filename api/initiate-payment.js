// api/initiate-payment.js
// Server-side Paystack Session Initializer.
// Calls Paystack /transaction/initialize and returns a hosted
// authorization_url. On iOS/mobile Safari the injected inline popup iframe
// is unreliable, so the client redirects to this URL, pays on Paystack's
// hosted page, and Paystack redirects back to the callback (verify) URL.
//
// Products:
//   { plan_id }                          -> premium subscription (legacy)
//   { product:'anonymous_spectate', group_id } -> one-time ₦599 spectator pass
import { applyCors, getSupabaseAdmin, getUserFromRequest } from './_utils.js';

const KOBOS = 100;

// Server-side resolution of an anonymous spectator purchase: the group must be
// an ACTIVE anonymous group and the buyer must not be a member or an already
// active spectator. Returns { amount, metadata, reference } or throws an
// object { code, status } for the caller to return.
async function resolveSpectatorPurchase(supabase, user, groupIdRaw) {
  const groupId = Number(groupIdRaw);
  if (!Number.isFinite(groupId)) {
    const e = new Error('Invalid group id');
    e.code = 'INVALID_GROUP'; e.status = 400; throw e;
  }

  const { data: group, error: groupError } = await supabase
    .from('study_groups')
    .select('id, name, type, group_state, spectator_price')
    .eq('id', groupId)
    .maybeSingle();
  if (groupError) {
    const e = new Error('Failed to resolve group');
    e.code = 'GROUP_LOOKUP_FAILED'; e.status = 500; throw e;
  }
  if (!group) {
    const e = new Error('Group not found');
    e.code = 'GROUP_NOT_FOUND'; e.status = 404; throw e;
  }
  if (group.type !== 'anonymous') {
    const e = new Error('This group is not anonymous');
    e.code = 'NOT_ANONYMOUS'; e.status = 400; throw e;
  }
  // Spectators are only purchasable once the group has activated (30 members).
  if (group.group_state !== 'active') {
    const e = new Error('Spectator access unlocks once the Anonymous group is active');
    e.code = 'GROUP_NOT_ACTIVE'; e.status = 400; throw e;
  }
  const price = Number(group.spectator_price);
  if (!price || price <= 0) {
    const e = new Error('Not purchasable');
    e.code = 'NOT_PURCHASABLE'; e.status = 400; throw e;
  }

  // A member already has full access; an existing active spectator must not
  // be double-charged.
  const { data: member } = await supabase
    .from('study_group_members')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (member) {
    const e = new Error('Members already have full access');
    e.code = 'ALREADY_MEMBER'; e.status = 400; throw e;
  }
  const { data: existing } = await supabase
    .from('anonymous_spectators')
    .select('reference')
    .eq('group_id', groupId)
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existing) {
    const e = new Error('You already have spectator access to this group');
    e.code = 'ALREADY_SPECTATOR'; e.status = 400; throw e;
  }

  return {
    amount: price,
    metadata: {
      product: 'anonymous_spectate',
      group_id: groupId,
      group_name: group.name,
      user_id: user.id,
    },
    reference: `APX-SPE-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  };
}

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  if (!process.env.PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ error: 'Payment gateway is not configured' });
  }

  // SECURITY: identity comes from the Supabase access token, never the body.
  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { plan_id, product, group_id } = req.body || {};

  try {
    let amount;
    let reference;
    let metadata;

    if (product === 'anonymous_spectate') {
      // One-time spectator pass — no subscription is involved.
      const spec = await resolveSpectatorPurchase(supabase, user, group_id);
      amount = spec.amount;
      metadata = spec.metadata;
      reference = spec.reference;
    } else {
      if (!plan_id) return res.status(400).json({ error: 'Missing plan id' });
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
      amount = Number(plan.price);
      reference = `APX-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
      metadata = { plan_id: plan.id, plan_name: plan.name, user_id: user.id };
    }

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
        amount: Math.round(amount * KOBOS),
        currency: 'NGN',
        reference,
        callback_url,
        metadata
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
    const status = error.status || 500;
    return res.status(status).json({ error: error.code || 'Internal Server Error', message: error.message });
  }
}