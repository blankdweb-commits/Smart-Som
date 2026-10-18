import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from './AppContext';
import { supabase } from '../utils/supabase';
import ChallengePopup from '../components/ChallengePopup';

/**
 * ChallengeContext — every incoming duel challenge, wherever the user is.
 *
 * WHY THIS EXISTS. Before this, invites were polled ONLY while the Arena's
 * scholars phase was mounted (Rumble.jsx gated the poll on `phase ===
 * 'scholars'`). A challenge that arrived while the user was on the dashboard,
 * in the hub, in the picker or mid-match was simply never seen. Separately,
 * arena_invites_list filtered status='pending' on both branches, so an INVITER
 * could not learn their own challenge had been accepted — which is why two
 * players never actually started together (migration-v84 adds `ready[]`).
 *
 * WHAT IT OWNS:
 *   * the single app-wide invite poll (2.5s, paused when the tab is hidden)
 *   * the incoming-challenge popup, including a live expiry countdown
 *   * `ready[]` handoff: when a challenge you SENT is accepted, this surfaces
 *     the match and hands it to the Arena so both sides enter together
 *   * a broadcast channel so the accepter can tell the inviter immediately,
 *     with the poll as the fallback when realtime is unavailable
 *
 * It lives outside AppContext on purpose: a 2.5s poll there would re-render
 * every consumer in the app. Here it re-renders one small provider.
 *
 * MID-MATCH BEHAVIOUR: while a duel is live the popup is not shown at all. That
 * is a DERIVED condition rather than a queued state — see `visibleInvite`. The
 * instant the duel ends the oldest unanswered challenge reappears by itself,
 * with nothing to synchronise.
 *
 * State here is deliberately minimal: the poll callback (an external-system
 * subscription) is the only thing that calls setState, and the popup is derived
 * during render rather than mirrored by an effect.
 */

const POLL_MS = 2500;
const CHANNEL = 'arena:challenge';

const ChallengeContext = createContext({
  incoming: [],
  outgoing: [],
  ready: [],
  windowSeconds: 600,
  busy: null,
  notice: null,
  dismissNotice: () => {},
  dismiss: () => {},
  setMatchLive: () => {},
  matchLive: false,
  openFor: () => {},
  respond: () => {},
  cancel: () => {},
  refresh: () => {},
  consumeAdopt: () => {},
});

// Module-level singleton so StrictMode's double-invoked effect cannot leave two
// channels attached to the same topic. The poll is the fallback if this never
// connects, so nothing depends on it.
let channel = null;

const ensureChannel = (onEvent) => {
  if (!supabase || channel) return channel;
  const ch = supabase.channel(CHANNEL, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'accepted' }, ({ payload }) => {
    try { onEvent(payload); } catch { /* a bad payload must not kill the socket */ }
  });
  ch.subscribe();
  channel = ch;
  return ch;
};

