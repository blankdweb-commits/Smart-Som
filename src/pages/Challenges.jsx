import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ArrowLeft, Target, Coins, RefreshCw, Loader2, Check, Sparkles, XCircle } from '../components/Icons';
import BrandLogo from '../components/BrandLogo';

const COMMON_METRICS = {
  correct_answers: 'correct answers today',
  duel_wins: 'duel wins',
  quiz_rounds: 'quiz rounds',
  streak_days: 'day streak'
};

const Challenges = () => {
  const navigate = useNavigate();
  const { supabase, session, claimChallengeReward, smartCoins } = useAppContext();

  const [catalog, setCatalog] = useState([]);
  const [claimedKeys, setClaimedKeys] = useState({});
  const [progress, setProgress] = useState({});
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!supabase || !session) return;
    setError(null);
    setLoading(true);
    try {
      const [catRes, doneRes] = await Promise.all([
        supabase.from('challenges').select('*').eq('is_active', true),
        supabase.from('challenge_completions').select('challenge_key')
      ]);
      if (catRes.error) throw catRes.error;
      setCatalog(catRes.data || []);
      setClaimedKeys(Object.fromEntries((doneRes.data || []).map(r => [r.challenge_key, true])));
    } catch (err) {
      console.warn('[challenges] load:', err?.message);
      setError('Could not load challenges right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase, session]);

  useEffect(() => {
    load();
  }, [load]);

  const onClaim = async (ch) => {
    if (claiming) return;
    setClaiming(ch.key);
    setToast(null);
    try {
      const res = await claimChallengeReward(ch.key);
      if (!res) {
        setToast({ type: 'error', text: 'This challenge is unavailable right now.' });
        return;
      }
      if (res.ok) {
        setClaimedKeys(prev => ({ ...prev, [ch.key]: true }));
        setProgress(prev => ({ ...prev, [ch.key]: `${res.value}/${res.target}` }));
        setToast({ type: 'success', text: `${ch.title} complete — ${res.reward} Smart Coins added!` });
      } else if (res.error === 'NOT_COMPLETE') {
        setProgress(prev => ({ ...prev, [ch.key]: `${res.value}/${res.target}` }));
        setToast({ type: 'info', text: `Almost there — ${res.value} of ${res.target} done.` });
      } else if (res.error === 'ALREADY_CLAIMED') {
        setClaimedKeys(prev => ({ ...prev, [ch.key]: true }));
        setToast({ type: 'info', text: 'Already claimed.' });
      } else {
        setToast({ type: 'error', text: ERR_TEXT[res.error] || 'Could not claim this challenge.' });
      }
    } finally {
      setClaiming(null);
    }
  };

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
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Target size={120} />
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tight relative z-10">Challenges</h1>
        <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
          Complete the goal — the server verifies, then pays
        </p>
        <p className="text-sm font-black text-white/90 relative z-10 mt-3">
          Balance <span className="text-amber-300">{Number(smartCoins || 0).toLocaleString()}</span> Smart Coins
        </p>
      </div>

      {toast && (
        <div
          className={`mb-4 flex items-center justify-between gap-3 text-sm font-bold rounded-2xl px-4 py-3 ${
            toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
              : toast.type === 'error'
                ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                : 'bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400'
          }`}
        >
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <XCircle size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold rounded-2xl px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-polynurse-600" />
        </div>
      ) : catalog.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-10 text-center">
          <Sparkles className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={44} />
          <p className="text-slate-500 dark:text-slate-400 font-bold">No active challenges right now.</p>
        </div>
      ) : (
        <ul className="grid sm:grid-cols-2 gap-3">
          {catalog.map(ch => {
            const claimed = !!claimedKeys[ch.key];
            const prog = progress[ch.key];
            return (
              <li key={ch.key} className="bg-white dark:bg-slate-800 rounded-2xl shadow-clinical border border-slate-100 dark:border-slate-700 p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <span className="w-11 h-11 flex items-center justify-center rounded-xl bg-polynurse-50 dark:bg-polynurse-900/20 text-xl">{ch.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white">{ch.title}</p>
                    <p className="text-xs font-bold text-slate-400">{ch.description}</p>
                    <p className="mt-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                      <Coins size={11} /> {ch.reward_sc} SC
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 capitalize">{COMMON_METRICS[ch.metric] || ch.metric}</p>
                  </div>
                </div>
                {prog && (
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full bg-polynurse-600 rounded-full"
                      style={{ width: `${Math.min(100, (parseInt(prog.split('/')[0], 10) || 0) / (parseInt(prog.split('/')[1], 10) || 1) * 100)}%` }}
                    />
                  </div>
                )}
                <button
                  onClick={() => onClaim(ch)}
                  disabled={claimed || !!claiming}
                  className={`flex items-center justify-center gap-2 rounded-xl py-2.5 font-black text-xs uppercase tracking-widest transition ${
                    claimed
                      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-polynurse-600 hover:bg-polynurse-700 text-white disabled:opacity-50'
                  }`}
                >
                  {claimed ? (
                    <><Check size={14} /> Claimed</>
                  ) : claiming === ch.key ? (
                    <><Loader2 size={14} className="animate-spin" /> Verifying…</>
                  ) : (
                    'Claim Reward'
                  )}
                </button>
                {!claimed && !prog && (
                  <p className="text-[9px] font-bold text-slate-400 text-center leading-snug">
                    Tap Claim — the server checks your stats, then pays if you're there.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-8 flex justify-center">
        <BrandLogo variant="mark" size="md" />
      </div>
    </div>
  );
};

const ERR_TEXT = {
  UNKNOWN_CHALLENGE: 'That challenge no longer exists.',
  CHALLENGE_CLOSED: 'This challenge has ended.',
  INVALID_METRIC: 'This challenge has a broken goal.',
  UNAUTHENTICATED: 'Please sign in first.'
};

export default Challenges;