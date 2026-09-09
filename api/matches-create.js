// ============================================================
// POST /api/matches-create
//
// Creates a 1v1 match with a shared question sequence.
// Both players receive exactly the same questions.
//
// Body: {
//   matchId: string,         // existing match ID from duel_waiting
//   playerIds: [uuid, uuid], // exactly 2 player user IDs
//   courseKey: string,       // question source course
//   examFramework?: string,  // NCLEX or NMCN
//   difficultyDistribution?: object,
//   batchSize?: number,
// }
//
// Returns: { matchId, questionIds, batches }
// ============================================================

import { applyCors, authorizeRequest } from './_utils.js';
import { QuestionSelectionService } from './questionSelectionService.js';
import { getSupabaseAdmin } from './_utils.js';
import { notifyUser } from './_push.js';

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
    const {
      matchId,
      playerIds,
      courseKey,
      examFramework,
      difficultyDistribution,
      batchSize,
    } = req.body || {};

    // Validate
    if (!matchId || !playerIds || !Array.isArray(playerIds) || playerIds.length !== 2) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'matchId and exactly 2 playerIds are required.',
      });
    }

    if (!courseKey) {
      return res.status(400).json({
        error: 'Missing courseKey',
        message: 'courseKey is required.',
      });
    }

    // Verify the requesting user is one of the players
    if (!playerIds.includes(user.id)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'You must be one of the match participants.',
      });
    }

    const service = new QuestionSelectionService(getSupabaseAdmin());

    const result = await service.createMatchBatch({
      matchId,
      playerIds,
      mode: 'oneVsOne',
      examFramework,
      courseKey,
      difficultyDistribution,
      batchSize,
    });

    // Wake up the opponent: they queued for a 1v1 and might have the app closed
    // or backgrounded. Server-driven cross-user push (safe here — matchmaking
    // already validated the requesting user is one of the two players).
    const opponent = playerIds.find(id => id !== user.id);
    if (opponent) {
      notifyUser(getSupabaseAdmin(), opponent, {
        title: 'Your 1v1 match is live',
        body: 'A challenger just matched you — jump in before the streak cools.',
        url: '/xp-hall',
        tag: 'duel-match',
        data: { kind: 'duel-match' },
      }).catch(err => console.error('[matches/create] opponent push failed:', err.message));
    }

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    console.error('[matches/create] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to create match batch.',
    });
  }
}
