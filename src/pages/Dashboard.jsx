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
    <div className="space-y-8 pb-20">
      <header className="relative py-4">
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">Nurse's Dashboard</h2>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-lg mt-1">Empowering your clinical learning journey.</p>
          </div>
        </div>

        {isExamSoon && (
          <div className="mt-6 p-6 bg-red-50 dark:bg-red-900/20 border-2 border-red-100 dark:border-red-900/30 rounded-[2rem] flex flex-col sm:flex-row items-center justify-between gap-4 animate-bounce-in shadow-soft">
            <div className="flex items-center gap-4 text-center sm:text-left">
              <div className="w-14 h-14 bg-red-100 dark:bg-red-900/40 rounded-2xl flex items-center justify-center text-red-600 shrink-0">
                <Calendar size={28} />
              </div>
              <div>
                <p className="text-red-800 dark:text-red-400 font-bold text-lg uppercase tracking-wider">High Urgency: Exam Alert</p>
                <p className="text-red-700 dark:text-red-500 font-medium">
                  Your <strong>{immediateExam.title}</strong> exam is in less than 48 hours. Focus on high-yield topics now!
                </p>
              </div>
            </div>
            <a href="/exams" className="w-full sm:w-auto px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-bold rounded-2xl shadow-clinical transition-all active:scale-95 text-center">Open Timetable</a>
          </div>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard
          title="Curriculum Decks"
          value={flashcards.length}
          icon={<BookOpen size={24} />}
          color="text-blue-600"
          bg="bg-blue-50/50 dark:bg-blue-900/20"
        />
        <StatsCard
          title="Cards Studied"
          value={studyStats.cardsStudied}
          icon={<TrendingUp size={24} />}
          color="text-emerald-600"
          bg="bg-emerald-50/50 dark:bg-emerald-900/20"
        />
        <StatsCard
          title="Study Streak"
          value={`${studyStats.streak} Days`}
          icon={<Award size={24} />}
          color="text-orange-600"
          bg="bg-orange-50/50 dark:bg-orange-900/20"
        />
        <StatsCard
          title="Due Today"
          value={dueFlashcards.length}
          icon={<Award size={24} />}
          color="text-amber-600"
          bg="bg-amber-50/50 dark:bg-amber-900/20"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-soft border border-slate-100 dark:border-slate-700">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-bold flex items-center text-slate-900 dark:text-white">
                <TrendingUp className="mr-3 text-medical-600" size={24} />
                Subject Mastery
              </h3>
              <span className="text-sm font-bold text-slate-400 uppercase tracking-widest">Top 5 Courses</span>
            </div>
            <div className="space-y-8">
              {subjectProgress.length > 0 ? (
                subjectProgress.map(sub => (
                  <div key={sub.name} className="group">
                    <div className="flex justify-between text-sm font-bold mb-2 uppercase tracking-tight">
                      <span className="text-slate-700 dark:text-slate-300 truncate max-w-[250px]">{sub.name}</span>
                      <span className="text-medical-600">{sub.percent}% Mastery</span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-medical-500 rounded-full transition-all duration-1000 group-hover:bg-medical-400"
                        style={{ width: `${sub.percent}%` }}
                      ></div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-10 text-center">
                  <p className="text-slate-400 font-medium italic">Begin your first study session to track course mastery.</p>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-soft border border-slate-100 dark:border-slate-700">
            <h3 className="text-2xl font-bold mb-6 flex items-center text-slate-900 dark:text-white">
              <Calendar className="mr-3 text-medical-600" size={24} />
              Upcoming Exams
            </h3>
            <div className="space-y-4">
              {upcomingExams.length > 0 ? upcomingExams.map(exam => (
                <div key={exam.id} className="flex items-center justify-between p-5 rounded-3xl bg-slate-50 dark:bg-slate-900/50 border border-transparent hover:border-medical-200 dark:hover:border-medical-800 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm text-medical-600">
                      <Calendar size={20} />
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 dark:text-white">{exam.title}</p>
                      <p className="text-sm text-slate-500 font-medium">{new Date(exam.date).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-4 py-1.5 bg-medical-50 text-medical-700 dark:bg-medical-900/40 dark:text-medical-300 rounded-full uppercase tracking-wider">
                    {Math.ceil((new Date(exam.date).getTime() - new Date().getTime()) / (1000 * 3600 * 24))} Days Left
                  </span>
                </div>
              )) : (
                <div className="py-6 text-center">
                  <p className="text-slate-400 font-medium italic">Your exam schedule is clear.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-8">
          <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-soft border border-amber-100 dark:border-amber-900/30 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-amber-50 dark:bg-amber-900/10 rounded-full -mr-16 -mt-16" />

            <h3 className="text-2xl font-bold mb-6 flex items-center text-amber-600 relative z-10">
              <Award className="mr-3" size={24} />
              Learning Hub
            </h3>

            {dueFlashcards.length > 0 ? (
              <div className="mb-8 p-6 bg-amber-50 dark:bg-amber-900/20 rounded-3xl border border-amber-100 dark:border-amber-800/50 relative z-10">
                <p className="text-amber-800 dark:text-amber-300 font-bold text-xs uppercase tracking-widest mb-2">High Yield Focus</p>
                <p className="text-amber-700 dark:text-amber-400 font-medium mb-4">
                  You have <strong>{dueFlashcards.length} cards</strong> due for review today. Stay sharp!
                </p>
                <a href="/flashcards" className="flex items-center justify-center w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-2xl shadow-soft transition-all active:scale-95">
                  Start Review
                </a>
              </div>
            ) : (
              <div className="mb-8 p-6 bg-emerald-50 dark:bg-emerald-900/20 rounded-3xl border border-emerald-100 dark:border-emerald-800/50 relative z-10">
                <p className="text-emerald-800 dark:text-emerald-300 font-bold text-xs uppercase tracking-widest mb-2">Well Done!</p>
                <p className="text-emerald-700 dark:text-emerald-400 font-medium">
                  Your review queue is empty. You're maintaining an excellent study pace!
                </p>
              </div>
            )}

            <div className="space-y-6 relative z-10">
              <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest">Clinical Study Tip</h4>
              <div className="p-6 bg-medical-50 dark:bg-medical-900/20 rounded-3xl border border-medical-100 dark:border-medical-800/50 min-h-[140px] flex items-center">
                <p className="text-medical-800 dark:text-medical-300 italic font-medium leading-relaxed">
                  "{studyTips[currentTip]}"
                </p>
              </div>
            </div>

            <div className="mt-10 relative z-10">
              <h4 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-4">Quick Access</h4>
              <div className="grid grid-cols-2 gap-4">
                <a href="/flashcards" className="flex flex-col items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800 shadow-sm border border-transparent hover:border-medical-200 transition-all">
                  <div className="p-2 bg-medical-50 dark:bg-medical-900/30 rounded-xl mb-2 text-medical-600">
                    <BookOpen size={20} />
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Cards</span>
                </a>
                <a href="/exams" className="flex flex-col items-center p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 hover:bg-white dark:hover:bg-slate-800 shadow-sm border border-transparent hover:border-medical-200 transition-all">
                  <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-xl mb-2 text-indigo-600">
                    <Calendar size={20} />
                  </div>
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Exams</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatsCard = ({ title, value, icon, color, bg }) => (
  <div className={`p-8 rounded-[2.5rem] shadow-soft ${bg} border border-white dark:border-slate-800/50 flex flex-col items-center text-center group hover:shadow-clinical transition-all`}>
    <div className={`p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-sm ${color} mb-4 group-hover:scale-110 transition-transform`}>
      {icon}
    </div>
    <div>
      <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white leading-none">{value}</p>
      <p className="text-xs sm:text-sm font-bold text-slate-500 dark:text-slate-400 mt-2 uppercase tracking-widest">{title}</p>
    </div>
  </div>
);

export default Dashboard;
