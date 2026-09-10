// api/_quiz-batches.js
//
// Support module backing the single api/quiz.js serverless function (the
// underscore prefix keeps Vercel from deploying this file as a separate
// function). Each handler keeps the exact contract of the former
// api/quiz-batch-{create,get,answer,complete}.js files so the public API is
// unchanged. api/quiz.js owns the CORS/OPTIONS gate and dispatches on the
// original request path (Vercel preserves req.url across rewrites).

import crypto from 'crypto';
import { authorizeRequest, getSupabaseAdmin } from './_utils.js';
import { QuestionSelectionService } from './_questionSelectionService.js';

const HTTP_ERRORS = {
  DIFFICULTY_LOCKED: 403,
  QUOTA_EXHAUSTED: 403,
  FRAMEWORK_MISMATCH: 400,
  UNKNOWN_COURSE: 400,
  INVALID_COURSE_KEY: 400,
  INVALID_MODE: 400,
};

// Refund a reserved round that never produced a batch. A failed start must
// never burn a free user's round — otherwise the very next start would 403
// QUOTA_EXHAUSTED while the first one was only a selection/validation error.
//
// Race-safe: the refund targets ONLY the round THIS request reserved (by
// matching last_round_id), so a failing request B can never delete a
// legitimate cooldown/reservation opened by a concurrent request A.
async function refundRound(supabase, userId, courseKey, roundId) {
  if (!supabase || !userId || !courseKey) return;
  try {
    let q = supabase
      .from('user_course_quota')
      .delete()
      .eq('user_id', userId)
      .eq('course_key', courseKey);
    if (roundId) q = q.eq('last_round_id', roundId);
    await q;
  } catch (e) {
    console.warn('[quiz create] Quota refund failed:', e?.message);
  }
}

// Server-authoritative attempt id for this start request. Used as the atomic
// idempotency key in consume_course_quota (replay/double-click/refresh cannot
// charge twice) and as the refund target above.
const makeAttemptId = (clientProvided) =>
  typeof clientProvided === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(clientProvided)
    ? clientProvided
    : crypto.randomUUID();

