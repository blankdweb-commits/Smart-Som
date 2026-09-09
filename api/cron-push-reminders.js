// ============================================================
// GET /api/cron-push-reminders   (Vercel Cron -> vercel.json `crons`)
//
// Server-driven Web Push reminders. Runs on a schedule (morning + evening, see
// vercel.json) and pushes to every user with >= 1 push subscription, deduped
// by (user, kind, day) via push_log so nobody is pinged twice for the same
// alert.
//
// Auth: Authorization: Bearer <CRON_SECRET>, or ?token=<CRON_SECRET> (Vercel Cron
// can't send custom headers, so the schedule embeds the secret in the query via
// the $CRON_SECRET macro). Requests without a valid token get 403.
//
// Alert matrix (all gated on "has a subscription" + "not already sent today"):
//   MORNING slot (05–12 UTC):
//     - daily-reminder : studied in the last 3 days but not today
//     - challenge-ready: hasn't completed today's daily challenge
//   EVENING slot (13–23 UTC):
//     - streak-alert   : studied in the last 3 days but not today
//     - exam-near      : an exam on the timetable is within 3 days
// ============================================================
import { getSupabaseAdmin } from './_utils.js';
import { notifyUser } from './_push.js';

const DAY = 24 * 60 * 60 * 1000;
const MAX_USERS_PER_RUN = 200;

const startOfTodayUtc = () => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
};

const fmt = () => new Date().toISOString().slice(0, 10);

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  const url = new URL(req.url || '', 'http://internal');
  const queryToken = (req.query && req.query.token) || url.searchParams.get('token');
  const got = String(req.headers.authorization || '');
  const authed = expected && (got === `Bearer ${expected}` || queryToken === expected);
  if (!authed) return res.status(403).json({ error: 'FORBIDDEN', message: 'Cron endpoint requires the CRON_SECRET token.' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });
  if (!process.env.VAPID_PRIVATE_KEY) {
    return res.status(200).json({ skipped: true, reason: 'VAPID not configured' });
  }

  const started = Date.now();
  const todayStart = startOfTodayUtc();
  const todayIso = fmt();
  const hourUtc = new Date().getUTCHours();
  const slot = hourUtc >= 5 && hourUtc <= 12 ? 'morning' : 'evening';
  const summary = { slot, users: 0, attempted: 0, sent: 0, byKind: {} };

  const send = async (userId, kind, title, body, url) => {
    const result = await notifyUser(supabase, userId, {
      title, body, url,
      tag: kind,
      data: { kind },
    }, { kind, log: true });
    summary.attempted += 1;
    if (result.sent > 0) {
      summary.sent += result.sent;
      summary.byKind[kind] = (summary.byKind[kind] || 0) + result.sent;
    }
    return result;
  };

  try {
    const { data: rows } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .order('updated_at', { ascending: false })
      .limit(MAX_USERS_PER_RUN);

    const userIds = [...new Set((rows || []).map(r => r.user_id))];
    if (userIds.length === 0) {
      return res.status(200).json({ ...summary, elapsedMs: Date.now() - started });
    }

    const { data: logRows } = await supabase
      .from('push_log')
      .select('user_id, kind')
      .eq('sent_date', todayIso)
      .in('user_id', userIds);
    const sentToday = new Map();
    (logRows || []).forEach(r => {
      if (!sentToday.has(r.user_id)) sentToday.set(r.user_id, new Set());
      sentToday.get(r.user_id).add(r.kind);
    });

    // Last study activity per user (proxy for "has a habit worth protecting").
    const { data: attemptRows } = await supabase
      .from('question_attempts')
      .select('user_id, created_at')
      .in('user_id', userIds)
      .order('created_at', { ascending: false })
      .limit(userIds.length * 4);
    const lastStudyByUser = new Map();
    (attemptRows || []).forEach(a => {
      const ts = Date.parse(a.created_at);
      if (!lastStudyByUser.has(a.user_id) || ts > lastStudyByUser.get(a.user_id)) {
        lastStudyByUser.set(a.user_id, ts);
      }
    });

    // Exams within the next 3 days.
    const nowTs = Date.now();
    const { data: examRows } = await supabase
      .from('exams')
      .select('user_id, title, date')
      .in('user_id', userIds)
      .gte('date', startOfTodayUtc())
      .lte('date', startOfTodayUtc() + 3 * DAY);

    if (slot === 'morning') {
      // Who already finished today's challenge?
      const { data: challengeRows } = await supabase
        .from('daily_challenge')
        .select('user_id')
        .eq('challenge_date', todayIso)
        .eq('completed', true)
        .in('user_id', userIds);
      const challengeDone = new Set((challengeRows || []).map(r => r.user_id));

      for (const userId of userIds) {
        const lastStudy = lastStudyByUser.get(userId);
        const studiedToday = lastStudy >= todayStart;
        const studiedRecently = studiedToday || (lastStudy >= todayStart - 3 * DAY);
        const already = sentToday.get(userId) || new Set();
        if (!studiedToday && studiedRecently && !already.has('daily-reminder')) {
          await send(userId, 'daily-reminder',
            'A few minutes keeps the habit',
            'You haven\u2019t studied today — let\u2019s keep things moving with a short round.',
            '/quiz');
        }
        if (studiedRecently && !already.has('challenge-ready') && !challengeDone.has(userId)) {
          await send(userId, 'challenge-ready',
            'Today\u2019s challenge is waiting',
            'A short remediation round built from your recent mistakes — 5 questions.',
            '/quiz?mode=daily');
        }
        summary.users += 1;
      }
    } else {
      for (const userId of userIds) {
        const lastStudy = lastStudyByUser.get(userId);
        const studiedToday = lastStudy >= todayStart;
        const studiedRecently = studiedToday || (lastStudy >= todayStart - 3 * DAY);
        const already = sentToday.get(userId) || new Set();

        if (!studiedToday && studiedRecently && !already.has('streak-alert')) {
          await send(userId, 'streak-alert',
            'Your streak needs you today',
            'Answer a few questions now so tomorrow\u2019s streak survives.',
            '/quiz');
        }

        const nearExam = (examRows || [])
          .filter(e => e.user_id === userId)
          .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
        if (nearExam && !already.has('exam-near')) {
          const days = Math.max(0, Math.round((new Date(nearExam.date) - nowTs) / DAY));
          await send(userId, 'exam-near',
            days === 0 ? `${nearExam.title} is today` : `${nearExam.title} in ${days} day${days > 1 ? 's' : ''}`,
            'Review the high-yield topics before the deadline — a targeted quiz helps.',
            '/exams');
        }
        summary.users += 1;
      }
    }

    return res.status(200).json({ ...summary, elapsedMs: Date.now() - started });
  } catch (err) {
    console.error('[cron/push-reminders] error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
}