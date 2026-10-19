// ============================================================================
// src/components/LiveEventBar.jsx
//
// The compact live-event header for the Anonymous Room (migration-v99).
//
// THE COUNTDOWN IS DISPLAY-ONLY. `room.event` comes from the server with the
// authoritative deadline AND the server's own clock, so this component:
//
//   * computes its offset ONCE per sync (serverNow - Date.now()) and corrects
//     for it on every tick, rather than trusting the device clock;
//   * re-syncs whenever the room payload arrives, which is what makes a refresh
//     or a reconnect resume the SAME countdown instead of restarting it;
//   * never decides whether the event is live. That is `room.can_write`, which
//     the server sets. A user whose clock is wrong sees the wrong number for a
//     moment and is still correctly refused by the API.
//
// A room that has not started has no deadline, and this renders "no countdown"
// rather than a fabricated one. See `endsAt === null`.
// ============================================================================

import React, { useEffect, useMemo, useRef, useState } from 'react';
// Only icons that src/components/Icons.jsx actually re-exports. Rollup fails the
// build on an unknown named export here ("Hourglass is not exported by
// src/components/Icons.jsx"), which is the same class of break as the stale
// ShoppingCart import this project has hit before.
import { Clock, Timer, Users } from './Icons';

const TONE = {
  live: {
    dot: 'bg-emerald-400',
    chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    label: 'LIVE EVENT',
  },
  ending_soon: {
    dot: 'bg-amber-400',
    chip: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    label: 'ENDING SOON',
  },
  waiting: {
    dot: 'bg-slate-500',
    chip: 'bg-slate-700/50 text-slate-300 border-slate-600/50',
    label: 'WAITING',
  },
  ended: {
    dot: 'bg-slate-600',
    chip: 'bg-slate-800 text-slate-400 border-slate-700',
    label: 'EVENT ENDED',
  },
  scheduled: {
    dot: 'bg-slate-500',
    chip: 'bg-slate-700/50 text-slate-300 border-slate-600/50',
    label: 'SCHEDULED',
  },
};

// mm:ss, and h:mm:ss once it passes an hour. A negative value is clamped to
// zero rather than shown as a negative countdown — the state has already flipped
// to 'ended' by then, so reaching here means the payload is a moment stale.
function fmtRemaining(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtClockTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function LiveEventBar({ event, memberCount, onEndedNotified }) {
  const state = event?.state || 'scheduled';
  const tone = TONE[state] || TONE.scheduled;

  // Server-clock offset in ms. Recomputed whenever the payload identity changes
  // (a new serverNow string), never on a timer — the device clock can drift
  // during a session and we do not want to re-derive a "correction" from a
  // drifting source.
  //
  // STATE, not a ref: the offset is read during render (to compute the visible
  // countdown), and reading ref.current while rendering is exactly the pattern
  // that silently stops updating when React bails out of a re-render. It is
  // derived data, so it belongs in state.
  const serverNow = event?.serverNow;
  const [clockOffset, setClockOffset] = useState(0);
  useEffect(() => {
    const parsed = serverNow ? new Date(serverNow).getTime() : NaN;
    if (!Number.isFinite(parsed)) return;
    // Deferred by a tick rather than set synchronously in the effect body: the
    // payload arrives in the same commit that mounts this component, so a
    // synchronous write here cascades straight back into render. Nothing reads
    // the offset until the first tick anyway, so the deferral is invisible.
    const t = setTimeout(() => setClockOffset(parsed - Date.now()), 0);
    return () => clearTimeout(t);
  }, [serverNow]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (state === 'ended' || state === 'waiting') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state]);

  const endsAt = event?.endsAt ?? null;
  const remainingMs = useMemo(() => {
    if (!endsAt) return null;
    // Offset-corrected "now" on the server's timeline.
    return endsAt - (now + clockOffset);
  }, [endsAt, now, clockOffset]);

  // One-shot notification when the local display crosses into "ended". Guarded
  // by a ref keyed on the event's start time so a re-render cannot fire it
  // twice, and deliberately NOT repeated: the brief asks for a warning, not a
  // stream of notifications.
  const warnedRef = useRef(null);
  useEffect(() => {
    if (remainingMs === null) return;
    if (remainingMs > 0) return;
    const key = event?.startedAt || 'unknown';
    if (warnedRef.current === key) return;
    warnedRef.current = key;
    onEndedNotified?.();
  }, [remainingMs, event?.startedAt, onEndedNotified]);

  const heading = state === 'ended'
    ? 'EVENT ENDED'
    : state === 'waiting'
      ? 'WAITING FOR SCHOLARS'
      : state === 'ending_soon'
        ? 'ENDING SOON'
        : 'LIVE EVENT';

  const countdown = (() => {
    if (state === 'ended') return null;
    if (remainingMs === null) return null;
    return `${fmtRemaining(remainingMs)} remaining`;
  })();

  return (
    <div
      className="flex items-center gap-2 flex-wrap min-h-[18px]"
      data-testid="live-event-bar"
      data-event-state={state}
    >
      <span
        className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${tone.chip}`}
      >
        {state === 'live' || state === 'ending_soon' ? (
          <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
        ) : (
          <Timer size={9} aria-hidden="true" />
        )}
        {heading}
      </span>

      {countdown && (
        <span
          className="inline-flex items-center gap-1 text-[10px] font-black text-slate-300 tabular-nums"
          data-testid="live-event-countdown"
        >
          <Clock size={10} aria-hidden="true" />
          {countdown}
        </span>
      )}

      {state === 'live' && endsAt && (
        <span className="text-[10px] font-medium text-slate-500">closes at {fmtClockTime(endsAt)}</span>
      )}

      {state === 'waiting' && (
        <span className="text-[10px] font-medium text-slate-500">
          the clock starts when the room opens
        </span>
      )}

      {state === 'ended' && (
        <span className="text-[10px] font-medium text-slate-500">
          ended{event?.endedAt ? ` ${fmtClockTime(event.endedAt)}` : ''} · read-only now
        </span>
      )}

      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500">
        <Users size={10} aria-hidden="true" />
        {typeof memberCount === 'number' ? memberCount : '—'} here
      </span>

      {/* Announced once, politely, rather than only shown. */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'ended'
          ? 'This live event has ended. You can still read it.'
          : state === 'waiting'
            ? 'This room is still gathering members. The event has not started.'
            : countdown
              ? `Live event. ${countdown}.`
              : 'Live event.'}
      </span>
    </div>
  );
}
