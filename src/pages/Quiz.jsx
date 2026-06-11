import React, { useState, useMemo, useEffect, useCallback } from 'react';
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

const Quiz = () => {
  const { flashcards, userProfile, studyStats, updateQuizStats, curriculumSubjects, richardsQuestions } = useAppContext();
  const navigate = useNavigate();

  // -- 1. STATE DECLARATIONS --
  const [quizMode, setQuizMode] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [pendingOption, setPendingOption] = useState(null);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [showHint, setShowHint] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [wrongAttempts, setWrongAttempts] = useState([]);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [noQuestionsFound, setNoQuestionsFound] = useState(false);

  const [lifelinesUsed, setLifelinesUsed] = useState({
    hint: false,
    fiftyFifty: false,
    askClass: false,
    askFriend: false
  });
  const [classPoll, setClassPoll] = useState(null);
  const [colleagueAdvice, setColleagueAdvice] = useState(null);

  const [timeLeft, setTimeLeft] = useState(15);
  const [volumeOn, setVolumeOn] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const currentQ = quizQuestions[currentQuestionIndex];

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

  const processAnswer = useCallback((option) => {
    if (!currentQ) return;

    const correct = option !== null && option === currentQ.correctAnswer;
    setIsCorrect(correct);

    playSound(correct ? 'correct' : 'wrong');

    if (correct) {
      setScore(prev => prev + 1);
      setShowRationale(true);
      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      setWrongAttempts(option !== null ? [option] : []);
      if (quizMode === 'speed') {
        setShowRationale(true);
      }
      updateQuizStats({ quizStreak: 0 });
    }
  }, [currentQ, updateQuizStats, studyStats.quizStreak, quizMode, playSound]);

  useEffect(() => {
    let timer;
    if (quizStarted && quizMode === 'speed' && !showRationale && !showResults && !colleagueAdvice && isCorrect === null && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          const next = prev - 1;
          if (next <= 5 && next > 0) playSound('tick');
          return next;
        });
      }, 1000);
    } else if (timeLeft === 0 && !showRationale && !showResults && quizMode === 'speed' && isCorrect === null) {
      processAnswer(null);
    }
    return () => clearInterval(timer);
  }, [quizStarted, quizMode, showRationale, showResults, colleagueAdvice, timeLeft, isCorrect, processAnswer, playSound]);

  const resetTimer = () => setTimeLeft(15);
  const currentMilestone = MILESTONES[Math.min(Math.floor(score / 3), MILESTONES.length - 1)];

  const startQuiz = (mode, subject = null) => {
    setIsLoadingQuestions(true);
    setNoQuestionsFound(false);
    setQuizQuestions([]);
    let questions = [];

    if (mode === 'quick') {
      const bank = (richardsQuestions && richardsQuestions.length > 0) ? richardsQuestions : RICHARDS_QUESTIONS;
      questions = [...bank].sort(() => 0.5 - Math.random()).slice(0, 10);
      setQuizQuestions(questions);
      setQuizStarted(true);
      setCurrentQuestionIndex(0);
      setScore(0);
      setShowResults(false);
      setSelectedOption(null);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setWrongAttempts([]);
      setEliminatedOptions([]);
      setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false, askFriend: false });
      setClassPoll(null);
      setColleagueAdvice(null);
      setIsLoadingQuestions(false);
      return;
    }

    let pool = flashcards.filter(c => {
      const isPlaceholder = c.id && String(c.id).startsWith('ex_');
      const hasMeaningfulAnswer = c.answer && c.answer.length > 5 && !c.answer.includes("governs specific physiological responses");
      return !isPlaceholder && hasMeaningfulAnswer;
    });

    if (subject) {
      const subLower = subject.toLowerCase();
      pool = pool.filter(c => {
        const cSubject = (c.subject || '').toLowerCase();
        const cTopic = (c.topic || '').toLowerCase();
        return cSubject === subLower || cTopic === subLower || cSubject.includes(subLower);
      });
    }

    const count = mode === 'clinical' ? 20 : mode === 'speed' ? 15 : 10;

    if (pool.length >= 1) {
      const shuffled = [...pool].sort((a, b) => {
        if (a.important && !b.important) return -1;
        if (!a.important && b.important) return 1;
        return 0.5 - Math.random();
      });

      const selected = shuffled.slice(0, count);
      questions = selected.map(card => {
        if (card.options && Array.isArray(card.options) && card.options.length > 0) {
          return { ...card, correctAnswer: card.correctAnswer || card.answer };
        }
        const distractors = flashcards
          .filter(c => c.id !== card.id && c.answer !== card.answer)
          .sort(() => 0.5 - Math.random())
          .slice(0, 3)
          .map(c => c.answer);
        const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());
        return { ...card, options, correctAnswer: card.answer };
      });
    } else if (!subject) {
      questions = [...FALLBACK_QUESTIONS].sort(() => 0.5 - Math.random()).slice(0, Math.min(count, FALLBACK_QUESTIONS.length));
    }

    if (questions.length > 0) {
      setQuizQuestions(questions);
      setQuizStarted(true);
      setCurrentQuestionIndex(0);
      setScore(0);
      setShowResults(false);
      setSelectedOption(null);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setWrongAttempts([]);
      setEliminatedOptions([]);
      setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false, askFriend: false });
      setClassPoll(null);
      setColleagueAdvice(null);
      if (mode === 'speed') resetTimer();
    } else {
      setNoQuestionsFound(true);
    }
    setIsLoadingQuestions(false);
  };

  const handleOptionClick = (option) => {
    if (selectedOption !== null || pendingOption !== null || showRationale || isCorrect !== null) return;
    if (eliminatedOptions.includes(option)) return;
    setPendingOption(option);
  };

  const confirmFinalAnswer = () => {
    if (!pendingOption) return;
    const option = pendingOption;
    setPendingOption(null);
    setSelectedOption(option);
    processAnswer(option);
  };

  const eliminateTwo = useCallback(() => {
    if (isCorrect !== null || showRationale || lifelinesUsed.fiftyFifty || !currentQ) return;
    const incorrectOptions = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    const shuffledIncorrect = [...incorrectOptions].sort(() => 0.5 - Math.random());
    const toEliminate = shuffledIncorrect.slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  }, [isCorrect, showRationale, lifelinesUsed.fiftyFifty, currentQ]);

  const askClass = useCallback(() => {
    if (isCorrect !== null || showRationale || lifelinesUsed.askClass || !currentQ) return;
    const accuracyBase = (currentQ.question || '').length > 100 ? 0.45 : 0.75;
    const results = {};
    let remainingPercentage = 100;
    const options = [...currentQ.options];
    if (Math.random() < accuracyBase) {
      const winnerShare = Math.floor(Math.random() * (82 - 55) + 55);
      results[currentQ.correctAnswer] = winnerShare;
      remainingPercentage -= winnerShare;
    } else {
      const wrongOptions = options.filter(o => o !== currentQ.correctAnswer);
      const deceptiveOption = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
      const winnerShare = Math.floor(Math.random() * (52 - 38) + 38);
      results[deceptiveOption] = winnerShare;
      remainingPercentage -= winnerShare;
    }
    const remainingOptions = options.filter(o => !results[o]);
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
  }, [lifelinesUsed.askClass, currentQ, isCorrect, showRationale]);

  const askColleague = useCallback(() => {
    if (isCorrect !== null || showRationale || lifelinesUsed.askFriend || !currentQ) return;
    const names = ["Nurse Tolu", "Dr. Emeka", "Senior Nurse Sarah", "Head Nurse Ibrahim"];
    const name = names[Math.floor(Math.random() * names.length)];
    const isHard = (currentQ.question || '').length > 120;
    const confidenceBase = isHard ? 0.6 : 0.85;
    const isAdviceCorrect = Math.random() < confidenceBase;
    const adviceOption = isAdviceCorrect ? currentQ.correctAnswer : currentQ.options.filter(o => o !== currentQ.correctAnswer)[0];
    const confidence = Math.floor((isAdviceCorrect ? 75 : 45) + Math.random() * 20);

    setColleagueAdvice({
      name,
      option: adviceOption,
      confidence,
      reasoning: isAdviceCorrect
        ? "In my clinical experience, this aligns with the current nursing best practices."
        : "This is complex, but based on ward protocols, I suspect this path."
    });
    setLifelinesUsed(prev => ({ ...prev, askFriend: true }));
  }, [lifelinesUsed.askFriend, currentQ, isCorrect, showRationale]);

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedOption(null);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setWrongAttempts([]);
      setEliminatedOptions([]);
      setClassPoll(null);
      setColleagueAdvice(null);
      if (quizMode === 'speed') resetTimer();
    } else {
      setShowResults(true);
    }
  };

  const walkAway = () => {
    updateQuizStats({ milestone: currentMilestone });
    setShowResults(true);
  };

  if (showResults) {
    return (
      <div className="max-w-4xl mx-auto mt-8 p-8 bg-white dark:bg-slate-800 rounded-[3rem] shadow-xl text-center space-y-8 animate-in zoom-in-95 px-4">
        <Trophy className="mx-auto text-amber-500" size={64} />
        <div>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Session Complete</h2>
          <p className="text-slate-500 font-bold mt-2">Rank: <span className="text-medical-600">{currentMilestone}</span></p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-sm mx-auto">
          <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
            <p className="text-[10px] font-black uppercase text-slate-400">Score</p>
            <p className="text-2xl font-black">{score}/{quizQuestions.length}</p>
          </div>
          <div className="bg-slate-50 dark:bg-slate-900 p-4 rounded-2xl">
            <p className="text-[10px] font-black uppercase text-slate-400">Accuracy</p>
            <p className="text-2xl font-black text-emerald-600">{Math.round((score / quizQuestions.length) * 100)}%</p>
          </div>
        </div>
        <button onClick={() => { setQuizStarted(false); setQuizMode(null); }} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl">Return to Hub</button>
      </div>
    );
  }

  if (quizMode === 'mastery_select') {
    const REQUIRED_SUBJECTS = ["Pharmacology", "Medical Surgical Nursing", "Anatomy", "Physiology", "Community Health", "Mental Health Nursing", "Midwifery", "Pediatrics", "Nursing Ethics", "Research Methods", "Entrepreneurship in Nursing", "Pathophysiology"];
    const uniqueSubjects = Array.from(new Set([...REQUIRED_SUBJECTS, ...curriculumSubjects]));
    const sortedSubjects = uniqueSubjects.sort((a, b) => a.localeCompare(b));

    return (
      <div className="max-w-4xl mx-auto mt-8 space-y-8 animate-in fade-in pb-32 px-4">
        <div className="flex items-center gap-4">
          <button onClick={() => setQuizMode(null)} className="p-3 bg-white dark:bg-slate-800 rounded-2xl text-slate-400 hover:text-medical-600 shadow-sm">
            <ArrowRight size={24} className="rotate-180" />
          </button>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Subject Mastery</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedSubjects.map(subject => (
            <button key={subject} onClick={() => startQuiz('mastery', subject)} className="p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm hover:border-medical-500 transition-all text-left flex justify-between items-center group">
              <span className="font-bold text-slate-700 dark:text-slate-200">{subject}</span>
              <ChevronRight size={18} className="text-slate-300 group-hover:text-medical-600" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (isLoadingQuestions) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="w-20 h-20 border-4 border-medical-100 border-t-medical-500 rounded-full animate-spin" />
        <p className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-widest">Assembling Curated Bank</p>
      </div>
    );
  }

  if (noQuestionsFound) {
    return (
      <div className="max-w-xl mx-auto mt-20 p-12 bg-white dark:bg-slate-800 rounded-[3rem] text-center space-y-8 px-4">
        <AlertCircle size={48} className="mx-auto text-slate-300" />
        <h2 className="text-3xl font-black text-slate-900 dark:text-white">No Questions Found</h2>
        <button onClick={() => { setNoQuestionsFound(false); setQuizMode(null); }} className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-sm shadow-xl">Return to Hub</button>
      </div>
    );
  }

  if (!quizStarted) {
    return (
      <div className="max-w-4xl mx-auto mt-8 space-y-12 animate-in fade-in px-4">
        <div className="text-center space-y-4">
          <div className="inline-flex p-3 bg-medical-50 dark:bg-medical-900/20 rounded-2xl text-medical-600">
            <Brain size={32} />
          </div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">Clinical Quiz Hub</h2>
          <p className="text-slate-500 dark:text-slate-400 text-lg font-medium">Select a mode to begin your clinical mastery session.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
          <ModeCard title="Clinical Challenge" description="NMCN-style exam simulation." icon={<Award size={32} />} onClick={() => startQuiz('clinical')} color="purple" />
          <ModeCard title="Quick Quiz" description="Fast revision (10 questions)." icon={<BookOpen size={32} />} onClick={() => startQuiz('quick')} color="medical" />
          <ModeCard title="Subject Mastery" description="Master one course." icon={<Target size={32} />} onClick={() => setQuizMode('mastery_select')} color="emerald" />
          <ModeCard title="Speed Challenge" description="Timed rapid fire session." icon={<Zap size={32} />} onClick={() => startQuiz('speed')} color="amber" />
        </div>
      </div>
    );
  }

  if (!currentQ) return null;

  if (quizMode === 'speed') {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-900 flex flex-col h-[100dvh] overflow-hidden text-white font-sans touch-none">
        <header className="shrink-0 p-4 flex justify-between items-center bg-slate-800/50 border-b border-white/5">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-full border-4 border-medical-500 flex items-center justify-center font-black text-xl">{timeLeft}</div>
             <div>
               <p className="text-[10px] font-black uppercase tracking-widest text-medical-400">Question</p>
               <p className="font-black text-lg leading-none">{currentQuestionIndex + 1} of {quizQuestions.length}</p>
             </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setVolumeOn(!volumeOn)} className={`p-3 rounded-xl transition-all ${volumeOn ? 'bg-medical-500/20 text-medical-400' : 'bg-slate-700 text-slate-500'}`}>
              {volumeOn ? <Volume2 size={18} /> : <XCircle size={18} />}
            </button>
            <button onClick={() => setShowSettings(true)} className="p-3 bg-slate-700 rounded-xl"><Settings size={18} /></button>
          </div>
        </header>

        <main className="flex-1 flex flex-col px-4 py-6 max-w-5xl mx-auto w-full overflow-y-auto">
           <div className="shrink-0 flex justify-center gap-2 mb-6">
             <SpeedLifeline icon={<Shield size={16} />} label="50/50" used={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} />
             <SpeedLifeline icon={<Users size={16} />} label="Class" used={lifelinesUsed.askClass} onClick={askClass} />
             <SpeedLifeline icon={<Brain size={16} />} label="Colleague" used={lifelinesUsed.askFriend} onClick={askColleague} />
           </div>

           <div className="shrink-0 flex flex-col items-center justify-center text-center space-y-4 mb-8">
              <h2 className="text-xl sm:text-2xl font-black leading-tight">{currentQ.question}</h2>
           </div>

           <div className="grid grid-cols-2 gap-3 pb-8">
              {currentQ.options.map((option, idx) => (
                <SpeedOption
                  key={idx} label={option}
                  color={idx === 0 ? "bg-red-500" : idx === 1 ? "bg-blue-500" : idx === 2 ? "bg-amber-500" : "bg-emerald-500"}
                  icon={idx === 0 ? <Triangle size={24} fill="currentColor" /> : idx === 1 ? <Diamond size={24} fill="currentColor" /> : idx === 2 ? <Circle size={24} fill="currentColor" /> : <Square size={24} fill="currentColor" />}
                  onClick={() => handleOptionClick(option)}
                  disabled={showRationale || isCorrect !== null || eliminatedOptions.includes(option) || pendingOption !== null}
                  state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'idle')) : (selectedOption === option || pendingOption === option ? 'selected' : (eliminatedOptions.includes(option) ? 'wrong' : 'idle'))}
                />
              ))}
           </div>

           <AnimatePresence>
             {pendingOption && (
               <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed inset-x-4 bottom-24 z-50 bg-slate-800/95 backdrop-blur-xl p-8 rounded-[3rem] border border-white/20 shadow-2xl flex flex-col items-center gap-6 text-center">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Final Confirmation</p>
                    <h4 className="text-xl font-black">Confirm this answer?</h4>
                  </div>
                  <div className="flex gap-3 w-full">
                    <button onClick={() => setPendingOption(null)} className="flex-1 py-5 bg-white/10 rounded-2xl font-black uppercase tracking-widest text-xs">Change</button>
                    <button onClick={confirmFinalAnswer} className="flex-[2] py-5 bg-medical-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Confirm</button>
                  </div>
               </motion.div>
             )}
           </AnimatePresence>
        </main>

        <AnimatePresence>
          {showRationale && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] bg-slate-900 p-8 flex flex-col justify-center items-center text-center space-y-8">
               <div className={`w-24 h-24 rounded-full flex items-center justify-center ${isCorrect ? 'bg-emerald-500' : 'bg-red-500'}`}>
                 {isCorrect ? <CheckCircle2 size={48} /> : <XCircle size={48} />}
               </div>
               <div className="space-y-4 max-w-2xl">
                 <h3 className="text-4xl font-black">{isCorrect ? 'GENIUS!' : 'NOT QUITE...'}</h3>
                 <p className="text-xl text-slate-300 font-medium leading-relaxed">{currentQ.rationale || 'Keep pushing your clinical limits.'}</p>
               </div>
               <button onClick={nextQuestion} className="px-12 py-6 bg-white text-slate-900 rounded-3xl font-black text-xl shadow-2xl">NEXT QUESTION</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col min-h-screen space-y-4 pb-32 px-4 relative overflow-hidden">
      <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mt-4">
        <motion.div className="h-full bg-medical-500" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} />
      </div>

      <div className="flex justify-between items-end">
        <div className="space-y-2">
           <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-medical-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-medical-600 dark:text-medical-400">{currentMilestone}</span>
           </div>
           <h3 className="text-2xl font-black text-slate-900 dark:text-white">Question {currentQuestionIndex + 1}</h3>
        </div>
        <div className="flex flex-col items-end">
           <div className="flex items-center gap-1.5 mb-1">
              <Star className="text-amber-500 fill-amber-500" size={14} />
              <span className="text-[10px] font-black uppercase text-slate-400">Streak</span>
           </div>
           <p className="text-3xl font-black text-slate-900 dark:text-white leading-none">{studyStats.quizStreak || 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <LifelineButton icon={<Zap />} label="Hint" used={lifelinesUsed.hint} onClick={() => { setShowHint(true); setLifelinesUsed(p => ({...p, hint: true})); }} />
        <LifelineButton icon={<Shield />} label="50/50" used={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} />
        <LifelineButton icon={<Users />} label="Class" used={lifelinesUsed.askClass} onClick={askClass} />
        <LifelineButton icon={<Users />} label="Colleague" used={lifelinesUsed.askFriend} onClick={askColleague} />
      </div>

      <div className="relative flex-1 flex flex-col bg-slate-900 rounded-[3rem] p-8 border border-white/10 shadow-2xl overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={currentQuestionIndex} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} className="flex-1 flex flex-col">
            <div className="flex-1 flex flex-col space-y-6 pt-4 text-center">
              {currentQ.source && currentQ.source.includes('Richard') && (
                <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 mx-auto">
                   <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Source: Richard's Question Bank</span>
                </div>
              )}
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-medical-500/60">Subject: {currentQ.subject}</p>
              <h2 className="text-2xl sm:text-4xl font-black text-white leading-tight">{currentQ.question}</h2>

              {showHint && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-2xl mx-8">
                  <p className="text-sm text-amber-200/80 font-medium italic">{currentQ.hint || "Focus on the primary intervention."}</p>
                </motion.div>
              )}
            </div>

            <div className="grid gap-4 mt-12 mb-8">
              {currentQ.options.map((option, idx) => (
                <OptionButton
                  key={idx} label={option} index={idx} pollValue={classPoll?.[option]}
                  state={eliminatedOptions.includes(option) ? "eliminated" : (wrongAttempts.includes(option) ? "wrong" : (selectedOption === option ? (isCorrect === null ? "selected" : (isCorrect ? "correct" : "wrong")) : (showRationale && option === currentQ.correctAnswer ? "correct" : "idle")))}
                  onClick={() => handleOptionClick(option)}
                  disabled={isCorrect !== null || showRationale || eliminatedOptions.includes(option)}
                />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {pendingOption && (
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="absolute inset-x-8 bottom-24 z-50 bg-slate-800/95 backdrop-blur-xl p-8 rounded-[3rem] border border-white/20 shadow-2xl flex flex-col items-center gap-6 text-center">
              <h4 className="text-xl font-black text-white">Confirm Final Answer?</h4>
              <div className="flex gap-4 w-full">
                <button onClick={() => setPendingOption(null)} className="flex-1 py-5 bg-white/10 rounded-2xl font-black text-white uppercase tracking-widest text-xs">Change</button>
                <button onClick={confirmFinalAnswer} className="flex-[2] py-5 bg-medical-500 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Confirm</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {colleagueAdvice && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <div className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl space-y-6">
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{colleagueAdvice.name} Advice</h3>
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300 italic">"{colleagueAdvice.reasoning}"</p>
              <button onClick={() => setColleagueAdvice(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Back</button>
            </div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRationale && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-xl border border-slate-100 dark:border-slate-700">
               <div className="flex items-center gap-3 mb-6">
                  <div className={`p-2 rounded-xl ${isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                     {isCorrect ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                  </div>
                  <h4 className="text-xl font-black text-slate-900 dark:text-white">{isCorrect ? 'Excellent!' : 'Correct Answer:'}</h4>
               </div>
               <p className="text-lg font-medium text-slate-600 dark:text-slate-300 leading-relaxed italic">{currentQ.rationale || "Keep studying to master this concept."}</p>
            </div>
            <div className="flex gap-4">
               <button onClick={walkAway} className="flex-1 py-5 bg-white dark:bg-slate-800 text-slate-600 rounded-2xl font-black uppercase tracking-widest text-[10px] border border-slate-100 dark:border-slate-700">Walk Away</button>
               <button onClick={nextQuestion} className="flex-[2] py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl">{currentQuestionIndex < quizQuestions.length - 1 ? 'Next' : 'Finish'}</button>
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- HELPER COMPONENTS ---

const ModeCard = ({ title, description, icon, onClick, color }) => {
  const colorMap = {
    medical: 'text-medical-600 bg-medical-50 dark:bg-medical-900/20 border-medical-100',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-100',
    purple: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20 border-purple-100',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100'
  };
  return (
    <button onClick={onClick} className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-xl transition-all text-left group">
      <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${colorMap[color]}`}>{icon}</div>
      <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">{description}</p>
    </button>
  );
};

const LifelineButton = React.memo(({ icon, label, used, onClick }) => (
  <button disabled={used} onClick={onClick} className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all active:scale-95 ${used ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 text-slate-300 grayscale' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-medical-600 hover:border-medical-500'}`}>
    {React.cloneElement(icon, { size: 18 })}
    <span className="text-[9px] font-black uppercase tracking-widest mt-2">{label}</span>
  </button>
));

const SpeedOption = React.memo(({ label, color, icon, onClick, disabled, state }) => {
  let stateStyles = "";
  if (state === 'selected') stateStyles = "ring-4 ring-white ring-offset-2 ring-offset-slate-900 scale-95";
  if (state === 'correct') stateStyles = "ring-4 ring-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.4)]";
  if (state === 'wrong') stateStyles = "opacity-40 grayscale scale-90";

  return (
    <button disabled={disabled} onClick={onClick} className={`relative min-h-[120px] rounded-[2.5rem] p-6 flex flex-col items-center justify-center text-center transition-all duration-300 active:scale-95 group ${color} ${stateStyles}`}>
      <div className="absolute top-3 left-3 opacity-30 group-hover:opacity-50">{icon}</div>
      <span className="font-black text-sm sm:text-base leading-tight">{label}</span>
    </button>
  );
});

const SpeedLifeline = React.memo(({ icon, label, used, onClick }) => (
  <button disabled={used} onClick={onClick} className={`px-4 py-2 rounded-full border transition-all flex items-center gap-2 ${used ? 'bg-slate-800/50 border-white/5 text-slate-600' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
    {icon}<span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">{label}</span>
  </button>
));

const OptionButton = React.memo(({ label, index, state, pollValue, onClick, disabled }) => {
  const letters = ['A', 'B', 'C', 'D'];
  let styles = "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/30";
  if (state === 'selected') styles = "bg-amber-500/20 border-amber-500 text-amber-500";
  if (state === 'correct') styles = "bg-emerald-500/20 border-emerald-500 text-emerald-500";
  if (state === 'wrong') styles = "bg-red-500/20 border-red-500 text-red-500";
  if (state === 'eliminated') styles = "opacity-20 pointer-events-none grayscale blur-[1px]";

  return (
    <button disabled={disabled} onClick={onClick} className={`w-full group relative flex items-center p-5 min-h-[72px] rounded-2xl border-2 transition-all duration-300 ${styles}`}>
      <div className="flex items-center gap-4 w-full relative z-10">
         <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border ${state === 'selected' ? 'bg-amber-500 border-amber-400 text-white' : 'bg-white/10 border-white/10'}`}>{letters[index]}</span>
         <span className="flex-1 font-bold text-sm sm:text-base text-left leading-tight">{label}</span>
         {pollValue !== undefined && (
            <div className="text-right">
               <p className="text-lg font-black">{pollValue}%</p>
               <div className="w-12 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-medical-500" style={{ width: `${pollValue}%` }} />
               </div>
            </div>
         )}
      </div>
    </button>
  );
});

export default Quiz;
