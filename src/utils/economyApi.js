import { apiFetch } from './apexFetch';

// Wallet + World Bank (migration v81). Routed through /api/quiz so the app
// stays inside the 12-function Vercel Hobby budget.
//
// requestId is generated HERE, once per user intent, and reused on retry. That
// is what makes a double-tap or a flaky connection safe: the server passes it
// to the RPC as the deterministic client_request_id, and a replay is a no-op
// rather than a second transfer.

const rid = () => (crypto?.randomUUID
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

const pinHeaders = (pin) => (pin ? { 'X-Wallet-Pin': pin } : {});

export const newRequestId = rid;

export const fetchPinStatus = (session) =>
  apiFetch('/economy/pin/status', { method: 'GET', token: session?.access_token });

export const setupPin = (session, { pin, confirmPin }) =>
  apiFetch('/economy/pin/setup', {
    method: 'POST',
    token: session?.access_token,
    body: { pin, confirmPin },
  });

export const changePin = (session, { currentPin, pin, confirmPin }) =>
  apiFetch('/economy/pin/change', {
    method: 'POST',
    token: session?.access_token,
    body: { currentPin, pin, confirmPin },
  });

export const resetPin = (session, { pin, confirmPin }) =>
  apiFetch('/economy/pin/reset', {
    method: 'POST',
    token: session?.access_token,
    body: { pin, confirmPin },
  });

export const fetchEconomyOverview = (session, pin) =>
  apiFetch('/economy/overview', {
    method: 'GET',
    token: session?.access_token,
    headers: pinHeaders(pin),
  });

export const sendTransfer = (session, { toUserId, amount, pin, requestId = rid() }) =>
  apiFetch('/economy/transfer', {
    method: 'POST',
    token: session?.access_token,
    body: { toUserId, amount, pin, requestId },
  });

export const fetchBank = (session, pin) =>
  apiFetch('/economy/bank', {
    method: 'GET',
    token: session?.access_token,
    headers: pinHeaders(pin),
  });

export const borrowFromBank = (session, { amount, pin, requestId = rid() }) =>
  apiFetch('/economy/borrow', {
    method: 'POST',
    token: session?.access_token,
    body: { amount, pin, requestId },
  });

export const repayLoan = (session, { loanId, pin, requestId = rid() }) =>
  apiFetch('/economy/repay', {
    method: 'POST',
    token: session?.access_token,
    body: { loanId, pin, requestId },
  });

// Find someone to pay. Uses the friend_search RPC: same name/handle predicate
// as the arena search, and never email.
export const searchPeople = async (supabase, query) => {
  const { data } = await supabase.rpc('friend_search', { p_query: query });
  return Array.isArray(data?.results) ? data.results : [];
};