export function ChallengeProvider({ children }) {
  const { arenaInvites, arenaInviteReady, arenaInviteRespond, arenaInviteCancel, session } =
    useAppContext();

  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [ready, setReady] = useState([]);
  const [windowSeconds, setWindowSeconds] = useState(600);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [dismissed, setDismissed] = useState(() => new Set());
  const [matchLive, setMatchLive] = useState(false);

  // A match id the Arena has not picked up yet. A ref, not state: the Arena
  // drains it on mount and we must not want a re-render for it.
  const pendingRef = useRef(null);

  // ---- the inviter handoff -------------------------------------------------
  const adopt = useCallback(async (entry) => {
    const matchId = entry?.matchId;
    if (!matchId || pendingRef.current === matchId) return;
    // Acknowledge first so `ready` stops offering it, then hand the match over.
    // The match itself is verified server-side via arena_state, never trusted
    // from the broadcast payload.
    const ack = await arenaInviteReady({ inviteId: entry.inviteId });
    if (!ack?.ok) {
      setNotice('Your challenge was accepted but the duel could not be opened. Try again from the Arena.');
      return;
    }
    pendingRef.current = matchId;
    setNotice(`${entry.name || 'Your rival'} accepted your challenge. Opening the duel…`);
  }, [arenaInviteReady]);

  // ---- the single poll -----------------------------------------------------
  // The ONLY place setState is called. This is an external-system subscription
  // (the server), so calling setState from its callback is exactly what effects
  // are for — unlike mirroring one state from another in an effect body.
  const refresh = useCallback(async () => {
    if (!session) return null;
    const r = await arenaInvites();
    if (!r) return null;
    setIncoming(r.incoming);
    setOutgoing(r.outgoing);
    setReady(r.ready);
    setWindowSeconds(r.windowSeconds);

    // Adopt a challenge of ours that was accepted. Guarded so it happens once.
    const next = r.ready[0];
    if (next) adopt(next);
    return r;
  }, [arenaInvites, adopt, session]);

  useEffect(() => {
    if (!session) return undefined;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      // Don't burn requests on a hidden tab; the first tick after it becomes
      // visible again picks up anything missed.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      await refresh();
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh, session]);

  // Realtime: the accepter tells the inviter at once instead of waiting up to
  // 2.5s. Notification only — it carries no authority.
  useEffect(() => {
    if (!session) return undefined;
    ensureChannel(() => { refresh(); });
    return undefined;
  }, [refresh, session]);

  // The Arena drains this on mount and on every phase change.
  const consumeAdopt = useCallback(() => {
    const mid = pendingRef.current;
    if (!mid) return null;
    pendingRef.current = null;
    return mid;
  }, []);

  // ---- which challenge is on screen — DERIVED, not synced ------------------
  const visibleInvite = useMemo(() => {
    if (matchLive) return null;          // never interrupt a duel; it reappears after
    return incoming.find((i) => !dismissed.has(i.inviteId)) || null;
  }, [incoming, dismissed, matchLive]);

  // Closing without declining: mark this one answered-for-now. It stays in the
  // bell, and it reappears on the next full reload. Declining is a different
  // decision and must never happen by accident.
  const dismiss = useCallback((inviteId) => {
    if (inviteId == null) return;
    setDismissed((cur) => {
      if (cur.has(inviteId)) return cur;
      const next = new Set(cur);
      next.add(inviteId);
      return next;
    });
  }, []);

  // Bring one specific challenge to the front from the bell.
  const openFor = useCallback((inviteId) => {
    if (inviteId == null) return;
    setDismissed((cur) => {
      const next = new Set(cur);
      for (const i of incoming) if (i.inviteId !== inviteId) next.add(i.inviteId);
      return next;
    });
  }, [incoming]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  // ---- responses -----------------------------------------------------------
  const respond = useCallback(async (invite, accept) => {
    if (!invite) return null;
    setBusy(invite.inviteId);
    const res = await arenaInviteRespond({ inviteId: invite.inviteId, accept });
    setBusy(null);
    await refresh();
    dismiss(invite.inviteId);

    if (accept && res?.ok && res?.matchId) {
      // Tell the other side immediately; the poll covers a missed broadcast.
      try {
        channel?.send({ type: 'broadcast', event: 'accepted', payload: { inviteId: invite.inviteId, matchId: res.matchId } });
      } catch { /* best effort */ }
      setNotice('Challenge accepted. The duel is opening for both of you.');
      return res;
    }
    if (!accept && res?.ok) setNotice('Challenge declined. Nothing was held.');
    else if (accept) setNotice('Could not accept that challenge right now.');
    return res;
  }, [arenaInviteRespond, refresh, dismiss]);

  const cancel = useCallback(async (invite) => {
    if (!invite) return;
    setBusy(invite.inviteId);
    await arenaInviteCancel({ inviteId: invite.inviteId });
    setBusy(null);
    await refresh();
  }, [arenaInviteCancel, refresh]);

  const value = useMemo(() => ({
    incoming,
    outgoing,
    ready,
    windowSeconds,
    busy,
    notice,
    dismissNotice,
    dismiss,
    setMatchLive,
    matchLive,
    openFor,
    respond,
    cancel,
    refresh,
    consumeAdopt,
  }), [incoming, outgoing, ready, windowSeconds, busy, notice, dismissNotice, dismiss, matchLive, openFor, respond, cancel, refresh, consumeAdopt]);

  return (
    <ChallengeContext.Provider value={value}>
      {children}
      <ChallengePopup
        invite={visibleInvite}
        windowSeconds={windowSeconds}
        busy={busy}
        onRespond={respond}
        onDismiss={dismiss}
      />
    </ChallengeContext.Provider>
  );
}

// A Provider and its consumer hook have to live in the same module - that is
// what makes the CONTEXT OBJECT identical for both. Splitting them would create
// two context objects and produce exactly the "useAppContext(...) is undefined"
// crash this codebase already paid for once. Same reason, and same suppression,
// as AppContext.jsx.
 // eslint-disable-next-line react-refresh/only-export-components
export const useChallenge = () => useContext(ChallengeContext);

export default ChallengeProvider;