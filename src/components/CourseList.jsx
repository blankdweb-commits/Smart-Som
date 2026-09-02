import { useEffect, useMemo, useState } from 'react';
import { Clock, Lock, Sparkles, CheckCircle2, Timer } from './Icons';

// Ticking countdown that re-renders every second until `until` passes.
// Mounted only while a cooldown is actually active (see CooldownChip).
const useCountdown = (untilIso) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!untilIso) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [untilIso]);
  return useMemo(() => {
    if (!untilIso) return 0;
    const remaining = Math.max(0, Math.ceil((new Date(untilIso).getTime() - now) / 1000));
    return remaining;
  }, [untilIso, now]);
};

const formatRemaining = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// Rendered ONLY during an active cooldown, so the ticking hook is always
// called in the same order for the component instances that exist.
const CooldownChip = ({ untilIso, label }) => {
  const remaining = useCountdown(untilIso);
  if (remaining <= 0) return null; // freshly expired — render nothing
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest tabular-nums">
      <Timer size={11} /> {label || 'Next round'} · {formatRemaining(remaining)}
    </span>
  );
};

const StatusChip = ({ premium, ready, untilIso, label }) => {
  if (premium) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest">
        <Sparkles size={11} /> Unlimited
      </span>
    );
  }
  if (ready || !untilIso) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[9px] font-black uppercase tracking-widest">
        <CheckCircle2 size={11} /> Ready
      </span>
    );
  }
  return <CooldownChip untilIso={untilIso} label={label} />;
};

// Composite server-side course keys:
//   - Clinical / Quick Quiz are per EXAM SOURCE (nmcn | nclex | both). The
//     selector "both" is the default shown on the parent row.
//   - 200-Level banks are per SUBJECT (<courseId>:<subject>).
//   - Uselu / Weakness / Daily Challenge use the bare course id.
const statusKey = (courseId, subject) => {
  if (subject) return `${courseId}:${subject}`;
  if (courseId === 'clinical-challenge' || courseId === 'quick-quiz') return `${courseId}:both`;
  return courseId;
};

// Returns { premium, ready, untilIso } for a row. Server-authoritative: we only
// render what the RPC returned; absence = never used = ready.
const rowStatus = (courseId, subject, courseQuota) => {
  const row = (courseQuota || {})[statusKey(courseId, subject)] || null;
  if (!row) return { ready: true, untilIso: null };
  if (row.is_ready === true) return { ready: true, untilIso: null };
  return { ready: false, untilIso: row.window_expires_at || null };
};

const CourseList = ({ courses, onLaunch, premium, courseQuota }) => {
  return (
    <div className="space-y-6">
      {/* Plan banner */}
      <div className={`rounded-2xl sm:rounded-3xl border p-4 sm:p-5 flex items-center justify-between gap-3 ${premium ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/5 border-amber-500/30'}`}>
        <div className="flex items-center gap-3">
          {premium ? <Sparkles size={18} className="text-emerald-500 shrink-0" /> : <Clock size={18} className="text-amber-500 shrink-0" />}
          <div>
            <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">{premium ? 'Premium Plan' : 'Free Plan'}</p>
            <p className={`text-xs sm:text-sm font-black ${premium ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
              {premium ? 'Unlimited practice — no cooldowns' : '10 questions per round · new round every hour (per course)'}
            </p>
          </div>
        </div>
        {premium && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-600 dark:text-emerald-300 text-[9px] font-black uppercase tracking-widest">
            🟢 Unlimited
          </span>
        )}
      </div>

      {/* Course sections */}
      {courses.map((course) => {
        const subjects = Array.isArray(course.subjects) ? course.subjects : [];
        // Parent row status: for subject-bearing banks this is the aggregate —
        // Ready if ANY subject is ready, else the soonest-expiring cooldown.
        const parentRows = subjects.map(s => rowStatus(course.id, s, courseQuota));
        const parentReady = subjects.length === 0
          ? rowStatus(course.id, null, courseQuota).ready
          : parentRows.some(r => r.ready);
        const parentUntil = subjects.length === 0
          ? rowStatus(course.id, null, courseQuota).untilIso
          : (parentReady
              ? null
              : parentRows.filter(r => r.untilIso).sort((a, b) => new Date(a.untilIso) - new Date(b.untilIso))[0]?.untilIso || null);

        return (
          <div key={course.id} className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden">
            {/* Parent mode card / section header */}
            <button
              onClick={() => onLaunch(course.id)}
              className="w-full flex items-center gap-4 p-4 sm:p-5 text-left group transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40"
            >
              <div className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 ${course.color.icon}`}>
                {course.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight group-hover:translate-x-1 transition-transform">
                  {course.title}
                </h3>
                <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm font-medium leading-snug line-clamp-2">{course.desc}</p>
              </div>
              <StatusChip
                premium={premium}
                ready={parentReady}
                untilIso={parentUntil}
                label="Next round"
              />
            </button>

            {/* Per-subject rows (200-level banks) — each row has its OWN course key */}
            {subjects.length > 0 && (
              <div className="border-t border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700">
                {subjects.map((s) => {
                  const st = rowStatus(course.id, s, courseQuota);
                  return (
                    <button
                      key={s}
                      onClick={() => onLaunch(course.id, s)}
                      className="w-full flex items-center gap-3 px-4 sm:px-6 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/40 group/subj"
                    >
                      <span className="text-[10px] font-black text-slate-400 group-hover/subj:text-medical-500 transition-colors">›</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 tracking-tight group-hover/subj:translate-x-0.5 transition-transform">
                          {s}
                        </span>
                      </span>
                      <StatusChip
                        premium={premium}
                        ready={st.ready}
                        untilIso={st.untilIso}
                        label="Next round"
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Free plan note */}
      {!premium && (
        <p className="text-center text-[9px] font-bold uppercase tracking-widest text-slate-400 flex items-center justify-center gap-1.5">
          <Lock size={10} className="shrink-0" /> Some content requires a Premium plan to unlock
        </p>
      )}
    </div>
  );
};

export default CourseList;