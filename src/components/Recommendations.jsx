import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Sparkles, BookOpen, Zap, Target, Award } from './Icons';

// Personalized next-action suggestions derived from the user's current state.
// Props:
//   stats: { questionsToday, accuracy, weakConcepts, dueFlashcards, nearExams,
//            streak, smartCoins, isActivated }
const Recommendations = ({ stats = {} }) => {
  const navigate = useNavigate();
  const recs = React.useMemo(() => {
    const list = [];
    if (stats.nearExams && stats.nearExams.length > 0) {
      list.push({
        icon: <Target className="text-rose-500" />,
        tone: 'bg-rose-50 dark:bg-rose-900/20',
        title: `${stats.nearExams[0].subject} Exam — ${stats.nearExams[0].days}d away`,
        body: `Review ${stats.nearExams[0].subject.toLowerCase()} before the deadline.`,
        label: 'Review',
        to: `/flashcards?subject=${encodeURIComponent(stats.nearExams[0].subject)}`
      });
    }
    if (stats.weakConcepts && stats.weakConcepts.length > 0) {
      list.push({
        icon: <Target className="text-rose-500" />,
        tone: 'bg-rose-50 dark:bg-rose-900/20',
        title: 'Break the weak-concept trend',
        body: `${stats.weakConcepts.length} concept${stats.weakConcepts.length > 1 ? 's' : ''} below 60% accuracy.`,
        label: 'Fix Weakness',
        to: '/quiz?weakness=1'
      });
    }
    if (stats.dueFlashcards > 0) {
      list.push({
        icon: <BookOpen className="text-apex-600" />,
        tone: 'bg-sky-50 dark:bg-sky-900/20',
        title: `${stats.dueFlashcards} card${stats.dueFlashcards > 1 ? 's' : ''} due for review`,
        body: 'Spaced repetition works best the moment cards fall due.',
        label: 'Review Cards',
        to: '/flashcards'
      });
    }
    if (stats.questionsToday === 0) {
      list.push({
        icon: <Zap className="text-amber-500" />,
        tone: 'bg-amber-50 dark:bg-amber-900/20',
        title: 'Restart the momentum',
        body: 'Answer a short set today to keep your streak alive.',
        label: 'Start Quiz',
        to: '/quiz'
      });
    }
    if (stats.streak >= 3 && stats.isActivated) {
      list.push({
        icon: <Award className="text-gold-500" />,
        tone: 'bg-gold-50 dark:bg-gold-900/20',
        title: `You\u2019re on a ${stats.streak}-day streak`,
        body: 'Longer streaks compound into exam confidence.',
        label: 'Keep Going',
        to: '/quiz'
      });
    }
    return list.slice(0, 3);
  }, [stats]);

  if (recs.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-1.5">
        <Sparkles size={14} className="text-apex-600" /> Recommended Next
      </h4>
      <div className="space-y-3">
        {recs.map((rec, i) => (
          <button
            key={i}
            onClick={() => navigate(rec.to)}
            className="w-full flex items-center gap-3 p-3 rounded-2xl text-left transition-all hover:bg-slate-50 dark:hover:bg-slate-700/50 active:scale-[0.99]"
          >
            <div className={`w-10 h-10 rounded-xl ${rec.tone} flex items-center justify-center shrink-0`}>
              {rec.icon}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-slate-900 dark:text-white truncate">{rec.title}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate">{rec.body}</p>
            </div>
            <ArrowRight size={16} className="text-slate-300 shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default Recommendations;
