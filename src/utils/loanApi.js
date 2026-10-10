// Loan Shark client API (S9).
//
// Thin, auth-aware wrappers over the /api/loans/* endpoints. The server owns
// every rule (peer-to-peer transfer, 10% interest, 48h window, lender caps,
// Loan Shark license, default recovery); this module only transports the token.

import apiFetch from './apexFetch';

const tokenOf = (session) => session?.access_token || null;

export async function fetchLoans(session) {
  return apiFetch('/loans/list', { method: 'GET', token: tokenOf(session) });
}

export async function requestLoan(session, { amount, note, requestId }) {
  return apiFetch('/loans/request', { method: 'POST', token: tokenOf(session), body: { amount, note, requestId } });
}

export async function offerLoan(session, loanId) {
  return apiFetch('/loans/offer', { method: 'POST', token: tokenOf(session), body: { loanId } });
}

export async function acceptLoan(session, { loanId, requestId }) {
  return apiFetch('/loans/accept', { method: 'POST', token: tokenOf(session), body: { loanId, requestId } });
}

export async function repayLoan(session, { loanId, requestId }) {
  return apiFetch('/loans/repay', { method: 'POST', token: tokenOf(session), body: { loanId, requestId } });
}

export async function rejectLoan(session, loanId) {
  return apiFetch('/loans/reject', { method: 'POST', token: tokenOf(session), body: { loanId } });
}

export async function cancelLoan(session, loanId) {
  return apiFetch('/loans/cancel', { method: 'POST', token: tokenOf(session), body: { loanId } });
}

export async function buySharkLicense(session, requestId) {
  return apiFetch('/loans/shark-buy', { method: 'POST', token: tokenOf(session), body: { requestId } });
}

export async function markLoanDefault(session, loanId) {
  return apiFetch('/loans/default', { method: 'POST', token: tokenOf(session), body: { loanId } });
}
