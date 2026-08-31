import React from 'react';
import { computeCurrentIdentity, computeProgressToNext } from '../utils/identityEngine';
import { ChevronRight, Sparkles } from './Icons';

// Compact card showing the user's current identity tier, its emoji, and the
// progress bar toward the next identity. Props:
//   stats: { totalAttempts, quizStreak, cardsStudied, accuracy, scEarned, speedRuns }
//   onView: optional callback when the card is tapped (e.g. open a fuller modal)
const IdentityCard = ({ stats = {}, onView = null }) => {
  const current = computeCurrentIdentity(stats);
  const progress = computeProgressToNext(stats, current);

  return (
    <div
      onClick={onView}
      className="group w-full cursor-pointer bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 text-left transition-all hover:-translate-y-0.5"
      aria-label={`Identity: ${current.name} ${current.emoji}`}
    >
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="text-apex-600" size={16} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Your Identity</p>
      </div>

      <div className="flex items-center gap-4">
        <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${current.color} flex items-center justify-center text-3xl shadow-lg shrink-0`}>
          <span aria-hidden>{current.emoji}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-lg text-slate-900 dark:text-white leading-tight truncate">
            {current.name}
          </p>
          <p className="text-xs text-slate-400 font-medium mt-0.5 line-clamp-1">{current.tagline}</p>
        </div>
        {onView && <ChevronRight size={18} className="text-slate-300 group-hover:text-apex-600 transition-colors shrink-0" />}
      </div>

      {progress && (
        <div className="mt-5">
          <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
            <span className="truncate">Next: {progress.next.name} {progress.next.emoji}</span>
            <span>{progress.fraction}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden border border-slate-50 dark:border-slate-800">
            <div
              className={`h-full bg-gradient-to-r ${progress.next.color} rounded-full transition-[width] duration-700`}
              style={{ width: `${progress.fraction}%` }}
            />
          </div>
          {progress.furthestMetric && progress.furthestMetric.key !== 'accuracy' ? (
            <p className="text-[10px] text-slate-400 font-medium mt-2">
              {progress.furthestMetric.current}/{progress.furthestMetric.target} {progress.furthestMetric.key.replace(/([A-Z])/g, ' $1').toLowerCase().replace('total attempts', 'questions').replace('quiz streak', 'day streak')}
            </p>
          ) : progress.furthestMetric ? (
            <p className="text-[10px] text-slate-400 font-medium mt-2">
              Aim for {progress.furthestMetric.target}% accuracy
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
};

export default IdentityCard;
