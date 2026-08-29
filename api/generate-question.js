// api/generate-question.js
// On-demand question generation via Gemini (server-side only).
//
// IMPORTANT: This endpoint must ONLY be called when the hardcoded question
// banks are COMPLETELY exhausted for a given niche — it is a last-resort
// fallback, never a proactive generator. The client guard (Quiz.jsx
// selection engine) enforces that policy; this route is the server-side
// executor.
//
// GEMINI_API_KEY lives only on the server (Vercel). No key ever reaches the
// browser. The generated question is stored in `generated_questions` so it
// becomes reusable through the normal pool, and the same no-repetition rules
// apply to it on the next round.
import { getSupabaseAdmin, getUserFromRequest } from './_utils';

const DEFAULT_MODEL = 'gemini-3.6-flash';

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

function sanitizeQuestion(raw) {
  const q = raw || {};
  const question = typeof q.question === 'string' ? q.question.trim() : '';
  const answer = typeof q.answer === 'string' ? q.answer.trim() : '';
  const distractors = Array.isArray(q.distractors) ? q.distractors : [];
  if (!question || !answer) return null;
  const options = [answer, ...distractors]
    .filter((o) => typeof o === 'string' && o.trim())
    .map((o) => o.trim());
  if (options.length < 2) return null;
  const uniq = [...new Set(options)];
  if (uniq.length < 2) return null;
  return {
    question,
    options: uniq,
    correctAnswer: answer,
    explanation: typeof q.explanation === 'string' ? q.explanation.trim() : ''
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Prefer the true server secret; fall back to the VITE_-prefixed var that
  // is also configured server-side. Both are read from process.env in this
  // serverless function, so neither ever reaches the client bundle.
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    // No key configured yet — degrade gracefully so the client can fall back
    // to previously-seen questions instead of erroring visibly.
    return res.status(503).json({ error: 'Question generation is not configured' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { niche, subject, topic, difficulty } = req.body || {};
  if (!niche || !subject || !difficulty) {
    return badRequest(res, 'Missing niche, subject, or difficulty');
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const prompt = [
    `You are an expert NMCN-style nursing and midwifery exam writer.`,
    `Write ONE original multiple-choice question for the subject "${subject}"`,
    niche || topic ? `around the topic "${niche || topic}"` : '',
    `with difficulty "${difficulty}". Question must be clinically accurate,`,
    `unambiguous, and NMCN-compliant.`,
    ``,
    `Return ONLY valid JSON with this exact shape:`,
    `{ "question": "the question text (no options embedded)",`,
    `  "answer": "the single correct option text",`,
    `  "distractors": ["three plausible wrong options"],`,
    `  "explanation": "1-2 sentence rationale" }`
  ].filter(Boolean).join(' ');

  try {
    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.7,
            // Thinking models spend tokens on chain-of-thought before emitting
            // the final JSON; a small budget truncates the output (observed at
            // 512 and even 1024). 8192 ensures a complete, parseable response.
            maxOutputTokens: 8192,
            // Force a machine-readable JSON response instead of relying on
            // fragile prose parsing.
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                question: { type: 'STRING' },
                answer: { type: 'STRING' },
                distractors: { type: 'ARRAY', items: { type: 'STRING' } },
                explanation: { type: 'STRING' }
              },
              required: ['question', 'answer', 'distractors', 'explanation']
            }
          }
        })
      }
    );

    const gen = await genRes.json();
    if (!genRes.ok) {
      console.error('Gemini error:', genRes.status, JSON.stringify(gen).slice(0, 500));
      return res.status(502).json({ error: 'Question generation failed' });
    }

    const text =
      gen?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) return res.status(502).json({ error: 'Empty response from model' });

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return res.status(502).json({ error: 'Invalid JSON from model' });
    }

    const question = sanitizeQuestion(parsed);
    if (!question) return res.status(502).json({ error: 'Model returned an incomplete question' });

    const { error } = await supabase.from('generated_questions').insert({
      user_id: user.id,
      subject,
      niche: niche || topic || null,
      difficulty,
      question_text: question.question,
      options: question.options,
      correct_answer: question.correctAnswer,
      explanation: question.explanation
    });
    if (error) {
      console.error('Failed to persist generated question:', error.message);
      return res.status(500).json({ error: 'Failed to persist question' });
    }

    return res.status(200).json({
      success: true,
      generated: true,
      question: {
        question: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        explanation: question.explanation,
        subject,
        difficulty,
        id: `generated-${Date.now()}`
      }
    });
  } catch (error) {
    console.error('Question generation error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
