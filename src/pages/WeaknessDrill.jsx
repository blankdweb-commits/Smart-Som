import React, { useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import PracticeGenerator from '../components/PracticeGenerator';
import { questionId } from '../utils/questionMetadata';
import { ALL_BANKS } from '../data/flashcardPools';
import { ArrowRight, BookOpen, CheckCircle, Flame, Loader2, Target } from '../components/Icons';

// Rehydrate a stored attempt with its original bank card (same stable id),
// so the drill shows options/answer references when available.
const findCard = (attempt) => {
  const qid = String(attempt.question_id || '').trim();
  if (!qid) return null;
  return ALL_BANKS.find(c => questionId(c) === qid) || null;
};

const DifficultyBadge = ({ label }) => {
  const tone = {
    Easy: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400',
    Medium: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
    Hard: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
    Expert: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
  }[label] || 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${tone}`}>
      {label || 'General'}
    </span>
  );
};

const WeaknessDrill = () => {
  const { session, fetchFailedQuestions, loadingAuth } = useAppContext();
  const [failed, setFailed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState({});

  useEffect(() => {
    if (!session?.user) {
      setLoading(false);
      return;
    }
    let active = true;
    (async () => {
      const rows = await fetchFailedQuestions();
      if (active) {
        setFailed(rows);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [session?.user, fetchFailedQuestions]);

  // Group by subject, most recent attempt first.
  const groups = useMemo(() => {
    const bySubject = new Map();
    failed.forEach(a => {
      const subj = a.subject || 'General';
      if (!bySubject.has(subj)) bySubject.set(subj, []);
      bySubject.get(subj).push(a);
    });
    return Array.from(bySubject.entries());
  }, [failed]);

  const totalMissed = failed.length;

  if (!session && !loadingAuth) {
    return (
      <div className="min-h-[60vh] max-w-lg mx-auto px-4 pt-14 text-center animate-in fade-in">
        <Flame size={40} className="mx-auto text-rose-500 mb-4" />
        <h1 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-2">Weakness Drill</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">Sign in to review the exact questions you missed.</p>
        <PracticeGenerator subject="" label="Go to Quiz" variant="primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-32 px-4 animate-in fade-in duration-500 space-y-6">
      <header className="text-center pt-4 sm:pt-8">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mb-4">
          <Flame size={26} className="text-rose-500" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Weakness Drill</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
          The exact questions you answered wrong — re-expose them until they stick.
        </p>
      </header>

      <div className="bg-white dark:bg-slate-800 p-5 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Missed questions</p>
          <p className="text-3xl font-black text-rose-500 tracking-tighter">{totalMissed}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">90-day window</p>
          <p className="text-xs font-bold text-slate-500 dark:text-slate-300">Most recent first</p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin" />
          <p className="text-xs font-black uppercase tracking-widest">Loading your misses…</p>
        </div>
      ) : totalMissed === 0 ? (
        <div className="bg-white dark:bg-slate-800 p-10 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-500/10 flex items-center justify-center mb-4">
            <CheckCircle size={26} className="text-emerald-500" />
          </div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Clean slate</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">No wrong answers in the last 90 days — go sharpen the edge anyway.</p>
          <div className="mt-5 flex justify-center">
            <PracticeGenerator subject="" label="Start a Quiz" />
          </div>
        </div>
      ) : (
        groups.map(([subject, rows]) => (
          <div key={subject} className="bg-white dark:bg-slate-800 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-700">
              <div className="flex items-center gap-2">
                <Target size={15} className="text-rose-500" />
                <h2 className="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">{subject}</h2>
              </div>
              <span className="text-[10px] font-black text-slate-400">{rows.length} missed</span>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-700">
              {rows.map((a, idx) => {
                const card = findCard(a);
                const key = `${a.question_id}-${a.created_at}-${idx}`;
                const open = !!revealed[key];
                return (
                  <div key={key} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-snug flex-1">
                        {a.question}
                      </p>
                      <DifficultyBadge label={a.difficulty} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
                      <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">{a.topic || 'General'}</span>
                      <span className="text-slate-200 dark:text-slate-700">•</span>
                      <PracticeGenerator subject={subject} label="Practice" variant="ghost" />
                      {card && (
                        <button
                          onClick={() => setRevealed(prev => ({ ...prev, [key]: !open }))}
                          className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-apex-600 dark:hover:text-apex-400 transition-colors"
                        >
                          <BookOpen size={11} /> {open ? 'Hide Card' : 'Review Card'}
                        </button>
                      )}
                    </div>

                    {card && open && (
                      <div className="mt-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
                        <p className="mb-1"><span className="font-black text-emerald-600 uppercase tracking-widest text-[9px]">Answer · </span>{card.correctAnswer || card.answer}</p>
                        {card.hint && <p className="mb-1"><span className="font-black text-slate-400 uppercase tracking-widest text-[9px]">Hint · </span>{card.hint}</p>}
                        {card.rationale && <p><span className="font-black text-slate-400 uppercase tracking-widest text-[9px]">Rationale · </span>{card.rationale}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-700 flex items-center justify-center">
              <PracticeGenerator subject={subject} label={`Practice ${subject}`} />
            </div>
          </div>
        ))
      )}

      <div className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400">
        <ArrowRight size={12} className="rotate-90" /> Revisit, then clear them on your next quiz
      </div>
    </div>
  );
};

export default WeaknessDrill;