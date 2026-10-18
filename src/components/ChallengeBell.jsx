import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Swords, Loader2 } from 'lucide-react';
import { useChallenge } from '../context/ChallengeContext';

/**
 * ChallengeBell — a persistent badge so a challenge can never be invisible
 * again. It lives in Layout (not BottomNav, which returns null while
 * body.classList.contains('quiz-active')) so it shows on every signed-in page.
 *
 * Tapping opens the incoming-challenge dialog. If the user is mid-duel the
 * dialog is deliberately NOT forced open — ChallengeContext queues it and
 * surfaces it on the result screen — so from here we send them to the Arena
 * instead, where both the duel and the queued challenge are visible.
 */
const ChallengeBell = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { incoming, outgoing, notice, dismissNotice, openFor, matchLive } = useChallenge();

  const count = incoming.length;
  const pendingOut = outgoing.length;
  const onArena = pathname === '/rumble';

  if (!count && !pendingOut && !notice) return null;

  return (
    <>
      {/* A challenge you sent and are waiting on is worth surfacing too —
          otherwise "nothing here" is indistinguishable from "they ignored me". */}
      {pendingOut > 0 && (
        <button
          type="button"
          onClick={() => navigate('/rumble')}
          title={`${pendingOut} challenge${pendingOut === 1 ? '' : 's'} sent — waiting for a reply`}
          className="relative shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-400 hover:text-white transition"
        >
          <Loader2 size={16} className="animate-spin" />
          <span className="absolute -bottom-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-slate-500 text-white text-[9px] font-black flex items-center justify-center">
            {pendingOut}
          </span>
        </button>
      )}

      {count > 0 && (
        <button
          type="button"
          onClick={() => (onArena || matchLive ? navigate('/rumble') : openFor(incoming[0]?.inviteId))}
          title={`${count} duel challenge${count === 1 ? '' : 's'} waiting`}
          className="relative shrink-0 w-10 h-10 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 flex items-center justify-center text-emerald-300 transition"
        >
          <Swords size={17} />
          <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1 rounded-full bg-emerald-500 text-white text-[10px] font-black flex items-center justify-center ring-2 ring-slate-900">
            {count}
          </span>
        </button>
      )}

      {notice && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[75] flex items-center gap-3 max-w-[92vw] rounded-2xl bg-slate-900 border border-emerald-500/40 px-4 py-3 text-xs font-bold text-white shadow-xl"
        >
          <span className="flex-1">{notice}</span>
          <button onClick={dismissNotice} className="text-slate-400 hover:text-white text-[10px] font-black uppercase tracking-widest shrink-0">
            Close
          </button>
        </div>
      )}
    </>
  );
};

export default ChallengeBell;