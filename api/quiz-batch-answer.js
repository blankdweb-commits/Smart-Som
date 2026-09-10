// ============================================================
// POST /api/quiz-batch-answer
//
// Records an answer for a question within a batch.
// Updates both quiz_batch_questions and user_question_history.
//
// Body: {
//   batchId: string,
//   questionId: string,
//   selectedAnswer: string,
//   elapsedMs?: number,
// }
//
// NOTE: `correct` is NOT accepted as authoritative. The server grades the
// answer itself by comparing selectedAnswer to the stored correct_answer,
// writes the server-derived correctness, and returns it as { success, correct }.
// A client cannot fabricate a score or difficulty-progression credit.
//
// Returns: { success, correct }
// ============================================================

import { applyCors, authorizeRequest } from './_utils.js';
import { QuestionSelectionService } from './_questionSelectionService.js';
import { getSupabaseAdmin } from './_utils.js';

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
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
    const { batchId, questionId, selectedAnswer, elapsedMs } = req.body || {};

    if (!batchId || !questionId || selectedAnswer === undefined) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'batchId, questionId, and selectedAnswer are required.',
      });
    }

    // `correct` from the client is deliberately ignored — the server grades.
    const service = new QuestionSelectionService(getSupabaseAdmin());
    const result = await service.recordAnswer({
      batchId,
      userId: user.id,
      questionId,
      selectedAnswer,
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
