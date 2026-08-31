// ============================================================
// Quota API — free-user 50-question / 12-hour cooldown.
//
// GET  /api/quota/status   → current quota state (server timestamps).
// POST /api/quota/consume  → atomically consume one answered question.
//      Body: { count } (optional, default 1). Consumes that many ONLY if the
//      caller passes category-A evidence (genuine answered question path).
//      Premium users are exempt server-side (never consumed against them).
// ============================================================
import { getSupabaseAdmin, authorizeRequest } from './_utils';

const PREMIUM_FREE_UNLIMITED = true; // premium = unlimited by design

const getStatus = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  // Premium users have no quota.
  const premium = await isPremium(user.id, supabase);
  if (premium) {
    return res.status(200).json({
      premium: true,
      unlimited: true,
      questions_remaining: null,
      in_cooldown: false,
      window_expires_at: null
    });
  }

  try {
    const { data, error } = await supabase.rpc('get_quota_status', { p_user_id: user.id });
    if (error) throw error;
    return res.status(200).json({
      premium: false,
      unlimited: false,
      ...(data || {}),
      questions_remaining: data?.questions_remaining ?? 0,
      in_cooldown: (data?.questions_remaining ?? 0) <= 0
    });
  } catch (err) {
    console.error('Quota status error:', err.message);
    return res.status(500).json({ error: 'Internal error reading quota' });
  }
};

const consume = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  // Premium = unlimited; never consume against them.
  const premium = await isPremium(user.id, supabase);
  if (premium) {
    return res.status(200).json({
      premium: true,
      unlimited: true,
      consumed: 0,
      questions_remaining: null,
      in_cooldown: false
    });
  }

  const requested = Math.max(1, Math.min(50, Number(req.body?.count) || 1));

  try {
    let remaining = null;
    for (let i = 0; i < requested; i++) {
      const { data, error } = await supabase.rpc('consume_question', { p_user_id: user.id });
      if (error) throw error;
      remaining = data;
      if (remaining === -1) break; // exhausted
    }
    const inCooldown = remaining === -1 || remaining === 0;
    // Fetch full state for accurate countdown timestamps.
    const state = await supabase.rpc('get_quota_status', { p_user_id: user.id });
    return res.status(200).json({
      premium: false,
      unlimited: false,
      consumed: inCooldown ? 0 : Math.min(requested, remaining >= 0 ? requested : 0),
      questions_remaining: state.data?.questions_remaining ?? remaining,
      in_cooldown: state.data?.questions_remaining <= 0,
      window_expires_at: state.data?.window_expires_at ?? null,
      window_started_at: state.data?.window_started_at ?? null
    });
  } catch (err) {
    console.error('Quota consume error:', err.message);
    return res.status(500).json({ error: 'Internal error consuming quota' });
  }
};

// Server-side premium check — single source of truth. Never trusts a client flag.
async function isPremium(userId, supabase) {
  if (!supabase) return false;
  try {
    const { data } = await supabase
      .from('subscriptions')
      .select('id, expires_at, grace_until, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return false;
    const now = Date.now();
    if (new Date(data.expires_at).getTime() > now) return true;
    if (data.grace_until && new Date(data.grace_until).getTime() > now) return true;
    if (data.status === 'active' && data.expires_at) {
      // Allow a small tolerance; authoritative is expires_at > now.
      return false;
    }
    return false;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && path.endsWith('/status')) return getStatus(req, res);
  if (req.method === 'POST' && path.endsWith('/consume')) return consume(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
