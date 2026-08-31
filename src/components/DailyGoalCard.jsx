import React from 'react';
import { Target, Flame, Crosshair } from './Icons';

const DAILY_GOAL = 30;

// Daily goal card with an SVG progress ring for today's question target, plus
// mini-stats for streak and accuracy.
const DailyGoalCard = ({ today = {}, streak = 0 }) => {
  const questions = today.questions || 0;
  const accuracy = today.accuracy || 0;
  const pct = Math.min(100, Math.round((questions / DAILY_GOAL) * 100));
  const R = 40;
  const CIRC = 2 * Math.PI * R;
  const offset = CIRC * (1 - pct / 100);
  const done = questions >= DAILY_GOAL;

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-1.5">
        <Target size={14} className="text-apex-600" /> Daily Goal
      </h4>

      <div className="flex items-center gap-5">
        <div className="relative w-24 h-24 shrink-0">
          <svg width="96" height="96" viewBox="0 0 96 96" className="-rotate-90">
            <circle cx="48" cy="48" r={R} fill="none" strokeWidth="10" className="stroke-slate-100 dark:stroke-slate-700" />
            <circle
              cx="48" cy="48" r={R} fill="none" strokeWidth="10" strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={offset}
              className={`transition-all duration-700 ${done ? 'stroke-emerald-500' : 'stroke-apex-600'}`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-black text-slate-900 dark:text-white">{questions}</span>
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">of {DAILY_GOAL}</span>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 gap-3">
          <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-2xl text-center">
            <Flame size={16} className="text-amber-500 mx-auto mb-1" />
            <p className="text-lg font-black text-amber-700 dark:text-amber-400">{streak}d</p>
            <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Streak</p>
          </div>
          <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl text-center">
            <Crosshair size={16} className="text-emerald-500 mx-auto mb-1" />
            <p className="text-lg font-black text-emerald-700 dark:text-emerald-400">{accuracy}%</p>
            <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Accuracy</p>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 font-medium mt-4">
        {done
          ? 'Goal completed. Exceptional focus today! 🎯'
          : `${DAILY_GOAL - questions} more question${DAILY_GOAL - questions === 1 ? '' : 's'} to hit today\u2019s target.`}
      </p>
    </div>
  );
};

export default DailyGoalCard;
