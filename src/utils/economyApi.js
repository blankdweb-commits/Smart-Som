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

export const fetchEconomyOverview = (session) =>
  apiFetch('/api/economy/overview', { method: 'GET', token: session?.access_token });

export const sendTransfer = (session, { toUserId, amount }) =>
  apiFetch('/api/economy/transfer', {
    method: 'POST',
    token: session?.access_token,
    body: { toUserId, amount, requestId: rid() },
  });

export const fetchBank = (session) =>
  apiFetch('/api/economy/bank', { method: 'GET', token: session?.access_token });

export const borrowFromBank = (session, amount) =>
  apiFetch('/api/economy/borrow', {
    method: 'POST',
    token: session?.access_token,
    body: { amount, requestId: rid() },
  });

export const repayLoan = (session, loanId) =>
  apiFetch('/api/economy/repay', {
    method: 'POST',
    token: session?.access_token,
    body: { loanId, requestId: rid() },
  });

// Find someone to pay. Uses the friend_search RPC: same name/handle predicate
// as the arena search, and never email.
export const searchPeople = async (supabase, query) => {
  const { data } = await supabase.rpc('friend_search', { p_query: query });
  return Array.isArray(data?.results) ? data.results : [];
};