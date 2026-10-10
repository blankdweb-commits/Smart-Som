// Nursing License Renewal client API (S8).
//
// Thin, auth-aware wrappers over the /api/license/* endpoints. The server owns
// every rule (fee, 50-question exam, 80% pass, 24h cooldown, renewal); this
// module only transports the session token.

import apiFetch from './apexFetch';

const tokenOf = (session) => session?.access_token || null;

export async function fetchLicenseStatus(session) {
  return apiFetch('/license/status', { method: 'GET', token: tokenOf(session) });
}

export async function startLicenseRenewal(session, attemptId) {
  return apiFetch('/license/start', { method: 'POST', token: tokenOf(session), body: { attemptId } });
}

export async function answerLicenseQuestion(session, { batchId, questionId, selectedAnswer, elapsedMs }) {
  return apiFetch('/quiz-batch-answer', {
    method: 'POST',
    token: tokenOf(session),
    body: { batchId, questionId, selectedAnswer, elapsedMs },
  });
}

export async function submitLicenseRenewal(session, batchId) {
  return apiFetch('/license/submit', { method: 'POST', token: tokenOf(session), body: { batchId } });
}
