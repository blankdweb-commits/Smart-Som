import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { Brain, CheckCircle2, XCircle, RefreshCw, ChevronRight, Trophy, AlertCircle, Lock, Star, Users, Share2, ArrowRight, Clock, Award, Shield, Target, BookOpen, Zap, Settings, HelpCircle, Volume2 } from '../components/Icons';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const MILESTONES = [
  "Clinical Beginner",
  "Ward Ready",
  "Exam Survivor",
  "Clinical Strategist",
  "Apex Scholar"
];

const Quiz = () => {
  const { flashcards, userProfile, studyStats, updateQuizStats } = useAppContext();
  const navigate = useNavigate();

  // -- 1. STATE DECLARATIONS (Ordered for initialization safety) --
  const [quizMode, setQuizMode] = useState(null); // 'revision', 'speed', 'mastery', 'cbt'
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
  const [wrongAttempts, setWrongAttempts] = useState([]);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false, askFriend: false });
  const [classPoll, setClassPoll] = useState(null);
  const [colleagueAdvice, setColleagueAdvice] = useState(null);

  // Speed mode specific state
  const [timeLeft, setTimeLeft] = useState(15);
  const [volumeOn, setVolumeOn] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  // -- 2. SIDE EFFECTS --
  useEffect(() => {
    let timer;
    if (quizStarted && quizMode === 'speed' && !showRationale && !showResults && !isConfirming && !colleagueAdvice && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          const next = prev - 1;
          if (next <= 5 && next > 0) playSound('tick');
          return next;
        });
      }, 1000);
    } else if (timeLeft === 0 && !showRationale && !showResults && !isConfirming && quizMode === 'speed') {
      // Auto-submit when time runs out, but only if not already confirming
      confirmAnswer();
    }
    return () => clearInterval(timer);
  }, [quizStarted, quizMode, showRationale, showResults, isConfirming, colleagueAdvice, timeLeft]);

  // Reset timer on next question
  const resetTimer = () => setTimeLeft(15);

  // Milestone logic
  const currentMilestone = MILESTONES[Math.min(Math.floor(score / 3), MILESTONES.length - 1)];

  // Generate a quiz from existing flashcards
  const startQuiz = () => {
    if (flashcards.length < 4) return;

    // Shuffle and pick 10 random cards (or all if less than 10)
    const shuffled = [...flashcards].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 10);

    const questions = selected.map(card => {
      // Create distractors from other cards' answers
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
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
    setAttempts(0);
    setShowHint(false);
    setShowRationale(false);
    setIsCorrect(null);
    setWrongAttempts([]);
    setEliminatedOptions([]);
  };

  const handleOptionClick = (option) => {
    if (selectedOption !== null && isCorrect) return;
    if (eliminatedOptions.includes(option)) return;
    setSelectedOption(option);
    setIsConfirming(true);
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
        oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
        oscillator.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.1); // A5
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
      } else if (type === 'wrong') {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(220, audioCtx.currentTime); // A3
        oscillator.frequency.exponentialRampToValueAtTime(110, audioCtx.currentTime + 0.1); // A2
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
    } catch (e) {
      console.warn("Audio feedback failed:", e);
    }
  };

  const confirmAnswer = useCallback(() => {
    const currentQ = quizQuestions[currentQuestionIndex];
    if (!currentQ) return;

    const correct = selectedOption === currentQ.correctAnswer;
    setIsCorrect(correct);
    setIsConfirming(false);

    if (quizMode === 'speed' || quizMode === 'mastery') {
       playSound(correct ? 'correct' : 'wrong');
    }

    if (correct) {
      if (attempts === 0) setScore(score + 1);
      setShowRationale(true);
      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      setWrongAttempts(prev => [...prev, selectedOption]);
      if (quizMode === 'mastery' || quizMode === 'speed') {
        setAttempts(2); // Bypass multi-attempt for speed/mastery
        setShowRationale(true);
        updateQuizStats({ quizStreak: 0 });
      } else {
        const newAttempts = attempts + 1;
        setAttempts(newAttempts);
        if (newAttempts >= 2) {
          setShowRationale(true);
          updateQuizStats({ quizStreak: 0 });
        } else {
          // Allow second attempt
          setIsCorrect(null);
          setSelectedOption(null);
        }
      }
    }
  }, [quizQuestions, currentQuestionIndex, selectedOption, quizMode, attempts, score, studyStats.quizStreak, updateQuizStats]);

  const eliminateTwo = useCallback(() => {
    if (attempts > 0 || lifelinesUsed.fiftyFifty || !quizQuestions[currentQuestionIndex]) return;

    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrectOptions = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);

    // Select exactly 2 to eliminate
    const shuffledIncorrect = [...incorrectOptions].sort(() => 0.5 - Math.random());
    const toEliminate = shuffledIncorrect.slice(0, 2);

    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  }, [attempts, lifelinesUsed.fiftyFifty, quizQuestions, currentQuestionIndex]);

  const askClass = useCallback(() => {
    if (lifelinesUsed.askClass || !quizQuestions[currentQuestionIndex]) return;
    const currentQ = quizQuestions[currentQuestionIndex];

    // Advanced Simulation Algorithm
    const isHardQuestion = (currentQ.question || '').length > 100;
    const accuracyBase = isHardQuestion ? 0.45 : 0.75;
    const isAudienceCorrect = Math.random() < accuracyBase;

    const results = {};
    let remainingPercentage = 100;
    const options = [...currentQ.options];

    if (isAudienceCorrect) {
      // Crowd identifies the correct answer
      const winnerShare = Math.floor(Math.random() * (82 - 55) + 55);
      results[currentQ.correctAnswer] = winnerShare;
      remainingPercentage -= winnerShare;
    } else {
      // Crowd is split or wrong (common in hard nursing questions)
      const wrongOptions = options.filter(o => o !== currentQ.correctAnswer);
      const deceptiveOption = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
      const winnerShare = Math.floor(Math.random() * (52 - 38) + 38);
      results[deceptiveOption] = winnerShare;
      remainingPercentage -= winnerShare;
    }

    // Distribute remaining percentages among other options
    const remainingOptions = options.filter(o => !results[o]);
    remainingOptions.forEach((opt, idx) => {
      if (idx === remainingOptions.length - 1) {
        results[opt] = remainingPercentage;
      } else {
        const share = Math.floor(Math.random() * (remainingPercentage / 1.5));
        results[opt] = share;
        remainingPercentage -= share;
      }
    });

    setClassPoll(results);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  }, [lifelinesUsed.askClass, quizQuestions, currentQuestionIndex]);

  const askColleague = useCallback(() => {
    if (lifelinesUsed.askFriend || !quizQuestions[currentQuestionIndex]) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const names = ["Nurse Tolu", "Dr. Emeka", "Senior Nurse Sarah", "Head Nurse Ibrahim"];
    const name = names[Math.floor(Math.random() * names.length)];

    const isHard = (currentQ.question || '').length > 120;
    const confidenceBase = isHard ? 0.6 : 0.85;
    const isCorrect = Math.random() < confidenceBase;

    const adviceOption = isCorrect ? currentQ.correctAnswer : currentQ.options.filter(o => o !== currentQ.correctAnswer)[0];
    const confidence = Math.floor((isCorrect ? 70 : 40) + Math.random() * 25);

    setColleagueAdvice({
      name,
      option: adviceOption,
      confidence,
      reasoning: isCorrect
        ? "Based on clinical protocols, this is the most likely priority intervention."
        : "I've seen this in the ward before, but it could be a tricky one."
    });
    setLifelinesUsed(prev => ({ ...prev, askFriend: true }));
  }, [lifelinesUsed.askFriend, quizQuestions, currentQuestionIndex]);

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOption(null);
      setAttempts(0);
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

  if (!quizStarted) {
    return (
      <div className="max-w-4xl mx-auto mt-8 space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="text-center space-y-4">
          <div className="inline-flex p-3 bg-medical-50 dark:bg-medical-900/20 rounded-2xl text-medical-600 mb-2">
            <Brain size={32} />
          </div>
          <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter">Clinical Quiz Hub</h2>
          <p className="text-slate-500 dark:text-slate-400 text-lg font-medium max-w-2xl mx-auto">
            Select a mode to begin your clinical mastery session.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ModeCard
            title="Standard Revision"
            description="Deep learning with rationale and unlimited time."
            icon={<BookOpen size={32} />}
            stats={`${studyStats.quizStreak || 0} Streak`}
            onClick={() => { setQuizMode('revision'); startQuiz(); }}
            color="medical"
          />
          <ModeCard
            title="Speed Challenge"
            description="Kahoot-style rapid fire clinical reasoning."
            icon={<Zap size={32} />}
            stats="Timed Rounds"
            onClick={() => { setQuizMode('speed'); startQuiz(); }}
            color="amber"
          />
          <ModeCard
            title="Mastery Challenge"
            description="High-stakes mode. One wrong answer ends the streak."
            icon={<Award size={32} />}
            stats={studyStats.milestone}
            onClick={() => { setQuizMode('mastery'); startQuiz(); }}
            color="purple"
          />
          <ModeCard
            title="Timed CBT Exam"
            description="Full exam simulation with strictly timed blocks."
            icon={<Clock size={32} />}
            stats="Exam Format"
            onClick={() => { setQuizMode('cbt'); startQuiz(); }}
            color="slate"
          />
        </div>

        {flashcards.length < 4 && (
          <div className="p-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-[2rem] flex items-center gap-6 text-left">
            <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl text-amber-500 shadow-sm"><AlertCircle size={32} /></div>
            <div>
              <p className="font-black text-amber-900 dark:text-amber-400 uppercase tracking-widest text-xs">Awaiting Data</p>
              <p className="text-sm text-amber-800 dark:text-amber-500/80 font-medium mt-1">Add at least 4 flashcards to your clinical vault to activate all modes.</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32">
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" />
          <div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 shadow-2xl">
            <Trophy size={64} />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">Challenge Results</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xl font-medium">
            You've reached the milestone of <span className="text-medical-600 dark:text-medical-400 font-black">{currentMilestone}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Final Score</p>
            <p className="text-4xl font-black text-slate-900 dark:text-white">{score}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">New Streak</p>
            <p className="text-4xl font-black text-medical-600">{studyStats.quizStreak || 0}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 max-w-sm mx-auto">
          <button
            onClick={startQuiz}
            className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-slate-800 border-2 border-white/10 group"
          >
            <RefreshCw size={24} className="group-hover:rotate-180 transition-transform duration-500" />
            New Challenge
          </button>
          <button
            onClick={() => setQuizStarted(false)}
            className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-[2rem] font-black uppercase tracking-widest text-xs border border-slate-100 dark:border-slate-700 hover:bg-slate-50 transition-all"
          >
            Exit to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];

  if (quizStarted && !currentQ) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] space-y-4">
        <RefreshCw className="animate-spin text-medical-600" size={48} />
        <p className="text-slate-500 font-bold animate-pulse uppercase tracking-widest text-xs">Preparing Clinical Scenarios...</p>
      </div>
    );
  }

  if (quizStarted && quizMode === 'speed') {
    return (
      <div className="fixed inset-0 z-[60] bg-slate-900 flex flex-col h-[100dvh] overflow-hidden text-white font-sans touch-none selection:bg-medical-500/30">
        {/* Speed Mode Header */}
        <header className="shrink-0 p-3 sm:p-4 flex justify-between items-center bg-slate-800/50 backdrop-blur-md border-b border-white/5 z-10">
          <div className="flex items-center gap-4">
             <div className="w-12 h-12 rounded-full border-4 border-medical-500 flex items-center justify-center font-black text-xl">
               {timeLeft}
             </div>
             <div>
               <p className="text-[10px] font-black uppercase tracking-widest text-medical-400">Question</p>
               <p className="font-black text-lg leading-none">{currentQuestionIndex + 1} of {quizQuestions.length}</p>
             </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setVolumeOn(!volumeOn)}
              className={`p-3 rounded-xl transition-all ${volumeOn ? 'bg-medical-500/20 text-medical-400' : 'bg-slate-700 text-slate-500'}`}
            >
              {volumeOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="p-3 bg-slate-700 rounded-xl text-white"
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* Speed Mode Question Section */}
        <main className="flex-1 flex flex-col min-h-0 px-4 sm:px-8 py-2 sm:py-6 space-y-4 max-w-5xl mx-auto w-full overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
           {/* Speed Lifelines Bar */}
           <div className="shrink-0 flex justify-center gap-2">
             <SpeedLifeline icon={<Shield size={18} />} label="50/50" used={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} />
             <SpeedLifeline icon={<Users size={18} />} label="Class" used={lifelinesUsed.askClass} onClick={askClass} />
             <SpeedLifeline icon={<Brain size={18} />} label="Colleague" used={lifelinesUsed.askFriend} onClick={askColleague} />
           </div>

           <div className="shrink-0 flex flex-col items-center justify-center text-center space-y-3 min-h-[15vh] max-h-[40vh] overscroll-contain">
              {currentQ.mediaUrl && (
                <div className="shrink-0 w-full max-w-[160px] sm:max-w-md aspect-video bg-slate-800 rounded-2xl overflow-hidden border border-white/10 shadow-2xl relative">
                  <img src={currentQ.mediaUrl} alt="Clinical Media" className="w-full h-full object-cover" />
                </div>
              )}

              <div className="max-h-[28vh] overflow-y-auto px-2 w-full custom-scrollbar overscroll-contain">
                <h2 className="font-black tracking-tight leading-relaxed transition-all duration-500 break-words whitespace-normal text-balance" style={{ fontSize: 'clamp(0.95rem, 2vw, 1.15rem)' }}>
                  {currentQ.question}
                </h2>
              </div>
           </div>

           {/* 2x2 Grid Options */}
           <div className="shrink-0 grid grid-cols-2 gap-3 pb-6 overscroll-contain" style={{ gridAutoRows: 'minmax(110px, auto)' }}>
              <SpeedOption
                label={currentQ.options[0]}
                color="bg-red-500"
                icon={<Triangle className="fill-white" size={24} />}
                onClick={() => handleOptionClick(currentQ.options[0])}
                disabled={showRationale}
                state={showRationale ? (currentQ.options[0] === currentQ.correctAnswer ? 'correct' : (selectedOption === currentQ.options[0] ? 'wrong' : 'idle')) : (selectedOption === currentQ.options[0] ? 'selected' : 'idle')}
              />
              <SpeedOption
                label={currentQ.options[1]}
                color="bg-blue-500"
                icon={<Diamond className="fill-white" size={24} />}
                onClick={() => handleOptionClick(currentQ.options[1])}
                disabled={showRationale}
                state={showRationale ? (currentQ.options[1] === currentQ.correctAnswer ? 'correct' : (selectedOption === currentQ.options[1] ? 'wrong' : 'idle')) : (selectedOption === currentQ.options[1] ? 'selected' : 'idle')}
              />
              <SpeedOption
                label={currentQ.options[2]}
                color="bg-amber-500"
                icon={<Circle className="fill-white" size={24} />}
                onClick={() => handleOptionClick(currentQ.options[2])}
                disabled={showRationale}
                state={showRationale ? (currentQ.options[2] === currentQ.correctAnswer ? 'correct' : (selectedOption === currentQ.options[2] ? 'wrong' : 'idle')) : (selectedOption === currentQ.options[2] ? 'selected' : 'idle')}
              />
              <SpeedOption
                label={currentQ.options[3]}
                color="bg-emerald-500"
                icon={<Square className="fill-white" size={24} />}
                onClick={() => handleOptionClick(currentQ.options[3])}
                disabled={showRationale}
                state={showRationale ? (currentQ.options[3] === currentQ.correctAnswer ? 'correct' : (selectedOption === currentQ.options[3] ? 'wrong' : 'idle')) : (selectedOption === currentQ.options[3] ? 'selected' : 'idle')}
              />
           </div>
        </main>

        {/* Speed Mode Rationale Overlay */}
        <AnimatePresence>
          {showRationale && (
            <motion.div
              initial={{ opacity: 0, y: 100 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 100 }}
              className="absolute inset-0 z-[70] bg-slate-900 p-8 flex flex-col justify-center items-center text-center space-y-8"
            >
               <div className={`w-24 h-24 rounded-full flex items-center justify-center ${isCorrect ? 'bg-emerald-500' : 'bg-red-500'}`}>
                 {isCorrect ? <CheckCircle2 size={48} /> : <XCircle size={48} />}
               </div>
               <div className="space-y-4 max-w-2xl">
                 <h3 className="text-4xl font-black">{isCorrect ? 'GENIUS!' : 'NOT QUITE...'}</h3>
                 <p className="text-xl text-slate-300 font-medium leading-relaxed">{currentQ.rationale || 'Keep pushing your clinical limits.'}</p>
               </div>
               <button
                 onClick={nextQuestion}
                 className="px-12 py-6 bg-white text-slate-900 rounded-3xl font-black text-xl shadow-2xl active:scale-95 transition-all"
               >
                 NEXT QUESTION
               </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Modal */}
        <AnimatePresence>
          {showSettings && (
             <motion.div
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="fixed inset-0 z-[100] bg-slate-900/90 backdrop-blur-md flex items-center justify-center p-4"
             >
                <div className="bg-slate-800 w-full max-w-md rounded-[3rem] p-10 border border-white/10 space-y-8">
                   <h3 className="text-3xl font-black text-center uppercase tracking-tighter">Session Settings</h3>
                   <div className="space-y-4">
                      <SettingToggle label="Sound Effects" active={volumeOn} onClick={() => setVolumeOn(!volumeOn)} />
                      <SettingToggle label="Auto-Advance" active={true} disabled />
                      <SettingToggle label="Fast Animations" active={true} disabled />
                   </div>
                   <button
                     onClick={() => setShowSettings(false)}
                     className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs"
                   >
                     Done
                   </button>
                   <button
                     onClick={() => { setQuizStarted(false); setQuizMode(null); setShowSettings(false); }}
                     className="w-full py-5 bg-red-500/10 text-red-500 rounded-2xl font-black uppercase tracking-widest text-xs border border-red-500/20"
                   >
                     Quit Challenge
                   </button>
                </div>
             </motion.div>
          )}
        </AnimatePresence>

        {/* Speed Mode Confirmation */}
        <AnimatePresence>
           {isConfirming && (
             <motion.div
               initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
               className="absolute inset-0 z-50 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-8"
             >
                <div className="text-center space-y-8">
                   <h4 className="text-4xl font-black">Final Answer?</h4>
                   <div className="flex gap-4">
                      <button onClick={confirmAnswer} className="px-12 py-5 bg-medical-500 rounded-2xl font-black text-xl">YES</button>
                      <button onClick={() => { setIsConfirming(false); setSelectedOption(null); }} className="px-12 py-5 bg-white/10 rounded-2xl font-black text-xl">NO</button>
                   </div>
                </div>
             </motion.div>
           )}
        </AnimatePresence>

        {/* Speed Mode Colleague Advice */}
        <AnimatePresence>
          {colleagueAdvice && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 z-[100] bg-slate-900/90 backdrop-blur-lg flex items-center justify-center p-4"
            >
               <div className="bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full max-w-sm rounded-[2.5rem] p-8 space-y-6 border border-slate-100 dark:border-slate-700 shadow-2xl">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-medical-100 dark:bg-medical-900/40 rounded-full flex items-center justify-center text-medical-600"><Users size={24} /></div>
                    <h3 className="text-xl font-black uppercase tracking-tight">{colleagueAdvice.name}</h3>
                  </div>
                  <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-4">
                     <p className="text-sm font-medium italic text-slate-600 dark:text-slate-300">"{colleagueAdvice.reasoning}"</p>
                     <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-3">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Suggestion</span>
                        <span className="text-sm font-black text-medical-600 dark:text-medical-400">{colleagueAdvice.option}</span>
                     </div>
                  </div>
                  <button onClick={() => setColleagueAdvice(null)} className="w-full py-4 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs active:scale-95 transition-all">Return to Challenge</button>
               </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-32 relative min-h-[100dvh]">
      {/* Dynamic Header */}
      <div className="flex justify-between items-end px-2 shrink-0">
        <div className="space-y-2">
           <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-medical-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-medical-600 dark:text-medical-400">{currentMilestone}</span>
           </div>
           <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Question {currentQuestionIndex + 1}</h3>
        </div>
        <div className="flex flex-col items-end">
           <div className="flex items-center gap-2 mb-1">
              <Star className="text-amber-500 fill-amber-500" size={14} />
              <span className="text-[10px] font-black uppercase text-slate-400">Streak</span>
           </div>
           <p className="text-3xl font-black text-slate-900 dark:text-white leading-none">{studyStats.quizStreak || 0}</p>
        </div>
      </div>

      {/* Lifelines Bar */}
      <div className="grid grid-cols-4 gap-3 shrink-0">
        <LifelineButton
          icon={<Clock />} label="Hint" used={showHint || lifelinesUsed.hint}
          onClick={() => { setShowHint(true); setLifelinesUsed(p => ({...p, hint: true})); }}
        />
        <LifelineButton
          icon={<Shield />} label="50/50" used={lifelinesUsed.fiftyFifty}
          onClick={eliminateTwo}
        />
        <LifelineButton
          icon={<Users />} label="Class" used={lifelinesUsed.askClass}
          onClick={askClass}
        />
        <LifelineButton
          icon={<Users />} label="Colleague" used={lifelinesUsed.askFriend}
          onClick={askColleague}
        />
      </div>

      {/* Main Question Card */}
      <div className="relative flex-1 flex flex-col min-h-0">
        <div className="absolute inset-0 bg-slate-900 rounded-[3rem] blur-2xl opacity-10 dark:opacity-40" />
        <div className="relative flex-1 flex flex-col bg-slate-900 dark:bg-slate-950 rounded-[3rem] p-6 sm:p-12 border border-white/10 shadow-2xl overflow-hidden min-h-[400px]">

           <AnimatePresence mode="wait">
             <motion.div
               key={currentQuestionIndex}
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 1.1 }}
               className="flex-1 flex flex-col space-y-8 overflow-y-auto overscroll-contain custom-scrollbar px-2"
             >
                <div className="shrink-0 text-center space-y-4 pt-4">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-medical-500/60">Subject: {currentQ.subject}</p>
                   <div className="max-h-[30vh] overflow-y-auto px-4">
                      <h2 className="text-xl sm:text-4xl font-black text-white leading-tight tracking-tight break-words">
                        {currentQ.question}
                      </h2>
                   </div>
                </div>

                <div className="shrink-0 grid gap-3 sm:gap-4 relative pb-8">
                  {currentQ.options.map((option, idx) => {
                    const isEliminated = eliminatedOptions.includes(option);
                    const wasWrong = wrongAttempts.includes(option);
                    let state = "idle"; // idle, selected, correct, wrong, eliminated

                    if (isEliminated) state = "eliminated";
                    else if (wasWrong) state = "wrong";
                    else if (selectedOption === option) {
                      if (isCorrect === null) state = "selected";
                      else state = isCorrect ? "correct" : "wrong";
                    } else if (showRationale && option === currentQ.correctAnswer) {
                      state = "correct";
                    }

                    return (
                      <OptionButton
                        key={idx}
                        label={option}
                        index={idx}
                        state={state}
                        pollValue={classPoll?.[option]}
                        onClick={() => handleOptionClick(option)}
                        disabled={isCorrect === true || showRationale || isEliminated || wasWrong}
                      />
                    );
                  })}
                </div>
             </motion.div>
           </AnimatePresence>

           {/* Final Answer Modal */}
           <AnimatePresence>
             {isConfirming && (
               <motion.div
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center"
               >
                  <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="space-y-8"
                  >
                     <div className="w-20 h-20 bg-medical-500/10 rounded-full flex items-center justify-center mx-auto border border-medical-500/20">
                        <HelpCircle size={40} className="text-medical-500 animate-pulse" />
                     </div>
                     <div>
                        <h4 className="text-2xl font-black text-white tracking-tight">Is this your final answer?</h4>
                        <p className="text-slate-400 font-medium mt-2">"{selectedOption}"</p>
                     </div>
                     <div className="flex flex-col gap-3 w-full max-w-[240px] mx-auto">
                        <button
                          onClick={confirmAnswer}
                          className="w-full py-4 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-medical-600/20 active:scale-95 transition-all"
                        >
                          Confirm Answer
                        </button>
                        <button
                          onClick={() => { setIsConfirming(false); setSelectedOption(null); }}
                          className="w-full py-4 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-white/20 transition-all"
                        >
                          Change Mind
                        </button>
                     </div>
                  </motion.div>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </div>

      {/* Internal Colleague Advice Modal */}
      <AnimatePresence>
        {colleagueAdvice && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl space-y-6"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-medical-100 dark:bg-medical-900/40 rounded-full flex items-center justify-center text-medical-600">
                   <Users size={24} />
                </div>
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
                 <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black uppercase text-slate-400">Confidence</span>
                    <span className="text-sm font-black text-amber-500">{colleagueAdvice.confidence}%</span>
                 </div>
              </div>

              <button
                onClick={() => setColleagueAdvice(null)}
                className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs"
              >
                Back to Challenge
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rationale System - Educational Polish */}
      <AnimatePresence>
        {showRationale && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 overflow-hidden relative">
               <div className="absolute top-0 right-0 p-8 opacity-5 text-slate-900 dark:text-white">
                  <Award size={120} />
               </div>

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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-4">
                        <div className="flex items-center gap-2">
                           <Target size={16} className="text-medical-500" />
                           <p className="text-xs font-black uppercase tracking-widest text-slate-400">Clinical Insight</p>
                        </div>
                        <p className="text-sm sm:text-base font-medium text-slate-600 dark:text-slate-300 leading-relaxed italic">
                          {currentQ.rationale || "The correct answer is derived from standard clinical protocols and the physiological basis of nursing practice."}
                        </p>
                     </div>
                     <div className="space-y-6">
                        <div className="p-5 bg-medical-50 dark:bg-medical-900/20 rounded-2xl border border-medical-100 dark:border-medical-900/30">
                           <div className="flex items-center gap-2 mb-2">
                              <Zap size={14} className="text-amber-500" />
                              <p className="text-[10px] font-black uppercase tracking-widest text-medical-600">Exam Memory Tip</p>
                           </div>
                           <p className="text-xs font-bold text-slate-600 dark:text-slate-400 italic leading-relaxed">
                             "{currentQ.hint || 'Focus on the underlying physiological mechanism to eliminate distractors.'}"
                           </p>
                        </div>
                        {!isCorrect && (
                           <div className="p-5 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-900/30">
                              <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">Common Pitfall</p>
                              <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Students often confuse this with secondary assessment findings. Remember: primary ABCs always come first.</p>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex gap-4">
               <button
                 onClick={walkAway}
                 className="flex-1 py-5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-[1.5rem] font-black uppercase tracking-widest text-[10px] border border-slate-100 dark:border-slate-700 shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2"
               >
                 Walk Away (Save Streak)
               </button>
               <button
                 onClick={nextQuestion}
                 className="flex-[2] py-5 bg-slate-900 text-white rounded-[1.5rem] font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
               >
                 {currentQuestionIndex < quizQuestions.length - 1 ? 'Next Challenge' : 'Complete Challenge'}
                 <ChevronRight size={18} />
               </button>
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
    <button
      onClick={onClick}
      className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-clinical hover:shadow-xl transition-all text-left group flex flex-col justify-between"
    >
      <div className="space-y-4">
        <div className={`w-16 h-16 rounded-[1.5rem] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform ${colorMap[color]}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">{title}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 font-medium">{description}</p>
        </div>
      </div>
      <div className="mt-8 flex justify-between items-center">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{stats}</span>
        <div className="p-2 bg-slate-900 text-white rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
          <ArrowRight size={16} />
        </div>
      </div>
    </button>
  );
};

const LifelineButton = React.memo(({ icon, label, used, onClick }) => (
  <button
    disabled={used}
    onClick={onClick}
    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all active:scale-95 touch-manipulation ${used ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 text-slate-300 grayscale' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-medical-600 hover:border-medical-500 shadow-sm'}`}
  >
    {React.cloneElement(icon, { size: 20 })}
    <span className="text-[9px] font-black uppercase tracking-widest mt-2">{label}</span>
  </button>
));

const SpeedOption = ({ label, color, icon, onClick, disabled, state }) => {
  let stateStyles = "";
  if (state === 'selected') stateStyles = "ring-4 ring-white ring-offset-2 ring-offset-slate-900 scale-95 z-10";
  if (state === 'correct') stateStyles = "ring-4 ring-emerald-400 scale-100 shadow-[0_0_40px_rgba(52,211,153,0.4)] z-10";
  if (state === 'wrong') stateStyles = "opacity-40 grayscale scale-90";

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`relative min-h-[110px] rounded-[1.25rem] sm:rounded-[2.5rem] p-4 flex flex-col items-center justify-center text-center transition-all duration-300 active:scale-95 overflow-hidden group ${color} ${stateStyles} touch-manipulation overscroll-contain`}
    >
      <div className="absolute top-2 left-2 sm:top-3 sm:left-3 opacity-30 group-hover:scale-110 transition-transform">
        {React.cloneElement(icon, { size: 16 })}
      </div>
      <span className="font-black leading-tight break-words overflow-wrap-anywhere whitespace-normal px-2" style={{ fontSize: 'clamp(0.82rem, 1.9vw, 1rem)' }}>
        {label}
      </span>
    </button>
  );
};

const SpeedLifeline = React.memo(({ icon, label, used, onClick }) => (
  <button
    disabled={used}
    onClick={onClick}
    className={`px-4 py-2 rounded-full border transition-all flex items-center gap-2 touch-manipulation ${used ? 'bg-slate-800/50 border-white/5 text-slate-600' : 'bg-white/10 border-white/20 text-white hover:bg-white/20'}`}
  >
    {icon}
    <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">{label}</span>
  </button>
));

const SettingToggle = ({ label, active, onClick, disabled }) => (
  <div className={`flex items-center justify-between p-5 bg-slate-700/50 rounded-2xl border border-white/5 ${disabled ? 'opacity-50' : ''}`}>
    <span className="font-bold text-slate-200">{label}</span>
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-14 h-8 rounded-full relative transition-all ${active ? 'bg-medical-500' : 'bg-slate-600'}`}
    >
      <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${active ? 'left-7' : 'left-1'}`} />
    </button>
  </div>
);

const OptionButton = React.memo(({ label, index, state, pollValue, onClick, disabled }) => {
  const letters = ['A', 'B', 'C', 'D'];

  let styles = "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/30";
  if (state === 'selected') styles = "bg-amber-500/20 border-amber-500 text-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.2)]";
  if (state === 'correct') styles = "bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]";
  if (state === 'wrong') styles = "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]";
  if (state === 'eliminated') styles = "opacity-20 pointer-events-none grayscale blur-[1px]";

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full group relative flex items-center p-4 sm:p-5 rounded-2xl border-2 transition-all duration-300 overflow-hidden ${styles}`}
    >
      <div className="flex items-center gap-4 w-full relative z-10">
         <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border ${state === 'selected' ? 'bg-amber-500 border-amber-400 text-white' : 'bg-white/10 border-white/10'}`}>
            {letters[index]}
         </span>
         <span className="flex-1 font-bold text-sm sm:text-base text-left leading-tight pr-8">{label}</span>
         {pollValue !== undefined && (
            <div className="text-right">
               <p className="text-lg font-black">{pollValue}%</p>
               <div className="w-12 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-medical-500" style={{ width: `${pollValue}%` }} />
               </div>
            </div>
         )}
      </div>
      {state === 'correct' && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1.5 }}
          className="absolute right-[-20px] top-[-20px] p-8 text-emerald-500/10"
        >
          <CheckCircle2 size={80} />
        </motion.div>
      )}
    </button>
  );
});

const VolumeX = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M11 5L6 9H2V15H6L11 19V5Z" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);


const Triangle = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2L2 20H22L12 2Z" />
  </svg>
);

const Diamond = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M12 2L2 12L12 22L22 12L12 2Z" />
  </svg>
);

const Circle = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <circle cx="12" cy="12" r="10" />
  </svg>
);

const Square = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </svg>
);


export default Quiz;
