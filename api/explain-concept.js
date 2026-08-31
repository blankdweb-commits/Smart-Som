// api/explain-concept.js
// On-demand, stateless learning feedback via Gemini (server-side only).
//
// Wired to the [Explain Simply], [Clinical Example] and [Memory Trick] buttons
// on each quiz question. The model explains the given question/concept without
// altering the official answer, score, or any stored learning data — it is a
// pure study aid.
//
// GEMINI_API_KEY lives only on the server (Vercel). No key ever reaches the
// browser. Does not persist anything to Supabase.
import { getUserFromRequest } from './_utils';

const DEFAULT_MODEL = 'gemini-3.6-flash';

const MODES = {
  simple: 'Explain Simply',
  clinical: 'Clinical Example',
  memory: 'Memory Trick'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Learning feedback is not configured' });
  }

  const user = await getUserFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });

  const { question = '', correctAnswer = '', options = [], mode = 'simple' } = req.body || {};
  if (!question || !correctAnswer) {
    return res.status(400).json({ error: 'Missing question or correct answer' });
  }

  const modeLabel = MODES[mode] || MODES.simple;
  const optionsText = Array.isArray(options) && options.length
    ? `Options: ${options.join(' | ')}\n`
    : '';

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const prompt = [
    `You are a warm, expert nursing educator.`,
    `Explain this exam question as a "${modeLabel}" so a."`,
    `Question: "${question}"`,
    optionsText,
    `Correct answer: "${correctAnswer}"`,
    ``,
    `Return ONLY valid JSON with this exact shape:`,
    `{ "text": "a concise ${
      mode === 'memory' ? 'mnemonic or memory trick' :
      mode === 'clinical' ? 'real-world clinical example' :
      'plain-language explanation'
    } (~1-3 sentences). Never reveal that this is a hint. Be encouraging and clinically accurate." }`
  ].filter(Boolean).join('\n');

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
            maxOutputTokens: 1024,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: { text: { type: 'STRING' } },
              required: ['text']
            }
          }
        })
      }
    );

    const gen = await genRes.json();
    if (!genRes.ok) {
      console.error('Gemini error:', genRes.status, JSON.stringify(gen).slice(0, 300));
      return res.status(502).json({ error: 'Explanation generation failed' });
    }

    const text =
      gen?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!text) return res.status(502).json({ error: 'Empty response from model' });

    let parsed;
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    } catch {
      return res.status(502).json({ error: 'Invalid JSON from model' });
    }

    const explanation = (parsed && parsed.text ? String(parsed.text) : '').trim();
    if (!explanation) return res.status(502).json({ error: 'Model returned an empty explanation' });

    return res.status(200).json({ success: true, mode, explanation });
  } catch (error) {
    console.error('Explanation error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
