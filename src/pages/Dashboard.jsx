import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { BookOpen, TrendingUp, Award, Zap, ArrowRight, Star, Clock, AlertCircle, Target, CheckCircle, ChevronRight, Lock, Sparkles, Coins } from '../components/Icons';
import { differenceInDays } from 'date-fns';

import DailyChallengeWidget from '../components/DailyChallengeWidget';
import IdentityCard from '../components/IdentityCard';
import IdentityUnlockModal from '../components/IdentityUnlockModal';
import Recommendations from '../components/Recommendations';
import StudyCoachWidget from '../components/StudyCoachWidget';
import { greetingForName } from '../utils/getGreeting';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars

const Dashboard = () => {
  const DEV_MODE = import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true';
  const { flashcards, exams, studyStats, userProfile, session, loadingAuth, learningAnalytics, quizHistory, smartCoins, scLedger, claimDailySC, identity, identityUnlock, dismissIdentityUnlock, quota, fetchQuotaStatus, difficultyProgress, isPremium, SC_FEATURE_LOCKED } = useAppContext();
  const navigate = useNavigate();

  // Redirect if not logged in - Only if not in DEV_MODE and NOT in Dashboard-First mode
  // Since Dashboard-First is the primary experience, we usually don't want to redirect back to landing
  React.useEffect(() => {
    if (!loadingAuth && !session && !DEV_MODE) {
      // navigate('/'); // Disabled to prevent redirect loops in Dashboard-First mode
    }
  }, [session, loadingAuth, navigate, DEV_MODE]);

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

  const todayStats = React.useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const rows = quizHistory.filter(r => {
      const ts = new Date(r.created_at).getTime();
      return ts >= startOfToday;
    });
    const questions = rows.reduce((sum, r) => sum + (r.total || 0), 0);
    const correct = rows.reduce((sum, r) => sum + (r.score || 0), 0);
    return {
      questions,
      accuracy: questions > 0 ? Math.round((correct / questions) * 100) : 0
    };
  }, [quizHistory]);

  const upcomingExams = exams
    .filter(e => new Date(e.date) >= new Date())
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  const nearExams = upcomingExams.filter(e => {
    const daysLeft = differenceInDays(new Date(e.date), new Date());
    return daysLeft >= 0 && daysLeft <= 3;
  });

  const isExamSoon = nearExams.length > 0;

  const dueFlashcards = flashcards.filter(c => {
    if (!c.srs?.nextReview) return true;
    return new Date(c.srs.nextReview) <= new Date();
  });

  const expiryDays = userProfile.subscriptionExpiry
    ? differenceInDays(new Date(userProfile.subscriptionExpiry), new Date())
    : null;

  const studyTips = [
    "Use the 'Shuffle' mode for flashcards to improve long-term retention.",
    "Focus on 'High-Yield' topics during the last 3 days before an exam.",
    "Break down long medical terms into syllables to master their pronunciation.",
    "Maintain a daily study streak to build consistent learning habits."
  ];

  const [currentTip, setCurrentTip] = React.useState(0);

  // Load free-user quota status for the Command Center on mount.
  React.useEffect(() => {
    if (session?.user && !isPremium) fetchQuotaStatus();
  }, [session?.user, isPremium, fetchQuotaStatus]);

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

  // ---- Exam Readiness score (weighted: accuracy, volume, streak) ----
  const readinessScore = React.useMemo(() => {
    const acc = todayStats.accuracy;
    const questions = todayStats.questions;
    const streak = studyStats.streak || 0;
    const accScore = Math.min(50, (acc / 100) * 50);
    const volScore = Math.min(30, Math.min(1, questions / 50) * 30);
    const streakScore = Math.min(20, Math.min(1, streak / 7) * 20);
    return Math.round(accScore + volScore + streakScore);
  }, [todayStats.accuracy, todayStats.questions, studyStats.streak]);

  const readinessLabel =
    readinessScore >= 80 ? 'Combat Ready' :
    readinessScore >= 50 ? 'Getting Sharper' :
    readinessScore >= 20 ? 'Warming Up' : 'Just Started';

  const readinessHint =
    readinessScore >= 80 ? 'You are exam-ready. Keep the momentum through review. 🔥' :
    readinessScore >= 50 ? 'Solid base — push accuracy above 70% to level up.' :
    'Answer a few questions today to build your readiness score.';

  // ---- Contextual CTA (weak area callout + action) ----
  const weakAreas = (learningAnalytics.weakConcepts || []).slice(0, 3);
  const contextualCTA = React.useMemo(() => {
    if (nearExams.length > 0) {
      return {
        title: `${nearExams[0].title.split(' ')[0]} Exam Soon`,
        body: 'Your exam window is close. Sharpen the high-yield topics now.',
        label: 'Revise Now',
        to: '/flashcards',
        tone: 'rose'
      };
    }
    if (todayStats.questions === 0) {
      return {
        title: 'Start Today\u2019s Mission',
        body: 'No questions answered yet. Warm up with a quick practice set.',
        label: 'Start Quiz',
        to: '/quiz',
        tone: 'apex'
      };
    }
    return {
      title: 'Fix My Weakest Areas',
      body: weakAreas.length
        ? `You\u2019re below 60% on ${weakAreas.length} concept${weakAreas.length > 1 ? 's' : ''}. Turn those around.`
        : 'Targeted practice sharpens the areas that cost you marks.',
      label: 'Get Targeted',
      to: '/quiz?weakness=1',
      tone: 'rose'
    };
  }, [nearExams, todayStats.questions, weakAreas.length]);

  const ctaTone =
    contextualCTA.tone === 'rose'
      ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20'
      : 'bg-apex-600 hover:bg-apex-700 shadow-apex-600/20';

  return (
    <div className="relative space-y-6 sm:space-y-8 pb-32 animate-in fade-in duration-700 max-w-5xl mx-auto px-1 sm:px-0 overflow-x-hidden">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="w-full">
          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-apex-600 dark:text-apex-400 mb-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> Nursing Exam Command Center
          </p>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
            {greetingForName(userProfile.fullName || session?.user?.user_metadata?.full_name, 'Scholar')}
            {' '}{identity?.emoji || '👶'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 text-sm sm:text-base">Institutional Productivity Hub • {userProfile.level}</p>
        </div>
        <div className="flex gap-3">
           <button
            onClick={() => navigate('/flashcards')}
            aria-label="Open flashcards"
            className="p-4 bg-white dark:bg-slate-800 rounded-[1.5rem] shadow-soft border border-slate-100 dark:border-slate-700 hover:text-apex-600 transition-all"
           >
             <Zap size={24} />
           </button>
        </div>
      </header>

      <IdentityUnlockModal identity={identityUnlock} onClose={dismissIdentityUnlock} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {expiryDays !== null && expiryDays <= 3 && expiryDays >= 0 && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-6 bg-amber-50 border border-amber-200 rounded-[2rem] flex items-center justify-between gap-4 shadow-lg shadow-amber-500/5"
            >
              <div className="flex items-center gap-4 text-amber-900">
                <div className="p-3 bg-amber-200 rounded-2xl">
                  <Clock size={24} />
                </div>
                <div>
                  <h4 className="font-black text-lg">Subscription Expiring Soon</h4>
                  <p className="text-sm font-medium opacity-80">You have {expiryDays === 0 ? 'less than 24 hours' : `${expiryDays} days`} left. Renew now to avoid losing access.</p>
                </div>
              </div>
              <button
                onClick={() => navigate('/activate')}
                className="px-6 py-3 bg-amber-900 text-white rounded-xl font-black text-xs uppercase tracking-widest whitespace-nowrap"
              >
                Renew Access
              </button>
            </motion.div>
          )}

          {expiryDays !== null && expiryDays < 0 && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="p-6 bg-red-50 border border-red-200 rounded-[2rem] flex items-center justify-between gap-4 shadow-lg shadow-red-500/5"
            >
              <div className="flex items-center gap-4 text-red-900">
                <div className="p-3 bg-red-200 rounded-2xl">
                  <AlertCircle size={24} />
                </div>
                <div>
                  <h4 className="font-black text-lg">Access Expired</h4>
                  <p className="text-sm font-medium opacity-80">Your 30-day premium cycle has ended. Activate now to continue your clinical mastery.</p>
                </div>
              </div>
              <button
                onClick={() => navigate('/activate')}
                className="px-6 py-3 bg-red-900 text-white rounded-xl font-black text-xs uppercase tracking-widest whitespace-nowrap"
              >
                Re-Activate
              </button>
            </motion.div>
          )}


          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-6 rounded-[2rem] bg-white dark:bg-slate-800 shadow-clinical border border-slate-100 dark:border-slate-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-4 min-w-0">
              <div className={`w-12 h-12 rounded-2xl ${ctaTone.split(' ')[0]} flex items-center justify-center text-white shrink-0`}>
                <Target size={22} />
              </div>
              <div className="min-w-0">
                <h4 className="font-black text-lg text-slate-900 dark:text-white leading-tight">{contextualCTA.title}</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-0.5">{contextualCTA.body}</p>
              </div>
            </div>
            <button
              onClick={() => navigate(contextualCTA.to)}
              className={`shrink-0 px-5 py-3 ${ctaTone} text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg transition-all active:scale-95 flex items-center gap-2`}
            >
              {contextualCTA.label} <ArrowRight size={14} />
            </button>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DailyChallengeWidget />
            <TodayProgressWidget streak={studyStats.streak} stats={todayStats} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <QuotaCard quota={quota} isPremium={isPremium} onRefresh={fetchQuotaStatus} />
            <DifficultyProgressCard progress={difficultyProgress} isPremium={isPremium} />
          </div>

          <WeaknessChallengeCard
  totalAttempts={learningAnalytics.totalAttempts || 0}
  weakConcepts={learningAnalytics.weakConcepts || []}
  isActivated={userProfile.isActivated}
  onFix={() => navigate('/quiz?weakness=1')}
  onActivate={() => navigate('/activate')}
  onPractice={() => navigate('/quiz')}
