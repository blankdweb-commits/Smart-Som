import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ArrowRight, Coins, Landmark, Send, Wallet } from './Icons';
import RivalLoans from './RivalLoans';

const WalletPanel = ({ initialView = 'wallet' }) => {
  const navigate = useNavigate();
  const { smartCoins, scEarnedTotal } = useAppContext();
  const [view, setView] = useState(initialView === 'loans' ? 'loans' : 'wallet');

  const balance = Number(smartCoins) || 0;
  const earned = Number(scEarnedTotal) || 0;

  return (
    <div>
      <div className="mb-4 overflow-hidden rounded-[2rem] border border-slate-100 bg-white p-5 shadow-clinical dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <Wallet size={13} /> Smart Coins
            </p>
            <p className="mt-1 text-4xl font-black tabular-nums text-slate-900 dark:text-white">{balance}</p>
            <p className="mt-1 text-xs font-bold text-slate-400">
              {earned.toLocaleString()} SC earned all time
            </p>
          </div>
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-500">
            <Coins size={34} />
          </div>
        </div>
        <button
          onClick={() => navigate('/wallet')}
          className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-polynurse-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition"
        >
          Open full wallet <ArrowRight size={14} />
        </button>
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        <button
          role="tab"
          type="button"
          aria-selected={view === 'wallet'}
          onClick={() => setView('wallet')}
          className={`shrink-0 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition ${
            view === 'wallet'
              ? 'bg-polynurse-700 text-white'
              : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          SC actions
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={view === 'loans'}
          onClick={() => setView('loans')}
          className={`shrink-0 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest transition ${
            view === 'loans'
              ? 'bg-polynurse-700 text-white'
              : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
          }`}
        >
          Scholar loans
        </button>
      </div>

      {view === 'loans' ? <RivalLoans /> : (
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            onClick={() => navigate('/wallet')}
            className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-clinical transition hover:border-polynurse-300 dark:border-slate-700 dark:bg-slate-800"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-polynurse-100 text-polynurse-700 dark:bg-polynurse-900/30 dark:text-polynurse-300">
              <Send size={18} />
            </span>
            <span className="mt-3 block font-black text-slate-900 dark:text-white">Send Smart Coins</span>
            <span className="mt-0.5 block text-xs font-bold text-slate-400">Transfer to a scholar from your wallet.</span>
          </button>
          <button
            onClick={() => navigate('/wallet')}
            className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-clinical transition hover:border-polynurse-300 dark:border-slate-700 dark:bg-slate-800"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <Landmark size={18} />
            </span>
            <span className="mt-3 block font-black text-slate-900 dark:text-white">World Bank</span>
            <span className="mt-0.5 block text-xs font-bold text-slate-400">Borrow against the server rate, then repay in time.</span>
          </button>
          <button
            onClick={() => setView('loans')}
            className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-clinical transition hover:border-polynurse-300 dark:border-slate-700 dark:bg-slate-800 sm:col-span-2"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
              <Coins size={18} />
            </span>
            <span className="mt-3 block font-black text-slate-900 dark:text-white">Borrow from a friend or rival</span>
            <span className="mt-0.5 block text-xs font-bold text-slate-400">Set the principal, interest and term. They fund it only if they accept.</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default WalletPanel;
