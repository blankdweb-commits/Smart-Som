import React from 'react';
import { useAppContext } from '../context/AppContext';
import { BookOpen, Calendar, TrendingUp, Award } from 'lucide-react';
import { format, differenceInDays } from 'date-fns';

const Dashboard = () => {
  const { flashcards, exams, studyStats } = useAppContext();

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

  const levelProgress = React.useMemo(() => {
    const levels = ['Year 1', 'Year 2', 'Year 3', 'Professional'];
    return levels.map(level => {
      const cards = flashcards.filter(c => c.level === level);
      const total = cards.length;
      const learned = cards.filter(c => c.srs?.reps > 0).length;
      return {
        level,
        total,
        learned,
        percent: total > 0 ? Math.round((learned / total) * 100) : 0
      };
    });
  }, [flashcards]);

  const upcomingExams = exams
    .filter(e => new Date(e.date) >= new Date())
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const immediateExam = upcomingExams[0];
  const isExamSoon = immediateExam &&
    (new Date(immediateExam.date).getTime() - new Date().getTime()) / (1000 * 3600 * 24) <= 2;

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
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-2 duration-700">
      <header>
        <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Dashboard</h2>
        <p className="text-slate-600 dark:text-slate-400">Welcome back to your nursing study portal.</p>

        {isExamSoon && (
          <div className="mt-4 p-5 bg-white dark:bg-slate-800 border border-red-100 dark:border-red-900/30 rounded-[2rem] flex flex-col sm:flex-row items-center justify-between gap-4 shadow-clinical">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-red-50 dark:bg-red-900/20 rounded-2xl flex items-center justify-center text-red-600 relative overflow-hidden group">
                <div className="absolute inset-0 bg-red-500/10 animate-pulse" />
                <Calendar size={28} className="relative z-10" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] font-black uppercase tracking-widest rounded-full">Urgent Alert</span>
                  <p className="text-red-600 dark:text-red-400 font-black text-xs uppercase tracking-widest">Exam Approaching</p>
                </div>
                <h4 className="text-slate-800 dark:text-white font-black text-lg mt-0.5">
                  {immediateExam.title}
                </h4>
                <p className="text-slate-400 text-xs font-bold uppercase tracking-tight">
                  Scheduled for {format(new Date(immediateExam.date), 'EEEE, MMM dd')} at {immediateExam.time}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto">
              <div className="hidden md:block text-right mr-2">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Time Remaining</p>
                <p className="text-sm font-black text-red-500 uppercase tracking-tighter">
                  {differenceInDays(new Date(immediateExam.date), new Date()) === 0 ? 'Today!' : `${differenceInDays(new Date(immediateExam.date), new Date())} Days Left`}
                </p>
              </div>
              <a
                href="/exams"
                className="flex-1 sm:flex-none px-6 py-3 bg-red-600 hover:bg-red-700 text-white text-xs font-black uppercase tracking-widest rounded-xl shadow-lg shadow-red-600/20 transition-all active:scale-95 text-center"
              >
                Launch Revision
              </a>
            </div>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Curriculum Decks" value={flashcards.length} icon={<BookOpen className="text-blue-500" />} color="bg-blue-50 dark:bg-blue-900/20" />
        <StatsCard title="Cards Studied" value={studyStats.cardsStudied} icon={<TrendingUp className="text-green-500" />} color="bg-green-50 dark:bg-green-900/20" />
        <StatsCard title="Study Streak" value={`${studyStats.streak} Days`} icon={<Award className="text-orange-500" />} color="bg-orange-50 dark:bg-orange-900/20" />
        <StatsCard title="Due for Review" value={dueFlashcards.length} icon={<Award className="text-amber-500" />} color="bg-amber-50 dark:bg-amber-900/20" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 space-y-4 sm:space-y-6">
          {/* Quick Reference Section */}
          <div className="bg-medical-600 rounded-2xl p-6 text-white shadow-lg overflow-hidden relative group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
            <h3 className="text-lg font-bold mb-4 flex items-center">
              <Award className="mr-2" size={20} />
              Clinical Quick Reference
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4 relative z-10">
              {quickReference.map((ref, i) => (
                <div key={i} className="bg-white/10 backdrop-blur-md p-3 rounded-xl border border-white/20">
                  <p className="text-[10px] uppercase font-black opacity-70 tracking-tighter">{ref.label}</p>
                  <p className="text-sm font-bold mt-1">{ref.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
            <h3 className="text-xl font-semibold mb-6 flex items-center text-slate-800 dark:text-white">
              <TrendingUp className="mr-2 text-medical-600" size={20} />
              Subject Mastery
            </h3>
            <div className="space-y-5">
              {subjectProgress.length > 0 ? (
                subjectProgress.map(sub => (
                  <div key={sub.name}>
                    <div className="flex justify-between text-xs font-bold mb-1 uppercase tracking-wider text-slate-500">
                      <span className="truncate max-w-[200px]">{sub.name}</span>
                      <span>{sub.percent}%</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-medical-500 rounded-full transition-all duration-500" style={{ width: `${sub.percent}%` }}></div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 italic">Start studying to see subject progress.</p>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
            <h3 className="text-xl font-semibold mb-6 flex items-center text-slate-800 dark:text-white">
              <TrendingUp className="mr-2 text-indigo-600" size={20} />
              Detailed Performance Analytics
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {levelProgress.map(lp => (
                <div key={lp.level} className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-sm font-black text-slate-700 dark:text-slate-300 uppercase tracking-widest">{lp.level} Mastery</span>
                    <span className={`text-xs font-black px-2 py-1 rounded-lg ${lp.percent > 70 ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      {lp.percent}%
                    </span>
                  </div>
                  <div className="w-full h-3 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-1000"
                      style={{ width: `${lp.percent}%` }}
                    />
                  </div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">
                    {lp.learned} of {lp.total} high-yield concepts mastered
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
            <h3 className="text-xl font-semibold mb-4 flex items-center text-slate-800 dark:text-white">
              <Calendar className="mr-2 text-medical-600" size={20} />
              Upcoming Exams
            </h3>
            <div className="space-y-3">
              {upcomingExams.length > 0 ? upcomingExams.map(exam => (
                <div key={exam.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                  <div>
                    <p className="font-medium text-slate-800 dark:text-white text-sm">{exam.title}</p>
                    <p className="text-xs text-slate-500">{new Date(exam.date).toLocaleDateString()}</p>
                  </div>
                  <span className="text-[10px] px-2 py-1 bg-medical-100 text-medical-700 dark:bg-medical-900/40 dark:text-medical-300 rounded-full font-bold uppercase tracking-wider">Upcoming</span>
                </div>
              )) : (
                <p className="text-slate-500 italic text-sm">No upcoming exams scheduled.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-amber-100 dark:border-amber-900/30">
            <h3 className="text-lg font-bold mb-4 flex items-center text-amber-600">
              <Award className="mr-2" size={18} />
              Study Hub
            </h3>

            {dueFlashcards.length > 0 ? (
              <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800">
                <p className="text-amber-800 dark:text-amber-300 font-bold text-xs uppercase mb-1">Review Needed</p>
                <p className="text-amber-700 dark:text-amber-400 text-sm mb-3">You have {dueFlashcards.length} cards due.</p>
                <a href="/flashcards" className="inline-block w-full py-2 bg-amber-500 text-white text-center text-xs font-bold rounded-lg hover:bg-amber-600 transition-colors">Start Review Now</a>
              </div>
            ) : (
              <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-800">
                <p className="text-green-800 dark:text-green-300 font-bold text-xs uppercase">All Caught Up!</p>
              </div>
            )}

            <h4 className="text-xs font-bold text-slate-400 uppercase mb-3">Tip of the Day</h4>
            <div className="p-4 bg-medical-50 dark:bg-medical-900/20 rounded-xl border border-medical-100 dark:border-medical-800 h-24 flex items-center">
              <p className="text-medical-800 dark:text-medical-300 italic text-sm leading-relaxed">"{studyTips[currentTip]}"</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatsCard = ({ title, value, icon, color }) => (
  <div className={`p-5 rounded-xl shadow-sm ${color} flex items-center border border-white/10`}>
    <div className="p-2 bg-white dark:bg-slate-800 rounded-lg mr-4 shadow-sm">
      {icon}
    </div>
    <div>
      <p className="text-xs text-slate-500 dark:text-slate-400 font-medium uppercase tracking-wider">{title}</p>
      <p className="text-xl font-bold text-slate-800 dark:text-white leading-none mt-1">{value}</p>
    </div>
  </div>
);

export default Dashboard;
