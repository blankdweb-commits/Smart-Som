import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';

// Resilient Supabase Realtime channel for the 1v1 Duel Lobby + blitz matches.
//
// Two kinds of channel ride the same hook:
//   - Lobby      topic = `match-lobby:duel:blitz`  (presence only — "N scholars
//                waiting" transparency count for the queue).
//   - Match      topic = `match:<id>`              (broadcast of MY mirrored
//                state so my opponent's score card ticks live).
//
// Same resilience rules as the anonymous room hook: NEVER reuse a channel for
// the same topic mid-lifecycle (remove the previous channel first), keep the
// effect deps STABLE (callbacks via refs), re-subscribe with bounded backoff
// instead of giving up, and reconcile (re-fetch) after any re-subscribe.
//
// Broadcast payloads are NOTIFICATION-ONLY: they carry a player's own grade
// deltas (score +delta) for the mirror — never the correct answer text, never
// the answer key. Settlement stays server-authoritative.

const BASE_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 30_000;

export function useMatchRealtime({ topic, enabled, sessionId, track, onEvent, onReconcile }) {
  const [conn, setConn] = useState('connecting');
  const [online, setOnline] = useState(null);
  const [nonce, setNonce] = useState(0);

  const channelRef = useRef(null);
  const onEventRef = useRef(onEvent);
  const onReconcileRef = useRef(onReconcile);
  const trackRef = useRef(track);
  const connRef = useRef('connecting');
  const retryRef = useRef(0);
  const timerRef = useRef(null);
  const subscribedOnceRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
    onReconcileRef.current = onReconcile;
    trackRef.current = track;
    connRef.current = conn;
  });

  const retry = useCallback(() => {
    retryRef.current = 0;
    setNonce((n) => n + 1);
  }, []);

  const sendState = useCallback((payload) => {
    try {
      channelRef.current?.send({ type: 'broadcast', event: 'state', payload }).catch(() => {});
    } catch {
      /* realtime unavailable — server truth wins on complete() */
    }
  }, []);

  useEffect(() => {
    if (!enabled || !topic || !supabase) {
      setConn(supabase ? 'connecting' : 'offline');
      return undefined;
    }
    let cancelled = false;
    subscribedOnceRef.current = false;

    // Remove any prior channel for this topic BEFORE creating a new one.
    const previous = channelRef.current;
    channelRef.current = null;
    if (previous) supabase.removeChannel(previous);

    const scheduleReconnect = () => {
      if (cancelled) return;
      retryRef.current += 1;
      const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (retryRef.current - 1));
      setConn(retryRef.current >= 3 ? 'reconnecting' : 'connecting');
      timerRef.current = setTimeout(() => {
        if (!cancelled) setNonce((n) => n + 1);
      }, delay);
    };

    const channel = supabase.channel(topic, {
      config: { presence: { key: `m:${sessionId || Math.random().toString(36).slice(2, 10)}` } },
    });
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'state' }, ({ payload }) => {
        onEventRef.current?.(payload?.type || 'unknown', payload);
      })
      .on('presence', { event: 'sync' }, () => {
        if (cancelled) return;
        const state = channel.presenceState();
        const members = Object.keys(state || {}).filter((key) => key.startsWith('m:'));
        setOnline(members.length);
        onReconcileRef.current?.('presence-sync', members.length);
      })
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          retryRef.current = 0;
          connRef.current = 'live';
          setConn('live');
          channel.track(trackRef.current || { waiting: true }).catch(() => {});
          // Any (re)subscribe after the first means we may have missed events.
          if (subscribedOnceRef.current) onReconcileRef.current?.('resubscribed');
          subscribedOnceRef.current = true;
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          scheduleReconnect();
        }
      });

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (channelRef.current === channel) channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [enabled, topic, sessionId, nonce]);

  return { conn, online, retry, sendState };
}

export default useMatchRealtime;