import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import {
  ArrowLeft, Coins, Users, Crown, AlertTriangle, RefreshCw, Loader2,
  Check, XCircle, Clock, Send, TrendingUp, ShieldCheck,
} from '../components/Icons';
import {
  fetchLoans, requestLoan, offerLoan, acceptLoan, repayLoan, rejectLoan,
  cancelLoan, buySharkLicense, markLoanDefault,
} from '../utils/loanApi';

const SHARK_WARNING =
  'Borrowing is backed by your Smart Coin balance. If you do not repay within the window, '
  + 'the platform recovers what it can from your available SC, the default is recorded on your '
  + 'public loan history (visible to lenders), and you risk losing licences, achievements and '
  + 'progress accumulated from the first stage.';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
};

const hoursLeft = (dueAt) => {
  if (!dueAt) return null;
  return (Date.parse(dueAt) - Date.now()) / 3600000;
};

const statusTone = (status) =>
  status === 'active' ? 'text-amber-300 border-amber-500/30 bg-amber-500/10'
    : status === 'repaid' ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
      : status === 'defaulted' ? 'text-red-300 border-red-500/30 bg-red-500/10'
        : 'text-slate-300 border-slate-600/40 bg-slate-700/20';

function LoanShark() {
  const navigate = useNavigate();
  const { session, smartCoins } = useAppContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchLoans(session));
    } catch (e) {
      setError(e?.message || 'Could not load the loan market.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  const profile = data?.profile || null;
  const config = data?.config || null;
  const openRequests = data?.open_requests || [];

  const { borrowing, lending, history } = useMemo(() => {
    const borrow = [];
    const lend = [];
    const hist = [];
    for (const l of data?.my_loans || []) {
      if (l.role === 'borrower') {
        if (l.status === 'requested' || l.status === 'offered' || l.status === 'active') borrow.push(l);
        else hist.push(l);
      } else {
        if (l.status === 'offered' || l.status === 'active') lend.push(l);
        else hist.push(l);
      }
    }
    return { borrowing: borrow, lending: lend, history: hist };
  }, [data]);

  const run = async (fn, successMsg) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await fn();
      if (successMsg) setNotice(successMsg);
      await load();
    } catch (e) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const submitRequest = () => {
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0) {
      setError('Enter a whole Smart Coin amount.');
      return;
    }
    run(
      () => requestLoan(session, { amount: amt, note: note.trim() || null, requestId: crypto?.randomUUID?.() }),
      'Loan request posted to the marketplace.',
    ).then(() => { setAmount(''); setNote(''); });
  };

  const buyShark = () => run(
    () => buySharkLicense(session, crypto?.randomUUID?.()),
    'Loan Shark licence activated — you can now run up to 10 concurrent loans.',
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="ml-auto flex items-center gap-3 text-xs font-black uppercase tracking-widest text-slate-400">
          <span className="inline-flex items-center gap-1 text-amber-300"><Coins size={14} /> {smartCoins} SC</span>
          <span className="inline-flex items-center gap-1"><Crown size={14} className="text-apex-400" /> Loan Shark</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-semibold text-amber-200 flex gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p>{SHARK_WARNING}</p>
        </div>

        {notice && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-300">{notice}</div>
        )}
        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm font-bold text-red-300">
            {error}
            <button onClick={load} className="ml-3 underline">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 text-sm font-bold">
            <Loader2 size={16} className="animate-spin" /> Loading the loan market…
          </div>
        ) : (
          <>
            {/* Profile / lender licence */}
            {profile && config && (
              <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <Stat label="As lender" value={`${profile.active_as_lender}/${profile.lender_cap}`} />
                  <Stat label="Defaults" value={profile.defaults_count} tone={profile.defaults_count > 0 ? 'text-red-300' : undefined} />
                  <Stat label="Taken" value={profile.loans_taken} />
                  <Stat label="Repaid" value={profile.loans_repaid} tone="text-emerald-300" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                  <div className="text-sm">
                    <div className="font-black uppercase tracking-widest text-slate-400 text-xs">Lender licence</div>
                    <div className={`font-bold ${profile.shark_license ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {profile.shark_license ? `Loan Shark active · up to ${config.shark_max_active_loans} loans` : `Standard · up to ${config.normal_max_active_loans} loans`}
                    </div>
                  </div>
                  {!profile.shark_license && (
                    <button
                      onClick={buyShark}
                      disabled={busy || smartCoins < config.shark_require_balance_sc}
                      className="inline-flex items-center gap-2 rounded-xl bg-apex-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-apex-500 disabled:opacity-50"
                      title={smartCoins < config.shark_require_balance_sc ? `Requires ${config.shark_require_balance_sc} SC balance` : ''}
                    >
                      <Crown size={14} /> Buy licence · {config.shark_license_fee_sc} SC
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  {config.interest_pct}% interest · {config.repayment_window_hours}h repayment window ·
                  licence entry needs a {config.shark_require_balance_sc} SC balance.
                </p>
              </section>
            )}

            {/* Borrow */}
            <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <Send size={14} /> Borrow Smart Coins
              </h2>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Amount (SC)"
                  className="w-full sm:w-40 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-slate-100 outline-none focus:border-apex-500"
                />
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="Optional note for lenders"
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-apex-500"
                />
                <button
                  onClick={submitRequest}
                  disabled={busy}
                  className="rounded-xl bg-apex-600 px-4 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-apex-500 disabled:opacity-50"
                >
                  Request
                </button>
              </div>

              {borrowing.length === 0 ? (
                <Empty text="No open borrow requests." />
              ) : (
                <ul className="space-y-2">
                  {borrowing.map((l) => (
                    <LoanRow key={l.id} loan={l} role="borrower" busy={busy} onAction={run} session={session} />
                  ))}
                </ul>
              )}
            </section>

            {/* Marketplace */}
            <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                <Users size={14} /> Open requests
              </h2>
              {openRequests.length === 0 ? (
                <Empty text="No open requests right now." />
              ) : (
                <ul className="space-y-2">
                  {openRequests.map((l) => (
                    <li key={l.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-100 truncate">{l.borrower_name}</div>
                        <div className="text-xs text-slate-400">
                          wants <b className="text-amber-300">{l.principal_sc} SC</b> · owes {l.total_due_sc} SC
                          {l.borrower_defaults > 0 && <span className="ml-2 text-red-300">· {l.borrower_defaults} default{l.borrower_defaults > 1 ? 's' : ''}</span>}
                        </div>
                        {l.note && <div className="text-xs text-slate-500 italic truncate">"{l.note}"</div>}
                      </div>
                      <button
                        onClick={() => run(() => offerLoan(session, l.id), 'Offer placed — waiting for the borrower to accept.')}
                        disabled={busy}
                        className="shrink-0 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Offer
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Lending */}
            {lending.length > 0 && (
              <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <TrendingUp size={14} /> Your lending
                </h2>
                <ul className="space-y-2">
                  {lending.map((l) => (
                    <LoanRow key={l.id} loan={l} role="lender" busy={busy} onAction={run} session={session} />
                  ))}
                </ul>
              </section>
            )}

            {/* History */}
            {history.length > 0 && (
              <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                <h2 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <Clock size={14} /> History
                </h2>
                <ul className="space-y-2">
                  {history.map((l) => (
                    <li key={l.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-200 truncate">
                          {l.role === 'borrower' ? `Borrowed ${l.principal_sc} SC` : `Lent ${l.principal_sc} SC to ${l.borrower_name}`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {fmtDate(l.repaid_at || l.defaulted_at || l.created_at)}
                          {l.status === 'defaulted' && <span className="ml-2 text-red-300">recovered {l.recovered_sc} · lost {l.forfeited_sc}</span>}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${statusTone(l.status)}`}>
                        {l.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
      <div className={`text-lg font-black ${tone || 'text-slate-100'}`}>{value}</div>
      <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
    </div>
  );
}

function Empty({ text }) {
  return <div className="text-sm text-slate-500 italic">{text}</div>;
}

function LoanRow({ loan, role, busy, onAction, session }) {
  const remaining = hoursLeft(loan.due_at);
  const overdue = loan.status === 'active' && remaining != null && remaining <= 0;

  return (
    <li className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-100">
            {role === 'borrower'
              ? <span>You owe <b className="text-amber-300">{loan.total_due_sc} SC</b> ({loan.principal_sc} + {loan.interest_sc} interest)</span>
              : <span>{loan.borrower_name} owes <b className="text-emerald-300">{loan.total_due_sc} SC</b></span>}
          </div>
          <div className="text-xs text-slate-400">
            {loan.status === 'requested' && 'Waiting for a lender…'}
            {loan.status === 'offered' && (role === 'borrower' ? 'A lender made an offer — accept or reject' : 'Offer placed — waiting for the borrower')}
            {loan.status === 'active' && (overdue ? <span className="text-red-300">Overdue — due {fmtDate(loan.due_at)}</span> : `Due ${fmtDate(loan.due_at)}`)}
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${statusTone(loan.status)}`}>
          {loan.status}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {role === 'borrower' && loan.status === 'requested' && (
          <button onClick={() => onAction(() => cancelLoan(session, loan.id), 'Request cancelled.')} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Cancel</button>
        )}
        {role === 'borrower' && loan.status === 'offered' && (
          <>
            <button onClick={() => onAction(() => acceptLoan(session, { loanId: loan.id, requestId: crypto?.randomUUID?.() }), 'Loan accepted — principal credited to your balance.')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-emerald-500 disabled:opacity-50"><Check size={13} /> Accept</button>
            <button onClick={() => onAction(() => rejectLoan(session, loan.id), 'Offer rejected.')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50"><XCircle size={13} /> Reject</button>
          </>
        )}
        {role === 'borrower' && loan.status === 'active' && (
          <button onClick={() => onAction(() => repayLoan(session, { loanId: loan.id, requestId: crypto?.randomUUID?.() }), 'Loan repaid in full.')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-apex-600 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-apex-500 disabled:opacity-50"><Coins size={13} /> Repay {loan.total_due_sc} SC</button>
        )}
        {role === 'lender' && loan.status === 'offered' && (
          <button onClick={() => onAction(() => rejectLoan(session, loan.id), 'Offer withdrawn.')} disabled={busy} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-50">Withdraw</button>
        )}
        {role === 'lender' && overdue && (
          <button onClick={() => onAction(() => markLoanDefault(session, loan.id), 'Recovery attempted — any available SC was recovered.')} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-white hover:bg-red-500 disabled:opacity-50"><ShieldCheck size={13} /> Recover</button>
        )}
      </div>
    </li>
  );
}

export default LoanShark;
