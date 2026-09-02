// ============================================================
// Progress API — server-side difficulty unlocks + question history.
//
// POST /api/progress/difficulty
//      Body: { difficulty: 'Easy'|'Medium'|'Hard'|'Expert', answers: [
//        { question_id, correct } ... ] }
//      Increments the correct-count for the difficulty ONLY for genuinely
//      correct answers, per the spec (incorrect answers do not contribute).
//      Also records exposure in user_question_history.
//
// GET /api/progress/difficulty
//      Returns correct counts per difficulty + which are unlocked.
//
// GET /api/progress/history
//      Returns the user's seen question ids (for non-repetition).
// ============================================================
import { getSupabaseAdmin, authorizeRequest } from './_utils.js';

const DIFFICULTY_ORDER = ['Easy', 'Medium', 'Hard', 'Expert'];
// Unlock thresholds (correct answers only) per the spec.
const UNLOCK_THRESHOLDS = {
  Easy: 0,       // always unlocked
  Medium: 50,    // needs 50 Easy correct
  Hard: 80,      // needs 80 Medium correct
  Expert: 100    // needs 100 Hard correct
};
// The difficulty whose CORRECT count gates the target difficulty.
const GATED_BY = {
  Medium: 'Easy',
  Hard: 'Medium',
  Expert: 'Hard'
};

const getDifficulty = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const { data, error } = await supabase.rpc('get_difficulty_status', { p_user_id: user.id });
    if (error) throw error;
    const counts = data || {}; // { Easy: n, Medium: n, ... }
    const progress = DIFFICULTY_ORDER.map(d => {
      const count = counts[d] || 0;
      const requiredBy = GATED_BY[d];
      const gateCount = requiredBy ? (counts[requiredBy] || 0) : 0;
      const target = UNLOCK_THRESHOLDS[d];
      const unlocked = d === 'Easy' ? true : gateCount >= target;
      return {
        difficulty: d,
        correct_count: count,
        target: d === 'Easy' ? null : target,
        gated_by: requiredBy || null,
        gate_progress: d === 'Easy' ? null : gateCount,
        unlocked
      };
    });
    return res.status(200).json({ progress });
  } catch (err) {
    console.error('Difficulty status error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

const postDifficulty = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const { difficulty, answers } = req.body || {};
  const diff = String(difficulty || '').trim();
  if (!DIFFICULTY_ORDER.includes(diff)) {
    return res.status(400).json({ error: 'Invalid difficulty' });
  }

  const list = Array.isArray(answers) ? answers : [];
  let correctConsumed = 0;
  try {
    for (const a of list) {
      const qid = String(a?.question_id || '').trim();
      const correct = !!a?.correct;
      if (!qid) continue;
      // Record exposure regardless.
      if (correct) {
        await supabase.rpc('record_question_seen', { p_user_id: user.id, p_question_id: qid, p_correct: true });
        // Increment difficulty correct count only when genuinely correct.
        await supabase.rpc('record_difficulty_correct', { p_user_id: user.id, p_difficulty: diff });
        correctConsumed += 1;
      } else {
        await supabase.rpc('record_question_seen', { p_user_id: user.id, p_question_id: qid, p_correct: false });
      }
    }
    return res.status(200).json({
      success: true,
      difficulty: diff,
      correct_consumed: correctConsumed
    });
  } catch (err) {
    console.error('Difficulty record error:', err.message);
    return res.status(500).json({ error: 'Internal error recording progress' });
  }
};

const getHistory = async (req, res) => {
  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  try {
    const { data, error } = await supabase
      .from('user_question_history')
      .select('question_id, times_seen, last_seen, last_result, correct_count, attempt_count')
      .eq('user_id', user.id);
    if (error) throw error;
    return res.status(200).json({ history: data || [] });
  } catch (err) {
    console.error('History error:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
};

export default async function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  if (path.endsWith('/difficulty')) {
    if (req.method === 'GET') return getDifficulty(req, res);
    if (req.method === 'POST') return postDifficulty(req, res);
  }
  if (path.endsWith('/history') && req.method === 'GET') return getHistory(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
