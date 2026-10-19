// Blitz Duel with Flow State client API.
//
// Thin, auth-aware wrappers over the /api/blitz-duel/* endpoints. The server
// owns every rule (the 90s clock, question sequence, grading, the bot, Flow
// accounting, the 2 SC stake and the 4 SC payout); this module only transports
// the session token. Nothing here computes a score or a balance.

import apiFetch from './apexFetch';

const tokenOf = (session) => session?.access_token || null;

export async function createBlitzDuel(session, pace) {
  return apiFetch('/blitz-duel/create', { method: 'POST', token: tokenOf(session), body: { pace } });
}

export async function fetchBlitzDuelState(session, matchId) {
  return apiFetch(`/blitz-duel/state?matchId=${encodeURIComponent(matchId)}`, {
    method: 'GET',
    token: tokenOf(session),
  });
}

export async function answerBlitzDuel(session, { matchId, questionIndex, selected, clientRequestId }) {
  return apiFetch('/blitz-duel/answer', {
    method: 'POST',
    token: tokenOf(session),
    body: { matchId, questionIndex, selected, clientRequestId },
  });
}

export async function skipBlitzDuel(session, { matchId, questionIndex, clientRequestId }) {
  return apiFetch('/blitz-duel/skip', {
    method: 'POST',
    token: tokenOf(session),
    body: { matchId, questionIndex, clientRequestId },
  });
}

export async function setBlitzDuelFlow(session, { matchId, active, clientRequestId }) {
  return apiFetch('/blitz-duel/flow', {
    method: 'POST',
    token: tokenOf(session),
    body: { matchId, active, clientRequestId },
  });
}

export async function settleBlitzDuel(session, matchId) {
  return apiFetch('/blitz-duel/settle', { method: 'POST', token: tokenOf(session), body: { matchId } });
}

export async function rematchBlitzDuel(session, pace) {
  return apiFetch('/blitz-duel/rematch', { method: 'POST', token: tokenOf(session), body: { pace } });
}
