// ============================================================
// Quota API — per-course round quota (v13). Free users only.
//
// GET  /api/quota/course-status  → per-course quota map for the Course Selector
//      { [course_key]: { questions_used, rounds_completed, last_round_completed_at,
//                         window_expires_at, cooldown_remaining_seconds, is_ready } }
// POST /api/quota/course-consume → reserve a round for a course.
//      Body: { course_key, count? }
//      FREE users are charged exactly 10 questions + a 1h cooldown, regardless
//      of `count`. PREMIUM users get 10-30 (server-clamped) with no cooldown.
//      The count is validated SERVER-SIDE only — never trusted from the client.
//      Returns { allowed, premium, questions_remaining, round_completed,
//                rounds_completed, window_expires_at, cooldown_remaining_seconds,
//                is_ready }.
// ============================================================
import { getSupabaseAdmin, authorizeRequest } from './_utils.js';

const courseStatus = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const { data, error } = await supabase.rpc('get_course_quota_status', { p_user_id: user.id });
    if (error) throw error;
    return res.status(200).json({ subjects: data || {} });
  } catch (err) {
    console.error('Course quota status error:', err.message);
    return res.status(500).json({ error: 'Internal error reading course quota' });
  }
};

const consume = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const courseKey = String(req.body?.course_key || '').trim();
  if (!courseKey || courseKey.length < 3) {
    return res.status(400).json({ error: 'Missing or invalid course_key' });
  }

  // Server-side premium check — single source of truth. Never trusts a client flag.
  const premium = await isPremium(user.id, supabase);
  const requested = Number(req.body?.count) || 10;

  try {
    const { data, error } = await supabase.rpc('consume_course_quota', {
      p_user_id: user.id,
      p_course_key: courseKey,
      p_count: requested,
      p_is_premium: premium
    });
    if (error) throw error;
    return res.status(200).json({
      premium,
      ...(data || {})
    });
  } catch (err) {
    console.error('Course quota consume error:', err.message);
    return res.status(500).json({ error: 'Internal error consuming course quota' });
  }
};

// Server-side premium check (subscriptions table, authoritative).
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
    return false;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && path.endsWith('/course-status')) return courseStatus(req, res);
  if (req.method === 'POST' && path.endsWith('/course-consume')) return consume(req, res);
  // Old v10/v12 endpoints are gone — tell callers explicitly.
  return res.status(410).json({ error: 'Gone — use /api/quota/course-status or /api/quota/course-consume' });
}