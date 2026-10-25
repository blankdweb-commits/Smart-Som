import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ArrowLeft, Coins, Landmark, Send, Loader2, RefreshCw, Search, X, Lock } from '../components/Icons';
import WalletPinDialog from '../components/WalletPinDialog';
import { newRequestId } from '../utils/economyApi';

// Wallet: Smart Coin transfers + the World Bank (migration v81).
//
// Every amount, cap and interest rate shown here comes FROM the server
// (`server_config` via /api/economy/overview). The inputs are bounds, not
// authority: the RPC re-validates them, and `requestId` makes a retry safe.
//
// The wallet is PIN-gated (v110). The PIN is held in memory on this page only;
// it is never stored in localStorage or sent anywhere except these endpoints.

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN = 2;

const PIN_ERROR_CODES = new Set([
  'PIN_REQUIRED',
  'PIN_NOT_SET',
  'PIN_INCORRECT',
  'PIN_LOCKED',
  'PIN_ALREADY_SET',
  'REAUTH_REQUIRED',
]);

const errorCode = (err) => err?.code || err?.data?.error?.code || err?.data?.error || err?.error;

const isPinError = (err) => PIN_ERROR_CODES.has(errorCode(err));

const errText = (err) => {
  if (!err) return null;
  if (typeof err === 'string') return err;
  return err.message
    || err?.data?.error?.message
    || err?.data?.message
    || err?.error?.message
    || err?.error
    || 'Something went wrong. Try again.';
};

