import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ArrowLeft, Coins, Landmark, Send, Loader2, RefreshCw, Search, X } from '../components/Icons';

// Wallet: Smart Coin transfers + the World Bank (migration v81).
//
// Every amount, cap and interest rate shown here comes FROM the server
// (`server_config` via /api/economy/overview). The inputs are bounds, not
// authority: the RPC re-validates them, and `requestId` makes a retry safe.

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN = 2;

const errText = (err) => {
  if (!err) return null;
  if (typeof err === 'string') return err;
  return err.message || err.error || 'Something went wrong. Try again.';
};

const Wallet = () => {
  const navigate = useNavigate();
  const { supabase, session, refreshSmartCoins } = useAppContext();

  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // transfers
  const [toQuery, setToQuery] = useState('');
  const [activeToQuery, setActiveToQuery] = useState('');
  const [people, setPeople] = useState([]);
  const [recipient, setRecipient] = useState(null);
  const [amount, setAmount] = useState('');

  // bank
  const [borrowAmount, setBorrowAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { fetchEconomyOverview } = await import('../utils/economyApi');
      const data = await fetchEconomyOverview(session);
      if (data?.ok) { setOverview(data); setError(null); }
      else setError(errText(data));
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

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

  const tCfg = overview?.transfers || {};
  const bCfg = overview?.worldBank || {};
  const loans = Array.isArray(overview?.bank?.loans) ? overview.bank.loans : [];
  const activeLoans = loans.filter((l) => l.status === 'active');

  const transferMax = Math.min(Number(tCfg.max_sc) || 200, Number(overview?.balance) || 0);
  const bankMax = Math.min(Number(bCfg.max_sc) || 200, (Number(bCfg.max_outstanding_sc) || 400) - (Number(overview?.bank?.outstanding) || 0));

  const doTransfer = async () => {
    if (!recipient) { setError('Pick who you are sending to.'); return; }
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter an amount.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const { sendTransfer } = await import('../utils/economyApi');
      const res = await sendTransfer(session, { toUserId: recipient.userId, amount: n });
      if (res?.ok) {
        setNotice(`Sent ${res.amount} SC to ${recipient.name}.`);
        setAmount(''); setRecipient(null); setToQuery('');
        await load();
        refreshSmartCoins?.();
      } else {
        setError(errText(res));
      }
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const doBorrow = async () => {
    const n = Number(borrowAmount);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter an amount to borrow.'); return; }
    setBusy(true); setError(null); setNotice(null);
    try {
      const { borrowFromBank } = await import('../utils/economyApi');
      const res = await borrowFromBank(session, n);
      if (res?.ok) {
        setNotice(`Borrowed ${res.principal} SC. Repay ${res.principal + res.interestSc} SC within ${res.dueInDays} days.`);
        setBorrowAmount('');
        await load();
        refreshSmartCoins?.();
      } else {
        setError(errText(res));
      }
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const doRepay = async (loan) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const { repayLoan } = await import('../utils/economyApi');
      const res = await repayLoan(session, loan.loanId);
      if (res?.ok) {
        setNotice(`Repaid ${res.paid} SC (${res.principal} + ${res.interest} interest).`);
        await load();
        refreshSmartCoins?.();
      } else {
        setError(errText(res));
      }
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const balance = Number(overview?.balance) || 0;
  const earned = Number(overview?.earned) || 0;
  const interestPct = Number(bCfg.interest_pct) || 10;
  const termDays = Number(bCfg.term_days) || 7;

  const quickBorrow = useMemo(() => bankMax > 0 ? [10, 50, bankMax].filter((v, i, a) => v > 0 && a.indexOf(v) === i) : [], [bankMax]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-polynurse-700 dark:hover:text-polynurse-300 font-bold text-sm transition"
        >
          <ArrowLeft size={18} /> Back
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-polynurse-700 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 p-8 opacity-10"><Coins size={110} /></div>
        <h1 className="text-2xl font-black uppercase tracking-tight relative z-10">Smart Coins</h1>
        <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
          Your wallet
        </p>
        <p className="text-4xl font-black tabular-nums relative z-10 mt-3">{balance}</p>
        <p className="text-xs font-bold text-white/80 relative z-10 mt-1">
          {earned.toLocaleString()} SC earned all time
          <span className="text-white/60"> · earning only happens by winning duels</span>
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

      {loading && !overview ? (
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
                  onClick={doTransfer}
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
                        onClick={() => doRepay(l)}
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
                    onClick={doBorrow}
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

          <p className="text-[10px] font-bold text-slate-400">
            Coins are earned by winning duels and the arena. Quizzes, daily streaks, referrals and
            squads no longer pay out.
          </p>
        </>
      )}
    </div>
  );
};

export default Wallet;