// ============================================================
// Feedback API — Reviews & Suggestions (app/feature/quiz/marketplace/community).
//
// POST /api/feedback
//   Body: { type, message }
//   type ∈ app_review | feature_suggestion | quiz_feedback |
//          marketplace_feedback | community_feedback | other
//
// GET /api/feedback/mine     → the caller's submissions.
// (Admin review happens client-side against feedback_submissions + is_admin.)
// ============================================================
import { getSupabaseAdmin, authorizeRequest } from './_utils.js';

const VALID_TYPES = new Set([
  'app_review',
  'feature_suggestion',
  'quiz_feedback',
  'marketplace_feedback',
  'community_feedback',
  'other'
]);

const submit = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const { type = 'other', message } = req.body || {};
  const msg = String(message || '').trim();
  if (!msg) return res.status(400).json({ error: 'Message is required' });
  const cleanType = VALID_TYPES.has(type) ? type : 'other';

  try {
    const { data, error } = await supabase
      .from('feedback_submissions')
      .insert({ user_id: user.id, type: cleanType, message: msg.slice(0, 2000) })
      .select('id, type, message, status, created_at')
      .single();
    if (error) throw error;
    return res.status(200).json({ success: true, submission: data });
  } catch (err) {
    console.error('Feedback submit error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

const mine = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const { data, error } = await supabase
      .from('feedback_submissions')
      .select('id, type, message, status, admin_note, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return res.status(200).json({ submissions: data || [] });
  } catch (err) {
    console.error('Feedback mine error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && path.endsWith('/feedback')) return submit(req, res);
  if (req.method === 'GET' && path.endsWith('/mine')) return mine(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
