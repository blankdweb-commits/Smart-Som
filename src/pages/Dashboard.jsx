import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { BookOpen, Calendar, TrendingUp, Award, Zap, ArrowRight, Star, Clock } from '../components/Icons';
import { format, differenceInDays } from 'date-fns';
import FeeDashboardWidget from '../components/FeeDashboardWidget';
import { motion } from 'framer-motion';

const Dashboard = () => {
  const { flashcards, exams, studyStats, userProfile } = useAppContext();
  const navigate = useNavigate();

  const subjectProgress = React.useMemo(() => {
    const stats = {};
    flashcards.forEach(card => {
      const sub = card.subject || 'General';
      if (!stats[sub]) {
        stats[sub] = { total: 0, learned: 0 };
      }
      stats[sub].total += 1;
      if (card.srs?.reps > 0) {
        stats[sub].learned += 1;
      }
    });
    return Object.entries(stats)
      .map(([name, data]) => ({ name, ...data, percent: Math.round((data.learned / data.total) * 100) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [flashcards]);

  const upcomingExams = exams
    .filter(e => new Date(e.date) >= new Date())
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const nearExams = upcomingExams.filter(e => {
    const daysLeft = differenceInDays(new Date(e.date), new Date());
    return daysLeft >= 0 && daysLeft <= 3;
  });

  const immediateExam = upcomingExams[0];
  const isExamSoon = nearExams.length > 0;

  const dueFlashcards = flashcards.filter(c => {
    if (!c.srs?.nextReview) return true;
    return new Date(c.srs.nextReview) <= new Date();
  });

  const studyTips = [
    "Use the 'Shuffle' mode for flashcards to improve long-term retention.",
    "Focus on 'High-Yield' topics during the last 3 days before an exam.",
    "Break down long medical terms into syllables to master their pronunciation.",
    "Maintain a daily study streak to build consistent learning habits."
  ];

  const [currentTip, setCurrentTip] = React.useState(0);

  const quickReference = [
    { label: "Normal BP", value: "120/80 mmHg" },
    { label: "Normal HR", value: "60-100 bpm" },
    { label: "Normal Temp", value: "36.5-37.5 °C" },
    { label: "Oxygen Sat", value: "95-100%" },
    { label: "Blood pH", value: "7.35-7.45" }
  ];

  const tipsCount = studyTips.length;
  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % tipsCount);
    }, 10000);
    return () => clearInterval(interval);
  }, [tipsCount]);

  return (
    <div className="space-y-8 pb-32 animate-in fade-in duration-700 max-w-5xl mx-auto">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Apex Scholars</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Institutional Productivity Hub • {userProfile.level}</p>
        </div>
        <div className="flex gap-3">
           <button
            onClick={() => navigate('/flashcards')}
            className="p-4 bg-white dark:bg-slate-800 rounded-[1.5rem] shadow-soft border border-slate-100 dark:border-slate-700 hover:text-apex-600 transition-all"
           >
             <Zap size={24} />
           </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <FeeDashboardWidget />

          {isExamSoon && (
            <div className="space-y-4">
              {nearExams.map((exam, idx) => {
                const days = differenceInDays(new Date(exam.date), new Date());
                const subject = exam.title.split(' ')[0];
                return (
                  <motion.div
                    key={exam.id}
                    initial={{ x: -20, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: idx * 0.1 }}
                    className={`p-6 rounded-[2rem] text-white shadow-xl relative overflow-hidden group ${days === 0 ? 'bg-red-600' : 'bg-slate-900'}`}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 p-4 opacity-10">
                      <AlertCircle size={80} />
                    </div>
                    <div className="relative z-10 flex flex-col sm:flex-row justify-between items-center gap-6">
                      <div className="space-y-1 text-center sm:text-left">
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-60">
                          {days === 0 ? 'Happening Now' : `${days} Day${days > 1 ? 's' : ''} Remaining`}
                        </p>
                        <h3 className="text-2xl font-black tracking-tight">{exam.title}</h3>
                        <p className="text-white/60 text-xs font-medium italic">
                          {days === 0 ? 'Final push! Open your cards now.' : `Review ${subject} mastery before the deadline.`}
                        </p>
                      </div>
                      <button
                        onClick={() => navigate(`/flashcards?subject=${encodeURIComponent(subject)}`)}
                        className="px-6 py-3 bg-white text-slate-900 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all flex items-center gap-2 whitespace-nowrap"
                      >
                        Revise Now <ArrowRight size={14} />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatsCard title="Vault" value={flashcards.length} icon={<BookOpen className="text-apex-600" />} color="bg-white dark:bg-slate-800" />
            <StatsCard title="Mastery" value={studyStats.cardsStudied} icon={<TrendingUp className="text-emerald-500" />} color="bg-white dark:bg-slate-800" />
            <StatsCard title="Streak" value={`${studyStats.streak}d`} icon={<Award className="text-amber-500" />} color="bg-white dark:bg-slate-800" />
            <StatsCard title="Due" value={dueFlashcards.length} icon={<Clock className="text-red-500" />} color="bg-white dark:bg-slate-800" />
          </div>

          <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
            <h3 className="text-xl font-black mb-8 flex items-center text-slate-900 dark:text-white uppercase tracking-tight">
              <Star className="mr-3 text-apex-600" size={20} />
              Subject Mastery
            </h3>
            <div className="space-y-6">
              {subjectProgress.length > 0 ? (
                subjectProgress.map(sub => (
                  <div key={sub.name}>
                    <div className="flex justify-between text-[10px] font-black mb-2 uppercase tracking-[0.2em] text-slate-400">
                      <span className="truncate max-w-[200px]">{sub.name}</span>
                      <span>{sub.percent}% learned</span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden p-0.5 border border-slate-50 dark:border-slate-800">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${sub.percent}%` }}
                        className="h-full bg-apex-600 rounded-full"
                      />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 italic">Activate learning mode to track subject progress.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-8">
           <div className="bg-apex-600 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
              <Award size={120} />
            </div>
            <h3 className="text-xl font-black mb-6 flex items-center relative z-10 uppercase tracking-tight">
              Clinical Reference
            </h3>
            <div className="space-y-4 relative z-10">
              {quickReference.slice(0, 4).map((ref, i) => (
                <div key={i} className="flex justify-between items-center bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10 transition-colors hover:bg-white/20">
                  <p className="text-[10px] uppercase font-black text-white/70 tracking-widest">{ref.label}</p>
                  <p className="text-sm font-black tracking-tight">{ref.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
             <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Apex Mindset</h4>
             <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-[1.5rem] border border-slate-100 dark:border-slate-800 min-h-[120px] flex items-center">
                <p className="text-slate-600 dark:text-slate-300 italic font-medium leading-relaxed tracking-tight">"{studyTips[currentTip]}"</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatsCard = ({ title, value, icon, color }) => (
  <div className={`p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 ${color} flex flex-col items-center justify-center text-center space-y-2 group transition-all hover:-translate-y-1`}>
    <div className="p-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl mb-1 group-hover:scale-110 transition-transform">
      {icon}
    </div>
    <div>
      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{title}</p>
      <p className="text-xl font-black text-slate-900 dark:text-white tracking-tighter mt-0.5">{value}</p>
    </div>
  </div>
);

export default Dashboard;
