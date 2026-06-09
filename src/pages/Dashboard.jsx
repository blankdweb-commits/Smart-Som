import React from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { BookOpen, Calendar, TrendingUp, Award, Zap, ArrowRight, Star, Clock, Lock, AlertCircle, Brain, Target, ChevronRight } from '../components/Icons';
import { differenceInDays } from 'date-fns';
import FeeDashboardWidget from '../components/FeeDashboardWidget';
import DailyChallengeWidget from '../components/DailyChallengeWidget';
import { motion } from 'framer-motion';

const Dashboard = () => {
  const DEV_MODE = true;
  const { flashcards = [], exams = [], studyStats = {}, userProfile = {}, session, loadingAuth, learningAnalytics = {} } = useAppContext();
  const navigate = useNavigate();

  const subjectProgress = React.useMemo(() => {
    const stats = {};
    const safeFlashcards = Array.isArray(flashcards) ? flashcards : [];
    safeFlashcards.forEach(card => {
      if (!card) return;
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

  const upcomingExams = (Array.isArray(exams) ? exams : [])
    .filter(e => e && e.date && new Date(e.date) >= new Date())
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const dueFlashcards = (Array.isArray(flashcards) ? flashcards : []).filter(c => {
    if (!c) return false;
    if (!c.srs?.nextReview) return true;
    return new Date(c.srs.nextReview) <= new Date();
  });

  const studyTips = [
    "Use the 'Shuffle' mode for flashcards to improve long-term retention.",
    "Focus on 'High-Yield' topics during the last 3 days before an exam.",
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

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % studyTips.length);
    }, 10000);
    return () => clearInterval(interval);
  }, [studyTips.length]);

  return (
    <div className="relative space-y-6 sm:space-y-8 pb-32 animate-in fade-in duration-700 max-w-5xl mx-auto px-1 sm:px-0 overflow-x-hidden min-h-[100dvh]">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="w-full">
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">Apex Scholars</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm sm:text-base">Institutional Productivity Hub • {userProfile.level || 'Scholar'}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <FeeDashboardWidget />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DailyChallengeWidget />
            <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-800 flex flex-col justify-between">
              <div>
                <h3 className="text-lg font-black flex items-center gap-2 text-slate-900 dark:text-white uppercase tracking-tight">
                  <Target className="text-red-500" size={20} /> Attention Required
                </h3>
              </div>
              <div className="mt-4 space-y-3">
                {(learningAnalytics?.weakTopics || []).length > 0 ? (learningAnalytics.weakTopics.map((topic, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{topic.name}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-black">{topic.subject}</p>
                    </div>
                    <span className="text-xs font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">{topic.count} errors</span>
                  </div>
                ))) : (
                   <div className="py-4 text-center">
                      <p className="text-xs text-slate-400 italic">Keep studying to track weak spots!</p>
                   </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatsCard title="Vault" value={(flashcards || []).length} icon={<BookOpen className="text-apex-600" />} color="bg-white dark:bg-slate-800" />
            <StatsCard title="Mastery" value={studyStats.cardsStudied || 0} icon={<TrendingUp className="text-emerald-500" />} color="bg-white dark:bg-slate-800" />
            <StatsCard title="Streak" value={`${studyStats.streak || 0}d`} icon={<Award className="text-amber-500" />} color="bg-white dark:bg-slate-800" />
            <StatsCard title="Due" value={(dueFlashcards || []).length} icon={<Clock className="text-red-500" />} color="bg-white dark:bg-slate-800" />
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
                      <motion.div initial={{ width: 0 }} animate={{ width: `${sub.percent}%` }} className="h-full bg-apex-600 rounded-full" />
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 italic">No progress data yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-8">
           <div className="bg-apex-600 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
              <Award size={120} />
            </div>
            <h3 className="text-xl font-black mb-6 relative z-10 uppercase tracking-tight">Clinical Reference</h3>
            <div className="space-y-4 relative z-10">
              {quickReference.slice(0, 4).map((ref, i) => (
                <div key={i} className="flex justify-between items-center bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/10">
                  <p className="text-[10px] uppercase font-black text-white/70 tracking-widest">{ref.label}</p>
                  <p className="text-sm font-black tracking-tight">{ref.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatsCard = React.memo(({ title, value, icon, color }) => (
  <div className={`p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 ${color} flex flex-col items-center justify-center text-center space-y-1 sm:space-y-2 group transition-all hover:-translate-y-1`}>
    <div className="p-2 sm:p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl sm:rounded-2xl mb-1 group-hover:scale-110 transition-transform">
      {React.cloneElement(icon, { size: 20 })}
    </div>
    <div>
      <p className="text-[9px] sm:text-[10px] text-slate-400 font-black uppercase tracking-widest">{title}</p>
      <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tighter mt-0.5">{value}</p>
    </div>
  </div>
));

export default Dashboard;
