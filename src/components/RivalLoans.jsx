import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Clock, Landmark, Loader2, RefreshCw, Send, X } from './Icons';

const DEFAULT_CONFIG = {
  enabled: true,
  min_principal_sc: 5,
  max_principal_sc: 50,
  min_interest_pct: 0,
  max_interest_pct: 25,
  min_term_days: 1,
  max_term_days: 14,
  borrower_max_active: 1,
  lender_max_active: 3,
  lender_max_outstanding_sc: 100,
  pending_expiry_hours: 72,
  grace_hours: 24,
};

const ERROR_COPY = {
  unauthenticated: 'Please sign in again.',
  disabled: 'Scholar loans are switched off right now.',
  invalid_target: 'Choose a friend or rival to borrow from.',
  invalid_amount: 'That principal is outside the allowed range.',
  invalid_interest: 'That interest rate is outside the allowed range.',
  invalid_term: 'That repayment term is outside the allowed range.',
  not_connected: 'You can only borrow from an accepted friend or rival.',
  blocked: 'You cannot exchange coins with that scholar.',
  borrower_has_active_loan: 'You already have an active scholar loan.',
  lender_active_limit: 'That lender already has the maximum number of active loans.',
  lender_exposure_limit: 'That lender has reached their outstanding loan limit.',
  lender_insufficient_funds: 'That lender does not have enough Smart Coins to fund this.',
  insufficient_funds: 'You do not have enough Smart Coins to repay this loan.',
  not_found: 'That loan is no longer available.',
  not_active: 'That loan is not active.',
  not_due: 'That loan is not due yet.',
  expired: 'That loan request has expired.',
  declined: 'That loan request was declined.',
  cancelled: 'That loan request was cancelled.',
  active: 'That loan is already active.',
  repaid: 'That loan has already been repaid.',
  defaulted: 'That loan has already defaulted.',
  invalid_response: 'That response could not be recorded.',
};

const chip = 'rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40';

const rid = () => (crypto?.randomUUID
  ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));

