// ============================================================
// GET /api/quiz/batch-get?id=<batchId>
//
// Returns a batch's questions for the authenticated user.
// Validates batch ownership and expiry.
//
// Returns: { batch, questions }
// ============================================================

import { authorizeRequest } from '../_utils.js';
import { QuestionSelectionService } from '../questionSelectionService.js';
import { getSupabaseAdmin } from '../_utils.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) {
    return res.status(status).json(authBody);
  }

  try {
    const batchId = req.query?.id || req.url?.split('id=')[1]?.split('&')[0];

    if (!batchId) {
      return res.status(400).json({
        error: 'Missing batch ID',
        message: 'id query parameter is required.',
      });
    }

    const service = new QuestionSelectionService(getSupabaseAdmin());
    const result = await service.getBatch(batchId, user.id);

    if (result.error) {
      const statusCode = result.error === 'BATCH_NOT_FOUND' ? 404 : 400;
      return res.status(statusCode).json({
        error: result.error,
        message: result.message,
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[batch-get] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch batch.',
    });
  }
}
