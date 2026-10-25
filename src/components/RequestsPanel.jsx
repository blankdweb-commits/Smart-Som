import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Coins, Loader2, RefreshCw, Send, X } from './Icons';

const ERROR_COPY = {
  unauthenticated: 'Please sign in again.',
  invalid_target: 'That scholar could not be selected.',
  invalid_amount: 'Requests must be between 1 and 10 SC.',
  blocked: 'You cannot exchange coins with that scholar.',
  not_friends: 'You can only request coins from a friend or rival.',
  cooldown: 'A request between you two was just sent. Try again in a minute.',
  sent_limit: 'You have sent three requests in the last 24 hours.',
  received_limit: 'That scholar has received too many requests today.',
  not_found: 'That request is no longer available.',
  invalid_response: 'That response could not be recorded.',
  expired: 'That request has expired.',
  declined: 'That request was declined.',
  cancelled: 'That request was cancelled.',
  accepted: 'That request was already accepted.',
  insufficient_funds: 'The recipient does not have enough Smart Coins.',
};

const chip = 'rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40';

const rid = () => (crypto?.randomUUID
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

const fmtWhen = (iso) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const RequestsPanel = ({ onOpenProfile }) => {
  const { supabase, refreshSmartCoins } = useAppContext();
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [history, setHistory] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [recipientId, setRecipientId] = useState('');
  const [amount, setAmount] = useState('5');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    try {
      const [requestsRes, friendsRes] = await Promise.all([
        supabase.rpc('social_sc_requests_list', { p_limit: 40, p_offset: 0 }),
        supabase.rpc('friend_list'),
      ]);
      if (requestsRes.error) throw requestsRes.error;
      if (!requestsRes.data || requestsRes.data.ok === false) {
        throw new Error(requestsRes.data?.error || 'Could not load requests');
      }
      setIncoming(Array.isArray(requestsRes.data.incoming) ? requestsRes.data.incoming : []);
      setOutgoing(Array.isArray(requestsRes.data.outgoing) ? requestsRes.data.outgoing : []);
      setHistory(Array.isArray(requestsRes.data.history) ? requestsRes.data.history : []);
      setConnections(Array.isArray(friendsRes.data?.friends) ? friendsRes.data.friends : []);
    } catch (err) {
      console.warn('[requests] load:', err?.message);
      setError('Could not load Smart Coin requests right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const selected = useMemo(
    () => connections.find((c) => c.userId === recipientId) || null,
    [connections, recipientId],
  );

  const fail = useCallback((data, fallback) => {
    const code = data?.error;
    setError(ERROR_COPY[code] || fallback || 'Something went wrong. Try again.');
    return false;
  }, []);

  const send = useCallback(async () => {
    if (!supabase) return;
    const parsed = Number(amount);
    if (!selected) { setError('Choose a friend or rival first.'); return; }
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
      setError('Requests must be between 1 and 10 SC.');
      return;
    }
    setBusy('send');
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('social_sc_request', {
      p_recipient: selected.userId,
      p_amount: parsed,
      p_note: note.trim() || null,
      p_client_request_id: rid(),
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      fail(data, rpcError?.message || 'Could not send that request.');
      return;
    }
    setNotice(`Asked ${selected.name} for ${parsed} SC.`);
    setNote('');
    setAmount('5');
    await load();
  }, [supabase, selected, amount, note, load, fail]);

  const respond = useCallback(async (req, accept) => {
    if (!supabase) return;
    setBusy(`respond-${req.requestId}`);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('social_sc_request_respond', {
      p_request_id: req.requestId,
      p_accept: accept,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      fail(data, rpcError?.message || 'Could not answer that request.');
      await load();
      return;
    }
    if (accept) {
      setNotice(`Sent ${req.amount} SC to ${req.name}.`);
      refreshSmartCoins?.();
    } else {
      setNotice(`Declined ${req.name}'s request.`);
    }
    await load();
  }, [supabase, refreshSmartCoins, load, fail]);

  const cancel = useCallback(async (req) => {
    if (!supabase) return;
    setBusy(`cancel-${req.requestId}`);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('social_sc_request_cancel', {
      p_request_id: req.requestId,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      fail(data, rpcError?.message || 'Could not cancel that request.');
      await load();
      return;
    }
    setNotice('Request cancelled.');
    await load();
  }, [supabase, load, fail]);

  const Row = ({ req, children, meta }) => (
    <li className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-clinical">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => onOpenProfile?.({ userId: req.userId, displayName: req.name })}
            className="block max-w-full text-left font-black text-slate-900 dark:text-white break-words"
            aria-label={`Open ${req.name || 'scholar'}'s profile`}
          >
            {req.name || 'Scholar'}
          </button>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {meta}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500/15 px-3 py-1.5 text-sm font-black tabular-nums text-amber-600 dark:text-amber-400">
          {req.amount} SC
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );

  return (
    <div>
      {(error || notice) && (
        <div
          role="status"
          className={`mb-4 rounded-2xl px-4 py-3 text-sm font-bold ${
            error
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
              : 'bg-polynurse-50 dark:bg-slate-800/60 text-polynurse-800 dark:text-polynurse-200'
          }`}
        >
          <div className="flex items-start gap-2">
            <span className="flex-1">{error || notice}</span>
            <button onClick={() => { setError(null); setNotice(null); }} aria-label="Dismiss message">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-clinical">
        <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
          <Coins size={14} /> Ask for Smart Coins
        </h2>
        <p className="mt-1 text-xs font-bold text-slate-400">
          Requests are 1-10 SC and only work with an accepted friend or rival. They pay only when accepted.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Scholar</span>
            <select
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white"
            >
              <option value="">Choose someone</option>
              {connections.map((c) => (
                <option key={c.userId} value={c.userId}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Amount (1-10 SC)</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              max="10"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-black text-slate-900 dark:text-white"
            />
          </label>
        </div>
        <input
          type="text"
          maxLength={160}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note"
          className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400"
        />
        <button
          onClick={send}
          disabled={busy === 'send' || !selected}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-polynurse-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition disabled:opacity-40"
        >
          {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {busy === 'send' ? 'Sending' : 'Send request'}
        </button>
        {connections.length === 0 && !loading && (
          <p className="mt-2 text-[10px] font-bold text-slate-400">
            Add a friend or rival first, then their name will appear here.
          </p>
        )}
      </section>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Requests</p>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin text-polynurse-600" />
        </div>
      ) : (
        <>
          {incoming.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Waiting for you ({incoming.length})
              </h2>
              <ul className="space-y-2">
                {incoming.map((req) => (
                  <Row key={req.requestId} req={req} meta={`Asked ${fmtWhen(req.createdAt)}`}>
                    <button
                      onClick={() => respond(req, false)}
                      disabled={busy === `respond-${req.requestId}`}
                      className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => respond(req, true)}
                      disabled={busy === `respond-${req.requestId}`}
                      className={`${chip} bg-polynurse-700 px-4 text-white`}
                    >
                      Send {req.amount} SC
                    </button>
                  </Row>
                ))}
              </ul>
            </section>
          )}

          {outgoing.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Awaiting reply ({outgoing.length})
              </h2>
              <ul className="space-y-2">
                {outgoing.map((req) => (
                  <Row key={req.requestId} req={req} meta={`Sent ${fmtWhen(req.createdAt)}`}>
                    <button
                      onClick={() => cancel(req)}
                      disabled={busy === `cancel-${req.requestId}`}
                      className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
                    >
                      Cancel
                    </button>
                  </Row>
                ))}
              </ul>
            </section>
          )}

          {incoming.length === 0 && outgoing.length === 0 && (
            <div className="rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center shadow-clinical">
              <Coins className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={38} />
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                No pending requests. Ask a friend above, or wait for one to arrive.
              </p>
            </div>
          )}

          {history.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                History
              </h2>
              <ul className="space-y-2">
                {history.map((req) => (
                  <li
                    key={req.requestId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-slate-700 dark:text-slate-200">{req.name || 'Scholar'}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {req.direction === 'outgoing' ? 'You asked' : 'They asked'} {'\u00b7'} {req.status}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-black tabular-nums text-slate-500 dark:text-slate-400">
                      {req.amount} SC
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default RequestsPanel;
