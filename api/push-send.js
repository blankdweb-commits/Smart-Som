// ============================================================
// POST /api/push-send
//
// Sends an OS push notification to THE REQUESTING USER's own device
// subscription(s). This powers in-app-triggered alerts (achievement unlocked,
// daily challenge ready, round stats, …). Users can never push to each other
// from here — cross-user pushes (e.g. "your 1v1 match is live") are sent by
// server flows that already validated both parties (matches-create) or by the
// cron reminder route.
//
// Body: {
//   title, body, url?, tag?,
//   kind?: string,       // e.g. 'achievement' — logged once per kind+day
//   actions?: [{action,title}]   // optional notification action buttons
// }
// ============================================================
import { applyCors, authorizeRequest, getSupabaseAdmin } from './_utils.js';
import { notifyUser, USER_FACING_KINDS } from './_push.js';

const MAX = { title: 120, body: 320, url: 300, kind: 40, actions: 3, actionTitle: 24 };

const clean = (value, max) => String(value == null ? '' : value).trim().slice(0, max);

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user, status, body: authBody } = await authorizeRequest(req);
  if (!user) return res.status(status).json(authBody);

  const b = req.body || {};
  const title = clean(b.title, MAX.title);
  if (!title) {
    return res.status(400).json({ error: 'Invalid request', message: 'title is required.' });
  }

  const actions = Array.isArray(b.actions) && b.actions.length > 0
    ? b.actions
        .filter(a => a && typeof a.action === 'string' && typeof a.title === 'string')
        .slice(0, MAX.actions)
        .map(a => ({ action: clean(a.action, MAX.title), title: clean(a.title, MAX.actionTitle) }))
    : undefined;

  const kind = clean(b.kind, MAX.kind);
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const result = await notifyUser(supabase, user.id, {
      title,
      body: clean(b.body, MAX.body),
      url: clean(b.url, MAX.url) || '/',
      tag: clean(b.tag, MAX.kind) || undefined,
      actions,
      data: { kind: kind || 'manual' },
    }, {
      kind,
      log: Boolean(kind) && USER_FACING_KINDS.has(kind) || kind === 'achievement',
    });

    return res.status(200).json({
      sent: result.sent,
      endpoints: result.endpoints,
      delivered: result.delivered,
      reason: result.sent === 0 ? (result.reason || 'no subscription on this device') : undefined,
    });
  } catch (err) {
    console.error('[push/send] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}