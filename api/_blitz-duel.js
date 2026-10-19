// api/_blitz-duel.js
//
// Blitz Duel with Flow State — support module for the api/quiz.js serverless
// function (underscore prefix -> not deployed as its own function, keeping the
// Vercel Hobby 12-function budget intact).
//
// Endpoints (dispatched by api/quiz.js on the original req.url):
//   POST /api/blitz-duel/create   body { pace? }                         -> handleBlitzCreate
//   GET  /api/blitz-duel/state    ?matchId=                              -> handleBlitzState
//   POST /api/blitz-duel/answer   body { matchId, questionIndex, selected, clientRequestId? } -> handleBlitzAnswer
//   POST /api/blitz-duel/skip     body { matchId, questionIndex, clientRequestId? }          -> handleBlitzSkip
//   POST /api/blitz-duel/flow     body { matchId, active, clientRequestId? }                 -> handleBlitzFlow
//   POST /api/blitz-duel/settle   body { matchId }                       -> handleBlitzSettle
//   POST /api/blitz-duel/rematch  body { pace? }                         -> handleBlitzRematch
//
// This module holds NO game logic. Every rule — the 90s clock, the question
// sequence, grading, the bot, Flow accounting, the stake and the payout — is
// decided inside the public.blitz_duel_* RPCs, which are executable by
// service_role ONLY. This layer exists for one reason: to turn each database
// refusal into a MEANINGFUL HTTP status (402/404/409/429) instead of a generic
// 200-shaped error object, and to pass the verified user id explicitly (the
// service role has no auth.uid()).

import { authorizeRequest, getSupabaseAdmin } from './_utils.js';

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);

// Database error code -> HTTP status. Anything unlisted is a 400 (a request the
// server understood and refused) rather than a 500.
const ERROR_STATUS = {
  UNAUTHENTICATED: 401,
  INSUFFICIENT_FUNDS: 402,
  MATCH_NOT_FOUND: 404,
  RATE_LIMITED: 429,
  QUESTION_NOT_CURRENT: 409,
  MATCH_CLOSED: 409,
  MATCH_ENDED: 409,
  MATCH_NOT_ENDED: 409,
  SETTLEMENT_FAILED: 500,
  STAKE_FAILED: 500,
};

const ERROR_MESSAGE = {
  UNAUTHENTICATED: 'Sign in to play Blitz Duel.',
  INSUFFICIENT_FUNDS: 'You need 2 Smart Coins to enter a Blitz Duel.',
  MATCH_NOT_FOUND: 'That match no longer exists.',
  RATE_LIMITED: 'Too many requests. Wait a moment and try again.',
  QUESTION_NOT_CURRENT: 'That question has already been resolved.',
  MATCH_CLOSED: 'This match is already over.',
  MATCH_ENDED: 'The final whistle has blown.',
  MATCH_NOT_ENDED: 'The match clock is still running.',
  INVALID_PACE: 'Choose a pace between 3 and 12 seconds.',
  INVALID_SELECTION: 'Choose one of the four options.',
  INVALID_QUESTION_INDEX: 'That question is out of range.',
  QUESTION_NOT_FOUND: 'That question is unavailable.',
  INSUFFICIENT_QUESTIONS: 'The question bank is too small to start a match.',
  SETTLEMENT_FAILED: 'The match could not be settled. It will retry.',
  STAKE_FAILED: 'Your stake could not be placed.',
};

// Send the RPC payload, translating an `ok:false` refusal into its HTTP status.
const respond = (res, data, err) => {
  if (err) {
    console.error('[blitz] rpc error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Blitz Duel request failed.' });
  }
  if (!data || typeof data !== 'object') {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Empty Blitz Duel response.' });
  }
  if (data.ok === false) {
    const code = data.error || 'INVALID_REQUEST';
    const status = ERROR_STATUS[code] ?? 400;
    return res.status(status).json({
      ...data,
      error: code,
      message: ERROR_MESSAGE[code] || 'Blitz Duel request refused.',
    });
  }
  return res.status(200).json(data);
};

const uuidOr = (v, fallback = null) => (isUuid(v) ? v : fallback);