/>

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
           <IdentityCard stats={{
             totalAttempts: learningAnalytics.totalAttempts || 0,
             quizStreak: studyStats.quizStreak || 0,
             cardsStudied: studyStats.cardsStudied || 0,
             accuracy: todayStats.accuracy,
             scEarned: smartCoins || 0,
             speedRuns: 0
           }} />

           <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
             <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4 flex items-center gap-1.5">
               <Target size={14} className="text-apex-600" /> Exam Readiness
             </h4>
             <div className="flex items-center justify-between mb-2">
               <span className="text-sm font-black text-slate-700 dark:text-slate-200">{readinessLabel}</span>
               <span className="text-xl font-black text-apex-600">{readinessScore}%</span>
             </div>
             <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden border border-slate-50 dark:border-slate-800">
               <motion.div
                 initial={{ width: 0 }}
                 animate={{ width: `${readinessScore}%` }}
                 className="h-full bg-gradient-to-r from-apex-500 to-apex-600 rounded-full"
               />
             </div>
             <p className="text-xs text-slate-400 font-medium mt-3">{readinessHint}</p>
           </div>

           <StudyCoachWidget />

           <div className="bg-amber-500 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <Coins size={120} />
            </div>
            <h3 className="text-xl font-black mb-2 relative z-10 uppercase tracking-tight">Smart Coins</h3>
            <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mb-4">Rare currency · power-ups & streaks</p>
            <div className="flex items-end justify-between relative z-10">
              <div>
                <p className="text-5xl font-black tracking-tighter">{smartCoins} <span className="text-xl">SC</span></p>
                <p className="text-xs font-bold text-white/80 mt-1">
                  {SC_FEATURE_LOCKED
                    ? 'Transfer unlocked with the upcoming 1v1 Duel Arena'
                    : (userProfile.isActivated ? 'Earn 9 SC daily when activated' : 'Activate your account to start earning SC')}
                </p>
              </div>
              {SC_FEATURE_LOCKED ? (
                <span className="bg-white/20 text-white text-[10px] font-black uppercase tracking-widest px-4 py-3 rounded-2xl backdrop-blur">
                  Locked
                </span>
              ) : (
                <button
                  onClick={claimDailySC}
                  disabled={!userProfile.isActivated}
                  className="bg-white text-amber-600 font-black text-sm uppercase tracking-wide px-4 py-3 rounded-2xl shadow hover:bg-amber-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  Claim +9
                </button>
              )}
            </div>
            {scLedger.length > 0 && (
              <div className="mt-5 pt-4 border-t border-white/20 relative z-10">
                <p className="text-[10px] font-black text-white/70 uppercase tracking-widest mb-2">Recent activity</p>
                <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                  {scLedger.slice(0, 6).map(e => (
                    <div key={e.id} className="flex justify-between text-xs font-bold bg-white/10 backdrop-blur rounded-xl px-3 py-1.5">
                      <span className="capitalize text-white/90">{String(e.reason || 'misc').replace(/_/g, ' ')}</span>
                      <span className={e.amount >= 0 ? 'text-white' : 'text-red-200'}>{e.amount >= 0 ? `+${e.amount}` : e.amount} SC</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

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

          <Recommendations stats={{
            questionsToday: todayStats.questions,
            accuracy: todayStats.accuracy,
            weakConcepts: learningAnalytics.weakConcepts || [],
            dueFlashcards: dueFlashcards.length,
            nearExams: nearExams.map(e => ({
              subject: e.title.split(' ')[0],
              days: differenceInDays(new Date(e.date), new Date())
            })),
            streak: studyStats.streak || 0,
            isActivated: !!userProfile.isActivated
          }} />
        </div>
      </div>
    </div>
  );
};

const StatsCard = ({ title, value, icon, color }) => (
  <div className={`p-4 sm:p-6 rounded-[1.5rem] sm:rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 ${color} flex flex-col items-center justify-center text-center space-y-1 sm:space-y-2 group transition-all hover:-translate-y-1`}>
    <div className="p-2 sm:p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl sm:rounded-2xl mb-1 group-hover:scale-110 transition-transform">
      {React.cloneElement(icon, { size: 20 })}
    </div>
    <div>
      <p className="text-[9px] sm:text-[10px] text-slate-400 font-black uppercase tracking-widest">{title}</p>
      <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-white tracking-tighter mt-0.5">{value}</p>
    </div>
  </div>
);

// ---- Today's Progress widget: streak + questions answered today + accuracy ----
const TodayProgressWidget = ({ streak, stats }) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-800 flex flex-col justify-between">
    <div>
      <h3 className="text-lg font-black flex items-center gap-2 text-slate-900 dark:text-white uppercase tracking-tight">
        <TrendingUp className="text-apex-600" size={20} /> Today's Progress
      </h3>
      <p className="text-xs text-slate-500 mt-1">Your momentum at a glance.</p>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-3">
      <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-center">
        <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest">Streak</p>
        <p className="text-2xl font-black text-amber-700 dark:text-amber-400 mt-1">{streak}d</p>
      </div>
      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-center">
        <p className="text-[9px] font-black text-blue-600 uppercase tracking-widest">Questions</p>
        <p className="text-2xl font-black text-blue-700 dark:text-blue-400 mt-1">{stats.questions}</p>
      </div>
      <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl text-center">
        <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest">Accuracy</p>
        <p className="text-2xl font-black text-emerald-700 dark:text-emerald-400 mt-1">{stats.accuracy}%</p>
      </div>
    </div>
  </div>
);

// ---- Weakness Challenge: 100-question milestone → custom quiz from weak topics ----
const WEAKNESS_MILESTONE = 100;

const WeaknessChallengeCard = ({ totalAttempts, weakConcepts, isActivated, onFix, onActivate, onPractice }) => {
  const progress = Math.min(100, Math.round((totalAttempts / WEAKNESS_MILESTONE) * 100));
  const remaining = Math.max(0, WEAKNESS_MILESTONE - totalAttempts);
  const unlocked = isActivated && totalAttempts >= WEAKNESS_MILESTONE;

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-800 relative overflow-hidden">
      <div className="absolute -top-10 -right-10 w-40 h-40 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-1">
          <Target className="text-rose-500" size={20} />
          <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Weakness Challenge</h3>
          {!isActivated && (
            <span className="ml-auto flex items-center gap-1 px-2 py-1 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded-full text-[9px] font-black uppercase tracking-widest">
              <Lock size={10} /> Premium
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">
          Answer 100 questions to unlock a custom quiz pulled from your weakest topics (accuracy below 60%).
        </p>

        {!isActivated ? (
          <div className="mt-5 p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-100 dark:bg-amber-900/40 rounded-2xl">
                <Lock size={16} className="text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-black text-slate-900 dark:text-white">Premium feature</p>
                <p className="text-[10px] text-slate-400 font-bold">Activate your account to unlock.</p>
              </div>
            </div>
            <button
              onClick={onActivate}
              className="shrink-0 flex items-center gap-1 px-4 py-2.5 bg-apex-600 text-white rounded-xl font-black uppercase tracking-widest text-[9px] hover:bg-apex-700 transition-all active:scale-95"
            >
              Activate <ChevronRight size={12} />
            </button>
          </div>
        ) : !unlocked ? (
          <div className="mt-5">
            <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
              <span>{totalAttempts} / {WEAKNESS_MILESTONE} questions</span>
              <span>{progress}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden border border-slate-50 dark:border-slate-800">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                className="h-full bg-rose-500 rounded-full"
              />
            </div>
            <p className="text-[10px] text-slate-400 font-medium mt-2">
              {remaining} more {remaining === 1 ? 'question' : 'questions'} to unlock your custom weakness quiz.
            </p>
          </div>
        ) : (
          <div className="mt-5">
            {weakConcepts.length > 0 ? (
              <>
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">
                  {weakConcepts.length} weak {weakConcepts.length === 1 ? 'concept' : 'concepts'} · below 60% accuracy
                </p>
                <div className="space-y-2">
                  {weakConcepts.slice(0, 5).map((w, i) => (
                    <div key={i} className="flex items-center justify-between gap-3 p-3 bg-slate-50 dark:bg-slate-900/50 rounded-xl">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{w.name}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">{w.attempts} attempt{w.attempts === 1 ? '' : 's'} · {w.subject}</p>
                      </div>
                      <span className="shrink-0 text-xs font-black text-red-500">{Math.round(w.accuracy * 100)}%</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={onFix}
                  className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-3.5 bg-rose-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-rose-600/20 hover:bg-rose-700 transition-all active:scale-95"
                >
                  <Sparkles size={14} /> Fix My Weak Areas <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <div className="py-5 text-center">
                <div className="w-12 h-12 bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <CheckCircle size={20} className="text-emerald-500" />
                </div>
                <p className="text-xs text-slate-400 italic">No weak topics detected — you're on your way to mastery.</p>
                <button
                  onClick={onPractice}
                  className="mt-4 px-4 py-2.5 bg-apex-600 text-white rounded-xl font-black uppercase tracking-widest text-[9px] hover:bg-apex-700 transition-all active:scale-95"
                >
                  Keep Practicing <ArrowRight size={12} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ---- Free-user quota card: 50 questions / 12h cooldown (premium = unlimited) ----
const QuotaCard = ({ quota, isPremium, onRefresh }) => {
  const used = isPremium ? null : (quota?.questions_used ?? 0);
  const remaining = isPremium ? null : (quota?.questions_remaining ?? 0);
  const percent = isPremium ? 100 : Math.max(0, Math.min(100, Math.round((used / 50) * 100)));

  const cooldownLabel = quota?.resets_at
    ? new Date(quota.resets_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Free Daily Quota</h3>
        {isPremium ? (
          <span className="text-[9px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-2.5 py-1 rounded-full">Unlimited</span>
        ) : (
          <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 bg-amber-50 dark:bg-amber-900/30 px-2.5 py-1 rounded-full">50 / 12h</span>
        )}
      </div>

      {isPremium ? (
        <div className="flex items-center gap-3 mt-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <CheckCircle size={18} className="text-emerald-600" />
          </div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">You have unlimited questions. Keep the momentum going.</p>
        </div>
      ) : (
        <>
          <div className="flex items-end justify-between mt-2">
            <span className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">
              {remaining}
              <span className="text-sm text-slate-400 font-bold ml-1">left</span>
            </span>
            <span className="text-[10px] text-slate-400 font-bold">resets {cooldownLabel || 'in 12h'}</span>
          </div>
          <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden mt-3 border border-slate-50 dark:border-slate-800">
            <div className="h-full bg-amber-500 rounded-full" style={{ width: `${percent}%` }} />
          </div>
          {remaining <= 10 && (
            <button
              onClick={onRefresh}
              className="w-full mt-3 py-2.5 bg-amber-500 text-white rounded-xl font-black uppercase tracking-widest text-[9px] hover:bg-amber-600 transition-all active:scale-95"
            >
              Check My Quota
            </button>
          )}
        </>
      )}
    </div>
  );
};

// ---- Difficulty unlock progress: correct answers across tiers ----
const DifficultyProgressCard = ({ progress, isPremium }) => {
  const tiers = [
    { key: 'medium', label: 'Medium', need: 50 },
    { key: 'hard', label: 'Hard', need: 80 },
    { key: 'expert', label: 'Expert', need: 100 }
  ];

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-800">
      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Difficulty Unlocks</h3>
      <div className="mt-4 space-y-4">
        {tiers.map(t => {
          const row = Array.isArray(progress)
            ? progress.find(p => String(p.difficulty).toLowerCase() === t.key)
            : null;
          const got = row?.correct_count ?? 0;
          const pct = Math.min(100, Math.round((got / t.need) * 100));
          const unlocked = row?.unlocked === true || got >= t.need;
          return (
            <div key={t.key}>
              <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">
                <span className="flex items-center gap-1.5">
                  {unlocked ? <CheckCircle size={12} className="text-emerald-500" /> : <Lock size={12} className="text-slate-400" />}
                  {t.label}
                </span>
                <span className={unlocked ? 'text-emerald-600' : 'text-slate-500'}>{unlocked ? 'Unlocked' : `${got}/${t.need}`}</span>
              </div>
              <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${unlocked ? 'bg-emerald-500' : 'bg-apex-600'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {!isPremium && (
        <p className="text-[10px] text-slate-400 italic mt-4">Correct answers unlock higher difficulty tiers.</p>
      )}
    </div>
  );
};

export default Dashboard;