// ============================================================
// POST /api/quiz-batch-create (dispatched as batch-create)
//
// Creates a new quiz batch with server-authoritative question selection.
// Transactional: reserves questions and records exposure atomically.
//
// Body: {
//   mode: string,           // practice, dailyQuiz, topicQuiz, etc.
//   courseKey: string,      // e.g. "clinical-challenge:nclex", "nursing-200:Pharmacology"
//   examFramework?: string, // NCLEX or NMCN (validated server-side)
//   batchSize?: number,     // override mode default (server-clamped)
//   difficultyDistribution?: object, // override mode default
//   subjectFilter?: string, // optional subject filter
//   topicFilter?: string,   // optional topic filter
// }
//
// Server-authoritative enforcement:
//   - Premium is resolved from the DB, never trusted from the client.
//   - The per-course round quota is consumed atomically here (defense in
//     depth): free users pay 10 questions + 30-min cooldown, premium 10-30
//     with no cooldown. Refused while on cooldown -> 403 QUOTA_EXHAUSTED.
//   - Difficulty progression is validated server-side by
//     QuestionSelectionService (a locked difficulty -> 403 DIFFICULTY_LOCKED).
//   - CourseKey -> framework/DB-course resolution is centralized + fail-closed.
//
// Returns: { batch, questions, meta } or a typed error.
// ============================================================
export async function handleCreate(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) {
    return res.status(status).json(authBody);
  }

  let supabase = null;
  let shouldRefund = true;
  let roundId = null;

  try {
    const {
      mode,
      courseKey,
      examFramework,
      batchSize,
      difficultyDistribution,
      subjectFilter,
      topicFilter,
      attemptId,
    } = req.body || {};

    // Validate required fields
    if (!mode || !courseKey) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'mode and courseKey are required.',
      });
    }

    // Check if user is premium (authoritative, from the DB)
    supabase = getSupabaseAdmin();
    let isPremium = false;
    if (supabase) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('expires_at, grace_until')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sub) {
        const now = new Date();
        isPremium = (sub.expires_at && new Date(sub.expires_at) > now) ||
                    (sub.grace_until && new Date(sub.grace_until) > now);
      }
    }

    // Free users are limited to 10 questions
    const finalBatchSize = isPremium
      ? Math.min(30, Math.max(10, batchSize || 10))
      : 10;

    // ---- Idempotent round reservation ----
    // This id is the atomic quota key: the SAME attemptId replayed (refresh,
    // double-click, retry, concurrent tab) returns the same result without
    // charging twice. Missing/invalid id -> fresh UUID on the server.
    roundId = makeAttemptId(attemptId);

    // ---- Defense-in-depth: consume the per-course round quota NOW ----
    // This is the authoritative charge. Free users reserve exactly 10
    // questions + a 30-min cooldown; premium users reserve 10-30 with no
    // cooldown. Refused while on cooldown.
    const quota = await supabase.rpc('consume_course_quota', {
      p_user_id: user.id,
      p_course_key: courseKey,
      p_count: finalBatchSize,
      p_is_premium: isPremium,
      p_request_id: roundId,
    });

    if (quota && quota.error) {
      console.error('[quiz create] Quota consume error:', quota.error);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to reserve course round.' });
    }

    const quotaBody = quota?.data || {};
    if (quotaBody.allowed === false) {
      // Distinguish an ACTIVE per-course cooldown (the POLYNURSE contract the
      // client gates the whole course on) from any other quota refusal, so
      // callers can fail closed on the right code.
      const cooling = (Number(quotaBody.cooldown_remaining_seconds) || 0) > 0;
      return res.status(403).json({
        error: cooling ? 'COOLDOWN_ACTIVE' : 'QUOTA_EXHAUSTED',
        message: cooling
          ? 'This course is on cooldown. It will become available after the cooldown ends.'
          : 'This course round is not available yet.',
        cooldown_remaining_seconds: quotaBody.cooldown_remaining_seconds ?? 0,
        cooldown_started_at: quotaBody.cooldown_started_at ?? null,
        window_expires_at: quotaBody.window_expires_at ?? null,
      });
    }

    // A replayed request id is NOT a fresh reservation — if the batch build
    // fails here we must NOT refund, because the reservation belongs to the
    // ORIGINAL request (which owns its own refund path).
    shouldRefund = quotaBody.replayed !== true;

    // Create selection service
    const service = new QuestionSelectionService(supabase);

    // Create the batch (server validates difficulty progression + framework)
    const result = await service.createQuizBatch({
      userId: user.id,
      mode,
      examFramework,
      courseKey,
      difficultyDistribution,
      batchSize: finalBatchSize,
      subjectFilter,
      topicFilter,
    });

    if (result.error) {
      if (shouldRefund) await refundRound(supabase, user.id, courseKey, roundId);
      return res.status(400).json({
        error: result.error,
        message: result.message,
        quota_refunded: shouldRefund,
      });
    }

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    const msg = err?.message || '';
    // Client-facing validation messages -> 400.
    if (/^(Invalid mode|courseKey is required|userId is required|Invalid exam framework|Invalid difficulty|difficultyDistribution|Difficulty count)/.test(msg)) {
      // Nothing was consumed (validation runs before quota) — no refund needed.
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: msg });
    }
    console.error('[quiz create] Error:', err);
    const code = err?.code || err?.message?.split(':')[0];
    const httpStatus = HTTP_ERRORS[code] || HTTP_ERRORS[msg] || 500;
    // No batch was produced -> refund the reserved round so a failed start
    // (DIFFICULTY_LOCKED, FRAMEWORK_MISMATCH, UNKNOWN_COURSE, INVALID_COURSE_KEY,
    // or internal errors) never charges the user. Replays skip refund (the
    // original request owns the reservation).
    if (shouldRefund) await refundRound(supabase, user.id, req.body?.courseKey, roundId);
    return res.status(httpStatus).json(
      httpStatus < 500
        ? {
            error: code || 'VALIDATION_ERROR',
            message: msg,
            ...(err.lockedDifficulty ? { lockedDifficulty: err.lockedDifficulty } : {}),
            ...(err.courseKey ? { courseKey: err.courseKey } : {}),
          }
        : { error: 'INTERNAL_ERROR', message: 'Failed to create quiz batch.' }
    );
  }
}

// ============================================================
// GET /api/quiz-batch-get?id=<batchId> (dispatched as batch-get)
//
// Returns a batch's questions for the authenticated user.
// Validates batch ownership and expiry.
//
// Returns: { batch, questions }
// ============================================================
export async function handleGet(req, res) {
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
    console.error('[quiz get] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch batch.',
    });
  }
}

// ============================================================
// POST /api/quiz-batch-answer (dispatched as batch-answer)
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
export async function handleAnswer(req, res) {
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
    console.error('[quiz answer] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to record answer.',
    });
  }
}

// ============================================================
// POST /api/quiz-batch-complete (dispatched as batch-complete)
//
// Marks a batch as completed and returns the final score.
//
// Body: {
//   batchId: string,
// }
//
// Returns: { success, score, total, answers }
// ============================================================
export async function handleComplete(req, res) {
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
    console.error('[quiz complete] Error:', err);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to complete batch.',
    });
  }
}