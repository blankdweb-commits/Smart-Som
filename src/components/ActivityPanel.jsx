import React, { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Sparkles, Loader2, RefreshCw } from './Icons';

const fmtWhen = (iso) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
};

const ActivityPanel = ({ onOpenProfile }) => {
  const { supabase } = useAppContext();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('social_activity_feed', {
        p_limit: 40, p_offset: 0,
      });
      if (rpcError) throw rpcError;
      if (!data || data.ok === false) throw new Error(data?.error || 'Could not load activity');
      setItems(Array.isArray(data.activity) ? data.activity : []);
    } catch (err) {
      console.warn('[activity] load:', err?.message);
      setError('Could not load activity right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          {items.length ? `${items.length} recent event${items.length === 1 ? '' : 's'}` : 'Recent activity'}
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold rounded-2xl px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin text-polynurse-600" />
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-10 text-center">
          <Sparkles className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={44} />
          <p className="text-slate-500 dark:text-slate-400 font-bold">
            Nothing yet. Quizzes, duels, streaks and rank climbs from you and your
            scholars will appear here.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => {
            const who = it.scope === 'you' ? 'You' : it.name || 'A scholar';
            return (
              <li
                key={it.id}
                className="flex items-start gap-3 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-clinical"
              >
                <span className="w-10 h-10 shrink-0 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center text-lg" aria-hidden="true">
                  {it.emoji || <Sparkles size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-900 dark:text-white break-words">
                    {it.title || 'Activity'}
                  </p>
                  {it.detail && (
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-0.5 break-words">
                      {it.detail}
                    </p>
                  )}
                  <p className="text-[10px] font-bold text-slate-400 mt-1">
                    {it.scope === 'you' ? 'You' : who}
                    {' \u00b7 '}
                    {fmtWhen(it.occurredAt)}
                  </p>
                </div>
                {it.scope !== 'you' && onOpenProfile && (
                  <button
                    onClick={() => onOpenProfile({ userId: it.userId, displayName: who })}
                    aria-label={`Open ${who}'s profile`}
                    className="shrink-0 rounded-full border border-slate-200 dark:border-slate-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 transition hover:border-polynurse-300"
                  >
                    View
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ActivityPanel;
