import React from 'react';
import { useAppContext } from '../context/AppContext';
import { BookOpen, Calendar, TrendingUp, Award } from 'lucide-react';

const Dashboard = () => {
  const { flashcards, exams, studyStats } = useAppContext();

  const subjectProgress = React.useMemo(() => {
    const stats = {};
    flashcards.forEach(card => {
      if (!stats[card.subject]) {
        stats[card.subject] = { total: 0, learned: 0 };
      }
      stats[card.subject].total += 1;
      if (card.srs?.reps > 0) {
        stats[card.subject].learned += 1;
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

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % studyTips.length);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-6">
      <header className="relative">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Welcome back, Student</h2>
            <p className="text-slate-600 dark:text-slate-400">Track your nursing study progress and upcoming exams.</p>
          </div>
        </div>

        {isExamSoon && (
          <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border-l-4 border-red-500 rounded-r-xl flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-100 dark:bg-red-900/40 rounded-full flex items-center justify-center text-red-600">
                <Calendar size={20} />
              </div>
              <div>
                <p className="text-red-800 dark:text-red-300 font-bold text-sm uppercase">Exam Alert!</p>
                <p className="text-red-700 dark:text-red-400 text-sm font-medium">
                  Your <strong>{immediateExam.title}</strong> exam is in less than 48 hours ({new Date(immediateExam.date).toLocaleDateString()}).
                </p>
              </div>
            </div>
            <a href="/exams" className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-lg shadow-lg">View Schedule</a>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total Flashcards"
          value={flashcards.length}
          icon={<BookOpen className="text-blue-500" />}
          color="bg-blue-50 dark:bg-blue-900/20"
        />
        <StatsCard
          title="Cards Studied"
          value={studyStats.cardsStudied}
          icon={<TrendingUp className="text-green-500" />}
          color="bg-green-50 dark:bg-green-900/20"
        />
        <StatsCard
          title="Study Streak"
          value={`${studyStats.streak} Days`}
          icon={<Award className="text-orange-500" />}
          color="bg-orange-50 dark:bg-orange-900/20"
        />
        <StatsCard
          title="Due for Review"
          value={dueFlashcards.length}
          icon={<Award className="text-amber-500" />}
          color="bg-amber-50 dark:bg-amber-900/20"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
            <h3 className="text-xl font-semibold mb-6 flex items-center">
              <TrendingUp className="mr-2 text-medical-600" size={20} />
              Subject Mastery
            </h3>
            <div className="space-y-5">
              {subjectProgress.length > 0 ? (
                subjectProgress.map(sub => (
                  <div key={sub.name}>
                    <div className="flex justify-between text-xs font-bold mb-1 uppercase tracking-wider text-slate-500">
                      <span className="truncate max-w-[200px]">{sub.name}</span>
                      <span>{sub.learned}/{sub.total} cards</span>
                    </div>
                    <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-medical-500 rounded-full transition-all duration-500"
                        style={{ width: `${sub.percent}%` }}
                      ></div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500 italic">Start studying to see subject progress.</p>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm">
          <h3 className="text-xl font-semibold mb-4 flex items-center">
            <Calendar className="mr-2 text-medical-600" size={20} />
            Upcoming Exams
          </h3>
            <div className="space-y-4">
              {upcomingExams.length > 0 ? upcomingExams.map(exam => (
                <div key={exam.id} className="flex items-center justify-between p-3 rounded-lg bg-slate-50 dark:bg-slate-700/50">
                  <div>
                    <p className="font-medium">{exam.title}</p>
                    <p className="text-sm text-slate-500">{new Date(exam.date).toLocaleDateString()}</p>
                  </div>
                  <span className="text-xs px-2 py-1 bg-medical-100 text-medical-700 dark:bg-medical-900/40 dark:text-medical-300 rounded-full">
                    Upcoming
                  </span>
                </div>
              )) : (
                <p className="text-slate-500 italic">No upcoming exams scheduled.</p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl shadow-sm border border-amber-100 dark:border-amber-900/30">
          <h3 className="text-xl font-semibold mb-4 flex items-center text-amber-600">
            <Award className="mr-2" size={20} />
            Smart Learning Hub
          </h3>

          {dueFlashcards.length > 0 ? (
            <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-100 dark:border-amber-800">
              <p className="text-amber-800 dark:text-amber-300 font-bold text-sm uppercase mb-1">Action Required</p>
              <p className="text-amber-700 dark:text-amber-400 text-sm">
                You have <strong>{dueFlashcards.length} cards</strong> due for review. Spaced repetition is most effective when done daily!
              </p>
              <a href="/flashcards" className="mt-3 inline-block px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-colors">
                Start Review Now
              </a>
            </div>
          ) : (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-100 dark:border-green-800">
              <p className="text-green-800 dark:text-green-300 font-bold text-sm uppercase mb-1">All Caught Up!</p>
              <p className="text-green-700 dark:text-green-400 text-sm">
                Excellent! You've reviewed all your current flashcards. Come back later for more.
              </p>
            </div>
          )}

          <h3 className="text-sm font-bold text-slate-400 uppercase mb-3 mt-6">
            Study Tip of the Day
          </h3>
          <div className="p-4 bg-medical-50 dark:bg-medical-900/20 rounded-xl border border-medical-100 dark:border-medical-800 h-24 flex items-center">
            <p className="text-medical-800 dark:text-medical-300 italic">
              "{studyTips[currentTip]}"
            </p>
          </div>
          <div className="mt-8">
            <h4 className="text-sm font-bold text-slate-400 uppercase mb-3">Quick Actions</h4>
            <div className="grid grid-cols-2 gap-3">
              <a href="/flashcards" className="flex flex-col items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-700 hover:bg-medical-50 dark:hover:bg-medical-900/20 transition-colors border border-transparent hover:border-medical-200">
                <BookOpen className="text-medical-600 mb-2" size={20} />
                <span className="text-xs font-medium">Flashcards</span>
              </a>
              <a href="/exams" className="flex flex-col items-center p-3 rounded-lg bg-slate-50 dark:bg-slate-700 hover:bg-medical-50 dark:hover:bg-medical-900/20 transition-colors border border-transparent hover:border-medical-200">
                <Calendar className="text-medical-600 mb-2" size={20} />
                <span className="text-xs font-medium">Exams</span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatsCard = ({ title, value, icon, color }) => (
  <div className={`p-6 rounded-xl shadow-sm ${color} flex items-center`}>
    <div className="p-3 bg-white dark:bg-slate-800 rounded-lg mr-4">
      {icon}
    </div>
    <div>
      <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">{title}</p>
      <p className="text-2xl font-bold">{value}</p>
    </div>
  </div>
);

export default Dashboard;
