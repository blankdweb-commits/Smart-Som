import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ArrowLeft, Users, Plus, RefreshCw, Loader2, Coins, LogOut, Check, XCircle, Copy } from '../components/Icons';
import BrandLogo from '../components/BrandLogo';

const WEEKS = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const Squads = () => {
  const navigate = useNavigate();
  const { createSquad, joinSquad, leaveSquad, getMySquad, claimSquadReward, getMyReferral, smartCoins } = useAppContext();

  const [squad, setSquad] = useState(null);
  const [members, setMembers] = useState([]);
  const [rewarded, setRewarded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [appliedCode, setAppliedCode] = useState('');
  const [toast, setToast] = useState(null);
  const [invite, setInvite] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [squadRes, inviteRes] = await Promise.all([getMySquad(), getMyReferral()]);
      setSquad(squadRes?.ok ? squadRes.squad : null);
      setMembers(squadRes?.ok ? squadRes.members : []);
      setRewarded(!!squadRes?.rewardedThisWeek);
      setInvite(inviteRes?.ok ? inviteRes : null);
    } finally {
      setLoading(false);
    }
  }, [getMySquad, getMyReferral]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onCreate = async () => {
    if (!name.trim()) { setToast({ type: 'error', text: 'Give your squad a name first.' }); return; }
    setBusy('create');
    setToast(null);
    const code = appliedCode.trim();
    try {
      const res = await createSquad(name.trim(), code || null);
      if (res?.ok) {
        setToast({ type: 'success', text: 'Squad created! Invite friends with the code.' });
        await refresh();
      } else {
        setToast({ type: 'error', text: SQ_ERR[res?.error] || SQ_ERR.default });
      }
    } finally {
      setBusy(null);
    }
  };

  const onJoin = async () => {
    if (!joinCode.trim()) { setToast({ type: 'error', text: 'Enter a squad code.' }); return; }
    setBusy('join');
    setToast(null);
    try {
      const res = await joinSquad(joinCode.trim().toUpperCase());
      if (res?.ok) {
        setToast({ type: 'success', text: 'Welcome to the squad!' });
        setJoinCode('');
        await refresh();
      } else {
        setToast({ type: 'error', text: SQ_ERR[res?.error] || SQ_ERR.default });
      }
    } finally {
      setBusy(null);
    }
  };

  const onLeave = async () => {
    setBusy('leave');
    setToast(null);
    try {
      const res = await leaveSquad();
      setSquad(null);
      setMembers([]);
      setToast({ type: 'success', text: res?.ok ? 'You left the squad.' : 'You left the squad.' });
    } finally {
      setBusy(null);
    }
  };

  const onClaim = async () => {
    setBusy('claim');
    setToast(null);
    try {
      const res = await claimSquadReward();
      if (res?.ok) {
        setRewarded(true);
        setToast({ type: 'success', text: `+${res.reward} Smart Coins earned this week!` });
      } else {
        setToast({ type: 'error', text: res?.error === 'TARGET_NOT_MET' ? `Keep going — ${res.weekCorrect}/${res.weeklyTarget} correct answers this week.` : (SQ_ERR[res?.error] || 'Not claimable right now.') });
      }
    } finally {
      setBusy(null);
    }
  };

  const copyCode = async (code) => {
    try {
      await navigator.clipboard.writeText(code || '');
      setToast({ type: 'success', text: 'Squad code copied!' });
    } catch {
      setToast({ type: 'error', text: 'Could not copy.' });
    }
  };

  const pct = squad && squad.weeklyTarget > 0 ? Math.min(100, (squad.weekCorrect / squad.weeklyTarget) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-polynurse-700 dark:hover:text-polynurse-300 font-bold text-sm transition"
        >
          <ArrowLeft size={18} /> Back
        </button>
        <button onClick={refresh} disabled={loading} className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-polynurse-700 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Users size={120} />
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tight relative z-10">Squads</h1>
        <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
          Study together · answer correctly together · earn weekly
        </p>
        <p className="text-sm font-black text-white/90 relative z-10 mt-3">
          Balance <span className="text-amber-300">{Number(smartCoins || 0).toLocaleString()}</span> Smart Coins
        </p>
      </div>

      {toast && (
        <div className={`mb-4 flex items-center justify-between gap-3 text-sm font-bold rounded-2xl px-4 py-3 ${
          toast.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
            : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss"><XCircle size={16} /></button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={28} className="animate-spin text-polynurse-600" /></div>
      ) : !squad ? (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-5">
            <p className="font-black text-slate-900 dark:text-white mb-3">Start a squad</p>
            <input
              type="text"
              placeholder="Squad name"
              maxLength={60}
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-polynurse-400 mb-2"
            />
            <input
              type="text"
              placeholder="Invite code (optional) — e.g. your referral code"
              maxLength={16}
              value={appliedCode}
              onChange={e => setAppliedCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              className="w-full bg-slate-100 dark:bg-slate-900 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-polynurse-400 uppercase tracking-wider mb-3"
            />
            <button
              onClick={onCreate}
              disabled={busy === 'create'}
              className="w-full flex items-center justify-center gap-2 bg-polynurse-600 hover:bg-polynurse-700 text-white rounded-xl py-3 font-black text-xs uppercase tracking-widest disabled:opacity-50 transition"
            >
              {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Squad
            </button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-5">
            <p className="font-black text-slate-900 dark:text-white mb-3">Join with a code</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="SQUAD-CODE"
                maxLength={16}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
                className="flex-1 bg-slate-100 dark:bg-slate-900 border border-white/10 rounded-xl py-2.5 px-4 text-sm text-slate-900 dark:text-white focus:outline-none focus:border-polynurse-400 uppercase tracking-wider"
              />
              <button
                onClick={onJoin}
                disabled={busy === 'join'}
                className="flex items-center gap-2 bg-polynurse-600 hover:bg-polynurse-700 text-white rounded-xl px-5 py-2.5 font-black text-xs uppercase tracking-widest disabled:opacity-50 transition"
              >
                {busy === 'join' ? <Loader2 size={14} className="animate-spin" /> : 'Join'}
              </button>
            </div>
            <p className="mt-3 text-[10px] font-bold text-slate-400 leading-snug">
              Each squad needs a weekly target of correct answers. Hit it together and every member claims +5 Smart Coins.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <p className="text-xl font-black text-slate-900 dark:text-white">{squad.name}</p>
                <button onClick={() => copyCode(squad.code)} className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-polynurse-600 dark:text-polynurse-300 hover:underline">
                  <Copy size={12} /> {squad.code} — tap to copy
                </button>
              </div>
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <Users size={12} /> {members.length}
              </span>
            </div>

            <div className="mb-5">
              <div className="flex items-center justify-between text-xs font-black mb-1">
                <span className="text-slate-500 dark:text-slate-400">Week of {WEEKS.format(new Date(squad.weekStart))}</span>
                <span className="text-polynurse-700 dark:text-polynurse-300">{squad.weekCorrect}/{squad.weeklyTarget} correct</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                <div className="h-full bg-polynurse-600 rounded-full" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <button
              onClick={onClaim}
              disabled={rewarded || busy === 'claim'}
              className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 font-black text-xs uppercase tracking-widest transition ${
                rewarded
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
                  : squad.targetMet
                    ? 'bg-polynurse-600 hover:bg-polynurse-700 text-white'
                    : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
              }`}
            >
              {rewarded ? <><Check size={14} /> Claimed this week</> : busy === 'claim' ? <><Loader2 size={14} className="animate-spin" /> Claiming…</> : <><Coins size={14} /> Claim +5 SC</>}
            </button>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-5">
            <p className="font-black text-slate-900 dark:text-white mb-3">Members</p>
            <ul className="space-y-2">
              {members.map(m => (
                <li key={m.userId} className="flex items-center justify-between text-sm">
                  <span className="font-black text-slate-800 dark:text-slate-200 truncate">
                    {m.fullName || 'Scholar'}
                    {m.role === 'owner' && <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-polynurse-600 dark:text-polynurse-300">Owner</span>}
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">joined {new Date(m.joinedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </div>

          <button
            onClick={onLeave}
            disabled={busy === 'leave'}
            className="w-full flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/40 text-red-500 rounded-2xl py-3 font-black text-xs uppercase tracking-widest hover:bg-red-50 dark:hover:bg-red-900/10 disabled:opacity-50 transition"
          >
            {busy === 'leave' ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />} Leave Squad
          </button>
        </div>
      )}

      {invite && (
        <div className="mt-6 bg-gradient-to-r from-polynurse-50 to-sky-50 dark:from-polynurse-900/10 dark:to-sky-900/10 rounded-2xl border border-polynurse-100 dark:border-polynurse-800/40 p-5">
          <p className="font-black text-slate-900 dark:text-white text-sm mb-1">Invite friends to Apex</p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-3">
            Share your code — each friend who activates earns you 15 Smart Coins.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyCode(invite.code)}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl py-2.5 font-black text-sm tracking-[0.3em] text-polynurse-700 dark:text-polynurse-300 hover:border-polynurse-300"
            >
              {invite.code} <Copy size={14} />
            </button>
            <button
              onClick={async () => {
                const link = `${window.location.origin}/signup?referral=${encodeURIComponent(invite.code)}`;
                try {
                  if (navigator.share) {
                    await navigator.share({ title: 'Join me on Apex Scholars', text: 'Study nursing with me — we both earn Smart Coins!', url: link });
                  } else {
                    await navigator.clipboard.writeText(link);
                    setToast({ type: 'success', text: 'Invite link copied!' });
                  }
                } catch (err) {
                  if (err?.name !== 'AbortError') setToast({ type: 'error', text: 'Could not share right now.' });
                }
              }}
              className="bg-polynurse-600 hover:bg-polynurse-700 text-white rounded-xl px-4 py-2.5 font-black text-xs uppercase tracking-widest transition"
            >
              Share
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <BrandLogo variant="mark" size="md" />
      </div>
    </div>
  );
};

const SQ_ERR = {
  ALREADY_IN_SQUAD: 'You are already in a squad.',
  UNKNOWN_SQUAD_CODE: 'No squad found for that code.',
  INVALID_NAME: 'Choose a squad name first.',
  NOT_IN_SQUAD: 'You are not in a squad.',
  ALREADY_CLAIMED: 'Already claimed this week.',
  default: 'Could not do that right now.'
};

export default Squads;