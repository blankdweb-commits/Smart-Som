import React, { useMemo, useState } from 'react';
import { Bell, X, Flame, Calendar, Target, Sparkles } from './Icons';
import { useAppContext } from '../context/AppContext';
import { differenceInDays } from 'date-fns';
import { safeGet, safeSet } from '../utils/safeStorage';

const CACHE_KEY = 'apex:notifDismissed';

const loadDismissed = () => {
  const raw = safeGet(CACHE_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
};
const saveDismissed = (set) => {
  safeSet(CACHE_KEY, JSON.stringify([...set]));
};

function uid() {
  return `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// Builds contextual, non-spammy notifications from the user's live state.
function buildNotifications({ exams, studyStats, learningAnalytics, identity }) {
  const list = [];

  if (studyStats.streak >= 3) {
    list.push({
      key: uid(),
      kind: 'streak',
      icon: <Flame className="text-amber-500" />,
      title: `You\u2019re on a ${studyStats.streak}-day streak`,
      body: 'Keep it alive — consistent review compounds into exam confidence.'
    });
  }

  const near = (exams || [])
    .map(e => ({ e, days: differenceInDays(new Date(e.date), new Date()) }))
    .filter(({ days }) => days >= 0 && days <= 3)
    .sort((a, b) => a.days - b.days)[0];
  if (near) {
    list.push({
      key: uid(),
      kind: 'exam',
      icon: <Calendar className="text-rose-500" />,
      title: near.days === 0 ? `${near.e.title} is today` : `${near.e.title} in ${near.days} day${near.days > 1 ? 's' : ''}`,
      body: 'Review the high-yield topics and rationales before the deadline.'
    });
  }

  const weak = (learningAnalytics.weakConcepts || []).slice(0, 3);
  if (weak.length > 0) {
    list.push({
      key: uid(),
      kind: 'weak',
      icon: <Target className="text-rose-500" />,
      title: `${weak.length} concept${weak.length > 1 ? 's' : ''} need attention`,
      body: 'These are below 60% accuracy — a targeted quiz would turn them around.'
    });
  }

  if (identity && identity.tier <= 1) {
    list.push({
      key: uid(),
      kind: 'welcome',
      icon: <Sparkles className="text-apex-500" />,
      title: `Welcome aboard, ${identity.name} ${identity.emoji}`,
      body: 'Answer 25 questions to unlock your first identity tier.'
    });
  }

  return list.slice(0, 4);
}

const NotificationBell = () => {
  const { exams, studyStats, learningAnalytics, identity } = useAppContext();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => loadDismissed());

  const notifications = useMemo(
    () => buildNotifications({ exams, studyStats, learningAnalytics, identity }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exams, studyStats?.streak, learningAnalytics?.weakConcepts, identity?.tier]
  );

  const visible = notifications.filter(n => !dismissed.has(n.key));
  const hasUnread = visible.length > 0;

  const dismiss = (key) => {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    saveDismissed(next);
  };

  const dismissAll = () => {
    const next = new Set(dismissed);
    visible.forEach(n => next.add(n.key));
    setDismissed(next);
    saveDismissed(next);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={hasUnread ? `${visible.length} notifications` : 'Notifications'}
        className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <Bell size={20} />
        {hasUnread && (
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-12 z-[75] w-80 sm:w-96 bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Notifications</p>
              {visible.length > 0 && (
                <button onClick={dismissAll} className="text-[10px] font-black uppercase tracking-widest text-apex-600 hover:text-apex-700">
                  Clear all
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mx-auto mb-3">
                    <Bell size={20} className="text-slate-400" />
                  </div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-bold">You\u2019re all caught up</p>
                  <p className="text-xs text-slate-400 font-medium mt-1">Nothing needs your attention right now.</p>
                </div>
              ) : (
                visible.map(n => (
                  <div key={n.key} className="flex items-start gap-3 px-4 py-3 border-b border-slate-50 dark:border-slate-700/60">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
                      {n.icon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-slate-900 dark:text-white leading-tight">{n.title}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5 leading-snug">{n.body}</p>
                    </div>
                    <button onClick={() => dismiss(n.key)} aria-label="Dismiss notification" className="text-slate-300 hover:text-slate-500 p-1 shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationBell;
