// ============================================================================
// src/pages/AdminLiveEvents.jsx
//
// Admin-only management of Anonymous Live Events. Only verified administrators
// (profiles.role in admin|super_admin) can create, publish, start, cancel or
// close events; the server enforces this in the API handlers and RLS.
// ============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  listLiveEvents,
  createLiveEvent,
  updateLiveEvent,
  publishLiveEvent,
  startLiveEvent,
  cancelLiveEvent,
  closeLiveEvent,
  liveEventError,
} from '../utils/liveEventsApi';
import { Shield, Users, Calendar, Clock, Plus, RefreshCw, Loader2, Edit2, X } from '../components/Icons';
import { Link } from 'react-router-dom';

// A closed or cancelled event is read-only: the server refuses the edit.
const terminalStatus = (status) => status === 'closed' || status === 'cancelled';

const fmtClock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

// ---------------------------------------------------------------------------
// LE-1 — the deadline grid.
//
// Deadlines are edited on a MINUTE grid in the browser's LOCAL time and sent
// as absolute instants. The server stores minutes, so the minute shown here is
// the minute the database holds.
// ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, '0');

const toLocalInputValue = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

// "YYYY-MM-DDTHH:mm" is read as LOCAL time by the platform, so this is the
// admin's own wall clock. Returns null when the value cannot be read.
const fromLocalInputValue = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

