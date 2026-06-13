import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  Brain, CheckCircle2, XCircle, RefreshCw, ChevronRight, Trophy,
  AlertCircle, Lock, Star, Users, Share2, ArrowRight, Clock,
  Award, Shield, Target, Volume2, VolumeX, Info, Send, Copy, Zap,
  ChevronLeft, Timer, Play, List
} from '../components/Icons';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const MILESTONES = [
  { q: 1, label: "Focus Starter" },
  { q: 5, label: "Safety Net I", safe: true },
  { q: 7, label: "Revision Warrior" },
  { q: 10, label: "Safety Net II", safe: true },
  { q: 15, label: "Clinical Apprentice" },
  { q: 25, label: "Nursing Scholar" },
  { q: 50, label: "Exam Survivor" },
  { q: 80, label: "Ward Champion" },
  { q: 100, label: "Clinical Strategist" },
  { q: 150, label: "Future Matron" },
  { q: 250, label: "Apex Scholar" },
  { q: 395, label: "Apex Legend" }
];

const Quiz = () => {
  const { flashcards, userProfile, studyStats, updateQuizStats } = useAppContext();
  const navigate = useNavigate();

  // Game State
  const [quizMode, setQuizMode] = useState('selection'); // selection, clinical, quick, subject, speed
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);

  // Speed Challenge Specific
  const [timeLeft, setTimeLeft] = useState(20);
  const [soundOn, setSoundOn] = useState(true);
  const [isFinalAnswer, setIsFinalAnswer] = useState(false);
  const [highestMilestone, setHighestMilestone] = useState("None");

  // Subject Mastery Specific
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [questionLimit, setQuestionLimit] = useState(10);
  const [useTimer, setUseTimer] = useState(false);

  // Derived Data
  const subjects = useMemo(() => {
    const s = new Map();
    flashcards.forEach(c => {
      const name = c.subject || 'General';
      s.set(name, (s.get(name) || 0) + 1);
    });
    return Array.from(s.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [flashcards]);

  const currentMilestone = useMemo(() => {
    const milestone = [...MILESTONES].reverse().find(m => score >= m.q);
    return milestone ? milestone.label : "Beginner";
  }, [score]);

  // Timer Logic
  useEffect(() => {
    let interval;
    const activeTimer = (quizMode === 'speed') || (quizMode === 'subject' && useTimer);

    if (activeTimer && quizStarted && !showResults && !showRationale && !isFinalAnswer && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && activeTimer && quizStarted && !showResults && !showRationale) {
      handleTimeOut();
    }

    return () => clearInterval(interval);
  }, [timeLeft, quizStarted, showResults, showRationale, isFinalAnswer, quizMode, useTimer]);

  const handleTimeOut = () => {
    setIsCorrect(false);
    setShowRationale(true);
    if (quizMode === 'speed') {
      updateQuizStats({ quizStreak: 0 });
    }
  };

  const getSpeedTimerValue = (index) => {
    if (index < 5) return 20;
    if (index < 10) return 18;
    return 15;
  };

  // Quiz Initialization
  const initQuiz = (mode, subject = null) => {
    let pool = [...flashcards];
    if (subject) {
      pool = pool.filter(c => c.subject === subject);
    }

    if (pool.length < 4) {
      alert("Not enough questions in this category.");
      return;
    }

    let limit = mode === 'quick' ? 10 : mode === 'speed' ? 395 : questionLimit;
    const shuffled = pool.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(limit, pool.length));

    const questions = selected.map(card => {
      const distractors = flashcards
        .filter(c => c.id !== card.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(c => c.answer);

      const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());

      return {
        ...card,
        options,
        correctAnswer: card.answer
      };
    });

    setQuizQuestions(questions);
    setQuizMode(mode);
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
    setAttempts(0);
    setShowHint(false);
    setShowRationale(false);
    setIsCorrect(null);
    setEliminatedOptions([]);
    setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });
    setClassPoll(null);
    setConsecutiveCorrect(0);
    setIsFinalAnswer(false);
    setHighestMilestone("None");
    if (mode === 'speed') setTimeLeft(20);
    else if (mode === 'subject' && useTimer) setTimeLeft(30);
  };

  const handleOptionClick = (option) => {
    if (showRationale) return;
    if (eliminatedOptions.includes(option)) return;
    setSelectedOption(option);

    if (quizMode === 'speed' || quizMode === 'clinical') {
      setIsFinalAnswer(true);
    } else {
      confirmAnswer(option);
    }
  };

  const confirmAnswer = (opt = selectedOption) => {
    const currentQ = quizQuestions[currentQuestionIndex];
    const correct = opt === currentQ.correctAnswer;
    setIsCorrect(correct);
    setIsFinalAnswer(false);

    if (correct) {
      const newScore = score + 1;
      setScore(newScore);

      const milestone = MILESTONES.find(m => m.q === newScore);
      if (milestone) setHighestMilestone(milestone.label);

      setConsecutiveCorrect(prev => {
        const next = prev + 1;
        if (next >= 5) {
          restoreLifeline();
          return 0;
        }
        return next;
      });
      setShowRationale(true);
      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      setConsecutiveCorrect(0);
      if (quizMode === 'speed') {
        setShowRationale(true);
        updateQuizStats({ quizStreak: 0 });
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= 1 || quizMode === 'quick' || quizMode === 'subject') {
          setShowRationale(true);
          updateQuizStats({ quizStreak: 0 });
        }
      }
    }
  };

  const restoreLifeline = () => {
    setLifelinesUsed(prev => {
      if (prev.fiftyFifty) return { ...prev, fiftyFifty: false };
      if (prev.hint) return { ...prev, hint: false };
      if (prev.askClass) return { ...prev, askClass: false };
      return prev;
    });
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
      setAttempts(0);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setEliminatedOptions([]);
      setClassPoll(null);
      setIsFinalAnswer(false);

      if (quizMode === 'speed') {
        setTimeLeft(getSpeedTimerValue(nextIdx));
      } else if (quizMode === 'subject' && useTimer) {
        setTimeLeft(30);
      }
    } else {
      setShowResults(true);
    }
  };

  const walkAway = () => {
    if (quizMode === 'speed' && confirm("You've come this far. One more question could strengthen your clinical confidence. Future patients depend on the knowledge you’re building today. Walk away now?")) {
      setShowResults(true);
    } else if (quizMode !== 'speed') {
       setShowResults(true);
    }
  };

  // Lifelines
  const eliminateTwo = () => {
    if (lifelinesUsed.fiftyFifty || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrectOptions = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    const toEliminate = incorrectOptions.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const askClass = () => {
    if (lifelinesUsed.askClass || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const accuracyBase = currentQ.question.length > 100 ? 0.45 : 0.75;
    const isAudienceCorrect = Math.random() < accuracyBase;

    const results = {};
    let remainingPercentage = 100;
    if (isAudienceCorrect) {
      const share = Math.floor(Math.random() * 27 + 55);
      results[currentQ.correctAnswer] = share;
      remainingPercentage -= share;
    } else {
      const wrong = currentQ.options.filter(o => o !== currentQ.correctAnswer);
      const deceptive = wrong[Math.floor(Math.random() * wrong.length)];
      const share = Math.floor(Math.random() * 14 + 38);
      results[deceptive] = share;
      remainingPercentage -= share;
    }

    const remainingOptions = currentQ.options.filter(o => !results[o]);
    remainingOptions.forEach((opt, idx) => {
      if (idx === remainingOptions.length - 1) results[opt] = remainingPercentage;
      else {
        const share = Math.floor(Math.random() * (remainingPercentage / 1.5));
        results[opt] = share;
        remainingPercentage -= share;
      }
    });

    setClassPoll(results);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  const useMentor = () => {
    if (lifelinesUsed.hint || showRationale) return;
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, hint: true }));
  };

  // Render selection screen
  if (quizMode === 'selection') {
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="text-center mb-12">
          <div className="w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 shadow-2xl border-2 border-medical-500/20">
            <Brain size={40} className="animate-pulse" />
          </div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">Quiz Central</h2>
          <p className="text-slate-500 font-medium">Choose your clinical training path</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ModeCard
            title="Clinical Challenge"
            desc="Full NMCN-style exam simulation with streak tracking."
            icon={<Shield size={24} />}
            duration="10-20 min"
            timer="None"
            color="medical"
            onClick={() => { setQuestionLimit(20); setUseTimer(false); initQuiz('clinical'); }}
          />
          <ModeCard
            title="Speed Challenge"
            desc="Kahoot-style rapid fire. High tension, high reward."
            icon={<Zap size={24} />}
            duration="5-15 min"
            timer="Progressive"
            color="amber"
            onClick={() => { initQuiz('speed'); }}
          />
          <ModeCard
            title="Quick Quiz"
            desc="5-10 rapid questions for a quick clinical refresh."
            icon={<Clock size={24} />}
            duration="2-5 min"
            timer="None"
            color="indigo"
            onClick={() => { setQuestionLimit(10); setUseTimer(false); initQuiz('quick'); }}
          />
          <ModeCard
            title="Subject Mastery"
            desc="Focus on specific subjects. Custom length and timing."
            icon={<Target size={24} />}
            duration="Custom"
            timer="Optional"
            color="emerald"
            onClick={() => setQuizMode('subject-select')}
          />
        </div>
      </div>
    );
  }

  if (quizMode === 'subject-select') {
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in duration-500">
        <button onClick={() => setQuizMode('selection')} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-8">
          <ChevronLeft size={16} /> Back to Selection
        </button>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-4">Subject Mastery</h3>

        <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 mb-8 space-y-8">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question Count</p>
                 <div className="flex gap-4">
                    {[10, 20, 50].map(n => (
                       <button
                        key={n}
                        onClick={() => setQuestionLimit(n)}
                        className={`flex-1 py-3 rounded-xl font-black transition-all ${questionLimit === n ? 'bg-emerald-500 text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-400'}`}
                       >
                          {n}
                       </button>
                    ))}
                 </div>
              </div>
              <div className="space-y-4">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Time Pressure</p>
                 <button
                  onClick={() => setUseTimer(!useTimer)}
                  className={`w-full py-3 rounded-xl font-black transition-all flex items-center justify-center gap-2 ${useTimer ? 'bg-red-500 text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-400'}`}
                 >
                    <Timer size={16} /> {useTimer ? '30s Per Question' : 'No Timer'}
                 </button>
              </div>
           </div>
        </div>

        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-6">Select Subject</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {subjects.map(sub => (
            <button
              key={sub.name}
              onClick={() => initQuiz('subject', sub.name)}
              className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border-2 border-slate-100 dark:border-slate-700 hover:border-emerald-500 transition-all text-left group"
            >
              <p className="text-[10px] font-black uppercase text-slate-400 mb-1 group-hover:text-emerald-500 transition-colors">{sub.count} Questions</p>
              <p className="font-black text-slate-900 dark:text-white">{sub.name}</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (showResults) {
    const finalMilestone = MILESTONES.slice().reverse().find(m => score >= m.q)?.label || "Focus Starter";
    const displayMilestone = quizMode === 'speed' ? finalMilestone : currentMilestone;

    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32">
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" />
          <div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 shadow-2xl">
            <Trophy size={64} />
          </div>
        </div>
        <div className="space-y-2">
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">Challenge Results</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xl font-medium">
            Milestone: <span className="text-medical-600 dark:text-medical-400 font-black">{displayMilestone}</span>
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical text-center">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Score</p>
            <p className="text-4xl font-black text-slate-900 dark:text-white">{score}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical text-center">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Streak</p>
            <p className="text-4xl font-black text-medical-600">{studyStats.quizStreak || 0}</p>
          </div>
        </div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto">
          <button onClick={() => setQuizMode('selection')} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-slate-800">
            New Challenge
          </button>
          <button onClick={() => navigate('/dashboard')} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-[2rem] font-black uppercase tracking-widest text-xs border border-slate-100 dark:border-slate-700 hover:bg-slate-50">
            Exit to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];
  if (!currentQ) return null;

  const isSpeed = quizMode === 'speed';
  const isRichard = currentQ.source?.toLowerCase().includes('richard');

  return (
    <div className={`max-w-4xl mx-auto space-y-6 pb-32 relative ${isSpeed ? 'dark' : ''}`}>
      {/* Header */}
      <div className="flex justify-between items-center px-4">
        <button onClick={walkAway} className="p-2 text-slate-400 hover:text-slate-600">
          <ChevronLeft size={24} />
        </button>
        <div className="flex items-center gap-3">
          {isSpeed && (
            <button onClick={() => setSoundOn(!soundOn)} className="p-2 bg-white/5 rounded-xl text-white/50">
              {soundOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
          )}
          <div className="px-4 py-2 bg-slate-100 dark:bg-white/10 rounded-xl">
             <p className="text-[10px] font-black uppercase text-slate-400 dark:text-white/40 tracking-widest">Score</p>
             <p className="text-sm font-black dark:text-white">{score}</p>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="px-4">
        <div className="h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
          <motion.div
            className={`h-full ${isSpeed ? 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]' : 'bg-medical-500'}`}
            initial={{ width: 0 }}
            animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Speed Challenge Header UI */}
      {isSpeed && (
        <div className="flex justify-center gap-4 px-4 overflow-x-auto pb-2 no-scrollbar">
           {MILESTONES.slice(Math.max(0, MILESTONES.findIndex(m => m.q > score) - 2), MILESTONES.findIndex(m => m.q > score) + 3).map(m => (
             <div key={m.label} className={`px-4 py-2 rounded-xl whitespace-nowrap border-2 transition-all ${score >= m.q ? 'bg-amber-500 border-amber-400 text-white' : 'bg-white/5 border-white/10 text-white/20'}`}>
                <p className="text-[8px] font-black uppercase tracking-tighter">Q{m.q}</p>
                <p className="text-[10px] font-black">{m.label}</p>
             </div>
           ))}
        </div>
      )}

      {/* Question Card */}
      <div className={`mx-4 p-8 rounded-[2.5rem] shadow-clinical border relative overflow-hidden transition-all ${isSpeed ? 'bg-slate-900 border-white/10' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}>
         {(isSpeed || (quizMode === 'subject' && useTimer)) && (
            <div className="absolute top-0 left-0 w-full h-1 bg-white/5">
               <motion.div
                  className={`h-full ${timeLeft < 5 ? 'bg-red-500' : timeLeft < 10 ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                  initial={{ width: '100%' }}
                  animate={{ width: `${(timeLeft / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30)) * 100}%` }}
                  transition={{ duration: 1, ease: 'linear' }}
               />
            </div>
         )}

         <div className="flex flex-wrap items-center gap-2 mb-6">
            <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${isSpeed ? 'bg-white/10 text-amber-400' : 'bg-medical-50 text-medical-600 shadow-[0_0_10px_rgba(16,185,129,0.2)]'}`}>
              {currentQ.subject} • SOURCE: {currentQ.source || 'Apex Scholars Core Bank'}
            </span>
            {isRichard && (
               <span className="px-3 py-1 bg-indigo-500 text-white rounded-full text-[10px] font-black uppercase tracking-widest shadow-[0_0_15px_rgba(99,102,241,0.5)] animate-pulse">
                  Source: Richard's Bank
               </span>
            )}
            {(isSpeed || (quizMode === 'subject' && useTimer)) && (
               <div className={`ml-auto flex items-center gap-2 ${timeLeft < 5 ? 'text-red-500 animate-bounce' : 'text-white/60'}`}>
                  <Clock size={16} />
                  <span className="text-xl font-black tabular-nums">{timeLeft}s</span>
               </div>
            )}
         </div>

         <h3 className={`text-xl md:text-3xl font-black leading-tight tracking-tight ${isSpeed ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
           {currentQ.question}
         </h3>
      </div>

      {/* Lifelines */}
      <div className="grid grid-cols-3 gap-4 px-4">
        <LifelineButton
          icon={<Shield />}
          label="50/50"
          used={lifelinesUsed.fiftyFifty}
          onClick={eliminateTwo}
          dark={isSpeed}
        />
        <LifelineButton
          icon={<Users />}
          label="The Class"
          used={lifelinesUsed.askClass}
          onClick={askClass}
          dark={isSpeed}
        />
        <LifelineButton
          icon={<Target />}
          label="Mentor"
          used={lifelinesUsed.hint}
          onClick={useMentor}
          dark={isSpeed}
        />
      </div>

      {/* Answer Grid */}
      <div className={`grid gap-4 px-4 ${isSpeed ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {currentQ.options.map((opt, i) => {
          let state = selectedOption === opt ? 'selected' : '';
          if (showRationale) {
            if (opt === currentQ.correctAnswer) state = 'correct';
            else if (selectedOption === opt) state = 'wrong';
          }
          if (eliminatedOptions.includes(opt)) state = 'eliminated';

          return (
            <OptionButton
              key={i}
              label={opt}
              index={i}
              state={state}
              pollValue={classPoll?.[opt]}
              onClick={() => handleOptionClick(opt)}
              disabled={showRationale || eliminatedOptions.includes(opt)}
              dark={isSpeed}
            />
          );
        })}
      </div>

      {/* Final Answer Confirmation */}
      <AnimatePresence>
        {isFinalAnswer && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-32 left-0 right-0 px-4 z-50"
          >
            <div className="bg-slate-900 border border-white/10 p-6 rounded-[2rem] shadow-2xl flex flex-col items-center gap-4">
               <p className="text-white font-black uppercase tracking-widest text-xs">Is that your final answer?</p>
               <div className="flex gap-4 w-full">
                  <button onClick={() => setIsFinalAnswer(false)} className="flex-1 py-4 bg-white/5 text-white/60 rounded-2xl font-black uppercase text-[10px] tracking-widest">
                    Change
                  </button>
                  <button onClick={() => confirmAnswer()} className="flex-[2] py-4 bg-amber-500 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-lg shadow-amber-500/20">
                    Confirm Answer
                  </button>
               </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rationale Modal Overlay */}
      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
             <motion.div
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
             />
             <motion.div
               initial={{ y: '100%' }}
               animate={{ y: 0 }}
               className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[2.5rem] sm:rounded-[2.5rem] p-8 shadow-2xl border border-slate-100 dark:border-white/10"
             >
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                   {isCorrect ? <CheckCircle2 size={32} /> : <XCircle size={32} />}
                </div>
                <div className="flex justify-between items-start mb-2">
                   <h4 className="text-2xl font-black text-slate-900 dark:text-white">
                      {isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}
                   </h4>
                   {consecutiveCorrect >= 5 && isCorrect && (
                      <div className="px-3 py-1 bg-amber-100 text-amber-600 rounded-lg text-[8px] font-black uppercase tracking-widest animate-bounce">
                         Lifeline Restored!
                      </div>
                   )}
                </div>
                <p className="text-slate-500 dark:text-slate-400 font-medium mb-8 leading-relaxed">
                   {currentQ.rationale || "Nurses must apply critical thinking to determine the safest clinical outcome."}
                </p>

                <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl mb-8 border border-slate-100 dark:border-white/5">
                   <p className="text-[10px] font-black uppercase text-medical-600 mb-1 tracking-widest">Clinical Hint</p>
                   <p className="text-sm font-bold italic text-slate-700 dark:text-slate-300">"{currentQ.hint || 'Focus on the underlying physiological mechanism.'}"</p>
                </div>

                <button onClick={nextQuestion} className="w-full py-6 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3">
                   {currentQuestionIndex < quizQuestions.length - 1 ? 'Next Challenge' : 'Complete Quiz'}
                   <ChevronRight size={18} />
                </button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mentor Clue (Hint) */}
      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
             <motion.div
               initial={{ opacity: 0 }} animate={{ opacity: 1 }}
               className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
               onClick={() => setShowHint(false)}
             />
             <motion.div
               initial={{ scale: 0.9, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               className="relative w-full max-w-md bg-white dark:bg-slate-800 p-8 rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-700 text-center"
             >
                <div className="w-16 h-16 bg-medical-50 text-medical-600 shadow-[0_0_10px_rgba(16,185,129,0.2)] rounded-2xl flex items-center justify-center mx-auto mb-6">
                   <Target size={32} />
                </div>
                <h4 className="text-xl font-black text-slate-900 dark:text-white mb-2">Mentor Strategy</h4>
                <p className="text-slate-600 dark:text-slate-400 font-medium italic mb-8">
                   "{currentQ.hint || 'Patient safety and ABCs (Airway, Breathing, Circulation) should always guide your first action.'}"
                </p>
                <button onClick={() => setShowHint(false)} className="w-full py-4 bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white rounded-2xl font-black uppercase tracking-widest text-[10px]">
                   Back to Question
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
    medical: 'hover:border-medical-500 group-hover:text-medical-500 bg-medical-500/10',
    amber: 'hover:border-amber-500 group-hover:text-amber-500 bg-amber-500/10',
    indigo: 'hover:border-indigo-500 group-hover:text-indigo-500 bg-indigo-500/10',
    emerald: 'hover:border-emerald-500 group-hover:text-emerald-500 bg-emerald-500/10'
  };

  return (
    <button
      onClick={onClick}
      className={`p-8 bg-white dark:bg-slate-800 rounded-[2.5rem] border-2 border-slate-100 dark:border-slate-700 transition-all text-left group active:scale-95 flex flex-col justify-between min-h-[220px] ${colors[color].split(' ')[0]}`}
    >
      <div>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-6 transition-colors ${colors[color].split(' ').pop()} ${colors[color].split(' ')[1]}`}>
          {icon}
        </div>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight group-hover:translate-x-1 transition-transform">{title}</h3>
        <p className="text-slate-500 text-sm font-medium leading-relaxed">{desc}</p>
      </div>
      <div className="flex gap-4 mt-6">
         <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400">
            <Clock size={12} /> {duration}
         </div>
         <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400">
            <Timer size={12} /> {timer}
         </div>
      </div>
    </button>
  );
};

const LifelineButton = ({ icon, label, used, onClick, dark }) => (
  <button
    disabled={used}
    onClick={onClick}
    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all active:scale-95
      ${used
        ? (dark ? 'bg-white/5 border-white/5 text-white/10' : 'bg-slate-50 border-slate-100 text-slate-200')
        : (dark ? 'bg-white/10 border-white/10 text-amber-500 hover:border-amber-500' : 'bg-white border-slate-100 text-medical-600 hover:border-medical-500 shadow-sm')
      }`}
  >
    {React.cloneElement(icon, { size: 20 })}
    <span className="text-[8px] font-black uppercase tracking-widest mt-2">{label}</span>
  </button>
);

const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark }) => {
  const letters = ['A', 'B', 'C', 'D'];

  let baseStyles = dark ? 'bg-white/5 border-white/5 text-white/70 hover:bg-white/10' : 'bg-white border-slate-100 text-slate-700 hover:border-medical-500';

  if (state === 'selected') baseStyles = dark ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-medical-50 border-medical-500 text-medical-700';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500';
  if (state === 'eliminated') baseStyles = 'opacity-10 grayscale pointer-events-none';

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full relative flex items-center p-5 rounded-2xl border-2 transition-all duration-300 overflow-hidden ${baseStyles} active:scale-98`}
    >
      <div className="flex items-center gap-4 w-full relative z-10">
         <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border ${state === 'selected' ? 'bg-amber-500 border-amber-400 text-white' : (dark ? 'bg-white/10 border-white/10 text-white/40' : 'bg-slate-100 border-slate-200 text-slate-400')}`}>
            {letters[index]}
         </span>
         <span className="flex-1 font-bold text-sm text-left leading-tight pr-12">{label}</span>
         {pollValue !== undefined && (
            <div className="text-right">
               <p className="text-lg font-black tabular-nums">{pollValue}%</p>
               <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-medical-500" style={{ width: `${pollValue}%` }} />
               </div>
            </div>
         )}
      </div>
      {state === 'correct' && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute right-[-10px] top-[-10px] p-4 text-emerald-500/20">
          <CheckCircle2 size={60} />
        </motion.div>
      )}
    </button>
  );
};

export default Quiz;