// ============================================================
// POST /api/blitz-duel/create   body { pace? }
// Places the 2 SC stake (once) and opens a fresh 90s match. A second call
// while a live match exists is a replay and charges nothing.
// ============================================================
export async function handleBlitzCreate(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  const pace = Number.isFinite(Number(req.body?.pace)) ? Number(req.body.pace) : null;
  const { data, error } = await supabase.rpc('blitz_duel_create', {
    p_user_id: user.id,
    p_pace: pace,
  });
  return respond(res, data, error);
}

// ============================================================
// GET /api/blitz-duel/state   ?matchId=
// Resume a match: returns the clock, the current question (never the answer)
// and both scoreboards. Settles lazily if the whistle already passed.
// ============================================================
export async function handleBlitzState(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  const matchId = req.query?.matchId || req.body?.matchId;
  if (!isUuid(matchId)) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'matchId is required.' });
  }

  const { data, error } = await supabase.rpc('blitz_duel_state', {
    p_user_id: user.id,
    p_match_id: matchId,
  });
  return respond(res, data, error);
}

// ============================================================
// POST /api/blitz-duel/answer   body { matchId, questionIndex, selected, clientRequestId? }
// The server grades the answer and advances the clock. The client never sends
// a score or a correct flag.
// ============================================================
export async function handleBlitzAnswer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  const { matchId, questionIndex, selected, clientRequestId } = req.body || {};
  if (!isUuid(matchId)) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'matchId is required.' });
  }
  if (!Number.isInteger(questionIndex)) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'questionIndex is required.' });
  }
  if (typeof selected !== 'string' || !selected.trim()) {
    return res.status(400).json({ error: 'INVALID_SELECTION', message: ERROR_MESSAGE.INVALID_SELECTION });
  }

  const { data, error } = await supabase.rpc('blitz_duel_answer', {
    p_user_id: user.id,
    p_match_id: matchId,
    p_question_index: questionIndex,
    p_selected: selected,
    p_client_request_id: uuidOr(clientRequestId),
  });
  return respond(res, data, error);
}

// ============================================================
// POST /api/blitz-duel/skip   body { matchId, questionIndex, clientRequestId? }
// Advance without answering. Counts as a skip; never reveals the answer.
// ============================================================
export async function handleBlitzSkip(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  const { matchId, questionIndex, clientRequestId } = req.body || {};
  if (!isUuid(matchId)) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'matchId is required.' });
  }
  if (!Number.isInteger(questionIndex)) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'questionIndex is required.' });
  }

  const { data, error } = await supabase.rpc('blitz_duel_skip', {
    p_user_id: user.id,
    p_match_id: matchId,
    p_question_index: questionIndex,
    p_client_request_id: uuidOr(clientRequestId),
  });
  return respond(res, data, error);
}

// ============================================================
// POST /api/blitz-duel/flow   body { matchId, active, clientRequestId? }
// Toggle Flow State. The server timestamps the event against its own clock, so
// a client cannot claim a duration it did not earn.
// ============================================================
export async function handleBlitzFlow(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  const { matchId, active, clientRequestId } = req.body || {};
  if (!isUuid(matchId)) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'matchId is required.' });
  }
  if (typeof active !== 'boolean') {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'active must be true or false.' });
  }

  const { data, error } = await supabase.rpc('blitz_duel_flow', {
    p_user_id: user.id,
    p_match_id: matchId,
    p_active: active,
    p_client_request_id: uuidOr(clientRequestId),
  });
  return respond(res, data, error);
}

// ============================================================
// POST /api/blitz-duel/settle   body { matchId }
// Settle at the whistle. Idempotent: a replay returns the stored result and
// moves no coins.
// ============================================================
export async function handleBlitzSettle(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  const { matchId } = req.body || {};
  if (!isUuid(matchId)) {
    return res.status(400).json({ error: 'INVALID_REQUEST', message: 'matchId is required.' });
  }

  const { data, error } = await supabase.rpc('blitz_duel_settle', {
    p_user_id: user.id,
    p_match_id: matchId,
  });
  return respond(res, data, error);
}

// ============================================================
// POST /api/blitz-duel/rematch   body { pace? }
// Settle-and-start a fresh match. Same replay-safe stake path as create.
// ============================================================
export async function handleBlitzRematch(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  const pace = Number.isFinite(Number(req.body?.pace)) ? Number(req.body.pace) : null;
  const { data, error } = await supabase.rpc('blitz_duel_rematch', {
    p_user_id: user.id,
    p_pace: pace,
  });
  return respond(res, data, error);
}
