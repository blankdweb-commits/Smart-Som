// ============================================================================
// src/pages/LiveEventRoom.jsx
//
// A single Anonymous Live Event room. Read-only archive when closed; composer
// and reactions only while `status === 'live'`. All mutation gates are enforced
// by the server (_live_event_over / RLS); the client never decides.
//
// DELIVERY. The server fans out a NOTICE-ONLY broadcast on `live_event:<id>`
// (no content, no author id) and the room re-reads the authorized endpoint
// when it arrives. A quiet poll runs while the event is live, so the room
// still converges when the broadcast channel is unavailable.
//
// OPTIMISM. A sent message is inserted from the server's own response (the row
// is already committed), and a reaction is applied locally and reconciled by
// the next read. Both are keyed by id, so a broadcast or poll echo can never
// duplicate them.
//
// REACTIONS. `reactions` stays the { emoji: count } map. `my_reactions` (the
// viewer's own emoji on that message) is what makes a reaction toggleable: the
// client sends `active: !mine`, never a blind `active: true`.
// ============================================================================
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import {
  getLiveEvent,
  sendLiveEventMessage,
  reactLiveEventMessage,
  closeLiveEvent,
  liveEventError,
} from '../utils/liveEventsApi';
import { Loader2, Send, RefreshCw, Clock, Users, MessageCircle, ShieldAlert, Smile } from '../components/Icons';
import { useParams } from 'react-router-dom';

const CLOSED_NOTICE =
  'This live event has closed. You can still read it, but no new messages or actions can be added.';

const REACTION_EMOJIS = ['👍', '❤️', '😂', '🎉', '👏', '🔥', '💡', '🙌'];

// How often a live room re-reads the authorized endpoint. The broadcast is the
// fast path; this is the path that always works.
const POLL_MS = 4000;

