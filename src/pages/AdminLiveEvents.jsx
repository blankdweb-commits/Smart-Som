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
} from '../utils/liveEventsApi';
import { Shield, Users, Calendar, Clock, Plus, RefreshCw, Loader2, Edit2, X } from '../components/Icons';
import { Link } from 'react-router-dom';

const fmtClock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function AdminLiveEvents() {
  const { userProfile, session } = useAppContext();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
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
        if (!cancelled) setError(err.message || 'Failed to load events');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, [session]);

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
      start_at: e.start_at ? new Date(e.start_at).toISOString().slice(0, 16) : '',
      end_at: e.end_at ? new Date(e.end_at).toISOString().slice(0, 16) : '',
      status: e.status_raw || e.status,
    });
    setOpen(true);
  };

  const closeForm = () => { setOpen(false); setEditing(null); };

  const save = async (ev) => {
    ev.preventDefault();
    setBusy('save');
    try {
      let res;
      if (editing) {
        res = await updateLiveEvent(session, editing.id, {
          title: form.title,
          description: form.description,
          cover_url: form.cover_url || undefined,
          start_at: form.start_at || undefined,
          end_at: form.end_at || undefined,
          status: form.status,
        });
      } else {
        res = await createLiveEvent(session, {
          title: form.title,
          description: form.description,
          cover_url: form.cover_url || undefined,
          start_at: form.start_at || undefined,
          end_at: form.end_at || undefined,
          status: form.status,
        });
      }
      if (!res.ok) { setError(res.error || 'Failed to save event'); return; }
      setOpen(false);
      setEditing(null);
      setError(null);
    } catch (err) {
      setError(err.message || 'Failed to save event');
    } finally {
      setBusy(false);
    }
  };

  const transition = async (fn, label) => {
    setBusy(label);
    try {
      const res = await fn(session, editing?.id || null);
      if (!res.ok) { setError(res.error || `Failed to ${label}`); return; }
      setError(null);
    } catch (err) {
      setError(err.message || `Failed to ${label}`);
    } finally {
      setBusy(false);
    }
  };

  const confirmClose = async () => {
    if (!window.confirm('Close this event? It stays readable but no new messages or actions can be added.')) return;
    await transition(() => closeLiveEvent(session, editing.id), 'close');
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
        <div className="mb-6 rounded-2xl border border-rose-200 dark:border-rose-900/30 bg-rose-50 dark:bg-rose-900/10 p-3 text-rose-700 dark:text-rose-400 font-black text-sm">
          {error}
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
                          className="px-2.5 py-1.5 rounded border text-[9px] font-black text-polynurse-600 hover:bg-polynurse-50 dark:hover:bg-polynurse-900/30 transition"
                          title="Edit"
                        >
                          <Edit2 size={13} />
                        </button>
                      )}
                      {!busy && e.status === 'live' && (
                        <button
                          type="button"
                          onClick={confirmClose}
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
                  onChange={(e) => setForm({ ...form, start_at: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">Ends at</label>
                <input
                  type="datetime-local"
                  value={form.end_at}
                  onChange={(e) => setForm({ ...form, end_at: e.target.value })}
                  className="w-full border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-polynurse-600 focus:border-transparent"
                />
              </div>
            </div>
            {busy === 'save' && <Loader2 size={16} className="animate-spin mx-auto" />}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeForm} className="px-4 py-2 rounded-xl text-[10px] font-black text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/50">Cancel</button>
              <button type="submit" disabled={busy === 'save'} className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-polynurse-600 text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500">
                {editing ? 'Save changes' : 'Create event'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Quick actions row for the selected event */}
      {editing && (
        <div className="mt-6 rounded-2xl border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 p-4">
          <h2 className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
            <Users size={14} /> Actions for “{editing.title}”
          </h2>
          <div className="flex flex-wrap gap-2">
            {editing.status === 'draft' && (
              <>
                <button
                  type="button"
                  onClick={() => transition(() => publishLiveEvent(session, editing.id), 'publish')}
                  disabled={busy === 'publish'}
                  className="px-3 py-2 rounded-xl border text-[10px] font-black text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/30 hover:bg-amber-50 dark:hover:bg-amber-900/10 transition"
                >
                  Publish (schedule)
                </button>
              </>
            )}
            {editing.status === 'scheduled' && (
              <>
                <button
                  type="button"
                  onClick={() => transition(() => startLiveEvent(session, editing.id), 'start')}
                  disabled={busy === 'start'}
                  className="px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wider hover:bg-emerald-700 transition"
                >
                  Start (go live)
                </button>
                <button
                  type="button"
                  onClick={() => transition(() => cancelLiveEvent(session, editing.id), 'cancel')}
                  disabled={busy === 'cancel'}
                  className="px-3 py-2 rounded-xl border text-[10px] font-black text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/30 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition"
                >
                  Cancel
                </button>
              </>
            )}
            {editing.status === 'live' && (
              <button
                type="button"
                onClick={confirmClose}
                disabled={busy === 'close'}
                className="px-3 py-2 rounded-xl border text-[10px] font-black text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/30 hover:bg-rose-50 dark:hover:bg-rose-900/10 transition"
              >
                Close event
              </button>
            )}
            {busy && <Loader2 size={16} className="animate-spin" />}
          </div>
        </div>
      )}
    </div>
  );
}
