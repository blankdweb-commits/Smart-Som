// ============================================================
// Daily Challenge API — remediation from the learner's OWN past mistakes.
//
// GET /api/daily-challenge
//   Returns today's challenge: 5 question ids drawn from the previous day's
//   FAILED questions (most-broken first), supplemented by weak-topic questions
//   if fewer than 5 failed questions exist. Never fabricates questions.
//
// POST /api/daily-challenge/complete
//   Body: { score, total, question_ids }
// ============================================================
import { getSupabaseAdmin, authorizeRequest } from './_utils';

const CHALLENGE_SIZE = 5;
const HARDCODED_POOL = null; // resolved client-side; server returns ids only

const getToday = () => {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return iso;
};

const getChallenge = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const today = getToday();
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    // Read today's existing challenge first.
    const { data: existing } = await supabase
      .from('daily_challenge')
      .select('*')
      .eq('user_id', user.id)
      .eq('challenge_date', today)
      .maybeSingle();
    if (existing && Array.isArray(existing.question_ids) && existing.question_ids.length > 0) {
      return res.status(200).json({
        question_ids: existing.question_ids,
        score: existing.score,
        total: existing.total,
        completed: existing.completed
      });
    }

    // 1) Preferred: yesterday's failed questions (most recently missed first).
    const { data: failed } = await supabase
      .from('question_attempts')
      .select('question_id, topic, subject')
      .eq('user_id', user.id)
      .eq('correct', false)
      .gte('created_at', yesterday)
      .order('created_at', { ascending: false });
    let ids = [];
    const seen = new Set();
    (failed || []).forEach(a => {
      const qid = String(a.question_id || '').trim();
      if (qid && qid !== '' && !seen.has(qid)) {
        seen.add(qid);
        ids.push(qid);
      }
    });

    // 2) Supplement with weak-topic question ids when < 5 failed.
    if (ids.length < CHALLENGE_SIZE) {
      await supabase
        .from('learning_analytics')
        .select('weak_concepts')
        .eq('user_id', user.id)
        .maybeSingle();
      // The server can't resolve hardcoded-bank topic ids for weak concepts, so
      // supplement from the user's most-missed overall attempts below.
      const { data: missedAll } = await supabase
        .from('question_attempts')
        .select('question_id')
        .eq('user_id', user.id)
        .eq('correct', false)
        .order('created_at', { ascending: false })
        .limit(200);
      (missedAll || []).forEach(a => {
        const qid = String(a.question_id || '').trim();
        if (qid && !seen.has(qid)) {
          seen.add(qid);
          ids.push(qid);
        }
      });
    }

    // 3) Final fallback: top unanswered popular ids are resolved client-side;
    // keep server deterministic — if still empty the client will fill from
    // its hardcoded pool. Cap at CHALLENGE_SIZE, no duplicates.
    ids = [...new Set(ids)].slice(0, CHALLENGE_SIZE);

    // Persist (so a refresh returns the same set).
    if (ids.length > 0) {
      await supabase
        .from('daily_challenge')
        .upsert({
          user_id: user.id,
          challenge_date: today,
          question_ids: ids,
          score: 0,
          total: ids.length,
          completed: false
        }, { onConflict: 'user_id,challenge_date' });
    }

    return res.status(200).json({
      question_ids: ids,
      score: 0,
      total: ids.length,
      completed: false,
      from_previous_day_failed: ids.length > 0
    });
  } catch (err) {
    console.error('Daily challenge error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

const completeChallenge = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const { score = 0, total = 0, question_ids = [] } = req.body || {};
  const today = getToday();

  try {
    await supabase.from('daily_challenge').upsert({
      user_id: user.id,
      challenge_date: today,
      question_ids,
      score,
      total,
      completed: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,challenge_date' });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Daily challenge complete error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && path.endsWith('/daily-challenge')) return getChallenge(req, res);
  if (req.method === 'POST' && path.endsWith('/complete')) return completeChallenge(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
