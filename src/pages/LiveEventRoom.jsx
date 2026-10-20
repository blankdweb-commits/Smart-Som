// ============================================================================
// src/pages/LiveEventRoom.jsx
//
// A single Anonymous Live Event room. Read-only archive when closed; composer
// and reactions only while `status === 'live'`. All mutation gates are enforced
// by the server (_live_event_over / RLS); the client never decides.
//
// Realtime: subscribes to a per-event broadcast channel so messages and the
// closure notice arrive without a manual refresh. Reconnects/refetches restore
// the authoritative state from getLiveEvent. Optimistic messages are deduped
// by id so a realtime echo doesn't duplicate them.
// ============================================================================
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import {
  getLiveEvent,
  sendLiveEventMessage,
  reactLiveEventMessage,
  closeLiveEvent,
} from '../utils/liveEventsApi';
import { Loader2, Send, RefreshCw, Clock, Users, MessageCircle, ShieldAlert } from '../components/Icons';
import { useParams } from 'react-router-dom';

const CLOSED_NOTICE =
  'This live event has closed. You can still read it, but no new messages or actions can be added.';

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
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [online, setOnline] = useState(null);
  const messageIdsRef = useRef(new Set());
  const channelRef = useRef(null);

  const load = useCallback(async () => {
    if (!eventId) return;
    try {
      setLoading(true);
      const res = await getLiveEvent(session, eventId);
      if (!res.ok) { setError(res.error || 'Failed to load event'); return; }
      setEvent(res.event);
      setMessages(res.messages || []);
      messageIdsRef.current = new Set((res.messages || []).map((m) => m.id));
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to load event');
    } finally {
      setLoading(false);
    }
  }, [session, eventId]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime broadcast channel for this event.
  useEffect(() => {
    if (!supabase || !eventId) return undefined;
    const ch = supabase.channel(`live_event:${eventId}`);
    ch.on('broadcast', { event: 'live_event_message' }, (payload) => {
      const m = payload?.payload?.message;
      if (m && !messageIdsRef.current.has(m.id)) {
        messageIdsRef.current.add(m.id);
        setMessages((prev) => [...prev, m]);
      }
    });
    ch.on('broadcast', { event: 'live_event_reaction' }, (payload) => {
      const { message_id, emoji, active } = payload?.payload || {};
      if (!message_id) return;
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== message_id) return m;
          const reactions = { ...(m.reactions || {}) };
          if (active) reactions[emoji] = (reactions[emoji] || 0) + 1;
          else if (reactions[emoji] > 0) reactions[emoji] -= 1;
          return { ...m, reactions };
        })
      );
    });
    ch.on('broadcast', { event: 'live_event_closed' }, () => {
      load();
    });
    ch.subscribe((status) => {
      setOnline(status === 'subscribed' ? true : status === 'closed' ? false : null);
      if (status === 'subscribed' || status === 'rejoined') load();
    });
    channelRef.current = ch;
    return () => {
      ch.unsubscribe();
      channelRef.current = null;
    };
  }, [eventId, load]);

  const state = event?.status;
  const closed = state === 'closed' || state === 'cancelled';
  const canWrite = state === 'live' && !!session;

  const handleSend = async (e) => {
    e.preventDefault();
    const c = composer.trim();
    if (!c || sending || !canWrite) return;
    setSending(true);
    try {
      const res = await sendLiveEventMessage(session, eventId, c);
      if (res.ok) {
        setComposer('');
        // Optimistic insert already covered by broadcast echo; dedupe by id.
      } else {
        setError(res.error || 'Failed to send message');
      }
    } catch (err) {
      setError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleReact = async (messageId, emoji, active) => {
    if (!canWrite) return;
    try {
      const res = await reactLiveEventMessage(session, messageId, emoji, active);
      if (!res.ok) setError(res.error || 'Reaction failed');
    } catch (err) {
      setError(err.message || 'Reaction failed');
    }
  };

  const handleClose = async () => {
    if (!window.confirm('Close this live event? Closed events stay readable but no new messages or actions can be added.')) return;
    try {
      const res = await closeLiveEvent(session, eventId);
      if (!res.ok) setError(res.error || 'Failed to close event');
      else load();
    } catch (err) {
      setError(err.message || 'Failed to close event');
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
        <p className="text-slate-500 dark:text-slate-400 text-sm">{error}</p>
        <button onClick={load} className="mt-4 px-4 py-2 rounded-xl bg-polynurse-600 text-white text-[10px] font-black uppercase tracking-wider">
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
            {messages.map((m) => (
              <li key={m.id} className="flex flex-col gap-1">
                <div className="flex items-start gap-2">
                  <span className="text-[9px] font-black text-slate-400">{m.author_alias}</span>
                  <span className="text-[9px] text-slate-400">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-700 dark:text-slate-200 leading-relaxed">
                  {m.content}
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  {Object.entries(m.reactions || {}).map(([emoji, count]) => (
                    <button
                      key={`${m.id}-${emoji}`}
                      type="button"
                      disabled={!canWrite}
                      onClick={() => handleReact(m.id, emoji, true)}
                      className={`flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-bold ${
                        canWrite
                          ? 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200 dark:bg-slate-800/50 dark:border-slate-700'
                          : 'bg-slate-200 text-slate-400 border-slate-200 dark:bg-slate-700/30 dark:border-slate-700'
                      }`}
                    >
                      {emoji} <span className="font-black">{count}</span>
                    </button>
                  ))}
                </div>
              </li>
            ))}
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
          onClick={load}
          className="flex items-center gap-1 px-2 py-1 rounded border text-slate-500 hover:text-polynurse-600 dark:hover:text-polynurse-400 transition"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  );
}
