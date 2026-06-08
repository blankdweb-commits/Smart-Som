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
  const [quizMode, setQuizMode] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("subject-mastery")) return "mastery_select";
    return null;
  });
  const [selectedSubject, setSelectedSubject] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("subject-mastery")) return "mastery_select";
    return null;
  });
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [selectedOption, setSelectedOption] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("subject-mastery")) return "mastery_select";
    return null;
  });
  const [pendingOption, setPendingOption] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("subject-mastery")) return "mastery_select";
    return null;
  }); // For "Final Answer" confirmation
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [showHint, setShowHint] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("subject-mastery")) return "mastery_select";
    return null;
  });
  const [wrongAttempts, setWrongAttempts] = useState([]);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(false);
  const [noQuestionsFound, setNoQuestionsFound] = useState(false);

  // Lifeline state - persists through the quiz session
  const [lifelinesUsed, setLifelinesUsed] = useState({
    hint: false,
    fiftyFifty: false,
    askClass: false,
    askFriend: false
  });
  const [classPoll, setClassPoll] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("subject-mastery")) return "mastery_select";
    return null;
  });
  const [colleagueAdvice, setColleagueAdvice] = useState(() => {
    const path = window.location.pathname;
    if (path.includes("subject-mastery")) return "mastery_select";
    return null;
  });

  // Speed mode specific state
  const [timeLeft, setTimeLeft] = useState(15);
  const [volumeOn, setVolumeOn] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const processAnswer = useCallback((option) => {
    const currentQ = quizQuestions[currentQuestionIndex];
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
      // In Speed mode, we show rationale immediately even for wrong answers to avoid freezing
      if (quizMode === 'speed') {
        setShowRationale(true);
      }
      updateQuizStats({ quizStreak: 0 });
    }
  }, [quizQuestions, currentQuestionIndex, updateQuizStats, studyStats.quizStreak, quizMode]);

  // -- 2. SIDE EFFECTS --
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
      processAnswer(null); // Auto-fail on timeout
    }
    return () => clearInterval(timer);
  }, [quizStarted, quizMode, showRationale, showResults, colleagueAdvice, timeLeft, isCorrect, processAnswer]);

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
      return;
    }

    // Prioritize high-quality content (NMCN, NCLEX, or specific IDs)
    // Avoid IDs starting with 'ex_' which are generated placeholders
    let pool = flashcards.filter(c => {
      const isPlaceholder = c.id && String(c.id).startsWith('ex_');
      const hasMeaningfulAnswer = c.answer && c.answer.length > 5 && !c.answer.includes("governs specific physiological responses");
      return !isPlaceholder && hasMeaningfulAnswer;
    });

    if (subject) {
      // Strict matching for Subject Mastery to avoid cross-contamination
      const subLower = subject.toLowerCase();
      pool = pool.filter(c => {
        const cSubject = (c.subject || '').toLowerCase();
        const cTopic = (c.topic || '').toLowerCase();

        // Exact match or contains for compound names
        return cSubject === subLower ||
               cTopic === subLower ||
               cSubject.includes(subLower) ||
               (subLower.includes('community') && cSubject.includes('community')) ||
               (subLower.includes('surgical') && cSubject.includes('surgical')) ||
               (subLower.includes('mental') && cSubject.includes('mental'));
      });
    } else {
      // For general modes, exclude placeholders if possible
      if (pool.length < 10) {
        pool = [...pool, ...flashcards.filter(c => c.id && String(c.id).startsWith('ex_'))];
      }
    }

    const count = mode === 'clinical' ? 20 : mode === 'speed' ? 15 : 10;

    if (pool.length >= 1) {
      // Sort to prioritize "important" cards or those with rationales
      const shuffled = [...pool].sort((a, b) => {
        if (a.important && !b.important) return -1;
        if (!a.important && b.important) return 1;
        return 0.5 - Math.random();
      });

      const selected = shuffled.slice(0, count);
      questions = selected.map(card => {
        // If question already has options (Richards format), use them
        if (card.options && Array.isArray(card.options) && card.options.length > 0) {
          return { ...card, correctAnswer: card.correctAnswer || card.answer };
        }

        // Otherwise generate distractors from the full flashcard pool
        const distractors = flashcards
          .filter(c => c.id !== card.id && c.answer !== card.answer)
          .sort(() => 0.5 - Math.random())
          .slice(0, 3)
          .map(c => c.answer);
        const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());
        return { ...card, options, correctAnswer: card.answer };
      });
    } else if (!subject) {
      // ONLY use generic fallbacks for non-subject modes if nothing found
      questions = [...FALLBACK_QUESTIONS].sort(() => 0.5 - Math.random()).slice(0, Math.min(count, FALLBACK_QUESTIONS.length));
    }

    if (questions.length > 0) {
      setTimeout(() => {
        setQuizQuestions(questions);
        setQuizStarted(true);
        setIsLoadingQuestions(false);
      }, 400);
    } else {
      setIsLoadingQuestions(false);
      setNoQuestionsFound(true);
    }
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
    if (quizMode === 'speed') resetTimer();
  };

  const handleOptionClick = (option) => {
    if (selectedOption !== null || pendingOption !== null || showRationale || isCorrect !== null) return;
    if (eliminatedOptions.includes(option)) return;

    // Always use confirmation system for all modes as requested
    setPendingOption(option);
  };

  const confirmFinalAnswer = () => {
    if (!pendingOption) return;
    const option = pendingOption;
    setPendingOption(null);
    setSelectedOption(option);
    processAnswer(option);
  };

  const playSound = (type) => {
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
  };

  const eliminateTwo = useCallback(() => {
    if (isCorrect !== null || showRationale || lifelinesUsed.fiftyFifty || !quizQuestions[currentQuestionIndex]) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrectOptions = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    // Ensure we exactly remove two wrong answers by shuffling and slicing
    const shuffledIncorrect = [...incorrectOptions].sort(() => 0.5 - Math.random());
    const toEliminate = shuffledIncorrect.slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  }, [isCorrect, showRationale, lifelinesUsed.fiftyFifty, quizQuestions, currentQuestionIndex]);

  const askClass = useCallback(() => {
    if (isCorrect !== null || showRationale || lifelinesUsed.askClass || !quizQuestions[currentQuestionIndex]) return;
    const currentQ = quizQuestions[currentQuestionIndex];
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
  }, [lifelinesUsed.askClass, quizQuestions, currentQuestionIndex, isCorrect, showRationale]);

  const askColleague = useCallback(() => {
    if (isCorrect !== null || showRationale || lifelinesUsed.askFriend || !quizQuestions[currentQuestionIndex]) return;
    const currentQ = quizQuestions[currentQuestionIndex];
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
        ? "In my clinical experience, this aligns with the current nursing best practices for this scenario."
        : "This is a complex case, but based on typical ward protocols, I suspect this might be the path."
    });
    setLifelinesUsed(prev => ({ ...prev, askFriend: true }));
  }, [lifelinesUsed.askFriend, quizQuestions, currentQuestionIndex, isCorrect, showRationale]);

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOption(null);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setWrongAttempts([]);
      setEliminatedOptions([]);
      setClassPoll(null);
      if (quizMode === 'speed') resetTimer();
    } else {
      setShowResults(true);
    }
  };

  const walkAway = () => {
    updateQuizStats({ milestone: currentMilestone });
    setShowResults(true);
  };

  if (quizMode === 'mastery_select') {
    const REQUIRED_SUBJECTS = ["Pharmacology", "Medical Surgical Nursing", "Anatomy", "Physiology", "Community Health", "Mental Health Nursing", "Midwifery", "Pediatrics", "Nursing Ethics", "Research Methods", "Entrepreneurship in Nursing", "Pathophysiology"];

    // Combine curriculum subjects with standard required categories to ensure they always appear
    const uniqueSubjects = Array.from(new Set([...REQUIRED_SUBJECTS, ...curriculumSubjects]));

    // Sort subjects so required ones come first
    const sortedSubjects = uniqueSubjects.sort((a, b) => {
      const aReqIdx = REQUIRED_SUBJECTS.findIndex(r => a.includes(r));
      const bReqIdx = REQUIRED_SUBJECTS.findIndex(r => b.includes(r));

      if (aReqIdx !== -1 && bReqIdx !== -1) return aReqIdx - bReqIdx;
      if (aReqIdx !== -1) return -1;
      if (bReqIdx !== -1) return 1;
      return a.localeCompare(b);
    });

    const masteryStats = {
      overallAccuracy: 85,
      totalAttempted: 1240,
      strongAreas: ['Pharmacology', 'Anatomy'],
      weakAreas: ['Midwifery', 'Research Methods']
    };

    return (
      <div className="max-w-4xl mx-auto mt-4 sm:mt-8 space-y-6 sm:space-y-8 animate-in fade-in duration-500 pb-32 px-4">
        <div className="flex items-center gap-4">
          <button onClick={() => { setQuizMode(null); setQuizStarted(false); }} className="p-3 bg-white dark:bg-slate-800 rounded-2xl text-slate-400 hover:text-medical-600 shadow-sm transition-all">
            <ArrowRight size={24} className="rotate-180" />
          </button>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">Subject Mastery</h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
           <div className="bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm">
              <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Accuracy</p>
              <p className="text-xl font-black text-emerald-600">{masteryStats.overallAccuracy}%</p>
           </div>
           <div className="bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm">
              <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-1">Attempted</p>
              <p className="text-xl font-black text-slate-900 dark:text-white">{masteryStats.totalAttempted}</p>
           </div>
           <div className="bg-white dark:bg-slate-800 p-4 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm col-span-2">
              <p className="text-[8px] font-black uppercase text-slate-400 tracking-widest mb-2">Focus Topics</p>
              <div className="flex flex-wrap gap-1.5">
                 {masteryStats.weakAreas.map(t => (
                   <span key={t} className="px-2 py-1 bg-red-50 text-red-600 rounded-lg text-[9px] font-bold"> {t} </span>
                 ))}
              </div>
           </div>
        </div>

        <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">Select a nursing course to begin specialized revision.</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {sortedSubjects.map(subject => (
            <button
              key={subject}
              onClick={() => {
                setSelectedSubject(subject);
                setQuizMode('mastery');
                startQuiz('mastery', subject);
              }}
              className="p-5 sm:p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-medical-500 transition-all text-left flex justify-between items-center group"
            >
              <span className="font-bold text-sm sm:text-base text-slate-700 dark:text-slate-200">{subject}</span>
              <ChevronRight size={18} className="text-slate-300 group-hover:text-medical-600 transition-colors" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (isLoadingQuestions) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
        <div className="relative">
          <div className="w-20 h-20 border-4 border-medical-100 border-t-medical-500 rounded-full animate-spin" />
          <Brain className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-medical-500 animate-pulse" size={32} />
        </div>
        <div className="text-center">
          <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-widest">Assembling Curated Bank</h3>
          <p className="text-slate-500 font-bold text-sm mt-2">Strict clinical filters active...</p>
        </div>
      </div>
    );
  }

  if (noQuestionsFound) {
    return (
      <div className="max-w-xl mx-auto mt-20 p-12 bg-white dark:bg-slate-800 rounded-[3rem] border-2 border-dashed border-slate-100 dark:border-slate-700 text-center space-y-8 animate-in zoom-in-95 duration-500 shadow-xl px-4">
        <div className="w-24 h-24 bg-slate-50 dark:bg-slate-900/50 rounded-full flex items-center justify-center mx-auto text-slate-300">
          <AlertCircle size={48} />
        </div>
        <div className="space-y-4">
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">No Questions Available Yet</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium">
            We are currently building the high-yield bank for <span className="text-medical-600 font-black">{selectedSubject || 'this category'}</span>.
            Check back soon for NMCN-standard content.
          </p>
        </div>
        <button
          onClick={() => { setNoQuestionsFound(false); setQuizMode(null); setQuizStarted(false); }}
          className="w-full py-5 bg-slate-900 text-white rounded-[2rem] font-black uppercase tracking-widest text-sm shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
        >
          Return to Hub
        </button>
      </div>
    );
  }

  if (!quizStarted) {
    return (
      <div className="max-w-4xl mx-auto mt-4 sm:mt-8 space-y-8 sm:space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 px-4">
        <div className="text-center space-y-2 sm:space-y-4">
          <div className="inline-flex p-2 sm:p-3 bg-medical-50 dark:bg-medical-900/20 rounded-xl sm:rounded-2xl text-medical-600 mb-1 sm:mb-2">
            <Brain size={24} className="sm:w-8 sm:h-8" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tighter">Clinical Quiz Hub</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-lg font-medium max-w-2xl mx-auto">
            Select a mode to begin your clinical mastery session.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 pb-20">
          <ModeCard
            title="Clinical Challenge"
            description="NMCN-style exam simulation with score tracking."
            icon={<Award size={32} />}
            stats="Exam Prep"
            onClick={() => { setQuizMode('clinical'); startQuiz('clinical'); }}
            color="purple"
          />
          <ModeCard
            title="Quick Quiz"
            description="Fast revision (5-10 questions) with immediate rationale."
            icon={<BookOpen size={32} />}
            stats="Rapid Learning"
            onClick={() => { setQuizMode('quick'); startQuiz('quick'); }}
            color="medical"
          />
          <ModeCard
            title="Subject Mastery"
            description="Master one course. Progress tracked by subject."
            icon={<Target size={32} />}
            stats="Specialized"
            onClick={() => setQuizMode('mastery_select')}
            color="emerald"
          />
          <ModeCard
            title="Speed Challenge"
            description="High-intensity rapid fire. Streaks & bonus points."
            icon={<Zap size={32} />}
            stats="Timed"
            onClick={() => { setQuizMode('speed'); startQuiz('speed'); }}
            color="amber"
          />
        </div>
      </div>
    );
  }

  if (quizMode === 'mastery_select') {
    const REQUIRED_SUBJECTS = ["Pharmacology", "Medical Surgical Nursing", "Anatomy", "Physiology", "Community Health Nursing", "Mental Health Nursing", "Midwifery", "Pediatrics", "Nursing Ethics", "Research Methods", "Entrepreneurship in Nursing", "Pathophysiology"];

  if (quizStarted && !currentQ) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <RefreshCw className="animate-spin text-medical-600" size={48} />
        <p className="text-slate-500 font-bold animate-pulse uppercase tracking-widest text-xs">Preparing Scenarios...</p>
      </div>
    );
  }

  if (quizStarted && quizMode === 'speed') {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-900 flex flex-col h-[100dvh] overflow-hidden text-white font-sans touch-none selection:bg-medical-500/30">
        <header className="shrink-0 p-2 sm:p-4 flex justify-between items-center bg-slate-800/50 backdrop-blur-md border-b border-white/5 z-10">
          <div className="flex items-center gap-3 sm:gap-4">
             <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full border-2 sm:border-4 border-medical-500 flex items-center justify-center font-black text-lg sm:text-xl">
               {timeLeft}
             </div>
             <div>
               <p className="text-[8px] sm:text-[10px] font-black uppercase tracking-widest text-medical-400">Question</p>
               <p className="font-black text-base sm:text-lg leading-none">{currentQuestionIndex + 1} of {quizQuestions.length}</p>
             </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <button
              onClick={() => setVolumeOn(!volumeOn)}
              className={`p-2 sm:p-3 rounded-xl transition-all ${volumeOn ? 'bg-medical-500/20 text-medical-400' : 'bg-slate-700 text-slate-500'}`}
            >
              {volumeOn ? <Volume2 size={18} /> : <XCircle size={18} />}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 sm:p-3 bg-slate-700 rounded-xl text-white"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col min-h-0 px-3 sm:px-8 py-2 sm:py-6 space-y-2 sm:space-y-4 max-w-5xl mx-auto w-full overflow-y-auto overscroll-contain">
           <div className="shrink-0 flex justify-center gap-1 sm:gap-2">
             <SpeedLifeline icon={<Shield size={16} />} label="50/50" used={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} />
             <SpeedLifeline icon={<Users size={16} />} label="Class" used={lifelinesUsed.askClass} onClick={askClass} />
             <SpeedLifeline icon={<Brain size={16} />} label="Colleague" used={lifelinesUsed.askFriend} onClick={askColleague} />
           </div>

           <div className="shrink-0 flex flex-col items-center justify-center text-center space-y-2 min-h-[12vh] max-h-[35vh] overscroll-contain">
              <div className="max-h-[25vh] overflow-y-auto px-1 w-full custom-scrollbar overscroll-contain">
                <h2 className="font-black tracking-tight leading-snug transition-all duration-500 break-words whitespace-normal text-balance" style={{ fontSize: 'clamp(0.9rem, 2.5vw, 1.1rem)' }}>
                  {currentQ.question}
                </h2>
              </div>
           </div>

           <div className="shrink-0 grid grid-cols-2 gap-2 sm:gap-3 pb-4 overscroll-contain" style={{ gridAutoRows: 'minmax(90px, auto)' }}>
              {currentQ.options.map((option, idx) => (
                <SpeedOption
                  key={idx}
                  label={option}
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
               <motion.div
                 initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                 className="absolute inset-x-4 bottom-24 z-50 bg-slate-800/95 backdrop-blur-xl p-6 rounded-[2rem] border border-white/20 shadow-2xl flex flex-col items-center gap-4 text-center"
               >
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Final Confirmation</p>
                    <h4 className="text-lg font-black">Is this your final answer?</h4>
                  </div>
                  <div className="flex gap-3 w-full">
                    <button onClick={() => setPendingOption(null)} className="flex-1 py-4 bg-white/10 hover:bg-white/20 rounded-2xl font-black uppercase tracking-widest text-[10px]">Change</button>
                    <button onClick={confirmFinalAnswer} className="flex-[2] py-4 bg-medical-500 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-500/20">Confirm Answer</button>
                  </div>
               </motion.div>
             )}
           </AnimatePresence>
        </main>

        <AnimatePresence>
          {showRationale && (
            <motion.div
              initial={{ opacity: 0, y: 100 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 100 }}
              className="absolute inset-0 z-[70] bg-slate-900 p-8 flex flex-col justify-center items-center text-center space-y-8"
            >
               <div className={`w-24 h-24 rounded-full flex items-center justify-center ${isCorrect ? 'bg-emerald-500' : 'bg-red-500'}`}>
                 {isCorrect ? <CheckCircle2 size={48} /> : <XCircle size={48} />}
               </div>
               <div className="space-y-4 max-w-2xl">
                 <h3 className="text-4xl font-black">{isCorrect ? 'GENIUS!' : 'NOT QUITE...'}</h3>
                 <p className="text-xl text-slate-300 font-medium leading-relaxed">{currentQ.rationale || 'Keep pushing your clinical limits.'}</p>
               </div>
               <button onClick={nextQuestion} className="px-12 py-6 bg-white text-slate-900 rounded-3xl font-black text-xl shadow-2xl active:scale-95 transition-all">NEXT QUESTION</button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSettings && (
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4">
                <div className="bg-slate-800 w-full max-w-md rounded-[3rem] p-10 border border-white/10 space-y-8">
                   <h3 className="text-3xl font-black text-center uppercase tracking-tighter">Session Settings</h3>
                   <button onClick={() => setShowSettings(false)} className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Done</button>
                   <button onClick={() => { setQuizStarted(false); setQuizMode(null); setShowSettings(false); }} className="w-full py-5 bg-red-500/10 text-red-500 rounded-2xl font-black uppercase tracking-widest text-xs border border-red-500/20">Quit Challenge</button>
                </div>
             </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100dvh-80px)] lg:h-auto lg:min-h-screen space-y-2 sm:space-y-4 pb-20 lg:pb-32 relative overflow-hidden px-2 sm:px-4 overscroll-none">
      {/* Visual Progress Bar */}
      <div className="w-full h-1 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shrink-0 mt-1 sm:mt-0">
        <motion.div
          className="h-full bg-medical-500"
          initial={{ width: 0 }}
          animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
        />
      </div>

      <div className="flex justify-between items-end px-2 shrink-0 mt-0.5 sm:mt-4">
        <div className="space-y-0.5 sm:space-y-2">
           <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-medical-500 animate-pulse" />
              <span className="text-[8px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-medical-600 dark:text-medical-400">{currentMilestone}</span>
           </div>
           <h3 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">Question {currentQuestionIndex + 1}</h3>
        </div>
        <div className="flex flex-col items-end">
           <div className="flex items-center gap-1.5 mb-0.5">
              <Star className="text-amber-500 fill-amber-500" size={12} />
              <span className="text-[9px] font-black uppercase text-slate-400">Streak</span>
           </div>
           <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white leading-none">{studyStats.quizStreak || 0}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 sm:gap-3 shrink-0">
        <LifelineButton icon={<Zap />} label="Hint" used={lifelinesUsed.hint} onClick={() => { setShowHint(true); setLifelinesUsed(p => ({...p, hint: true})); }} />
        <LifelineButton icon={<Shield />} label="50/50" used={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} />
        <LifelineButton icon={<Users />} label="Class" used={lifelinesUsed.askClass} onClick={askClass} />
        <LifelineButton icon={<Users />} label="Colleague" used={lifelinesUsed.askFriend} onClick={askColleague} />
      </div>

      <div className="relative flex-1 flex flex-col min-h-0">
        <AnimatePresence>
             {pendingOption && (
               <motion.div
                 initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                 className="absolute inset-x-4 bottom-24 z-50 bg-slate-800/95 backdrop-blur-xl p-6 rounded-[2rem] border border-white/20 shadow-2xl flex flex-col items-center gap-4 text-center"
               >
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Final Confirmation</p>
                    <h4 className="text-lg font-black text-white">Is this your final answer?</h4>
                  </div>
                  <div className="flex gap-3 w-full">
                    <button onClick={() => setPendingOption(null)} className="flex-1 py-4 bg-white/10 hover:bg-white/20 rounded-2xl font-black text-white uppercase tracking-widest text-[10px]">Change</button>
                    <button onClick={confirmFinalAnswer} className="flex-[2] py-4 bg-medical-500 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-500/20">Confirm Answer</button>
                  </div>
               </motion.div>
             )}
        </AnimatePresence>

        <div className="absolute inset-0 bg-slate-900 rounded-[1.5rem] sm:rounded-[3rem] blur-2xl opacity-10 dark:opacity-40" />
        <div className="relative flex-1 flex flex-col bg-slate-900 dark:bg-slate-950 rounded-[1.5rem] sm:rounded-[3rem] p-2.5 sm:p-8 border border-white/10 shadow-2xl overflow-hidden">

           <AnimatePresence mode="wait">
             <motion.div
               key={currentQuestionIndex} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }}
               className="flex-1 flex flex-col min-h-0"
             >
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="flex-1 flex flex-col space-y-4 sm:space-y-6 overflow-y-auto overscroll-contain custom-scrollbar px-1 sm:px-2 pb-4 sm:pb-6">
                    <div className="shrink-0 text-center space-y-3 sm:space-y-4 pt-1 sm:pt-4">
                       {currentQ.source && (currentQ.source.toLowerCase().includes('richard') || currentQ.source.toLowerCase().includes('bank')) && (
                         <motion.div
                           initial={{ opacity: 0, scale: 0.9 }}
                           animate={{ opacity: 1, scale: 1 }}
                           className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)] mb-2"
                         >
                            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-2 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Source: Richard's Question Bank</span>
                         </motion.div>
                       )}
                       <p className="text-[9px] font-black uppercase tracking-[0.3em] text-medical-500/60">Subject: {currentQ.subject}</p>
                       <div className="max-h-[30vh] sm:max-h-[35vh] overflow-y-auto px-2 sm:px-4 scrollbar-hide overscroll-contain">
                          <h2 className="text-base sm:text-4xl font-black text-white leading-tight tracking-tight break-words whitespace-normal overflow-wrap-anywhere word-break-word">
                            {currentQ.question}
                          </h2>
                       </div>

                       <AnimatePresence>
                         {showHint && (
                            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-amber-500/10 border border-amber-500/20 p-3 rounded-xl mx-4">
                              <div className="flex items-center gap-2 mb-1">
                                 <Zap size={14} className="text-amber-500" />
                                 <span className="text-[10px] font-black uppercase text-amber-500 tracking-widest">Clinical Hint</span>
                              </div>
                              <p className="text-xs text-amber-200/80 font-medium italic">{currentQ.hint || "Focus on the primary clinical intervention."}</p>
                            </motion.div>
                         )}
                       </AnimatePresence>
                    </div>
                  </div>

                  <div className="shrink-0 grid gap-2 sm:gap-4 relative pb-2 sm:pb-6 mt-auto">
                    {currentQ.options.map((option, idx) => (
                      <OptionButton
                        key={idx} label={option} index={idx} pollValue={classPoll?.[option]}
                        state={eliminatedOptions.includes(option) ? "eliminated" : (wrongAttempts.includes(option) ? "wrong" : (selectedOption === option ? (isCorrect === null ? "selected" : (isCorrect ? "correct" : "wrong")) : (showRationale && option === currentQ.correctAnswer ? "correct" : "idle")))}
                        onClick={() => handleOptionClick(option)}
                        disabled={isCorrect !== null || showRationale || eliminatedOptions.includes(option)}
                      />
                    ))}
                  </div>
                </div>
             </motion.div>
           </AnimatePresence>

           <AnimatePresence>
             {isCorrect === false && !showRationale && (
               <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-50 bg-red-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center">
                  <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="space-y-8">
                     <div className="w-24 h-24 bg-red-500/20 rounded-full flex items-center justify-center mx-auto border-4 border-red-500 shadow-[0_0_50px_rgba(239,68,68,0.4)]">
                        <XCircle size={48} className="text-red-500" />
                     </div>
                     <div>
                        <h4 className="text-4xl font-black text-white tracking-tighter uppercase">Clinical Error</h4>
                        <p className="text-red-200 font-bold mt-2 uppercase tracking-widest text-xs">Incorrect Selection Locked</p>
                     </div>
                     <div className="flex flex-col gap-4 w-full max-w-[280px] mx-auto">
                        <button onClick={() => setShowRationale(true)} className="w-full py-5 bg-white text-red-600 rounded-2xl font-black uppercase tracking-widest text-xs shadow-2xl active:scale-95 transition-all">View Explanation</button>
                        <button onClick={nextQuestion} className="w-full py-5 bg-red-500/20 text-white rounded-2xl font-black uppercase tracking-widest text-xs border border-white/10 hover:bg-red-500/30 transition-all">Next Question</button>
                     </div>
                  </motion.div>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {colleagueAdvice && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl space-y-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-medical-100 dark:bg-medical-900/40 rounded-full flex items-center justify-center text-medical-600"><Users size={24} /></div>
                <div>
                   <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{colleagueAdvice.name}</h3>
                   <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Colleague Advice</p>
                </div>
              </div>
              <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-4">
                 <p className="text-sm font-medium text-slate-600 dark:text-slate-300 italic">"{colleagueAdvice.reasoning}"</p>
                 <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-[10px] font-black uppercase text-slate-400">Suspected Answer</span>
                    <span className="text-sm font-black text-medical-600">{colleagueAdvice.option}</span>
                 </div>
              </div>
              <button onClick={() => setColleagueAdvice(null)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs">Back to Challenge</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showRationale && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
            <div className="bg-white dark:bg-slate-800 rounded-[2rem] sm:rounded-[2.5rem] p-5 sm:p-8 shadow-clinical border border-slate-100 dark:border-slate-700 overflow-hidden relative">
               <div className="absolute top-0 right-0 p-8 opacity-5 text-slate-900 dark:text-white"><Award size={120} /></div>
               <div className="relative z-10 space-y-8">
                  <header className="flex justify-between items-center">
                     <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                           {isCorrect ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                        </div>
                        <div>
                           <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}</p>
                           <h4 className="text-xl font-black text-slate-900 dark:text-white">{isCorrect ? 'Excellent Reasoning' : 'Almost There, Nurse'}</h4>
                        </div>
                     </div>
                  </header>
                  <div className="grid grid-cols-1 gap-4 sm:gap-8">
                     <div className="space-y-4 sm:space-y-6">
                        <div className="space-y-2 sm:space-y-4">
                           <div className="flex items-center gap-2">
                              <Target size={16} className="text-medical-500" />
                              <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest text-slate-400">Clinical Insight</p>
                           </div>
                           <p className="text-xs sm:text-base font-medium text-slate-600 dark:text-slate-300 leading-relaxed italic">{currentQ.rationale || "Rationale provided by Apex Scholars."}</p>
                        </div>

                        {(currentQ.examTip || currentQ.hint) && (
                          <div className="p-4 sm:p-6 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-900/30">
                            <div className="flex items-center gap-2 mb-2">
                               <Sparkles size={16} className="text-amber-500" />
                               <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-amber-600">Exam Tip</p>
                            </div>
                            <p className="text-xs sm:text-sm text-amber-800 dark:text-amber-300 font-bold leading-relaxed">{currentQ.examTip || currentQ.hint}</p>
                          </div>
                        )}

                        {currentQ.commonMistake && (
                          <div className="p-4 sm:p-6 bg-red-50 dark:bg-red-900/10 rounded-2xl border border-red-100 dark:border-red-900/30">
                            <div className="flex items-center gap-2 mb-2">
                               <XCircle size={16} className="text-red-500" />
                               <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-red-600">Common Mistake</p>
                            </div>
                            <p className="text-xs sm:text-sm text-red-800 dark:text-red-300 font-bold leading-relaxed">{currentQ.commonMistake}</p>
                          </div>
                        )}
                     </div>
                  </div>
               </div>
            </div>
            <div className="flex gap-4">
               <button onClick={walkAway} className="flex-1 py-5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-[1.5rem] font-black uppercase tracking-widest text-[10px] border border-slate-100 dark:border-slate-700 shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2">Walk Away</button>
               <button onClick={nextQuestion} className="flex-[2] py-5 bg-slate-900 text-white rounded-[1.5rem] font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2">{currentQuestionIndex < quizQuestions.length - 1 ? 'Next Challenge' : 'Complete Challenge'}<ChevronRight size={18} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ModeCard = ({ title, description, icon, stats, onClick, color }) => {
  const colorMap = {
    medical: 'text-medical-600 bg-medical-50 dark:bg-medical-900/20 border-medical-100',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 border-amber-100',
    purple: 'text-purple-600 bg-purple-50 dark:bg-purple-900/20 border-purple-100',
    slate: 'text-slate-600 bg-slate-50 dark:bg-slate-900/20 border-slate-100'
  };
  return (
    <button onClick={onClick} className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-clinical hover:shadow-xl transition-all text-left group flex flex-col justify-between">
      <div className="space-y-4">
        <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${colorMap[color]}`}>{icon}</div>
        <div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">{description}</p>
        </div>
      </div>
    </button>
  );
};

const LifelineButton = React.memo(({ icon, label, used, onClick }) => (
  <button disabled={used} onClick={onClick} className={`flex flex-col items-center justify-center p-2.5 sm:p-4 rounded-xl sm:rounded-2xl border sm:border-2 transition-all active:scale-95 touch-manipulation ${used ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 text-slate-300 grayscale' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-medical-600 hover:border-medical-500 shadow-sm'}`}>
    {React.cloneElement(icon, { size: 18 })}
    <span className="text-[8px] sm:text-[9px] font-black uppercase tracking-widest mt-1 sm:mt-2">{label}</span>
  </button>
));

const SpeedOption = React.memo(({ label, color, icon, onClick, disabled, state }) => {
  const stateStyles = useMemo(() => {
    if (state === 'selected') return "ring-4 ring-white ring-offset-2 ring-offset-slate-900 scale-95 z-10";
    if (state === 'correct') return "ring-4 ring-emerald-400 scale-100 shadow-[0_0_40px_rgba(52,211,153,0.4)] z-10";
    if (state === 'wrong') return "opacity-40 grayscale scale-90";
    return "";
  }, [state]);
  return (
    <button disabled={disabled} onClick={onClick} className={`relative min-h-[110px] rounded-[1.25rem] sm:rounded-[2.5rem] p-4 flex flex-col items-center justify-center text-center transition-all duration-300 active:scale-95 overflow-hidden group ${color} ${stateStyles} touch-manipulation overscroll-contain`}>
      <div className="absolute top-3 left-3 opacity-30 group-hover:opacity-50 transition-opacity">
        {icon}
      </div>
      <span className="font-black leading-tight break-words overflow-wrap-anywhere whitespace-normal px-2" style={{ fontSize: 'clamp(0.82rem, 1.9vw, 1rem)' }}>{label}</span>
    </button>
  );
});

const SpeedLifeline = React.memo(({ icon, label, used, onClick }) => (
  <button disabled={used} onClick={onClick} className={`px-4 py-2 rounded-full border transition-all flex items-center gap-2 touch-manipulation ${used ? 'bg-slate-800/50 border-white/5 text-slate-600' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}>
    {icon}<span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">{label}</span>
  </button>
));

const OptionButton = React.memo(({ label, index, state, pollValue, onClick, disabled }) => {
  const letters = ['A', 'B', 'C', 'D'];
  const styles = useMemo(() => {
    if (state === 'selected') return "bg-amber-500/20 border-amber-500 text-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.2)]";
    if (state === 'correct') return "bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]";
    if (state === 'wrong') return "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]";
    if (state === 'eliminated') return "opacity-20 pointer-events-none grayscale blur-[1px]";
    return "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/30";
  }, [state]);
  return (
    <button disabled={disabled} onClick={onClick} className={`w-full group relative flex items-center p-2.5 sm:p-5 min-h-[64px] rounded-xl sm:rounded-2xl border-2 transition-all duration-300 overflow-hidden ${styles}`}>
      <div className="flex items-center gap-2.5 sm:gap-4 w-full relative z-10">
         <span className={`w-6 h-6 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center font-black text-[10px] sm:text-xs border ${state === 'selected' ? 'bg-amber-500 border-amber-400 text-white' : 'bg-white/10 border-white/10'}`}>{letters[index]}</span>
         <span className="flex-1 font-bold text-[11px] sm:text-base text-left leading-tight pr-2 sm:pr-8 whitespace-normal overflow-wrap-anywhere word-break-word">{label}</span>
         {pollValue !== undefined && (
            <div className="text-right">
               <p className="text-sm sm:text-lg font-black">{pollValue}%</p>
               <div className="w-8 sm:w-12 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-medical-500" style={{ width: `${pollValue}%` }} />
               </div>
            </div>
         )}
      </div>
      {state === 'correct' && <motion.div initial={{ scale: 0 }} animate={{ scale: 1.5 }} className="absolute right-[-20px] top-[-20px] p-8 text-emerald-500/10"><CheckCircle2 size={80} /></motion.div>}
    </button>
  );
});
};

export default Quiz;
