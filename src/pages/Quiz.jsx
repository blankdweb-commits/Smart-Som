import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import {
  Brain,
  Timer,
  Award,
  Zap,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Target,
  Clock,
  Trophy,
  HelpCircle,
  Shield,
  Star,
  RefreshCw,
  LayoutDashboard,
  ChevronRight,
  TrendingUp,
  Settings as SettingsIcon,
  ChevronLeft,
  Users,
  AlertCircle
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';

const MILESTONES = [
  { q: 5, label: 'Clinical Novice', reward: 'Bronze Badge' },
  { q: 10, label: 'Nurse Intern', reward: 'Silver Badge' },
  { q: 15, label: 'Medical Scholar', reward: 'Gold Badge' },
  { q: 20, label: 'Diagnostic Specialist', reward: 'Platinum Badge' },
  { q: 25, label: 'Apex Practitioner', reward: 'Diamond Badge' },
  { q: 30, label: 'Clinical Legend', reward: 'Legendary Status' }
];

const getSpeedTimerValue = (index) => {
  if (index < 5) return 20;
  if (index < 10) return 18;
  return 15;
};

const Quiz = () => {
  const { flashcards, studyStats, updateQuizStats, darkMode } = useAppContext();
  const navigate = useNavigate();
  const [secretTaps, setSecretTaps] = useState(0);
  const [quizMode, setQuizMode] = useState(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const [selectedOption, setSelectedOption] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);

  // Speed Challenge Specific
  const [maxTime, setMaxTime] = useState(20);
  const [isFinalAnswer, setIsFinalAnswer] = useState(false);
  const [highestMilestone, setHighestMilestone] = useState("None");
  const [safetyNetScore, setSafetyNetScore] = useState(0);

  // Configuration Specific
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [questionLimit, setQuestionLimit] = useState(10);
  const [useTimer, setUseTimer] = useState(true);

  // Early Quit Messaging
  const [showQuitModal, setShowQuitModal] = useState(false);

  // Derived Data
  const subjects = useMemo(() => {
    const s = new Map();
    if (flashcards) {
      flashcards.forEach(c => {
        const name = c.subject || 'General';
        s.set(name, (s.get(name) || 0) + 1);
      });
    }
    return Array.from(s.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [flashcards]);

  const currentMilestone = useMemo(() => {
    const milestone = [...MILESTONES].reverse().find(m => score >= m.q);
    return milestone ? milestone.label : "Clinical Novice";
  }, [score]);

  const handleTimeOut = useCallback(() => {
    if (showRationale || showResults) return;
    if (quizMode === 'speed') {
      // Speed mode: time out = immediate quiz over
      updateQuizStats({ quizStreak: 0 });
      setShowResults(true);
    } else {
      // Other modes: time out = mark wrong and show rationale
      setIsCorrect(false);
      setShowRationale(true);
      setIsFinalAnswer(false);
    }
  }, [quizMode, showRationale, showResults, updateQuizStats]);

  // Timer Logic
  useEffect(() => {
    let interval;
    const activeTimer = (quizMode === 'speed') || (quizMode === 'subject' && useTimer) || (quizMode === 'quick' && useTimer) || (quizMode === 'clinical' && useTimer);

    if (activeTimer && quizStarted && !showResults && !showRationale && !isFinalAnswer && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { handleTimeOut(); return 0; }
          return prev - 1;
        });
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [timeLeft, quizStarted, showResults, showRationale, isFinalAnswer, quizMode, useTimer, handleTimeOut]);

  // Quiz Initialization
  const initQuiz = (mode, subject = null) => {
    if (!flashcards || flashcards.length === 0) return;
    let pool = [...flashcards];
    if (subject) {
      pool = pool.filter(c => c.subject === subject);
    }
    if (pool.length === 0) return;

    const seen = new Set();
    const uniquePool = pool.filter(c => seen.has(c.question) ? false : seen.add(c.question));

    let limit = mode === 'speed' ? 395 : (questionLimit || 10);
    const shuffled = pool.sort(() => 0.5 - Math.random());
    shuffled.sort((a, b) => {
      const isAPrio = ((a.source || '').toLowerCase().includes('richard') || (a.category || '').toLowerCase() === 'nmcn') ? 1 : 0;
      const isBPrio = ((b.source || '').toLowerCase().includes('richard') || (b.category || '').toLowerCase() === 'nmcn') ? 1 : 0;
      return isBPrio - isAPrio;
    });
    const selected = shuffled.slice(0, Math.min(limit, pool.length));

    const questions = selected.map(card => {
      const distractors = flashcards
        .filter(c => c.id !== card.id && c.answer !== card.answer)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(c => c.answer);
      const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());
      return { ...card, options, correctAnswer: card.answer };
    });

    setQuizQuestions(questions);
    setQuizMode(mode);
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
    setShowHint(false);
    setShowRationale(false);
    setIsCorrect(null);
    setEliminatedOptions([]);
    setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });
    setClassPoll(null);
    setIsFinalAnswer(false);
    setHighestMilestone("None");
    setSafetyNetScore(0);
    setShowQuitModal(false);

    if (mode === 'speed') {
      setTimeLeft(20);
      setMaxTime(20);
    } else if (useTimer) {
      setTimeLeft(30);
      setMaxTime(30);
    }
  };

  const handleOptionClick = (option) => {
    if (showRationale || showResults) return;
    if (eliminatedOptions.includes(option)) return;
    if (selectedOption === option) {
       confirmAnswer(option);
    } else {
       setSelectedOption(option);
       setIsFinalAnswer(true);
    }
  };

  const confirmAnswer = (opt = selectedOption) => {
    if (!opt) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const correct = opt === currentQ.correctAnswer;
    setIsCorrect(correct);
    setIsFinalAnswer(false);
    if (correct) {
      const newScore = score + 1;
      setScore(newScore);

      if (newScore === 5) setSafetyNetScore(5);
      if (newScore === 10) setSafetyNetScore(10);

      // Milestone is updated dynamically via useMemo
      setConsecutiveCorrect(prev => prev + 1);
      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      setConsecutiveCorrect(0);
      setShowRationale(true);
      updateQuizStats({ quizStreak: 0 });
    }
    setShowRationale(true);
  };

  const nextQuestion = () => {
    if (!isCorrect && quizMode === 'speed') {
       setShowResults(true);
       return;
    }
    if (currentQuestionIndex < quizQuestions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      setSelectedOption(null);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setEliminatedOptions([]);
      setClassPoll(null);
      setIsFinalAnswer(false);

      if (quizMode === 'speed') {
        const val = getSpeedTimerValue(nextIdx);
        setTimeLeft(val);
        setMaxTime(val);
      } else if (useTimer) {
        setTimeLeft(30);
        setMaxTime(30);
      }
    } else {
      setShowResults(true);
    }
  };

  const useFiftyFifty = () => {
    if (lifelinesUsed.fiftyFifty || showRationale || showResults) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const wrongs = currentQ.options.filter(o => o !== currentQ.correctAnswer);
    const toEliminate = wrongs.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const useAskClass = () => {
    if (lifelinesUsed.askClass || showRationale || showResults) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const poll = currentQ.options.map(o => ({
      option: o,
      value: o === currentQ.correctAnswer ? Math.floor(Math.random() * 30) + 50 : Math.floor(Math.random() * 20)
    }));
    setClassPoll(poll);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  if (!quizStarted) {
    return (
      <div className="space-y-8 animate-in fade-in duration-700 max-w-6xl mx-auto pb-20 px-4">
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const next = secretTaps + 1;
                setSecretTaps(next);
                if (next >= 5) { navigate('/xp-hall'); setSecretTaps(0); }
              }}
              className="p-2 text-slate-200 dark:text-slate-700 hover:text-medical-500 dark:hover:text-medical-400 transition-colors rounded-xl active:scale-90"
              title=""
            >
              <Brain size={22} />
            </button>
            <div>
              <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Quiz Modes</h1>
              <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 uppercase tracking-[0.2em] text-[10px]">Select your training intensity</p>
            </div>
          </div>
          <div className="flex items-center gap-4 bg-white dark:bg-slate-800 p-4 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700">
             <div className="text-center px-4 border-r border-slate-100 dark:border-slate-700">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Global Rank</p>
                <p className="text-xl font-black text-indigo-600">#42</p>
             </div>
             <div className="text-center px-4">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">XP Earned</p>
                <p className="text-xl font-black text-emerald-500">1,240</p>
             </div>
          </div>
        </header>

        {/* Configuration Section */}
        <section className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
           <div className="flex items-center gap-3 mb-8">
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl">
                 <SettingsIcon size={20} />
              </div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Session Parameters</h2>
           </div>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="space-y-3">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Question Limit</label>
                 <div className="flex items-center gap-2">
                    {[10, 20, 50, 100].map(val => (
                       <button
                         key={val}
                         onClick={() => setQuestionLimit(val)}
                         className={`flex-1 py-3 rounded-2xl font-black text-xs transition-all ${questionLimit === val ? 'bg-indigo-600 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-900 text-slate-400 hover:bg-slate-100'}`}
                       >
                          {val}
                       </button>
                    ))}
                 </div>
              </div>

              <div className="space-y-3">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Session Timer</label>
                 <div className="flex items-center gap-2">
                    <button
                      onClick={() => setUseTimer(true)}
                      className={`flex-1 py-3 rounded-2xl font-black text-xs transition-all ${useTimer ? 'bg-emerald-500 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-900 text-slate-400 hover:bg-slate-100'}`}
                    >
                       TIMER ON
                    </button>
                    <button
                      onClick={() => setUseTimer(false)}
                      className={`flex-1 py-3 rounded-2xl font-black text-xs transition-all ${!useTimer ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-900 text-slate-400 hover:bg-slate-100'}`}
                    >
                       OFF
                    </button>
                 </div>
              </div>

              <div className="space-y-3">
                 <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Subject Filter</label>
                 <select
                   value={selectedSubject || ''}
                   onChange={(e) => setSelectedSubject(e.target.value || null)}
                   className="w-full py-3 px-4 rounded-2xl bg-slate-50 dark:bg-slate-900 border-none text-slate-600 dark:text-slate-300 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                 >
                    <option value="">All Subjects</option>
                    {subjects.map(s => (
                       <option key={s.name} value={s.name}>{s.name} ({s.count})</option>
                    ))}
                 </select>
              </div>
           </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <ModeCard
            title="Clinical Challenge"
            desc="Simulated exam environment with critical rationales."
            icon={<Shield size={32} />}
            duration="Variable"
            timer={useTimer ? "30s/Q" : "Relaxed"}
            color="medical"
            onClick={() => initQuiz('clinical', selectedSubject)}
          />
          <ModeCard
            title="Quick Quiz"
            desc="5-10 rapid questions for instant knowledge verification."
            icon={<Zap size={32} />}
            duration="Fast"
            timer="Instant"
            color="amber"
            onClick={() => {
               setQuestionLimit(10);
               initQuiz('quick', selectedSubject);
            }}
          />
          <ModeCard
            title="Subject Mastery"
            desc="Target specific clinical subjects to eliminate weak spots."
            icon={<Target size={32} />}
            duration="Focused"
            timer={useTimer ? "30s/Q" : "Adaptive"}
            color="indigo"
            onClick={() => initQuiz('subject', selectedSubject)}
          />
          <ModeCard
            title="Speed Challenge"
            desc="The ultimate test. 20 seconds per question. Don't stop."
            icon={<Timer size={32} />}
            duration="Infinite"
            timer="Strict 20s"
            color="emerald"
            onClick={() => initQuiz('speed', selectedSubject)}
          />
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];

  if (showResults) {
    const finalScore = quizMode === 'speed' ? Math.max(score, safetyNetScore) : score;
    return (
      <div className="flex items-center justify-center min-h-[70vh] p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white dark:bg-slate-800 p-12 rounded-[3.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 text-center max-w-2xl w-full"
        >
          <div className="w-24 h-24 bg-medical-50 text-medical-600 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-lg">
            <Trophy size={48} />
          </div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white mb-2 tracking-tight uppercase">Session Complete</h2>
          <p className="text-slate-500 dark:text-slate-400 font-bold uppercase tracking-widest text-[10px] mb-10">Performance Analytics Generated</p>

          <div className="grid grid-cols-2 gap-4 mb-10">
            <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Final Score</p>
               <p className="text-3xl font-black text-slate-900 dark:text-white">{finalScore} <span className="text-sm text-slate-400">/ {quizQuestions.length}</span></p>
            </div>
            <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Rank Achieved</p>
               <p className="text-xl font-black text-medical-600">{currentMilestone}</p>
            </div>
          </div>

          {quizMode === 'speed' && score > safetyNetScore && (
             <p className="text-xs text-red-500 font-black uppercase mb-8 tracking-widest animate-pulse">Failed at Q{score}. Safety net applied at Q{safetyNetScore}.</p>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
             <button onClick={() => setQuizStarted(false)} className="flex-1 py-5 bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white rounded-[2rem] font-black uppercase tracking-widest text-xs hover:bg-slate-200 transition-all">
                Mode Selection
             </button>
             <button onClick={() => initQuiz(quizMode, selectedSubject)} className="flex-1 py-5 bg-medical-600 text-white rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-500/20 active:scale-95 transition-all">
                Try Again
             </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const timerColor = timeLeft <= 3 ? 'bg-red-500' : timeLeft <= 10 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className={`min-h-screen flex flex-col ${quizMode === 'speed' ? 'bg-slate-950 text-white' : ''} transition-colors duration-500 pb-48 overflow-x-hidden relative`}>
      {/* Speed Atmosphere Background Elements */}
      {quizMode === 'speed' && (
         <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className="absolute -top-24 -left-24 w-96 h-96 bg-medical-500/10 blur-[120px] rounded-full" />
            <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-amber-500/5 blur-[120px] rounded-full" />
         </div>
      )}

      {/* Progress Header */}
      <div className="max-w-4xl mx-auto pt-10 px-6 relative z-10">
        <div className="flex justify-between items-center mb-6">
          <button
            onClick={() => setShowQuitModal(true)}
            className="p-3 hover:bg-slate-100 dark:hover:bg-white/5 rounded-2xl transition-all"
          >
            <XCircle size={24} className="text-slate-400" />
          </button>
          <div className="flex flex-col items-center">
             <p className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">{quizMode} mode active</p>
             <h3 className="text-lg font-black tracking-tighter uppercase">{currentMilestone}</h3>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 backdrop-blur-md rounded-2xl border border-white/5">
             <Zap className="text-amber-500" size={16} fill="currentColor" />
             <span className="text-sm font-black tabular-nums">{score}</span>
          </div>
        </div>

        {/* Timer Bar */}
        <div className="w-full h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden mb-2">
          <motion.div
            initial={false}
            animate={{ width: `${(timeLeft / maxTime) * 100}%`, backgroundColor: timeLeft <= 5 ? '#ef4444' : '#10b981' }}
            className="h-full transition-colors duration-500"
          />
        </div>

        <div className="w-full h-3 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden p-0.5 border border-slate-50 dark:border-white/5">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
            className="h-full bg-medical-500 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.5)]"
          />
        </div>

        <div className="flex justify-between mt-4">
           <div className="flex items-center gap-2">
              <Star className="text-amber-500" size={16} fill="currentColor" />
              <span className="text-xs font-black tabular-nums">{score * 10} XP</span>
           </div>
           <div className="flex items-center gap-2">
              <Clock className={timeLeft <= 5 ? 'text-red-500 animate-pulse' : 'text-slate-400'} size={16} />
              <span className="text-xs font-black tabular-nums">{timeLeft}s remaining</span>
           </div>
        </div>
      </div>

      {/* Lifelines */}
      <div className="max-w-4xl mx-auto px-6 mt-8 relative z-30">
         <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl p-4 rounded-3xl shadow-sm border border-slate-100 dark:border-white/5 grid grid-cols-3 gap-4">
            <LifelineButton
               icon={<Target />} label="50/50"
               used={lifelinesUsed.fiftyFifty}
               onClick={useFiftyFifty}
               dark={quizMode === 'speed'}
            />
            <LifelineButton
               icon={<HelpCircle />} label="Hint"
               used={lifelinesUsed.hint}
               onClick={() => {
                  setShowHint(true);
                  setLifelinesUsed(prev => ({ ...prev, hint: true }));
               }}
               dark={quizMode === 'speed'}
            />
            <LifelineButton
               icon={<Users />} label="Poll"
               used={lifelinesUsed.askClass}
               onClick={useAskClass}
               dark={quizMode === 'speed'}
            />
         </div>
      </div>

      {/* Main Question Area */}
      <div className="max-w-4xl mx-auto mt-8 px-6 relative z-10">
         <motion.div
           key={currentQuestionIndex}
           initial={{ x: 20, opacity: 0 }}
           animate={{ x: 0, opacity: 1 }}
           className="space-y-12"
         >
            <div className="text-center space-y-6">
               <div className="flex flex-col items-center gap-2">
                  <span className="px-4 py-1 bg-medical-500/10 text-medical-500 rounded-full text-[9px] font-black uppercase tracking-widest border border-medical-500/20">
                    {currentQ?.subject}
                  </span>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest opacity-60">Question {currentQuestionIndex + 1}</p>
               </div>
               <h2 className={`text-2xl sm:text-4xl font-black leading-tight tracking-tight px-4 drop-shadow-sm ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                  {currentQ?.question}
               </h2>
               <div className="flex justify-center">
                  <div className="px-4 py-1.5 bg-indigo-500/10 text-indigo-500 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] shadow-[0_0_10px_rgba(99,102,241,0.3)] border border-indigo-500/20">
                     SOURCE: {currentQ?.source || "UNKNOWN SOURCE"}
                  </div>
               </div>
            </div>

            {/* Options - Kahoot Style 2x2 for Speed, List for others */}
            <div className={`grid ${quizMode === 'speed' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-4`}>
               {currentQ?.options?.map((option, idx) => (
                  <OptionButton
                    key={idx}
                    index={idx}
                    label={option}
                    isSpeed={quizMode === 'speed'}
                    state={
                      selectedOption === option
                        ? (isCorrect === null ? 'selected' : (isCorrect ? 'correct' : 'wrong'))
                        : (isCorrect !== null && option === currentQ.correctAnswer ? 'correct' : (eliminatedOptions.includes(option) ? 'eliminated' : 'default'))
                    }
                    pollValue={classPoll?.find(p => p.option === option)?.value}
                    onClick={() => handleOptionClick(option)}
                    disabled={showRationale || eliminatedOptions.includes(option)}
                    dark={quizMode === 'speed'}
                  />
               ))}
            </div>
         </motion.div>
      </div>

      {/* Final Answer Confirmation */}
      <AnimatePresence>
        {isFinalAnswer && !showRationale && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 w-full max-w-md px-6 z-40"
          >
            <button
              onClick={() => confirmAnswer()}
              className="w-full py-6 bg-amber-500 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl shadow-amber-500/40 animate-bounce"
            >
              Is that your final answer?
            </button>
          </motion.div>
        )}
      </AnimatePresence>



      {/* Speed Challenge Achievement UI */}
      {quizMode === 'speed' && (
         <div className="fixed left-6 top-1/2 -translate-y-1/2 hidden xl:block space-y-4">
            <div className="bg-slate-900/50 backdrop-blur-md p-6 rounded-[2.5rem] border border-white/10 w-48 shadow-2xl">
               <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-6">Mastery Ladder</h4>
               <div className="space-y-4">
                  {[...MILESTONES].reverse().map(m => (
                     <div key={m.q} className={`flex items-center gap-3 ${score >= m.q ? 'text-medical-500' : 'text-slate-600 opacity-40'}`}>
                        <div className={`w-2 h-2 rounded-full ${score >= m.q ? 'bg-medical-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-slate-800'}`} />
                        <span className="text-[10px] font-black uppercase tracking-tighter">{m.label}</span>
                        {score >= m.q && <CheckCircle2 size={10} />}
                     </div>
                  ))}
               </div>
            </div>
         </div>
      )}

      {/* Early Quit Modal */}
      <AnimatePresence>
        {showQuitModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" />
             <motion.div
               initial={{ scale: 0.9, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               className="relative bg-white dark:bg-slate-800 p-10 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-700 text-center max-w-sm"
             >
                <div className="w-20 h-20 bg-amber-50 dark:bg-amber-900/30 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner">
                   <AlertCircle size={40} />
                </div>
                <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-3">Abandon Challenge?</h4>
                <p className="text-slate-600 dark:text-slate-400 font-medium italic text-lg leading-relaxed mb-10">
                   "Every skipped challenge is a missed opportunity to strengthen your clinical judgment."
                </p>
                <div className="space-y-4">
                   <button onClick={() => setShowQuitModal(false)} className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-500/20 active:scale-95 transition-all">
                      Stay and Master
                   </button>
                   <button onClick={() => setQuizStarted(false)} className="w-full py-4 text-slate-400 hover:text-red-500 font-black uppercase tracking-widest text-[9px] transition-colors">
                      Quit for now
                   </button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Rationale / Feedback Overlay */}
      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
             <motion.div
               initial={{ opacity: 0 }} animate={{ opacity: 1 }}
               className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
             />
             <motion.div
               initial={{ y: '100%' }}
               animate={{ y: 0 }}
               className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[3rem] sm:rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-white/10"
             >
                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-8 mx-auto sm:mx-0 ${isCorrect ? 'bg-emerald-100 text-emerald-600 shadow-lg shadow-emerald-500/20' : 'bg-red-100 text-red-600 shadow-lg shadow-red-500/20'}`}>
                   {isCorrect ? <CheckCircle2 size={40} /> : <XCircle size={40} />}
                </div>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                   <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">
                        {isCorrect ? 'Logic Validated' : 'Conceptual Misalignment'}
                      </p>
                      <h4 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight leading-none">
                         {isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}
                      </h4>
                   </div>
                   {consecutiveCorrect >= 5 && isCorrect && (
                      <div className="px-4 py-2 bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-widest animate-bounce flex items-center gap-2 border border-amber-200">
                         <Zap size={12} /> Lifeline Restored!
                      </div>
                   )}
                </div>
                {!isCorrect && (
                   <div className="mb-4">
                      <p className="text-[10px] font-black uppercase text-medical-600 mb-1 tracking-widest">Correct Answer</p>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300 leading-snug">{currentQ?.correctAnswer}</p>
                   </div>
                )}
                <div className="max-h-40 overflow-y-auto custom-scrollbar mb-8">
                   <p className="text-slate-600 dark:text-slate-300 font-medium text-lg leading-relaxed italic">
                      {currentQ?.rationale || "Nurses must apply critical thinking and clinical protocols to ensure patient safety and prioritize airway, breathing, and circulation."}
                   </p>
                </div>

                <div className="p-6 bg-slate-50 dark:bg-white/5 rounded-2xl mb-10 border border-slate-100 dark:border-white/5 flex gap-4 items-start">
                   <div className="p-2 bg-medical-100 text-medical-600 rounded-lg shrink-0">
                      <Target size={16} />
                   </div>
                   <div>
                      <p className="text-[10px] font-black uppercase text-medical-600 mb-1 tracking-widest">Clinical Mentor Note</p>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300 leading-snug italic">"{currentQ?.hint || 'Focus on the physiological foundation and the primary action that ensures long-term stability.'}"</p>
                   </div>
                </div>
                <button onClick={nextQuestion} className="w-full py-6 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:gap-6">{currentQuestionIndex < quizQuestions.length - 1 ? 'Next Challenge' : 'Complete Quiz'} <ArrowRight size={20} /></button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowHint(false)} />
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white dark:bg-slate-800 p-10 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-700 text-center">
                <div className="w-20 h-20 bg-medical-50 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><Target size={40} /></div>
                <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-3">Mentor Strategy</h4>
                <p className="text-slate-600 dark:text-slate-300 font-medium italic text-lg leading-relaxed mb-10">
                   "{currentQ?.hint || 'Prioritize patient safety and focus on the intervention that addresses the root cause of the clinical presentation.'}"
                </p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-all">
                   Return to Question
                </button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ModeCard = ({ title, desc, icon, duration, timer, color, onClick }) => {
  const colors = {
    medical: 'hover:border-medical-500 group-hover:text-medical-500 bg-medical-500/10 text-medical-600',
    amber: 'hover:border-amber-500 group-hover:text-amber-500 bg-amber-500/10 text-amber-600',
    indigo: 'hover:border-indigo-500 group-hover:text-indigo-500 bg-indigo-500/10 text-indigo-600',
    emerald: 'hover:border-emerald-500 group-hover:text-emerald-500 bg-emerald-500/10 text-emerald-600'
  };
  return (
    <button onClick={onClick} className={`p-8 bg-white dark:bg-slate-800 rounded-[2.5rem] border-2 border-slate-100 dark:border-slate-700 transition-all text-left group active:scale-95 flex flex-col justify-between min-h-[260px] shadow-sm hover:shadow-xl ${colors[color].split(' ')[0]}`}>
      <div>
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 transition-all group-hover:scale-110 shadow-inner ${colors[color].split(' ').pop()} ${colors[color].split(' ')[1]}`}>{icon}</div>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight group-hover:translate-x-1 transition-transform">{title}</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium leading-relaxed">{desc}</p>
      </div>
      <div className="flex gap-4 mt-8">
         <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Clock size={12} /> {duration}</div>
         <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Timer size={12} /> {timer}</div>
      </div>
    </button>
  );
};

const LifelineButton = ({ icon, label, used, onClick, dark }) => (
  <button disabled={used} onClick={onClick} className={`flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all active:scale-90 shadow-sm ${used ? (dark ? 'bg-white/5 border-white/5 text-white/10' : 'bg-slate-50 border-slate-100 text-slate-200') : (dark ? 'bg-white/10 border-white/10 text-amber-500 hover:border-amber-400 hover:bg-white/20' : 'bg-white border-slate-100 text-medical-600 hover:border-medical-500 hover:bg-medical-50')}`}>{React.cloneElement(icon, { size: 24 })}<span className="text-[9px] font-black uppercase tracking-[0.2em] mt-3">{label}</span></button>
);

const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark, isSpeed }) => {
  const letters = ['A', 'B', 'C', 'D'];
  let baseStyles = dark ? 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10' : 'bg-white border-slate-100 text-slate-700 hover:border-medical-500 hover:shadow-md';
  if (state === 'selected') baseStyles = dark ? 'bg-amber-500/20 border-amber-500 text-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'bg-medical-50 border-medical-500 text-medical-700 shadow-md';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.4)]';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]';
  if (state === 'eliminated') baseStyles = 'opacity-10 grayscale pointer-events-none scale-95';
  return (
    <button disabled={disabled} onClick={onClick} className={`w-full relative flex items-center p-6 rounded-3xl border-2 transition-all duration-300 overflow-hidden ${baseStyles} active:scale-98 min-h-[80px]`}>
      <div className="flex items-center gap-5 w-full relative z-10">
         <span className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm border-2 ${state === 'selected' ? 'bg-amber-500 border-amber-400 text-white' : (dark ? 'bg-white/10 border-white/20 text-white/40' : 'bg-slate-100 border-slate-200 text-slate-400')}`}>{letters[index]}</span>
         <span className={`flex-1 font-bold text-left leading-snug pr-2 ${isSpeed ? 'text-[11px] sm:text-base' : 'text-base'}`}>{label}</span>
         {pollValue !== undefined && <div className="text-right shrink-0"><p className="text-xl font-black tabular-nums">{pollValue}%</p><div className="w-14 h-1.5 bg-white/20 rounded-full overflow-hidden mt-1"><div className="h-full bg-medical-500" style={{ width: `${pollValue}%` }} /></div></div>}
      </div>
      {state === 'correct' && <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} className="absolute right-0 top-0 p-6 text-emerald-500/20"><CheckCircle2 size={80} /></motion.div>}
    </button>
  );
};

export default React.memo(Quiz);
