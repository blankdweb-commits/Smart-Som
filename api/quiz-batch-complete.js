// ============================================================
// POST /api/quiz-batch-complete
//
// Marks a batch as completed and returns the final score.
//
// Body: {
//   batchId: string,
// }
//
// Returns: { success, score, total, answers }
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
    const { batchId } = req.body || {};

    if (!batchId) {
      return res.status(400).json({
        error: 'Missing batch ID',
        message: 'batchId is required.',
      });
    }

    const service = new QuestionSelectionService(getSupabaseAdmin());
    const result = await service.completeBatch({
      batchId,
      userId: user.id,
    });

    if (result.error) {
      const statusCode = result.error === 'BATCH_NOT_FOUND' ? 404 : 400;
      return res.status(statusCode).json(result);
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[batch-complete] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to complete batch.',
    });
  }
}