export default function AdminLiveEvents() {
  const { userProfile, session } = useAppContext();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null); // { code, message } — the code is shown for diagnosis
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [form, setForm] = useState({ title: '', description: '', cover_url: '', start_at: '', end_at: '', status: 'draft' });

  const nowRef = useRef(Date.now());
  useEffect(() => { const t = setInterval(() => { nowRef.current = Date.now(); }, 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const res = await listLiveEvents(session);
        if (!cancelled) setEvents(res.events || []);
      } catch (err) {
        if (!cancelled) setError(liveEventError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [session, reloadToken]);

  if (!userProfile?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield size={40} className="text-rose-500 mb-3" />
        <h2 className="font-black text-slate-900 dark:text-white">Admin only</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm">You need an administrator account to manage live events.</p>
        <Link to="/dashboard" className="mt-4 px-4 py-2 rounded-xl bg-polynurse-600 text-white text-[10px] font-black uppercase tracking-wider">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const remainingMs = (e) => (e.end_at ? new Date(e.end_at).getTime() - nowRef.current : null);

  const fmtRemaining = (ms) => {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}h ${pad(m)}m` : `${pad(m)}m ${pad(s)}s`;
  };

  const openForm = (ev = null) => {
    if (ev) ev.preventDefault();
    setEditing(null);
    setForm({ title: '', description: '', cover_url: '', start_at: '', end_at: '', status: 'draft' });
    setOpen(true);
  };

  const editForm = (ev, e) => {
    ev.preventDefault();
    ev.stopPropagation();
    setEditing(e);
    setForm({
      title: e.title,
      description: e.description,
      cover_url: e.cover_url || '',
      start_at: toLocalInputValue(e.start_at),
      end_at: toLocalInputValue(e.end_at),
      status: e.status_raw || e.status,
    });
    setOpen(true);
  };

  const closeForm = () => { setOpen(false); setEditing(null); };

  // The deadline is frozen once the event is live or someone has joined — the
  // server refuses a change with EVENT_LOCKED, so the form says so up front.
  const deadlineLocked = !!editing && (editing.status === 'live' || (editing.participant_count || 0) > 0);

  const save = async (ev) => {
    ev.preventDefault();
    setBusy('save');
    try {
      // LE-1 — read the grid first: an unreadable value is refused here
      // instead of becoming a server-side 500.
      const startIso = fromLocalInputValue(form.start_at);
      const endIso = fromLocalInputValue(form.end_at);
      if (startIso === null || endIso === null) {
        setError({ code: 'INVALID_TIME', message: 'That date and time could not be read. Re-enter it.' });
        return;
      }
      if (startIso && endIso && new Date(endIso).getTime() <= new Date(startIso).getTime()) {
        setError({ code: 'INVALID_WINDOW', message: 'The end time must be after the start time.' });
        return;
      }

      let res;
      if (editing) {
        // LE-1 — dirty diff: only the fields the admin actually changed are
        // sent. An unrelated title edit can therefore never carry a stale
        // deadline and trip the locked-window refusal.
        const original = {
          title: (editing.title || '').trim(),
          description: (editing.description || '').trim(),
          cover_url: (editing.cover_url || '').trim(),
          start_at: toLocalInputValue(editing.start_at),
          end_at: toLocalInputValue(editing.end_at),
        };
        const patch = {};
        if (form.title.trim() !== original.title) patch.title = form.title.trim();
        if (form.description.trim() !== original.description) patch.description = form.description.trim();
        if (form.cover_url.trim() !== original.cover_url) patch.cover_url = form.cover_url.trim() || null;
        if (form.start_at !== original.start_at) patch.start_at = startIso || null;
        if (form.end_at !== original.end_at) patch.end_at = endIso || null;
        res = await updateLiveEvent(session, editing.id, patch);
      } else {
        res = await createLiveEvent(session, {
          title: form.title.trim(),
          description: form.description.trim(),
          cover_url: form.cover_url.trim() || undefined,
          start_at: startIso || undefined,
          end_at: endIso || undefined,
          status: form.status,
        });
      }
      // apiFetch throws on every non-2xx, so a refusal arrives in the catch
      // with its server code attached. The check below is only a defensive net
      // for a 2xx body that still carries an error field.
      if (!res || res.error) {
        setError(liveEventError({ code: res?.error, data: res }));
        return;
      }
      setOpen(false);
      setEditing(null);
      setError(null);
      setReloadToken((t) => t + 1);
    } catch (err) {
      setError(liveEventError(err));
    } finally {
      setBusy(false);
    }
  };

  // LE-4 — a lifecycle action always names the event it acts on, and the list
  // is refreshed from the server straight after it (never from a guess).
  const transition = async (fn, label, eventId) => {
    const targetId = eventId || editing?.id;
    if (!targetId) return;
    setBusy(label);
    try {
      const res = await fn(session, targetId);
      if (!res || res.error) {
        setError(liveEventError({ code: res?.error, data: res }));
        return;
      }
      setError(null);
      setReloadToken((t) => t + 1);
      // Keep the open editor in step with the new status so the next action
      // offered is the one the server will accept.
      const nextStatus = res?.event?.status || res?.state;
      if (editing && nextStatus) setEditing({ ...editing, status: nextStatus });
    } catch (err) {
      setError(liveEventError(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = async (eventId) => {
    const targetId = eventId || editing?.id;
    if (!targetId) return;
    if (!window.confirm('Close this event? It stays readable but no new messages or actions can be added.')) return;
    await transition(() => closeLiveEvent(session, targetId), 'close', targetId);
  };

  const statusTone = {
    live: 'bg-emerald-500/10 text-emerald-700 border-emerald-200',
    scheduled: 'bg-amber-500/10 text-amber-700 border-amber-200',
    closed: 'bg-slate-500/10 text-slate-600 border-slate-200',
    cancelled: 'bg-rose-500/10 text-rose-700 border-rose-200',
    draft: 'bg-slate-500/10 text-slate-600 border-slate-200',
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">Live Events</h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Admin-only event management. Participants use /live-events.</p>
        </div>
        <button type="button" onClick={openForm} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-polynurse-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-polynurse-700 transition">
          <Plus size={14} /> Create event
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-rose-200 dark:border-rose-900/30 bg-rose-50 dark:bg-rose-900/10 p-3 text-rose-700 dark:text-rose-400">
          <div className="font-black text-sm">{error.message}</div>
          <div className="mt-1 text-[9px] font-black uppercase tracking-widest opacity-70">
            Code: {error.code}
          </div>
          {/* A failed read must not leave the console blank until the next
              30s poll: the operator retries it now. */}
          <button
            type="button"
            onClick={() => { setError(null); setReloadToken((t) => t + 1); }}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-300 dark:border-rose-800 text-[9px] font-black uppercase tracking-widest hover:bg-rose-100 dark:hover:bg-rose-900/30 transition"
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      <div className="rounded-2xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Event</th>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Starts / ends</th>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Participants</th>
              <th className="px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {loading ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-500 font-black text-sm"><Loader2 size={24} className="animate-spin" /> Loading…</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-slate-500 font-black text-sm">No events yet. Create your first live event.</td></tr>
            ) : (
              events.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                  <td className="px-4 py-3">
                    <div className="font-black text-slate-900 dark:text-white">{e.title}</div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[34rem]">{e.description || ''}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border ${statusTone[e.status] || statusTone.draft}`}>
                      {e.status.charAt(0).toUpperCase() + e.status.slice(1)}
                    </span>
                    {terminalStatus(e.status) && (
                      <span className="mt-1 block text-[9px] font-black uppercase tracking-widest text-slate-400">
                        Read-only
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-slate-600 dark:text-slate-400">
                    {e.start_at ? fmtClock(e.start_at) : '—'}{e.end_at ? ` · ${fmtClock(e.end_at)}` : ''}
                    {e.status === 'live' && e.end_at && <div className="mt-1 text-[9px] text-emerald-600 font-black">{fmtRemaining(remainingMs(e))} remaining</div>}
                  </td>
                  <td className="px-4 py-3 text-[10px] font-black text-slate-600 dark:text-slate-400">{e.participant_count}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Link to={`/live-events/${e.id}`} className="px-2.5 py-1.5 rounded border text-[9px] font-black text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800/50 transition">View</Link>
                      {!busy && (
                        <button
                          type="button"
                          onClick={(ev) => editForm(ev, e)}
                          disabled={terminalStatus(e.status)}
                          className="px-2.5 py-1.5 rounded border text-[9px] font-black text-polynurse-600 hover:bg-polynurse-50 dark:hover:bg-polynurse-900/30 transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                          title={terminalStatus(e.status) ? 'A closed or cancelled event cannot be edited' : 'Edit'}
                        >
                          <Edit2 size={13} />
                        </button>
                      )}
                      {!busy && e.status === 'live' && (
                        <button
                          type="button"
                          onClick={() => confirmClose(e.id)}
                          className="px-2.5 py-1.5 rounded border text-[9px] font-black text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/30 transition"
                          title="Close"
                        >
                          <Shield className="text-rose-600" size={13} />
                        </button>
                      )}
                      {busy === `close` && <Loader2 size={14} className="animate-spin text-slate-500" />}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create/Edit form */}
      <div
        className={`fixed inset-0 z-50 ${open ? '' : 'hidden'}`}
        aria-modal="true"
        role="dialog"
      >
        <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={closeForm} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md p-4 bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-black text-slate-900 dark:text-white">{editing ? 'Edit event' : 'Create live event'}</h2>
            <button type="button" onClick={closeForm} className="rounded p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
              <X size={20} />
            </button>
          </div>
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Title</label>
              <input
                required
                maxLength="120"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Description</label>
              <textarea
                required
                maxLength="2000"
                rows={3}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Cover image URL (optional)</label>
              <input
                value={form.cover_url}
                onChange={(e) => setForm({ ...form, cover_url: e.target.value })}
                className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent"
              />
            </div>
            {!editing && (
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Initial status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent"
                >
                  <option value="draft">Draft</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="live">Live now</option>
                </select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Starts at</label>
                <input
                  type="datetime-local"
                  value={form.start_at}
                  disabled={deadlineLocked}
                  onChange={(e) => setForm({ ...form, start_at: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800/50 dark:disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Ends at</label>
                <input
                  type="datetime-local"
                  value={form.end_at}
                  disabled={deadlineLocked}
                  onChange={(e) => setForm({ ...form, end_at: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent disabled:bg-slate-100 disabled:text-slate-400 dark:disabled:bg-slate-800/50 dark:disabled:text-slate-500"
                />
              </div>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400">
              {deadlineLocked
                ? 'The deadline is frozen now that the event has started or participants have joined. You can still edit the title and description.'
                : 'Times are your own local clock. The deadline is stored to the minute.'}
            </p>
            {busy === 'save' && <Loader2 size={16} className="animate-spin mx-auto" />}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="px-4 py-2 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50">Cancel</button>
              <button type="submit" disabled={busy === 'save'} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-polynurse-600 text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500">
                {editing ? 'Save changes' : 'Create event'}
              </button>
            </div>

            {/* LE-4 — the lifecycle actions live INSIDE the editor. They used to
                sit in a panel underneath the overlay, which made them
                unreachable while the modal was open. */}
            {editing && (
              <div className="mt-4 border-t border-slate-200 dark:border-slate-700 pt-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-2">
                  <Users size={13} /> Lifecycle
                </div>
                <div className="flex flex-wrap gap-2">
                  {editing.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => transition(() => publishLiveEvent(session, editing.id), 'publish')}
                      disabled={!!busy}
                      className="px-3 py-2 rounded-xl border text-[10px] font-black text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/30 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition disabled:opacity-50"
                    >
                      Publish (schedule)
                    </button>
                  )}
                  {editing.status === 'scheduled' && (
                    <>
                      <button
                        type="button"
                        onClick={() => transition(() => startLiveEvent(session, editing.id), 'start')}
                        disabled={!!busy}
                        className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-emerald-700 transition disabled:opacity-50"
                      >
                        Start (go live)
                      </button>
                      <button
                        type="button"
                        onClick={() => transition(() => cancelLiveEvent(session, editing.id), 'cancel')}
                        disabled={!!busy}
                        className="px-3 py-2 rounded-xl border text-[10px] font-black text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/30 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition disabled:opacity-50"
                      >
                        Cancel event
                      </button>
                    </>
                  )}
                  {editing.status === 'live' && (
                    <button
                      type="button"
                      onClick={() => confirmClose(editing.id)}
                      disabled={!!busy}
                      className="px-3 py-2 rounded-xl border text-[10px] font-black text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/30 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition disabled:opacity-50"
                    >
                      Close event
                    </button>
                  )}
                  {terminalStatus(editing.status) && (
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      This event is closed — it is read-only.
                    </span>
                  )}
                  {busy && <Loader2 size={16} className="animate-spin" />}
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
