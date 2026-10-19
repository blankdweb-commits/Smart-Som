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
//
// POST /api/feedback/conversion
//   Body: { action, plan_id, surface, metadata }
//   One row per funnel event into public.conversion_events, written through the
//   SERVICE ROLE only — the table has no client INSERT policy by design, so a
//   forged event cannot be planted from a browser. Reads are admin-only RLS.
//
//   Both `action` and every metadata KEY are closed allowlists. An allowlist on
//   VALUES alone is not privacy: the caller controls the metadata object, so an
//   open key space lets an analytics tag carry whatever the client likes
//   (an email, a payment reference, a full name) into a table an admin reads in
//   bulk. Nothing outside these names is persisted, ever.
import { applyCors, getSupabaseAdmin, authorizeRequest } from './_utils.js';

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

// The funnel, as a CLOSED set. An unknown action is dropped rather than stored
// under whatever the client called it, so the table can never accumulate
// unbounded, attacker-chosen "kinds".
const VALID_CONVERSION_ACTIONS = new Set([
  'pricing_viewed',
  'offer_viewed',
  'modal_view',
  'modal_dismiss',
  'upgrade_click',
  'plan_selected',
  'checkout_started',
  'premium_activated'
]);

// The ONLY metadata keys that may ever be persisted. Each is a short,
// low-cardinality string or number. No email, no name, no payment reference,
// no free-text, no credential, no URL with query parameters.
const CONVERSION_METADATA_KEYS = new Set(['surface', 'plan_id', 'offer_state']);
const CONVERSION_STRING_MAX = 64;

const conversion = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const { action, plan_id, surface, offer_state, metadata } = req.body || {};

  // Silent 204 for an unrecognised action. Analytics must never be the reason a
  // client errors, and refusing loudly would confirm to a prober exactly which
  // action names exist.
  if (!VALID_CONVERSION_ACTIONS.has(action)) {
    return res.status(204).end();
  }

  // Built here, field by field, from validated inputs. The caller's `metadata`
  // object is never spread through — only these three names are ever read, and
  // each is coerced to a bounded string.
  //
  // A top-level field and a nested one are both accepted, top-level winning.
  // The lookup must go through `??` per key rather than object spread:
  // `{ ...metadata, plan_id }` writes `plan_id: undefined` over a perfectly good
  // nested value whenever the top-level key is absent, silently dropping it.
  const nested = metadata && typeof metadata === 'object' ? metadata : {};
  const clean = {};
  for (const key of CONVERSION_METADATA_KEYS) {
    const v = ({ surface, plan_id, offer_state })[key] ?? nested[key];
    if (v === undefined || v === null || v === '') continue;
    clean[key] = String(v).slice(0, CONVERSION_STRING_MAX);
  }

  try {
    const { error } = await supabase.from('conversion_events').insert({
      user_id: user.id,
      action,
      metadata: clean,
    });
    if (error) throw error;
    return res.status(204).end();
  } catch (err) {
    // A failed analytics write must never surface to the user or break the
    // flow that produced it — the event is best-effort by definition.
    console.error('Conversion event error:', err.message);
    return res.status(204).end();
  }
};

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'POST' && path.endsWith('/feedback')) return submit(req, res);
  if (req.method === 'GET' && path.endsWith('/mine')) return mine(req, res);
  if (req.method === 'POST' && path.endsWith('/conversion')) return conversion(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