const fmtRemaining = (ms) => {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}m ${pad(s)}s`;
};

const fmtClock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function LiveEventRoom() {
  const { session } = useAppContext();
  const { id } = useParams();
  const eventId = id;

  const [event, setEvent] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(null);
  const [pickerFor, setPickerFor] = useState(null);
  const messageIdsRef = useRef(new Set());
  // Messages inserted locally that the server has not echoed yet.
  const pendingRef = useRef(new Map());
  const channelRef = useRef(null);

  const state = event?.status;
  const closed = state === 'closed' || state === 'cancelled';
  const canWrite = state === 'live' && !!session;

  const load = useCallback(
    async (opts) => {
      const quiet = opts?.quiet === true;
      if (!eventId) return;
      try {
        if (!quiet) setLoading(true);
        const res = await getLiveEvent(session, eventId);
        if (!res || res.error) {
          if (!quiet) setError(liveEventError({ code: res?.error, data: res }));
          return;
        }
        const serverMessages = res.messages || [];
        const serverIds = new Set(serverMessages.map((m) => m.id));
        // A message inserted locally stays visible even if the read that was
        // already in flight when it was sent has not caught up yet.
        const pending = Array.from(pendingRef.current.values()).filter((m) => !serverIds.has(m.id));
        const merged = pending.length ? [...serverMessages, ...pending] : serverMessages;
        pendingRef.current = new Map(pending.map((m) => [m.id, m]));
        setEvent(res.event);
        setMessages(merged);
        messageIdsRef.current = new Set(merged.map((m) => m.id));
        if (!quiet) setError(null);
      } catch (err) {
        if (!quiet) setError(liveEventError(err));
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [session, eventId]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Realtime notice channel. The payload is a notice only, so the only
  // correct reaction to it is to re-read the room through the API.
  useEffect(() => {
    if (!supabase || !eventId) return undefined;
    const ch = supabase.channel(`live_event:${eventId}`);
    ch.on('broadcast', { event: 'live_event' }, () => {
      load({ quiet: true });
    });
    ch.subscribe((status) => {
      setOnline(status === 'subscribed' ? true : status === 'closed' ? false : null);
      if (status === 'subscribed' || status === 'rejoined') load({ quiet: true });
    });
    channelRef.current = ch;
    return () => {
      ch.unsubscribe();
      channelRef.current = null;
    };
  }, [eventId, load]);

  // Quiet poll while the event is live, so messages and reactions converge even
  // when the broadcast never arrives. A hidden tab does not poll.
  useEffect(() => {
    if (state !== 'live') return undefined;
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      load({ quiet: true });
    };
    const timer = setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state, load]);

  const handleSend = async (e) => {
    e.preventDefault();
    const c = composer.trim();
    if (!c || sending || !canWrite) return;
    setSending(true);
    setActionError(null);
    try {
      const res = await sendLiveEventMessage(session, eventId, c);
      if (res.ok) {
        setComposer('');
        const msg = res.message;
        // The row is committed before the response, so it is safe to show it
        // now. Deduped by id against the feed and against a poll echo.
        if (msg && msg.id && !messageIdsRef.current.has(msg.id)) {
          messageIdsRef.current.add(msg.id);
          pendingRef.current.set(msg.id, { ...msg, reactions: {}, my_reactions: [] });
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, { ...msg, reactions: {}, my_reactions: [] }]));
        }
      } else {
        setActionError(liveEventError({ code: res?.error, data: res }));
      }
    } catch (err) {
      setActionError(liveEventError(err));
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (messageId, emoji, active) => {
    if (!canWrite) return;
    setActionError(null);
    // Optimistic: the chip and the count move now, the next read reconciles.
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = { ...(m.reactions || {}) };
        const mine = new Set(m.my_reactions || []);
        if (active) {
          reactions[emoji] = (reactions[emoji] || 0) + 1;
          mine.add(emoji);
        } else {
          if (reactions[emoji] > 0) reactions[emoji] -= 1;
          if (reactions[emoji] <= 0) delete reactions[emoji];
          mine.delete(emoji);
        }
        return { ...m, reactions, my_reactions: Array.from(mine) };
      })
    );
    try {
      const res = await reactLiveEventMessage(session, messageId, emoji, active);
      if (!res || res.error) {
        setActionError(liveEventError({ code: res?.error, data: res }));
        load({ quiet: true });
      }
    } catch (err) {
      setActionError(liveEventError(err));
      load({ quiet: true });
    }
  };

  const toggleReaction = (messageId, emoji) => {
    const mine = (messages.find((m) => m.id === messageId)?.my_reactions || []).includes(emoji);
    handleReact(messageId, emoji, !mine);
  };

  const handleClose = async () => {
    if (!window.confirm('Close this live event? Closed events stay readable but no new messages or actions can be added.')) return;
    setActionError(null);
    try {
      const res = await closeLiveEvent(session, eventId);
      if (!res || res.error) setActionError(liveEventError({ code: res?.error, data: res }));
      else load({ quiet: true });
    } catch (err) {
      setActionError(liveEventError(err));
    }
  };

  if (loading && !event) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500 font-black text-sm">
        <Loader2 size={28} className="animate-spin mr-2" /> Loading event…
      </div>
    );
  }
  if (error && !event) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ShieldAlert size={40} className="text-rose-500 mb-3" />
        <h2 className="font-black text-slate-900 dark:text-white">Couldn’t load the event</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm">{error.message}</p>
        <p className="mt-1 text-[9px] font-black uppercase tracking-widest text-slate-400">Code: {error.code}</p>
        <button onClick={() => load()} className="mt-4 px-4 py-2 rounded-xl bg-polynurse-600 text-white text-[10px] font-black uppercase tracking-wider">
          Try again
        </button>
      </div>
    );
  }

  const endsAt = event?.end_at ? new Date(event.end_at).getTime() : null;
  const remainingMs = endsAt ? endsAt - Date.now() : null;

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Header */}
      <div className="mb-5 rounded-2xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${
              closed
                ? 'bg-slate-100 text-slate-600 border border-slate-200'
                : state === 'live'
                  ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                  : 'bg-amber-100 text-amber-700 border border-amber-200'
            }`}
          >
            {closed ? <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> : <Clock size={10} />}
            {closed ? 'Closed' : state === 'live' ? 'Live now' : 'Scheduled'}
          </span>
          {state === 'scheduled' && endsAt && (
            <span className="text-[10px] font-black text-slate-500">starts {new Date(event.start_at).toLocaleDateString()} {fmtClock(event.start_at)}</span>
          )}
        </div>
        <h1 className="font-black text-slate-900 dark:text-white text-lg sm:text-xl">{event.title}</h1>
        <p className="mt-1 text-slate-500 dark:text-slate-400 text-sm line-clamp-2">{event.description}</p>

        <div className="mt-3 flex items-center gap-3 text-[10px] font-black text-slate-400">
          <span className="flex items-center gap-1">
            <Clock size={11} />
            {closed ? 'Closed' : endsAt ? fmtRemaining(remainingMs) + ' remaining' : 'TBD'}
          </span>
          <span className="flex items-center gap-1">
            <Users size={11} />
            {event.participant_count} here
          </span>
          {closed && (
            <span className="flex items-center gap-1">
              <ShieldAlert size={11} className="text-rose-500" />
              <span className="text-rose-600 dark:text-rose-400">Read-only</span>
            </span>
          )}
        </div>

        {closed && (
          <div className="mt-3 rounded-xl border border-rose-200 dark:border-rose-900/30 bg-rose-50 dark:bg-rose-900/10 p-3 text-rose-700 dark:text-rose-400 font-black text-sm">
            {CLOSED_NOTICE}
          </div>
        )}

        {event.created_by && session && session.user && event.created_by === session.user.id && !closed && (
          <button
            type="button"
            onClick={handleClose}
            className="mt-3 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/30 text-[10px] font-black text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/10 hover:bg-rose-100 dark:hover:bg-rose-900/30"
          >
            <ShieldAlert size={13} className="text-rose-600" /> Close event
          </button>
        )}
      </div>

      {actionError && (
        <div className="mb-4 rounded-2xl border border-rose-200 dark:border-rose-900/30 bg-rose-50 dark:bg-rose-900/10 p-3 text-rose-700 dark:text-rose-400">
          <div className="font-black text-sm">{actionError.message}</div>
          <div className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-70">Code: {actionError.code}</div>
        </div>
      )}

      {/* Feed */}
      <div className="mb-5">
        <h2 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
          <MessageCircle size={14} className="text-slate-500" /> Messages
        </h2>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500 font-black text-sm">
            <Loader2 size={24} className="animate-spin mr-2" />
          </div>
        ) : messages.length === 0 ? (
          <div className="rounded-2xl border border-dash border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50 p-10 text-center">
            <p className="text-slate-500 dark:text-slate-400 font-black text-sm">
              {closed ? 'No messages yet — this event is closed.' : 'No messages yet. Start the conversation!'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3" role="log" aria-label="Live event messages">
            {messages.map((m) => {
              const mine = m.my_reactions || [];
              return (
                <li key={m.id} className="flex flex-col gap-1">
                  <div className="flex items-start gap-2">
                    <span className="text-[9px] font-black text-slate-400">{m.author_alias}</span>
                    <span className="text-[9px] text-slate-400">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                    {m.content}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[10px]">
                    {Object.entries(m.reactions || {}).map(([emoji, count]) => {
                      const isMine = mine.includes(emoji);
                      return (
                        <button
                          key={`${m.id}-${emoji}`}
                          type="button"
                          aria-label={`${emoji} reaction, ${count}`}
                          aria-pressed={isMine}
                          disabled={!canWrite}
                          onClick={() => toggleReaction(m.id, emoji)}
                          className={`flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-bold ${
                            isMine
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-700'
                              : canWrite
                                ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 dark:bg-slate-800/50 dark:border-slate-700'
                                : 'bg-slate-200 text-slate-400 border-slate-200 dark:bg-slate-700/30 dark:border-slate-700'
                          }`}
                        >
                          {emoji} <span className="font-black">{count}</span>
                        </button>
                      );
                    })}
                    {canWrite && (
                      <button
                        type="button"
                        aria-label={`Add reaction to message ${m.id}`}
                        onClick={() => setPickerFor(pickerFor === m.id ? null : m.id)}
                        className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-slate-300 text-slate-500 hover:text-polynurse-600 hover:border-polynurse-300 dark:border-slate-600 dark:text-slate-400"
                      >
                        <Smile size={11} />
                      </button>
                    )}
                    {canWrite && pickerFor === m.id && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-1 rounded-full border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
                        {REACTION_EMOJIS.map((emoji) => (
                          <button
                            key={`${m.id}-pick-${emoji}`}
                            type="button"
                            aria-label={`React with ${emoji}`}
                            onClick={() => {
                              toggleReaction(m.id, emoji);
                              setPickerFor(null);
                            }}
                            className={`px-1 text-[13px] ${mine.includes(emoji) ? 'opacity-100' : 'opacity-60 hover:opacity-100'}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Composer */}
      <div className="rounded-2xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 p-3 shadow-sm">
        <form onSubmit={handleSend} className="flex items-end gap-2">
          <textarea
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            placeholder={closed ? 'This event is closed — no new messages can be added.' : 'Say something…'}
            disabled={!canWrite}
            rows={2}
            className="flex-1 min-h-[80px] resize-none border-0 focus:ring-0 text-sm text-slate-900 dark:text-white placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={sending || !canWrite || composer.trim().length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-polynurse-600 text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 hover:!bg-polynurse-700 transition"
          >
            <Send size={14} /> Send
          </button>
        </form>
        {!canWrite && (
          <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-black">
            {closed ? CLOSED_NOTICE : 'The composer opens when the event goes live.'}
          </p>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 font-black">
        <span>
          {online === true ? 'Connected' : online === false ? 'Disconnected' : 'Connecting…'}
        </span>
        <button
          type="button"
          onClick={() => load()}
          className="flex items-center gap-1 px-2 py-1 rounded border text-slate-500 hover:text-polynurse-600 dark:hover:text-polynurse-400 transition"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  );
}