const fmtDate = (iso) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const StatusPill = ({ status }) => {
  const tone = status === 'active'
    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    : status === 'pending'
      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
      : status === 'defaulted'
        ? 'bg-red-500/15 text-red-600 dark:text-red-400'
        : 'bg-slate-500/15 text-slate-500 dark:text-slate-400';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${tone}`}>
      {status}
    </span>
  );
};

const RivalLoans = () => {
  const { supabase, refreshSmartCoins } = useAppContext();
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [active, setActive] = useState([]);
  const [history, setHistory] = useState([]);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [lenderId, setLenderId] = useState('');
  const [principal, setPrincipal] = useState('5');
  const [interestPct, setInterestPct] = useState('0');
  const [termDays, setTermDays] = useState('7');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    try {
      const [configRes, loansRes, friendsRes] = await Promise.all([
        supabase.rpc('social_loan_config'),
        supabase.rpc('social_loans_list', { p_limit: 40, p_offset: 0 }),
        supabase.rpc('friend_list'),
      ]);
      if (loansRes.error) throw loansRes.error;
      if (!loansRes.data || loansRes.data.ok === false) {
        throw new Error(loansRes.data?.error || 'Could not load loans');
      }
      const nextConfig = configRes.data && typeof configRes.data === 'object' ? configRes.data : DEFAULT_CONFIG;
      setConfig({ ...DEFAULT_CONFIG, ...nextConfig });
      setIncoming(Array.isArray(loansRes.data.incoming) ? loansRes.data.incoming : []);
      setOutgoing(Array.isArray(loansRes.data.outgoing) ? loansRes.data.outgoing : []);
      setActive(Array.isArray(loansRes.data.active) ? loansRes.data.active : []);
      setHistory(Array.isArray(loansRes.data.history) ? loansRes.data.history : []);
      setConnections(Array.isArray(friendsRes.data?.friends) ? friendsRes.data.friends : []);
    } catch (err) {
      console.warn('[loans] load:', err?.message);
      setError('Could not load scholar loans right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const selectedLender = useMemo(
    () => connections.find((c) => c.userId === lenderId) || null,
    [connections, lenderId],
  );

  const fail = useCallback((data, fallback) => {
    setError(ERROR_COPY[data?.error] || fallback || 'Something went wrong. Try again.');
  }, []);

  const send = useCallback(async () => {
    if (!supabase) return;
    const p = Number(principal);
    const i = Number(interestPct);
    const t = Number(termDays);
    if (!selectedLender) { setError('Choose a friend or rival first.'); return; }
    if (!Number.isFinite(p) || p < config.min_principal_sc || p > config.max_principal_sc) {
      setError(`Principal must be ${config.min_principal_sc}-${config.max_principal_sc} SC.`);
      return;
    }
    if (!Number.isFinite(i) || i < config.min_interest_pct || i > config.max_interest_pct) {
      setError(`Interest must be ${config.min_interest_pct}-${config.max_interest_pct}%.`);
      return;
    }
    if (!Number.isFinite(t) || t < config.min_term_days || t > config.max_term_days) {
      setError(`Term must be ${config.min_term_days}-${config.max_term_days} days.`);
      return;
    }
    setBusy('send');
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('social_loan_request', {
      p_lender_id: selectedLender.userId,
      p_principal: p,
      p_interest_pct: i,
      p_term_days: t,
      p_note: note.trim() || null,
      p_client_request_id: rid(),
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      fail(data, rpcError?.message || 'Could not send that loan request.');
      await load();
      return;
    }
    setNotice(`Asked ${selectedLender.name} for ${p} SC.`);
    setNote('');
    await load();
  }, [supabase, selectedLender, principal, interestPct, termDays, note, config, load, fail]);

  const respond = useCallback(async (loan, accept) => {
    if (!supabase) return;
    setBusy(`respond-${loan.loanId}`);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('social_loan_respond', {
      p_loan_id: loan.loanId,
      p_accept: accept,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      fail(data, rpcError?.message || 'Could not answer that loan request.');
      await load();
      return;
    }
    setNotice(accept ? `Funded ${loan.name}'s ${loan.principal} SC loan.` : `Declined ${loan.name}'s loan request.`);
    refreshSmartCoins?.();
    await load();
  }, [supabase, refreshSmartCoins, load, fail]);

  const repay = useCallback(async (loan) => {
    if (!supabase) return;
    setBusy(`repay-${loan.loanId}`);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('social_loan_repay', {
      p_loan_id: loan.loanId,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      fail(data, rpcError?.message || 'Could not repay that loan.');
      await load();
      return;
    }
    setNotice(`Repaid ${loan.totalDue} SC to ${loan.name}.`);
    refreshSmartCoins?.();
    await load();
  }, [supabase, refreshSmartCoins, load, fail]);

  const cancel = useCallback(async (loan) => {
    if (!supabase) return;
    setBusy(`cancel-${loan.loanId}`);
    setError(null);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('social_loan_cancel', {
      p_loan_id: loan.loanId,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      fail(data, rpcError?.message || 'Could not cancel that loan request.');
      await load();
      return;
    }
    setNotice('Loan request cancelled.');
    await load();
  }, [supabase, load, fail]);

  const loanCard = (loan, children, meta) => (
    <li key={loan.loanId} className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-clinical">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black text-slate-900 dark:text-white break-words">{loan.name || 'Scholar'}</p>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">{meta}</p>
        </div>
        <StatusPill status={loan.status} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 px-3 py-2 text-center">
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Principal</p>
          <p className="text-sm font-black tabular-nums text-slate-800 dark:text-white">{loan.principal} SC</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Interest</p>
          <p className="text-sm font-black tabular-nums text-slate-800 dark:text-white">{loan.interestPct}%</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total due</p>
          <p className="text-sm font-black tabular-nums text-slate-800 dark:text-white">{loan.totalDue} SC</p>
        </div>
      </div>
      {loan.note && <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400 break-words">{loan.note}</p>}
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
          <Landmark size={14} /> Borrow from a scholar
        </h2>
        <p className="mt-1 text-xs font-bold text-slate-400">
          Choose a friend or rival, set the terms, and they fund it only if they accept. Defaults after the grace window sweep what is available.
          {config.enabled === false ? ' Scholar loans are currently switched off.' : ''}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Lender</span>
            <select
              value={lenderId}
              onChange={(e) => setLenderId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white"
            >
              <option value="">Choose someone</option>
              {connections.map((c) => (
                <option key={c.userId} value={c.userId}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Principal ({config.min_principal_sc}-{config.max_principal_sc} SC)
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={config.min_principal_sc}
              max={config.max_principal_sc}
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-black text-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Interest ({config.min_interest_pct}-{config.max_interest_pct}%)
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={config.min_interest_pct}
              max={config.max_interest_pct}
              value={interestPct}
              onChange={(e) => setInterestPct(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-black text-slate-900 dark:text-white"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Term ({config.min_term_days}-{config.max_term_days} days)
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={config.min_term_days}
              max={config.max_term_days}
              value={termDays}
              onChange={(e) => setTermDays(e.target.value)}
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-black text-slate-900 dark:text-white"
            />
          </label>
        </div>
        <input
          type="text"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note for the lender"
          className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400"
        />
        <p className="mt-2 text-[10px] font-bold text-slate-400">
          Pending requests expire in {config.pending_expiry_hours}h. Defaults settle after {config.grace_hours}h grace.
        </p>
        <button
          onClick={send}
          disabled={busy === 'send' || !selectedLender || config.enabled === false}
          className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-polynurse-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition disabled:opacity-40"
        >
          {busy === 'send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {busy === 'send' ? 'Sending' : 'Send loan request'}
        </button>
        {connections.length === 0 && !loading && (
          <p className="mt-2 text-[10px] font-bold text-slate-400">
            Add a friend or rival first, then their name will appear here.
          </p>
        )}
      </section>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scholar loans</p>
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
                Funding requests ({incoming.length})
              </h2>
              <ul className="space-y-2">
                {incoming.map((loan) => loanCard(loan, (
                  <>
                    <button
                      onClick={() => respond(loan, false)}
                      disabled={busy === `respond-${loan.loanId}`}
                      className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
                    >
                      Decline
                    </button>
                    <button
                      onClick={() => respond(loan, true)}
                      disabled={busy === `respond-${loan.loanId}`}
                      className={`${chip} bg-polynurse-700 px-4 text-white`}
                    >
                      Fund {loan.principal} SC
                    </button>
                  </>
                ), `Wants ${loan.principal} SC for ${loan.termDays} days`))}
              </ul>
            </section>
          )}

          {outgoing.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Awaiting lender ({outgoing.length})
              </h2>
              <ul className="space-y-2">
                {outgoing.map((loan) => loanCard(loan, (
                  <button
                    onClick={() => cancel(loan)}
                    disabled={busy === `cancel-${loan.loanId}`}
                    className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
                  >
                    Cancel
                  </button>
                ), `Requested ${fmtDate(loan.createdAt)}`))}
              </ul>
            </section>
          )}

          {active.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Active ({active.length})
              </h2>
              <ul className="space-y-2">
                {active.map((loan) => loanCard(loan, (
                  <>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
                      <Clock size={12} />
                      {loan.overdue ? 'Overdue' : 'Due'} {fmtDate(loan.dueAt)}
                      {loan.side === 'lender' && loan.graceEndsAt ? ` \u00b7 grace to ${fmtDate(loan.graceEndsAt)}` : ''}
                    </span>
                    {loan.canRepay && (
                      <button
                        onClick={() => repay(loan)}
                        disabled={busy === `repay-${loan.loanId}`}
                        className={`${chip} bg-polynurse-700 px-4 text-white`}
                      >
                        Repay {loan.totalDue} SC
                      </button>
                    )}
                  </>
                ), loan.side === 'borrower' ? `You borrowed from ${loan.name}` : `${loan.name} borrowed from you`))}
              </ul>
            </section>
          )}

          {incoming.length === 0 && outgoing.length === 0 && active.length === 0 && (
            <div className="rounded-[2rem] border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-8 text-center shadow-clinical">
              <Landmark className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={38} />
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400">
                No scholar loans yet. Ask a friend above, or wait for a funding request.
              </p>
            </div>
          )}

          {history.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
                History
              </h2>
              <ul className="space-y-2">
                {history.map((loan) => (
                  <li
                    key={loan.loanId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-slate-700 dark:text-slate-200">{loan.name || 'Scholar'}</p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {loan.side === 'borrower' ? 'You borrowed' : 'You lent'} {'\u00b7'} {loan.status}
                        {loan.status === 'defaulted' ? ` \u00b7 ${loan.forfeitedSc || 0} SC forfeited` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-black tabular-nums text-slate-500 dark:text-slate-400">
                      {loan.principal} SC
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

export default RivalLoans;
