import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Swords, Clock, Loader2, X } from 'lucide-react';

/**
 * ChallengePopup — the incoming-duel dialog.
 *
 * An overlay that a keyboard user cannot dismiss is a trap, so this one has
 * Escape-to-dismiss and a Tab focus trap (no existing overlay in this app had
 * either). Escape does NOT decline: it closes the dialog and leaves the
 * challenge waiting in the bell, because dismissing and declining are different
 * decisions and conflating them would silently throw away an invitation.
 *
 * THE COUNTDOWN IS NOW REAL.
 *
 * It used to be `useState(windowSeconds * 1000)` re-seeded whenever the popup
 * opened. windowSeconds is the GLOBAL invite lifetime (600), not this invite's
 * remaining life, so the dialog cheerfully showed "10:00" for a challenge that
 * had been sitting unanswered for nine minutes — and, because dismissing the
 * popup paused the interval rather than the deadline, it would resume from
 * wherever it had got to. Both are wrong in the direction that matters: it
 * promised time the recipient did not have.
 *
 * migration-v89 added `expiresAt` (created_at + invite_expiry_seconds) to every
 * row of arena_invites_list, so the deadline is now an absolute server
 * timestamp. We count down to that, and dismiss/reopen cannot change it,
 * because there is nothing left to reset.
 *
 * The windowSeconds fallback below is for a server that has not been redeployed
 * with v89 yet. It reproduces the old behaviour exactly rather than showing
 * NaN, and it disappears on its own once expiresAt is present.
 */

const fmtLeft = (ms) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

// Server timestamps are ISO strings. Anything unparseable falls through to the
// legacy path instead of rendering "NaN:NaN".
const parseDeadline = (expiresAt) => {
  if (!expiresAt) return null;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) ? null : t;
};

const ChallengePopup = ({ invite, windowSeconds = 600, busy, onRespond, onDismiss }) => {
  const [now, setNow] = useState(() => Date.now());
  const panelRef = useRef(null);
  const escRef = useRef(null);

  // One tick re-renders the panel. The deadline is never stored in state, so
  // there is no drift to correct and nothing to resynchronise on reopen.
  useEffect(() => {
    if (!invite) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [invite]);

  useEffect(() => {
    if (!invite || !panelRef.current) return undefined;
    escRef.current = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onDismiss?.(invite?.inviteId); return; }
      if (e.key !== 'Tab') return;
      const f = panelRef.current.querySelectorAll('button:not([disabled])');
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', escRef.current);
    panelRef.current.focus();
    return () => document.removeEventListener('keydown', escRef.current);
  }, [invite, onRespond, onDismiss]);

  const deadline = parseDeadline(invite?.expiresAt);
  const left = deadline != null
    ? Math.max(0, deadline - now)
    : Math.max(0, windowSeconds * 1000);

  const expired = left <= 0;
  const urgency = useMemo(() => {
    if (left <= 15_000) return 'border-red-500/50 bg-red-500/10';
    if (left <= 60_000) return 'border-amber-500/50 bg-amber-500/10';
    return 'border-emerald-500/40 bg-emerald-500/10';
  }, [left]);

  if (!invite) return null;

  const working = busy === invite.inviteId;

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Duel challenge"
        tabIndex={-1}
        className={`relative w-full max-w-md rounded-t-[2rem] sm:rounded-[2rem] border-2 p-6 shadow-2xl outline-none ${urgency}`}
        style={{ backgroundColor: '#0f172a' }}
      >
        <button
          type="button"
          onClick={() => onDismiss?.(invite?.inviteId)}
          aria-label="Dismiss challenge"
          className="absolute right-4 top-4 w-9 h-9 rounded-full bg-white/5 text-slate-400 hover:text-white flex items-center justify-center"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 pr-10">
          <span className="w-11 h-11 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
            <Swords size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
              Duel challenge
            </p>
            <p className="text-base font-black text-white truncate">
              {invite.name || 'A scholar'} challenges you
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl bg-slate-900/60 border border-white/10 p-3.5">
          <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-400">
            <span>Stake per player</span>
            <span className="text-amber-300 text-sm">{invite.stake} SC</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-400">
            <span className="flex items-center gap-1">
              <Clock size={11} /> Time to answer
            </span>
            <span className={left <= 15_000 ? 'text-red-400' : left <= 60_000 ? 'text-amber-300' : 'text-slate-200'}>
              {fmtLeft(left)}
            </span>
          </div>
          <p className="mt-3 text-[11px] font-medium text-slate-400 leading-snug">
            {invite.stake} SC is held from each of you only if you accept — winner takes {invite.stake * 2} SC,
            and declining costs you nothing. Decline or walk away in time and neither side is charged.
          </p>
        </div>

        {expired && (
          <p className="mt-3 text-[11px] font-black text-red-400 text-center">
            This challenge has expired. Declining clears it.
          </p>
        )}

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={() => onRespond?.(invite, false)}
            disabled={working}
            className="flex-1 min-h-[48px] rounded-xl border border-white/15 text-slate-300 font-black text-[11px] uppercase tracking-widest hover:bg-white/5 transition disabled:opacity-40"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onRespond?.(invite, true)}
            disabled={working || expired}
            className="flex-1 min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-black text-[11px] uppercase tracking-widest transition disabled:opacity-40 inline-flex items-center justify-center gap-2"
          >
            {working ? <Loader2 size={14} className="animate-spin" /> : <Swords size={14} />}
            {working ? 'Starting' : expired ? 'Expired' : `Accept · ${invite.stake} SC`}
          </button>
        </div>

        <p className="mt-3 text-center text-[10px] font-medium text-slate-500">
          Dismissing with X keeps the challenge waiting in your bell. It does not decline it.
        </p>
      </div>
    </div>
  );
};

export default ChallengePopup;