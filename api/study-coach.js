// ============================================================
// Study Coach API — Gemini-powered personalization & learning assistant.
//
// POST /api/study-coach
//   Body: {
//     intent: 'overview' | 'teach' | 'practice' | 'mistakes' | 'plan' | 'chat',
//     question?, correctAnswer?, options?, userQuestion?,
//   }
//   The server fetches the caller's real learning context (recent accuracy,
//   weak topics, streak, attempt volume) and personalizes the response.
//   Gemini NEVER controls scores/answers/premium/payments/unlocks.
// ============================================================
import { getSupabaseAdmin, authorizeRequest } from './_utils';

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

async function fetchLearningContext(userId, supabase) {
  if (!supabase) return { ready: false };
  const ctx = { ready: true, weakConcepts: [], totalAttempts: 0, q7: 0, streak: 0, accuracy: 0 };
  try {
    const [analytics, attempts, quiz] = await Promise.all([
      supabase.from('learning_analytics').select('weak_concepts, total_attempts').eq('user_id', userId).maybeSingle(),
      supabase.from('question_attempts').select('correct, topic').eq('user_id', userId),
      supabase.from('quiz_results').select('score, total').eq('user_id', userId),
    ]);
    if (analytics.data) {
      ctx.weakConcepts = (analytics.data.weak_concepts || []).slice(0, 5);
      ctx.totalAttempts = analytics.data.total_attempts || attempts.data?.length || 0;
    }
    if (attempts.data?.length) {
      ctx.q7 = attempts.data.length;
    }
    const profile = await supabase.from('profiles').select('streak').eq('id', userId).maybeSingle();
    if (profile.data) ctx.streak = profile.data.streak || 0;
    if (quiz.data?.length) {
      const tot = quiz.data.reduce((s, r) => s + (r.total || 0), 0);
      const ok = quiz.data.reduce((s, r) => s + (r.score || 0), 0);
      ctx.accuracy = tot > 0 ? Math.round((ok / tot) * 100) : 0;
    }
  } catch {
    ctx.ready = false;
  }
  return ctx;
}

function buildPrompt(ctx, { intent, question, correctAnswer, options, userQuestion }) {
  const weak = (ctx.weakConcepts || []).map(w => `- ${w.name || w.topic} (${Math.round((w.accuracy || 0) * 100)}% accuracy)`.trim()).join('\n');
  const weakBlock = weak ? `\nWeak topics:\n${weak}` : '\nWeak topics: none detected.';
  const base = `You are the APEX STUDY COACH, an encouraging nursing exam mentor for the Apex Scholars app. The learner has answered ${ctx.q7 || 0} questions total with ${ctx.accuracy}% accuracy and a ${ctx.streak || 0}-day streak.${weakBlock}`;

  switch (intent) {
    case 'teach': {
      if (!question) return `${base}\n\nThe learner wants to learn a concept. Please greet them and ask what topic or question they'd like to understand.`;
      const qText = typeof question === 'object' ? JSON.stringify(question) : question;
      return `${base}\n\nTeach the following question simply and clinically. Break down why the correct answer (${JSON.stringify(correctAnswer)}) is right, and clarify the misunderstanding a student typically has. Be concise, warm, and structured with short bullet points. Do NOT invent facts.\n\nQUESTION:\n${qText}\n\nOPTIONS:\n${(options || []).map(o => `• ${o}`).join('\n')}`;
    }
    case 'mistakes': {
      return `${base}\n\nBased on the learner's weak topics, explain their most likely misconceptions and exactly how to fix each one. Be empathetic, specific, and practical. 3-5 bullet points maximum.`;
    }
    case 'plan': {
      return `${base}\n\nCreate a short, realistic daily study plan for today and tomorrow that targets the weak topics listed. Keep it to 4 focused steps with time-bounded actions. Return plain text with markdown bullets.`;
    }
    case 'practice': {
      return `${base}\n\nThe learner asked for practice. Recommend which topic to practise first (their weakest) and explain why, then point them to use the in-app quiz. Keep it short and actionable.`;
    }
    case 'chat':
    default: {
      return `${base}\n\nRespond helpfully to this learner message:\n${userQuestion || ''}`;
    }
  }
}

function coalesceText(parts) {
  return parts.filter(Boolean).join('').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { user, status, body } = await authorizeRequest(req);
  if (!user) return res.status(status).json(body);

  const { intent = 'overview', question, correctAnswer, options, userQuestion } = req.body || {};

  const supabase = getSupabaseAdmin();
  const ctx = supabase ? await fetchLearningContext(user.id, supabase) : { ready: false };

  // Overview intent can be served without Gemini (deterministic dashboard copy).
  if (intent === 'overview') {
    const weak = (ctx.weakConcepts || [])[0];
    const lines = [];
    if (ctx.accuracy >= 0) lines.push(`You're at ${ctx.accuracy}% overall accuracy.`);
    if (ctx.q7 >= 0) lines.push(`You've answered ${ctx.q7} questions.`);
    if (weak) lines.push(`Your biggest opportunity is ${weak.name}.`);
    if (ctx.streak >= 0) lines.push(`You're on a ${ctx.streak}-day streak.`);
    lines.push(`What would you like to do?`);
    return res.status(200).json({
      success: true,
      coach: lines.join(' '),
      options: ['Teach Me', 'Give Me Practice', 'Explain My Mistakes', "Create Today's Plan"]
    });
  }

  if (!GEMINI_KEY) {
    // Graceful degradation — offer the deterministic fallback rather than fail.
    return res.status(200).json({
      success: true,
      coach: `Your practice data is being tracked. Try a targeted quiz on your weakest topic, then tap any option for help.`,
      options: ['Teach Me', 'Give Me Practice', "Create Today's Plan"],
      degraded: true
    });
  }

  const prompt = buildPrompt(ctx, { intent, question, correctAnswer, options, userQuestion });

  try {
    const gemRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6, maxOutputTokens: 800 }
        })
      }
    );
    const data = await gemRes.json();
    const text = coalesceText(
      data?.candidates?.[0]?.content?.parts?.map(p => p.text)
    );
    if (!text) {
      return res.status(200).json({
        success: true,
        coach: `I couldn't find the right words just now. Try a targeted quiz on your weakest topic.`,
        options: ['Teach Me', 'Give Me Practice', 'Explain My Mistakes'],
        degraded: true
      });
    }
    return res.status(200).json({
      success: true,
      coach: text,
      options: ['Teach Me', 'Give Me Practice', "Create Today's Plan"]
    });
  } catch (err) {
    console.error('Study coach error:', err.message);
    return res.status(200).json({
      success: true,
      coach: `I hit a small hiccup. Try a targeted quiz on your weakest topic for now.`,
      options: ['Give Me Practice', "Create Today's Plan"],
      degraded: true
    });
  }
}
