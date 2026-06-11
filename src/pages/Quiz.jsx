import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { Brain, CheckCircle2, XCircle, RefreshCw, ChevronRight, Trophy, AlertCircle, Lock, Star, Users, Share2, ArrowRight, Clock, Award, Shield, Target, BookOpen, Zap, Settings, HelpCircle, Volume2, Triangle, Diamond, Circle, Square, Sparkles, TrendingUp } from '../components/Icons';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { FALLBACK_QUESTIONS } from '../data/fallbackQuestions';
import { RICHARDS_QUESTIONS } from '../data/richardsQuestions';

const MILESTONES = [
  "Clinical Beginner",
  "Ward Ready",
  "Exam Survivor",
  "Clinical Strategist",
  "Apex Scholar"
];

// --- MAIN COMPONENT ---

const Quiz = () => {
  const {
    flashcards,
    studyStats,
    updateQuizStats,
    curriculumSubjects,
    richardsQuestions,
    setIsQuizActive,
    quizPreferences,
    updateQuizPreferences
  } = useAppContext();
  const navigate = useNavigate();

  // -- 1. COMPONENT STATE --
  const [view, setView] = useState('hub'); // hub, setup, quiz, results
  const [activeMode, setActiveMode] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);

  // Quiz Configuration
  const [config, setConfig] = useState({
    questionCount: 10,
    timerDuration: 'OFF' // OFF, 15, 30, 45, 60
  });

  // Quiz Engine State
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);

  // UI Interaction State
  const [selectedOption, setSelectedOption] = useState(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [wrongAttempts, setWrongAttempts] = useState([]);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [lifelineFeedback, setLifelineFeedback] = useState(null); // For "Lifeline Restored!"

  const [lifelines, setLifelines] = useState({
    hint: false,
    fiftyFifty: false,
    askClass: false,
    askFriend: false
  });

  const [classPoll, setClassPoll] = useState(null);
  const [colleagueAdvice, setColleagueAdvice] = useState(null);

  // Timer State
  const [timeLeft, setTimeLeft] = useState(null);
  const timerRef = useRef(null);

  const [volumeOn, setVolumeOn] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  const currentQ = questions[currentIndex];

  // -- 2. UTILITIES --

  const playSound = useCallback((type) => {
    if (!volumeOn) return;
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      if (type === 'correct') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
      } else if (type === 'wrong') {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(220, audioCtx.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.05, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
      } else if (type === 'tick') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.02, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.05);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.05);
      }
    } catch (e) {}
  }, [volumeOn]);

  const restoreLifeline = useCallback(() => {
    const used = Object.keys(lifelines).filter(k => lifelines[k]);
    if (used.length > 0) {
      // Priority: Hint, 50/50, Friend (Colleague), Class
      let toRestore = null;
      if (lifelines.hint) toRestore = 'hint';
      else if (lifelines.fiftyFifty) toRestore = 'fiftyFifty';
      else if (lifelines.askFriend) toRestore = 'askFriend';
      else if (lifelines.askClass) toRestore = 'askClass';

      if (toRestore) {
        setLifelines(prev => ({ ...prev, [toRestore]: false }));
        setLifelineFeedback("Lifeline Restored!");
        setTimeout(() => setLifelineFeedback(null), 3000);
      }
    }
  }, [lifelines]);

  // -- 3. QUIZ ENGINE LOGIC --

  const handleAnswer = useCallback((option) => {
    if (isAnswered) return;

    const correct = option === currentQ.correctAnswer;
    setSelectedOption(option);
    setIsAnswered(true);
    setShowRationale(true);

    // Stop Timer
    if (timerRef.current) clearInterval(timerRef.current);

    playSound(correct ? 'correct' : 'wrong');

    if (correct) {
      setScore(s => s + 1);
      const newConsecutive = consecutiveCorrect + 1;
      setConsecutiveCorrect(newConsecutive);

      if (newConsecutive > 0 && newConsecutive % 5 === 0) {
        restoreLifeline();
      }

      updateQuizStats({
        quizStreak: (studyStats.quizStreak || 0) + 1,
        xpAwarded: 10
      });
    } else {
      setConsecutiveCorrect(0);
      setWrongAttempts([option]);
      updateQuizStats({ quizStreak: 0 });
    }
  }, [currentQ, isAnswered, consecutiveCorrect, restoreLifeline, playSound, studyStats.quizStreak, updateQuizStats]);

  const startTimer = useCallback(() => {
    if (config.timerDuration === 'OFF') return;

    const duration = parseInt(config.timerDuration);
    setTimeLeft(duration);

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current);
          handleAnswer(null); // Time's up!
          return 0;
        }
        if (prev <= 6) playSound('tick');
        return prev - 1;
      });
    }, 1000);
  }, [config.timerDuration, handleAnswer, playSound]);

  const nextQuestion = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsAnswered(false);
      setShowRationale(false);
      setShowHint(false);
      setWrongAttempts([]);
      setEliminatedOptions([]);
      setClassPoll(null);
      setColleagueAdvice(null);
      if (config.timerDuration !== 'OFF') startTimer();
    } else {
      finishQuiz();
    }
  };

  const finishQuiz = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setView('results');
    setIsQuizActive(false);
    updateQuizStats({
      milestone: MILESTONES[Math.min(Math.floor(score / 3), MILESTONES.length - 1)]
    });
  };

  const quitQuiz = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setView('hub');
    setIsQuizActive(false);
    setActiveMode(null);
    setSelectedSubject(null);
  };

  // -- 4. SETUP LOGIC --

  const prepareQuiz = (mode, subject = null) => {
    setActiveMode(mode);
    setSelectedSubject(subject);

    // Default config based on mode
    let defaultCount = 10;
    let defaultTimer = 'OFF';

    if (mode === 'speed') {
      defaultTimer = '15';
    } else if (mode === 'clinical') {
      defaultCount = 20;
    }

    setConfig({
      questionCount: defaultCount,
      timerDuration: defaultTimer
    });

    if (mode === 'mastery_select') {
      setView('hub'); // Stay in hub but showing subject list
    } else {
      setView('setup');
    }
  };

  const startQuizSession = () => {
    setIsLoading(true);
    let pool = [];

    if (activeMode === 'quick' || (activeMode === 'speed' && !selectedSubject)) {
      const bank = (richardsQuestions && richardsQuestions.length > 0) ? richardsQuestions : RICHARDS_QUESTIONS;
      pool = [...bank];
    } else {
      pool = flashcards.filter(c => {
        const isPlaceholder = c.id && String(c.id).startsWith('ex_');
        return !isPlaceholder;
      });

      if (selectedSubject) {
        const subLower = selectedSubject.toLowerCase();
        pool = pool.filter(c => (c.subject || '').toLowerCase().includes(subLower));
      }
    }

    if (pool.length === 0) {
      pool = [...FALLBACK_QUESTIONS];
    }

    // Shuffle and slice
    const selected = pool.sort(() => 0.5 - Math.random()).slice(0, config.questionCount);

    const processed = selected.map(card => {
      // Ensure options exist
      if (card.options && Array.isArray(card.options) && card.options.length >= 2) {
        return { ...card, correctAnswer: card.correctAnswer || card.answer };
      }

      // Generate distractors
      const distractors = flashcards
        .filter(c => c.id !== card.id && c.answer !== card.answer)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(c => c.answer);
      const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());
      return { ...card, options, correctAnswer: card.answer };
    });

    setQuestions(processed);
    setCurrentIndex(0);
    setScore(0);
    setConsecutiveCorrect(0);
    setLifelines({ hint: false, fiftyFifty: false, askClass: false, askFriend: false });
    setIsAnswered(false);
    setSelectedOption(null);
    setShowRationale(false);

    setIsLoading(false);
    setView('quiz');
    setIsQuizActive(true);

    if (config.timerDuration !== 'OFF') {
      startTimer();
    }
  };

  // -- 5. LIFELINES --

  const handleFiftyFifty = () => {
    if (isAnswered || lifelines.fiftyFifty) return;
    const incorrect = currentQ.options.filter(o => o !== currentQ.correctAnswer);
    const toRemove = incorrect.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toRemove);
    setLifelines(l => ({ ...l, fiftyFifty: true }));
  };

  const handleAskClass = () => {
    if (isAnswered || lifelines.askClass) return;
    const results = {};
    let total = 100;
    const options = currentQ.options;

    // Correct answer usually gets majority
    const correctShare = Math.floor(Math.random() * 30) + 40;
    results[currentQ.correctAnswer] = correctShare;
    total -= correctShare;

    const others = options.filter(o => o !== currentQ.correctAnswer);
    others.forEach((o, i) => {
      if (i === others.length - 1) results[o] = total;
      else {
        const share = Math.floor(Math.random() * total);
        results[o] = share;
        total -= share;
      }
    });

    setClassPoll(results);
    setLifelines(l => ({ ...l, askClass: true }));
  };

  const handleAskFriend = () => {
    if (isAnswered || lifelines.askFriend) return;
    const names = ["Nurse Tolu", "Dr. Emeka", "Senior Nurse Sarah"];
    const name = names[Math.floor(Math.random() * names.length)];
    setColleagueAdvice({
      name,
      option: currentQ.correctAnswer,
      reasoning: "Based on recent clinical protocols, this is the standard of care for this scenario."
    });
    setLifelines(l => ({ ...l, askFriend: true }));
  };

  // -- 6. RENDERERS --

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="w-20 h-20 border-4 border-medical-100 border-t-medical-500 rounded-full animate-spin" />
        <p className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-widest">Preparing Scenarios</p>
      </div>
    );
  }

  if (view === 'hub') {
    if (activeMode === 'mastery_select') {
      const REQUIRED_SUBJECTS = ["Pharmacology", "Medical Surgical Nursing", "Anatomy", "Physiology", "Community Health", "Mental Health Nursing", "Midwifery", "Pediatrics", "Nursing Ethics", "Research Methods", "Entrepreneurship in Nursing", "Pathophysiology"];
      const sortedSubjects = [...new Set([...REQUIRED_SUBJECTS, ...curriculumSubjects])].sort();

      return (
        <div className="max-w-4xl mx-auto mt-8 space-y-8 animate-in fade-in pb-32 px-4">
          <div className="flex items-center gap-4">
            <button onClick={() => setActiveMode(null)} className="p-3 bg-white dark:bg-slate-800 rounded-2xl text-slate-400 hover:text-medical-600 shadow-sm">
              <ArrowRight size={24} className="rotate-180" />
            </button>
            <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Subject Mastery</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedSubjects.map(subject => (
              <button key={subject} onClick={() => prepareQuiz('mastery', subject)} className="p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm hover:border-medical-500 transition-all text-left flex justify-between items-center group">
                <span className="font-bold text-slate-700 dark:text-slate-200">{subject}</span>
                <ChevronRight size={18} className="text-slate-300 group-hover:text-medical-600" />
              </button>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="max-w-4xl mx-auto mt-8 space-y-12 animate-in fade-in px-4">
        <div className="text-center space-y-4">
          <div className="inline-flex p-3 bg-medical-50 dark:bg-medical-900/20 rounded-2xl text-medical-600">
            <Brain size={32} />
          </div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">Clinical Quiz Hub</h2>
          <p className="text-slate-500 dark:text-slate-400 text-lg font-medium">Elevate your clinical reasoning with targeted simulation.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
          <ModeCard title="Clinical Challenge" description="Full-length exam simulation with rationales." icon={<Award size={32} />} onClick={() => prepareQuiz('clinical')} color="purple" />
          <ModeCard title="Quick Quiz" description="Fast 10-question revision for busy shifts." icon={<BookOpen size={32} />} onClick={() => prepareQuiz('quick')} color="medical" />
          <ModeCard title="Subject Mastery" description="Deep dive into specific nursing courses." icon={<Target size={32} />} onClick={() => prepareQuiz('mastery_select')} color="emerald" />
          <ModeCard title="Speed Challenge" description="Rapid-fire clinical scenarios. Test your reflexes." icon={<Zap size={32} />} onClick={() => prepareQuiz('speed')} color="amber" />
        </div>
      </div>
    );
  }

  if (view === 'setup') {
    const counts = [5, 10, 15, 20, 25, 50, 100];
    const timers = ['OFF', '15', '30', '45', '60'];

    return (
      <div className="max-w-xl mx-auto mt-8 sm:mt-12 space-y-8 animate-in zoom-in-95 px-4">
        <div className="bg-white dark:bg-slate-800 rounded-[3rem] p-8 sm:p-12 shadow-xl border border-slate-100 dark:border-slate-700 space-y-10">
          <div className="text-center space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-medical-600">Configure Session</p>
            <h2 className="text-3xl font-black text-slate-900 dark:text-white">{activeMode === 'mastery' ? selectedSubject : activeMode?.replace('_', ' ')}</h2>
          </div>

          <div className="space-y-6">
            <div className="space-y-3">
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest">Question Count</label>
              <div className="flex flex-wrap gap-2">
                {counts.map(c => (
                  <button
                    key={c}
                    onClick={() => setConfig(prev => ({ ...prev, questionCount: c }))}
                    className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${config.questionCount === c ? 'bg-medical-600 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-900 text-slate-500 hover:bg-slate-100'}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-black uppercase text-slate-400 tracking-widest">Question Timer</label>
              <div className="flex flex-wrap gap-2">
                {timers.map(t => (
                  <button
                    key={t}
                    onClick={() => activeMode !== 'speed' && setConfig(prev => ({ ...prev, timerDuration: t }))}
                    disabled={activeMode === 'speed' && t === 'OFF'}
                    className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${config.timerDuration === t ? 'bg-amber-500 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-900 text-slate-500 hover:bg-slate-100'} ${activeMode === 'speed' && t === 'OFF' ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
                  >
                    {t === 'OFF' ? 'None' : `${t}s`}
                  </button>
                ))}
              </div>
              {activeMode === 'speed' && <p className="text-[10px] text-amber-600 font-bold italic">Timer is mandatory in Speed mode.</p>}
            </div>
          </div>

          <div className="pt-6 space-y-4">
             <button
               onClick={startQuizSession}
               className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
             >
               Start Challenge
             </button>
             <button
               onClick={() => setView('hub')}
               className="w-full py-5 bg-white dark:bg-slate-800 text-slate-400 rounded-2xl font-black uppercase tracking-widest text-[10px] border border-slate-100 dark:border-slate-700"
             >
               Cancel
             </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'results') {
    const accuracy = Math.round((score / questions.length) * 100);
    return (
      <div className="max-w-4xl mx-auto mt-8 p-8 sm:p-16 bg-white dark:bg-slate-800 rounded-[4rem] shadow-2xl text-center space-y-10 animate-in zoom-in-95 px-4 relative overflow-hidden">
        <div className="absolute top-0 inset-x-0 h-2 bg-gradient-to-r from-medical-400 via-purple-400 to-amber-400" />

        <div className="space-y-4">
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="w-24 h-24 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Trophy className="text-amber-500" size={48} />
          </motion.div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Session Complete</h2>
          <p className="text-slate-500 font-bold">Your Rank: <span className="text-medical-600 uppercase tracking-widest ml-2">{MILESTONES[Math.min(Math.floor(score / 3), MILESTONES.length - 1)]}</span></p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
           <ResultStat label="Score" value={`${score}/${questions.length}`} color="text-slate-900" />
           <ResultStat label="Accuracy" value={`${accuracy}%`} color="text-emerald-600" />
           <ResultStat label="XP Earned" value={`+${score * 10}`} color="text-amber-600" />
           <ResultStat label="Streak" value={studyStats.quizStreak} color="text-medical-600" />
        </div>

        <div className="pt-8 space-y-4">
          <button onClick={() => setView('hub')} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-xl hover:shadow-medical-500/20 active:scale-95 transition-all">Continue to Hub</button>
          <div className="flex gap-4">
             <button className="flex-1 py-4 bg-slate-100 dark:bg-slate-900 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-[10px]">Review Errors</button>
             <button className="flex-1 py-4 bg-slate-100 dark:bg-slate-900 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-[10px]">Share Result</button>
          </div>
        </div>
      </div>
    );
  }

  // --- QUIZ VIEW RENDERER ---

  return (
    <div className="fixed inset-0 z-[60] bg-slate-50 dark:bg-slate-950 flex flex-col h-[100dvh] overflow-hidden">
      {/* Header */}
      <header className="shrink-0 p-4 sm:p-6 flex justify-between items-center bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
        <div className="flex items-center gap-4">
           <button onClick={quitQuiz} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><XCircle size={24} /></button>
           <div className="h-8 w-[1px] bg-slate-100 dark:bg-slate-800 mx-2 hidden sm:block" />
           <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-medical-600">Question {currentIndex + 1} of {questions.length}</p>
              <div className="flex items-center gap-2">
                 <div className="w-24 sm:w-48 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }} className="h-full bg-medical-500" />
                 </div>
              </div>
           </div>
        </div>

        <div className="flex items-center gap-4">
           {config.timerDuration !== 'OFF' && (
             <div className={`flex items-center gap-2 px-4 py-2 rounded-full border-2 font-black ${timeLeft <= 5 ? 'border-red-500 text-red-500 bg-red-50' : 'border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300'}`}>
                <Clock size={16} />
                <span>{timeLeft}s</span>
             </div>
           )}
           <div className="hidden sm:flex items-center gap-2 px-4 py-2 bg-slate-50 dark:bg-slate-900 rounded-full text-amber-500 font-black">
              <Star size={16} fill="currentColor" />
              <span>{score}</span>
           </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 relative overflow-y-auto custom-scrollbar p-4 sm:p-8 space-y-6">

        {/* Lifeline Recovery Feedback */}
        <AnimatePresence>
          {lifelineFeedback && (
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-6 py-3 bg-emerald-500 text-white rounded-full font-black text-sm shadow-xl flex items-center gap-2">
               <Zap size={18} fill="currentColor" />
               {lifelineFeedback}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="max-w-4xl mx-auto w-full space-y-8">
           {/* Lifelines */}
           <div className="grid grid-cols-4 gap-2 sm:gap-4">
              <LifelineButton icon={<Zap />} label="Hint" used={lifelines.hint} onClick={() => { setLifelines(l => ({...l, hint: true})); setShowHint(true); }} disabled={isAnswered} />
              <LifelineButton icon={<Shield />} label="50/50" used={lifelines.fiftyFifty} onClick={handleFiftyFifty} disabled={isAnswered} />
              <LifelineButton icon={<Users />} label="Class" used={lifelines.askClass} onClick={handleAskClass} disabled={isAnswered} />
              <LifelineButton icon={<Users />} label="Mentor" used={lifelines.askFriend} onClick={handleAskFriend} disabled={isAnswered} />
           </div>

           {/* Question Card */}
           <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 sm:p-12 shadow-sm border border-slate-100 dark:border-slate-800 space-y-8">
              <div className="space-y-4">
                 <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-medical-500 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Clinical Scenario</span>
                 </div>
                 <h2 className="text-xl sm:text-3xl font-black text-slate-900 dark:text-white leading-snug">
                    {currentQ.question}
                 </h2>
              </div>

              {/* Distractors/Options */}
              <div className="grid gap-4">
                {currentQ.options.map((option, idx) => (
                   <QuizOption
                     key={idx}
                     label={option}
                     index={idx}
                     pollValue={classPoll?.[option]}
                     state={
                       isAnswered
                         ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'idle'))
                         : (selectedOption === option ? 'selected' : (eliminatedOptions.includes(option) ? 'eliminated' : 'idle'))
                     }
                     onClick={() => handleAnswer(option)}
                     disabled={isAnswered || eliminatedOptions.includes(option)}
                   />
                ))}
              </div>

              {/* Clues */}
              <AnimatePresence>
                 {showHint && !isAnswered && (
                   <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-2xl border border-amber-100 dark:border-amber-900/30">
                      <div className="flex items-center gap-2 mb-1 text-amber-600 dark:text-amber-400">
                         <Sparkles size={16} />
                         <span className="text-xs font-black uppercase tracking-widest">Clinical Hint</span>
                      </div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200 italic">{currentQ.hint || "Consider the physiological priority here."}</p>
                   </motion.div>
                 )}
              </AnimatePresence>
           </div>

           {/* Feedback/Rationale Section */}
           <AnimatePresence>
              {showRationale && (
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 animate-in slide-in-from-bottom-4 duration-500">
                   <div className="bg-white dark:bg-slate-900 rounded-[2.5rem] p-8 sm:p-12 shadow-xl border border-slate-100 dark:border-slate-800 space-y-8">
                      <div className="flex items-center gap-4">
                         <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${selectedOption === currentQ.correctAnswer ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                            {selectedOption === currentQ.correctAnswer ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                         </div>
                         <div>
                            <h4 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{selectedOption === currentQ.correctAnswer ? 'Excellent Reasoning' : 'Clinical Learning Point'}</h4>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">NMCN Exam Insight</p>
                         </div>
                      </div>

                      <div className="space-y-6">
                         <div className="space-y-3">
                            <label className="text-[10px] font-black uppercase text-medical-600 tracking-widest">Rationale</label>
                            <p className="text-base sm:text-lg font-medium text-slate-600 dark:text-slate-300 leading-relaxed italic">
                               {currentQ.rationale || "Rationale helps bridge the gap between theory and clinical practice. Focus on the core objective."}
                            </p>
                         </div>

                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                               <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-2">Clinical Context</p>
                               <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{currentQ.clinicalInsight || "Consider how this decision impacts patient stability."}</p>
                            </div>
                            <div className="p-6 bg-amber-50/50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-900/20">
                               <p className="text-[10px] font-black uppercase text-amber-600 tracking-widest mb-2">Exam Strategy</p>
                               <p className="text-sm font-bold text-amber-800 dark:text-amber-200">{currentQ.examTip || "Always look for airway, breathing, and circulation priorities first."}</p>
                            </div>
                         </div>
                      </div>
                   </div>

                   <button
                     onClick={nextQuestion}
                     className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-2xl flex items-center justify-center gap-3 active:scale-95 transition-all mb-20"
                   >
                     {currentIndex < questions.length - 1 ? 'Continue Challenge' : 'Finish Session'}
                     <ArrowRight size={20} />
                   </button>
                </motion.div>
              )}
           </AnimatePresence>
        </div>
      </main>

      {/* Colleague Advice Modal */}
      <AnimatePresence>
         {colleagueAdvice && (
            <div className="fixed inset-0 z-[100] bg-slate-900/80 backdrop-blur-md flex items-center justify-center p-4">
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl space-y-6">
                  <div className="flex items-center gap-4">
                     <div className="w-12 h-12 bg-medical-100 rounded-full flex items-center justify-center text-medical-600"><Users size={24} /></div>
                     <div>
                        <h4 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{colleagueAdvice.name}</h4>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Colleague Advice</p>
                     </div>
                  </div>
                  <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl italic font-medium text-slate-600 dark:text-slate-300">
                     "{colleagueAdvice.reasoning}"
                  </div>
                  <button onClick={() => setColleagueAdvice(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Got it</button>
               </motion.div>
            </div>
         )}
      </AnimatePresence>
    </div>
  );
};

// --- SUB-COMPONENTS ---

const ModeCard = ({ title, description, icon, onClick, color }) => {
  const colors = {
    medical: 'bg-medical-50 text-medical-600 border-medical-100 dark:bg-medical-900/20 dark:border-medical-900/30',
    amber: 'bg-amber-50 text-amber-600 border-amber-100 dark:bg-amber-900/20 dark:border-amber-900/30',
    purple: 'bg-purple-50 text-purple-600 border-purple-100 dark:bg-purple-900/20 dark:border-purple-900/30',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100 dark:bg-emerald-900/20 dark:border-emerald-900/30'
  };

  return (
    <button onClick={onClick} className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-xl hover:scale-[1.02] transition-all text-left group">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${colors[color]}`}>{icon}</div>
      <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium leading-relaxed">{description}</p>
    </button>
  );
};

const LifelineButton = React.memo(({ icon, label, used, onClick, disabled }) => (
  <button
    disabled={used || disabled}
    onClick={onClick}
    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all active:scale-95 ${used ? 'bg-slate-50 dark:bg-slate-900 text-slate-300 border-slate-100 dark:border-slate-800 grayscale' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-medical-600 hover:border-medical-500 shadow-sm'}`}
  >
    {React.cloneElement(icon, { size: 18 })}
    <span className="text-[9px] font-black uppercase tracking-widest mt-2">{label}</span>
  </button>
));

const QuizOption = React.memo(({ label, index, state, pollValue, onClick, disabled }) => {
  const letters = ['A', 'B', 'C', 'D'];

  const styles = useMemo(() => {
    switch (state) {
      case 'selected': return "bg-medical-50 dark:bg-medical-900/30 border-medical-500 text-medical-600 shadow-lg";
      case 'correct': return "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-500 text-emerald-600 shadow-lg";
      case 'wrong': return "bg-red-50 dark:bg-red-900/30 border-red-500 text-red-600 shadow-lg";
      case 'eliminated': return "opacity-20 pointer-events-none grayscale blur-[1px]";
      default: return "bg-white dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-600";
    }
  }, [state]);

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full group relative flex items-center p-5 min-h-[80px] rounded-2xl border-2 transition-all duration-300 ${styles}`}
    >
      <div className="flex items-center gap-4 w-full relative z-10">
         <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border-2 transition-colors ${state === 'correct' ? 'bg-emerald-500 border-emerald-500 text-white' : state === 'wrong' ? 'bg-red-500 border-red-500 text-white' : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-700 group-hover:border-medical-500 group-hover:text-medical-600'}`}>{letters[index]}</span>
         <span className="flex-1 font-bold text-base text-left leading-tight">{label}</span>
         {pollValue !== undefined && (
            <div className="text-right">
               <p className="text-lg font-black">{pollValue}%</p>
               <div className="w-12 h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-medical-500" style={{ width: `${pollValue}%` }} />
               </div>
            </div>
         )}
      </div>
    </button>
  );
});

const ResultStat = ({ label, value, color }) => (
  <div className="bg-slate-50 dark:bg-slate-900/50 p-6 rounded-3xl border border-slate-100 dark:border-slate-800">
    <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-1">{label}</p>
    <p className={`text-2xl font-black ${color}`}>{value}</p>
  </div>
);

export default Quiz;
