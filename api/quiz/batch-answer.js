// ============================================================
// POST /api/quiz/batch-answer
//
// Records an answer for a question within a batch.
// Updates both quiz_batch_questions and user_question_history.
//
// Body: {
//   batchId: string,
//   questionId: string,
//   selectedAnswer: string,
//   correct: boolean,
//   elapsedMs?: number,
// }
//
// Returns: { success }
// ============================================================

import { authorizeRequest } from '../_utils.js';
import { QuestionSelectionService } from '../questionSelectionService.js';
import { getSupabaseAdmin } from '../_utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) {
    return res.status(status).json(authBody);
  }

  try {
    const { batchId, questionId, selectedAnswer, correct, elapsedMs } = req.body || {};

    if (!batchId || !questionId || selectedAnswer === undefined || correct === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'batchId, questionId, selectedAnswer, and correct are required.',
      });
    }

    const service = new QuestionSelectionService(getSupabaseAdmin());
    const result = await service.recordAnswer({
      batchId,
      userId: user.id,
      questionId,
      selectedAnswer,
      correct,
      elapsedMs,
    });

    if (result.error) {
      const statusCode = result.error === 'BATCH_NOT_FOUND' ? 404 : 400;
      return res.status(statusCode).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[batch-answer] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to record answer.',
    });
  }
}
