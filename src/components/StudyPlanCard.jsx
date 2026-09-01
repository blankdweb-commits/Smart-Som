import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { generateDailyPlan } from '../utils/StudyPlanEngine';
import PracticeGenerator from './PracticeGenerator';
import { ArrowRight, BookOpen, Flame, Target, Trophy, Zap } from './Icons';

const ICONS = {
  book: <BookOpen size={16} />,
  flame: <Flame size={16} />,
  target: <Target size={16} />,
  trophy: <Trophy size={16} />,
  zap: <Zap size={16} />
};

const TONES = {
  rose: 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400',
  medical: 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
  indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
  amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
};

const StudyPlanCard = () => {
  const navigate = useNavigate();
  const { learningAnalytics, quizHistory, levelCompletions, studyStats } = useAppContext();

  const plan = useMemo(() => generateDailyPlan({
    quizHistory,
    weakConcepts: learningAnalytics?.weakConcepts || [],
    levelCompletions: levelCompletions || {},
    dayStreak: studyStats?.streak || 0,
    quizStreak: studyStats?.quizStreak || 0
  }), [quizHistory, learningAnalytics?.weakConcepts, levelCompletions, studyStats?.streak, studyStats?.quizStreak]);

  const worstSubject = (learningAnalytics?.weakConcepts || [])[0]?.subject || '';

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
      <div className="flex items-center justify-between mb-1">
        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-1.5">
          <Target size={14} className="text-apex-600" /> Today's Plan
        </h4>
        <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Rule-based coach</span>
      </div>

      <div className="mt-4 space-y-3">
        {plan.map((item) => (
          <button
            key={item.id}
            onClick={() => navigate(item.target)}
            className={`w-full flex items-start gap-3 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-700 text-left transition-all hover:border-slate-200 dark:hover:border-slate-600 hover:shadow-sm group`}
          >
            <span className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${TONES[item.tone] || TONES.indigo}`}>
              {ICONS[item.icon] || <Target size={16} />}
            </span>
            <span className="flex-1 min-w-0">
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-black text-slate-900 dark:text-white tracking-tight block truncate">
                  {item.title}
                </span>
                <ArrowRight size={13} className="shrink-0 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" />
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-snug block mt-0.5 line-clamp-2">
                {item.desc}
              </span>
              <span className="block text-[9px] font-black uppercase tracking-widest text-apex-600 dark:text-apex-400 mt-1.5">
                {item.cta}
              </span>
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
          Based on your real activity
        </p>
        <PracticeGenerator subject={worstSubject} label="Quick Practice" variant="ghost" />
      </div>
    </div>
  );
};

export default StudyPlanCard;