import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';

// Resilient Supabase Realtime subscription for the Anonymous room.
//
// ROOT CAUSE this hook fixes: `supabase.channel(topic)` REUSES an existing
// channel for the same topic. A churny effect (one that depends on alias /
// callbacks) would call channel(topic) while the previous channel was still
// `leaving`/`errored`/`joined`, and `.subscribe()` only re-joins when the state
// is `closed` — so it silently no-ops and the room goes permanently dead. This
// hook (a) removes the previous channel before creating a new one, (b) keeps the
// effect dependency list STABLE (callbacks/presence via refs), (c) re-subscribes
// with bounded exponential backoff instead of giving up after a few attempts,
// and (d) reconciles (re-fetches) after every re-subscribe so nothing is missed.
//
// Events are NOTIFICATION-ONLY: payloads never carry message content. Callers
// must re-fetch through the authorized API before trusting anything.

const BASE_BACKOFF_MS = 1500;
const MAX_BACKOFF_MS = 30_000;
const POLL_WHEN_DOWN_MS = 9_000;
const HEARTBEAT_MS = 60_000;

export function useAnonymousRoomRealtime({ topic, enabled, sessionId, presence, onEvent, onReconcile }) {
  const [conn, setConn] = useState('connecting');
  const [online, setOnline] = useState(null);
  const [nonce, setNonce] = useState(0);

  const channelRef = useRef(null);
  const onEventRef = useRef(onEvent);
  const onReconcileRef = useRef(onReconcile);
  const presenceRef = useRef(presence);
  const connRef = useRef('connecting');
  const retryRef = useRef(0);
  const timerRef = useRef(null);
  const subscribedOnceRef = useRef(false);

  useEffect(() => {
    onEventRef.current = onEvent;
    onReconcileRef.current = onReconcile;
    presenceRef.current = presence;
    connRef.current = conn;
  });

  const retry = useCallback(() => {
    retryRef.current = 0;
    setNonce((n) => n + 1);
  }, []);

  const sendTyping = useCallback((payload) => {
    try {
      channelRef.current?.send({ type: 'broadcast', event: 'typing', payload }).catch(() => {});
    } catch {
      /* realtime unavailable — polling reconciles */
    }
  }, []);

  useEffect(() => {
    if (!enabled || !topic || !supabase) {
      setConn(supabase ? 'connecting' : 'offline');
      return undefined;
    }
    let cancelled = false;
    subscribedOnceRef.current = false;

    // Remove any prior channel for this topic BEFORE creating a new one. This
    // is the crux of the fix: never let channel(topic) return a stale channel.
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

    const p = presenceRef.current || {};
    const channel = supabase.channel(topic, {
      config: { presence: { key: p.key || `guest:${Math.random().toString(36).slice(2, 10)}` } },
    });
    channelRef.current = channel;

    channel
      .on('broadcast', { event: 'room' }, ({ payload }) => {
        onEventRef.current?.(payload?.type || 'unknown', payload);
      })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        onEventRef.current?.('typing', payload);
      })
      .on('presence', { event: 'sync' }, () => {
        if (cancelled) return;
        const state = channel.presenceState();
        const members = Object.keys(state || {}).filter((key) => key.startsWith('m:'));
        setOnline(members.length);
      })
      .subscribe((status) => {
        if (cancelled) return;
        if (status === 'SUBSCRIBED') {
          retryRef.current = 0;
          connRef.current = 'live';
          setConn('live');
          channel.track(p.track || { spectator: true }).catch(() => {});
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

  // Fallback polling: fast when the socket is down, slow heartbeat when live.
  useEffect(() => {
    if (!enabled) return undefined;
    const fast = setInterval(() => {
      if (connRef.current !== 'live') onReconcileRef.current?.('poll');
    }, POLL_WHEN_DOWN_MS);
    const slow = setInterval(() => {
      if (connRef.current === 'live') onReconcileRef.current?.('heartbeat');
    }, HEARTBEAT_MS);
    return () => {
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [enabled]);

  return { conn, online, retry, sendTyping };
}

export default useAnonymousRoomRealtime;
