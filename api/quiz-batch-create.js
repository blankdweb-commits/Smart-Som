// ============================================================
// POST /api/quiz-batch-create
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

import crypto from 'crypto';
import { applyCors, authorizeRequest, getSupabaseAdmin } from './_utils.js';
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
    console.warn('[batch-create] Quota refund failed:', e?.message);
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
      console.error('[batch-create] Quota consume error:', quota.error);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to reserve course round.' });
    }

    const quotaBody = quota?.data || {};
    if (quotaBody.allowed === false) {
      return res.status(403).json({
        error: 'QUOTA_EXHAUSTED',
        message: 'This course round is still cooling down.',
        cooldown_remaining_seconds: quotaBody.cooldown_remaining_seconds ?? 0,
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
    console.error('[batch-create] Error:', err);
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