const Wallet = () => {
  const navigate = useNavigate();
  const { supabase, session, refreshSmartCoins } = useAppContext();

  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // PIN gate
  const [pinStatus, setPinStatus] = useState(null);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [pinModal, setPinModal] = useState(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState(null);
  const pendingIntentRef = useRef(null);

  // transfers
  const [toQuery, setToQuery] = useState('');
  const [activeToQuery, setActiveToQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [amount, setAmount] = useState('');
  const transferRequestIdRef = useRef(null);

  // bank
  const [borrowAmount, setBorrowAmount] = useState('');
  const borrowRequestIdRef = useRef(null);
  const repayRequestRef = useRef({ loanId: null, requestId: null });

  const handlePinFailure = useCallback((err, retryIntent = null) => {
    const code = errorCode(err);
    setPin('');
    setPinUnlocked(false);
    setOverview(null);
    if (retryIntent) pendingIntentRef.current = retryIntent;
    if (code === 'PIN_NOT_SET') setPinModal('setup');
    else setPinModal('unlock');
    setPinError(errText(err));
    if (code === 'PIN_LOCKED') {
      const retryAfterSeconds = Number(err?.data?.retryAfterSeconds ?? err?.data?.retry_after_seconds) || 900;
      setPinStatus((prev) => ({ ...prev, exists: true, locked: true, retryAfterSeconds }));
    }
  }, []);

  const load = useCallback(async (pinValue) => {
    if (!pinValue) return;
    setLoading(true);
    try {
      const { fetchEconomyOverview } = await import('../utils/economyApi');
      const data = await fetchEconomyOverview(session, pinValue);
      if (data?.ok) { setOverview(data); setError(null); }
      else setError(errText(data));
    } catch (e) {
      if (isPinError(e)) handlePinFailure(e);
      else setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [session, handlePinFailure]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchPinStatus } = await import('../utils/economyApi');
        const status = await fetchPinStatus(session);
        if (cancelled) return;
        setPinStatus(status);
        const wantsReset = new URLSearchParams(window.location.search).get('pinReset');
        if (wantsReset && status?.exists) setPinModal('reset');
        else setPinModal(status?.exists ? 'unlock' : 'setup');
      } catch (e) {
        if (!cancelled) {
          setError(errText(e));
          setPinModal('unlock');
        }
      }
    })();
    return () => {
      cancelled = true;
      pendingIntentRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    const t = toQuery.trim();
    if (t.length < SEARCH_MIN) { setActiveToQuery(''); return; }
    const timer = setTimeout(() => setActiveToQuery(t), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [toQuery]);

  useEffect(() => {
    if (!supabase || !activeToQuery) { setPeople([]); return; }
    let stopped = false;
    (async () => {
      const { searchPeople } = await import('../utils/economyApi');
      const rows = await searchPeople(supabase, activeToQuery);
      if (!stopped) setPeople(rows);
    })();
    return () => { stopped = true; };
  }, [supabase, activeToQuery]);

  useEffect(() => { transferRequestIdRef.current = null; }, [recipient, amount]);
  useEffect(() => { borrowRequestIdRef.current = null; }, [borrowAmount]);

  const completeUnlock = useCallback(async (pinValue, { notice: successNotice } = {}) => {
    const { fetchEconomyOverview } = await import('../utils/economyApi');
    const data = await fetchEconomyOverview(session, pinValue);
    if (!data?.ok) throw new Error(errText(data) || 'Could not open your wallet.');
    setOverview(data);
    setPin(pinValue);
    setPinUnlocked(true);
    setPinStatus((prev) => ({ ...prev, exists: true, locked: false, retryAfterSeconds: 0 }));
    setPinModal(null);
    setPinError(null);
    setError(null);
    if (successNotice) setNotice(successNotice);

    const intent = pendingIntentRef.current;
    pendingIntentRef.current = null;
    if (intent) await intent(pinValue);
  }, [session]);

  const handlePinSubmit = async ({ pin: nextPin, confirmPin, currentPin }) => {
    setPinBusy(true);
    setPinError(null);
    try {
      if (pinModal === 'setup') {
        const { setupPin } = await import('../utils/economyApi');
        await setupPin(session, { pin: nextPin, confirmPin });
        await completeUnlock(nextPin, { notice: 'Wallet PIN created.' });
      } else if (pinModal === 'unlock') {
        await completeUnlock(nextPin);
      } else if (pinModal === 'change') {
        const { changePin } = await import('../utils/economyApi');
        await changePin(session, { currentPin, pin: nextPin, confirmPin });
        setPin(nextPin);
        setPinUnlocked(true);
        setPinModal(null);
        setPinError(null);
        setNotice('Wallet PIN changed.');
      } else if (pinModal === 'reset') {
        const { resetPin } = await import('../utils/economyApi');
        await resetPin(session, { pin: nextPin, confirmPin });
        if (new URLSearchParams(window.location.search).get('pinReset')) {
          window.history.replaceState({}, '', '/wallet');
        }
        await completeUnlock(nextPin, { notice: 'Wallet PIN reset.' });
      }
    } catch (e) {
      if (isPinError(e)) handlePinFailure(e);
      else setPinError(errText(e));
    } finally {
      setPinBusy(false);
    }
  };

  const ensurePin = (intent) => {
    if (pinUnlocked && pin) { intent(pin); return; }
    pendingIntentRef.current = intent;
    setPinError(null);
    setPinModal(pinStatus?.exists ? 'unlock' : 'setup');
  };

  const sendResetEmail = async () => {
    const email = session?.user?.email;
    if (!email) { setPinError('No email is available for this account.'); return; }
    setPinBusy(true);
    setPinError(null);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/wallet?pinReset=1`,
      });
      if (resetError) throw resetError;
      setPinModal(null);
      setNotice(`Reset link sent to ${email}. Open it, then set a new wallet PIN.`);
    } catch (e) {
      setPinError(errText(e));
    } finally {
      setPinBusy(false);
    }
  };

  const lockWallet = () => {
    setPin('');
    setPinUnlocked(false);
    setOverview(null);
    setPinError(null);
    setPinModal(pinStatus?.exists ? 'unlock' : 'setup');
  };

  const tCfg = overview?.transfers || {};
  const bCfg = overview?.worldBank || {};
  const loans = Array.isArray(overview?.bank?.loans) ? overview.bank.loans : [];
  const activeLoans = loans.filter((l) => l.status === 'active');

  const transferMax = Math.min(Number(tCfg.max_sc) || 200, Number(overview?.balance) || 0);
  const bankMax = Math.min(Number(bCfg.max_sc) || 200, (Number(bCfg.max_outstanding_sc) || 400) - (Number(overview?.bank?.outstanding) || 0));

  const doTransfer = async (pinValue) => {
    if (!pinValue) return ensurePin(doTransfer);
    if (!recipient) { setError('Pick who you are sending to.'); return; }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter an amount.'); return; }
    if (!transferRequestIdRef.current) transferRequestIdRef.current = newRequestId();
    setBusy(true); setError(null); setNotice(null);
    try {
      const { sendTransfer } = await import('../utils/economyApi');
      const res = await sendTransfer(session, {
        toUserId: recipient.userId,
        amount: n,
        pin: pinValue,
        requestId: transferRequestIdRef.current,
      });
      if (res?.ok) {
        transferRequestIdRef.current = null;
        setNotice(`Sent ${res.amount} SC to ${recipient.name}.`);
        setAmount(''); setRecipient(null); setToQuery('');
        await load(pinValue);
        refreshSmartCoins?.();
      } else {
        setError(errText(res));
      }
    } catch (e) {
      if (isPinError(e)) { handlePinFailure(e, doTransfer); return; }
      setError(errText(e));
    } finally { setBusy(false); }
  };

  const doBorrow = async (pinValue) => {
    if (!pinValue) return ensurePin(doBorrow);
    const n = Number(borrowAmount);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter an amount to borrow.'); return; }
    if (!borrowRequestIdRef.current) borrowRequestIdRef.current = newRequestId();
    setBusy(true); setError(null); setNotice(null);
    try {
      const { borrowFromBank } = await import('../utils/economyApi');
      const res = await borrowFromBank(session, {
        amount: n,
        pin: pinValue,
        requestId: borrowRequestIdRef.current,
      });
      if (res?.ok) {
        borrowRequestIdRef.current = null;
        setNotice(`Borrowed ${res.principal} SC. Repay ${res.principal + res.interestSc} SC within ${res.dueInDays} days.`);
        setBorrowAmount('');
        await load(pinValue);
        refreshSmartCoins?.();
      } else {
        setError(errText(res));
      }
    } catch (e) {
      if (isPinError(e)) { handlePinFailure(e, doBorrow); return; }
      setError(errText(e));
    } finally { setBusy(false); }
  };

  const doRepay = async (loan, pinValue) => {
    if (!pinValue) return ensurePin((value) => doRepay(loan, value));
    if (repayRequestRef.current.loanId !== loan.loanId || !repayRequestRef.current.requestId) {
      repayRequestRef.current = { loanId: loan.loanId, requestId: newRequestId() };
    }
    setBusy(true); setError(null); setNotice(null);
    try {
      const { repayLoan } = await import('../utils/economyApi');
      const res = await repayLoan(session, {
        loanId: loan.loanId,
        pin: pinValue,
        requestId: repayRequestRef.current.requestId,
      });
      if (res?.ok) {
        repayRequestRef.current = { loanId: null, requestId: null };
        setNotice(`Repaid ${res.paid} SC (${res.principal} + ${res.interest} interest).`);
        await load(pinValue);
        refreshSmartCoins?.();
      } else {
        setError(errText(res));
      }
    } catch (e) {
      if (isPinError(e)) { handlePinFailure(e, (value) => doRepay(loan, value)); return; }
      setError(errText(e));
    } finally { setBusy(false); }
  };

  const balance = Number(overview?.balance) || 0;
  const earned = Number(overview?.earned) || 0;
  const interestPct = Number(bCfg.interest_pct) || 10;
  const termDays = Number(bCfg.term_days) || 7;

  const quickBorrow = useMemo(() => bankMax > 0 ? [10, 50, bankMax].filter((v, i, a) => v > 0 && a.indexOf(v) === i) : [], [bankMax]);

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-polynurse-700 dark:hover:text-polynurse-300 font-bold text-sm transition"
          >
            <ArrowLeft size={18} /> Back
          </button>
          <div className="flex items-center gap-4">
            {pinUnlocked && (
              <button
                onClick={lockWallet}
                className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 hover:text-polynurse-700 dark:hover:text-polynurse-300 font-black text-xs uppercase tracking-widest transition"
              >
                <Lock size={14} /> Lock
              </button>
            )}
            <button
              onClick={() => load(pin)}
              disabled={loading || !pinUnlocked}
              className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="bg-polynurse-700 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mb-6">
          <div className="absolute top-0 right-0 p-8 opacity-10"><Coins size={110} /></div>
          <h1 className="text-2xl font-black uppercase tracking-tight relative z-10">Smart Coins</h1>
          <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
            Your wallet
          </p>
          <p className="text-4xl font-black tabular-nums relative z-10 mt-3">{pinUnlocked ? balance : '••••'}</p>
          <p className="text-xs font-bold text-white/80 relative z-10 mt-1">
            {pinUnlocked ? (
              <>
                {earned.toLocaleString()} SC earned all time
                <span className="text-white/60"> · earning only happens by winning duels</span>
              </>
            ) : (
              'Locked · enter your 6-digit PIN to see and move coins'
            )}
          </p>
        </div>

        {(error || notice) && (
          <div className={`mb-4 rounded-2xl px-4 py-3 text-sm font-bold ${
            error
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
              : 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
          }`}
          >
            {error || notice}
          </div>
        )}

        {!pinUnlocked ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-800">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-polynurse-100 text-polynurse-700 dark:bg-polynurse-900/40 dark:text-polynurse-300">
              <Lock size={30} />
            </div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">
              {pinStatus?.exists ? 'Wallet locked' : 'Set up your wallet PIN'}
            </h2>
            <p className="mx-auto mt-2 max-w-sm text-xs font-bold text-slate-500 dark:text-slate-400">
              {pinStatus?.exists
                ? 'Transfers and World Bank actions need your 6-digit PIN. It is never stored on this device.'
                : 'Create a 6-digit PIN before sending coins or using the World Bank. You can reset it by email if you forget it.'}
            </p>
            <button
              onClick={() => {
                setPinError(null);
                setPinModal(pinStatus?.exists ? 'unlock' : 'setup');
              }}
              className="mt-5 rounded-xl bg-polynurse-700 px-6 py-3 text-xs font-black uppercase tracking-widest text-white transition active:scale-[0.99]"
            >
              {pinStatus?.exists ? 'Unlock wallet' : 'Create wallet PIN'}
            </button>
            {pinStatus?.exists && (
              <button
                onClick={sendResetEmail}
                disabled={pinBusy}
                className="mt-3 block w-full text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-polynurse-700 disabled:opacity-40 dark:text-slate-400 dark:hover:text-polynurse-300"
              >
                Forgot PIN? Send a reset link
              </button>
            )}
          </div>
        ) : loading && !overview ? (
          <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-polynurse-600" /></div>
        ) : (
          <>
            {/* ---------------- SEND ---------------- */}
            <section className="mb-8">
              <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
                <Send size={14} /> Send Smart Coins
              </h2>

              {tCfg.enabled === false && (
                <p className="mb-3 rounded-2xl bg-amber-50 dark:bg-amber-900/20 px-4 py-3 text-xs font-bold text-amber-700 dark:text-amber-300">
                  Transfers are switched off right now.
                </p>
              )}

              {recipient ? (
                <div className="rounded-2xl border border-polynurse-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <p className="font-black text-slate-900 dark:text-white truncate">{recipient.name}</p>
                    <button
                      onClick={() => setRecipient(null)}
                      aria-label="Change recipient"
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 shrink-0"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
                    Amount ({tCfg.min_sc}–{transferMax} SC)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={tCfg.min_sc}
                    max={transferMax}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm font-black text-slate-900 dark:text-white focus:outline-none focus:border-polynurse-400"
                  />
                  <p className="mt-2 text-[10px] font-bold text-slate-400">
                    No fee. Up to {tCfg.daily_cap_sc} SC a day and {tCfg.hourly_count} transfers an hour.
                  </p>
                  <button
                    onClick={() => doTransfer(pin)}
                    disabled={busy}
                    className="mt-3 w-full rounded-xl bg-polynurse-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white active:scale-[0.99] transition disabled:opacity-40"
                  >
                    {busy ? 'Sending…' : 'Send'}
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="search"
                    value={toQuery}
                    onChange={(e) => setToQuery(e.target.value)}
                    placeholder="Find someone by name…"
                    aria-label="Find someone to send coins to"
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-3 pl-10 pr-10 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-polynurse-400"
                  />
                </div>
              )}

              {toQuery.trim() && toQuery.trim().length < SEARCH_MIN && (
                <p className="mt-2 text-[10px] font-bold text-slate-400">Type at least {SEARCH_MIN} characters.</p>
              )}
              {!recipient && people.length > 0 && (
                <ul className="mt-2 space-y-2">
                  {people.map((p) => (
                    <li key={p.userId}>
                      <button
                        onClick={() => { setRecipient(p); setToQuery(''); }}
                        className="w-full text-left rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 hover:border-polynurse-300 transition"
                      >
                        <span className="font-black text-sm text-slate-900 dark:text-white">{p.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!recipient && activeToQuery && people.length === 0 && (
                <p className="mt-2 text-xs font-bold text-slate-500 dark:text-slate-400">
                  Nobody matches “{activeToQuery}”. They may not have activated their account.
                </p>
              )}
            </section>

            {/* ---------------- WORLD BANK ---------------- */}
            <section className="mb-8">
              <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-3">
                <Landmark size={14} /> World Bank
              </h2>

              <div className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 mb-3">
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  Borrow {bCfg.min_sc}–{bCfg.max_sc} SC and repay with {interestPct}% interest within {termDays} days.
                </p>
                <p className="mt-1 text-[10px] font-bold text-slate-400">
                  One loan at a time, up to {bCfg.max_outstanding_sc} SC outstanding.
                </p>

                {activeLoans.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {activeLoans.map((l) => (
                      <div key={l.loanId} className="rounded-xl border border-amber-300/50 bg-amber-50 dark:bg-amber-900/20 p-3">
                        <p className="text-sm font-black text-slate-900 dark:text-white">
                          {l.principal} SC borrowed · {l.due} SC due
                        </p>
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2">
                          Due {new Date(l.dueAt).toLocaleDateString()}
                        </p>
                        <button
                          onClick={() => doRepay(l, pin)}
                          disabled={busy}
                          className="rounded-full bg-slate-800 dark:bg-slate-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40 transition"
                        >
                          {busy ? 'Repaying…' : `Repay ${l.due} SC`}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2 mt-3 mb-3">
                      {quickBorrow.map((v) => (
                        <button
                          key={v}
                          onClick={() => setBorrowAmount(String(v))}
                          className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 transition"
                        >
                          {v} SC
                        </button>
                      ))}
                    </div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-1">
                      Amount to borrow (max {bankMax})
                    </label>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={bCfg.min_sc}
                      max={bankMax}
                      value={borrowAmount}
                      onChange={(e) => setBorrowAmount(e.target.value)}
                      placeholder="0"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-4 py-3 text-sm font-black text-slate-900 dark:text-white focus:outline-none focus:border-polynurse-400"
                    />
                    <button
                      onClick={() => doBorrow(pin)}
                      disabled={busy || bankMax < bCfg.min_sc}
                      className="mt-3 w-full rounded-xl bg-polynurse-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white active:scale-[0.99] transition disabled:opacity-40"
                    >
                      {busy ? 'Borrowing…' : 'Borrow'}
                    </button>
                  </>
                )}
              </div>

              {loans.filter((l) => l.status !== 'active').slice(0, 3).length > 0 && (
                <p className="text-[10px] font-bold text-slate-400">
                  Repaid: {loans.filter((l) => l.status !== 'active').slice(0, 3).map((l) => `${l.principal} SC`).join(', ')}
                </p>
              )}
            </section>

            <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800">
              <p className="text-[10px] font-bold text-slate-400">
                Wallet PIN is set. It is requested again after you leave this page.
              </p>
              <button
                onClick={() => { setPinError(null); setPinModal('change'); }}
                className="shrink-0 text-[10px] font-black uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300"
              >
                Change PIN
              </button>
            </div>

            <p className="mt-4 text-[10px] font-bold text-slate-400">
              Coins are earned by winning duels and the arena. Quizzes, daily streaks, referrals and
              squads no longer pay out.
            </p>
          </>
        )}
      </div>

      <WalletPinDialog
        isOpen={!!pinModal}
        mode={pinModal || 'unlock'}
        busy={pinBusy}
        error={pinError}
        lockedForSeconds={pinStatus?.locked ? Number(pinStatus.retryAfterSeconds) || 0 : 0}
        onClose={() => { setPinModal(null); setPinError(null); }}
        onSubmit={handlePinSubmit}
        onForgot={sendResetEmail}
      />
    </>
  );
};

export default Wallet;
