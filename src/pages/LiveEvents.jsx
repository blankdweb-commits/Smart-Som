// ============================================================================
// src/pages/LiveEvents.jsx
//
// Anonymous Live Events discovery — Live Now / Upcoming / Recently Closed.
// Read-only for participants; event creation and management are admin-only
// (/admin/live-events). All data comes from the server; counts are real.
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { listLiveEvents } from '../utils/liveEventsApi';
import { Calendar, Clock, Users, RefreshCw, Loader2, Trophy } from '../components/Icons';
import { Link } from 'react-router-dom';

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

const statusTone = {
  live: { chip: 'bg-emerald-500/10 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', label: 'Live now' },
  scheduled: { chip: 'bg-amber-500/10 text-amber-700 border-amber-200', dot: 'bg-amber-500', label: 'Upcoming' },
  closed: { chip: 'bg-slate-500/10 text-slate-600 border-slate-200', dot: 'bg-slate-400', label: 'Closed' },
  cancelled: { chip: 'bg-rose-500/10 text-rose-700 border-rose-200', dot: 'bg-rose-500', label: 'Cancelled' },
};

export default function LiveEvents() {
  const { session } = useAppContext();
  const nowRef = useRef(Date.now());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const res = await listLiveEvents(session);
        if (!cancelled) setEvents(res.events || []);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load live events');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [session]);

  // Keep the client countdown anchored to real time (display only; server is
  // authoritative and refuses writes past the deadline).
  useEffect(() => {
    const t = setInterval(() => { nowRef.current = Date.now(); }, 1000);
    return () => clearInterval(t);
  }, []);

  const byState = (state) => events.filter((e) => e.status === state);
  const live = byState('live');
  const upcoming = byState('scheduled');
  const closed = byState('closed').concat(byState('cancelled'));

  const section = (title, icon, items, empty) => (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${icon === Calendar ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-600'}`}>
          <icon size={18} />
        </div>
        <h2 className="text-base font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">{title}</h2>
      </div>
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-slate-500 font-black text-sm">
          <Loader2 size={24} className="animate-spin mr-2" /> Loading live events…
        </div>
      ) : items.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-slate-400 font-black text-sm">{empty}</div>
      ) : (
        <ul className="space-y-3">
          {items.map((e) => (
            <li key={e.id} className="group relative">
              <Link
                to={`/live-events/${e.id}`}
                className="block"
                onClick={(ev) => { if (e.status === 'closed' || e.status === 'cancelled') ev.preventDefault(); }}
              >
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-sm hover:border-polynurse-300 transition">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${statusTone[e.status]?.dot || statusTone.scheduled.dot}`} />
                    <span className={`text-[10px] font-black uppercase tracking-widest ${statusTone[e.status]?.chip || statusTone.scheduled.chip}`}>
                      {statusTone[e.status]?.label || 'Event'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-black text-slate-900 dark:text-white group-hover:text-polynurse-600 dark:group-hover:text-polynurse-400">{e.title}</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">{e.description || ''}</p>
                    <div className="flex items-center gap-3 mt-2 text-[10px] font-black text-slate-400">
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        {e.end_at ? fmtRemaining(new Date(e.end_at).getTime() - nowRef.current) : '—'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users size={11} />
                        {e.participant_count} here
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ml-3 flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-polynurse-600 text-white hover:bg-polynurse-700 transition"
                    disabled={e.status === 'closed' || e.status === 'cancelled'}
                    aria-label={e.status === 'closed' || e.status === 'cancelled' ? 'Event closed — read-only' : 'Join live event'}
                  >
                    {e.status === 'live' ? 'Join' : e.status === 'scheduled' ? 'RSVP' : 'Read'}
                  </button>
                </div>
              </Link>
              {e.status === 'closed' || e.status === 'cancelled' ? (
                <p className="text-[10px] text-rose-600 dark:text-rose-400 font-black mt-2 pl-8">{CLOSED_NOTICE}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">Live Events</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Scheduled, live and recently closed events. Read-only after they close.</p>
        </div>
        <button
          type="button"
          onClick={() => listLiveEvents(session).then((r) => setEvents(r.events || []))}
          className="flex items-center gap-2 px-3 py-2 rounded-xl border text-[10px] font-black text-polynurse-600 dark:text-polynurse-400 border-polynurse-200 dark:border-polynurse-800 hover:bg-polynurse-50 dark:hover:bg-polynurse-900/30"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-rose-200 dark:border-rose-900/30 bg-rose-50 dark:bg-rose-900/10 p-4 text-rose-700 dark:text-rose-400 font-black text-sm">
          {error}
        </div>
      )}

      {loading && events.length === 0 ? (
        <div className="flex items-center justify-center py-20 text-slate-500 font-black text-sm">
          <Loader2 size={28} className="animate-spin mr-2" /> Loading live events…
        </div>
      ) : null}

      {!loading && (
        <>
          {live.length > 0 && section('Live Now', Trophy, live, 'No live events right now.')}
          {upcoming.length > 0 && section('Upcoming', Calendar, upcoming, 'No upcoming events.')}
          {closed.length > 0 && section('Recently Closed', Calendar, closed, 'No recently closed events.')}
          {live.length === 0 && upcoming.length === 0 && closed.length === 0 && (
            <div className="flex items-center justify-center py-20 rounded-2xl border border-dash border-slate-200 dark:border-slate-700/50 bg-slate-50 dark:bg-slate-800/50 p-8 text-center">
              <Trophy size={48} className="mx-auto mb-4 text-slate-300 dark:text-slate-700" />
              <p className="text-slate-500 dark:text-slate-400 font-black text-sm">No live events yet.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
