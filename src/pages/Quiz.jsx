import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import {
  Shield,
  Zap,
  Clock,
  Target,
  ChevronLeft,
  Timer,
  Brain,
  Trophy,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertCircle,
  HelpCircle,
  RefreshCw,
  Users,
  Star,
  Info
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';

const EXIT_PROMPTS = [
  "Every unanswered question is a missed opportunity to save a future patient.",
  "Today's revision prevents tomorrow's regret.",
  "Your future patients are counting on your knowledge.",
  "Clinical excellence is built one question at a time.",
  "Don't stop now. Mastery is just a few more steps away."
];

const MILESTONES = [
  { q: 1, label: "Clinical Beginner" },
  { q: 5, label: "Future Staff Nurse", checkpoint: true },
  { q: 10, label: "Future Charge Nurse", checkpoint: true },
  { q: 15, label: "Future Matron", checkpoint: true }
];

const getSpeedTimerValue = (index) => {
  if (index < 5) return 20;
  if (index < 10) return 18;
  return 15;
};

const Quiz = () => {
  const { flashcards, studyStats, setStudyStats } = useAppContext();
  const navigate = useNavigate();

  const [quizMode, setQuizMode] = useState('selection');
  const [questionLimit, setQuestionLimit] = useState(10);
  const [useTimer, setUseTimer] = useState(true);

  const [quizStarted, setQuizStarted] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const [selectedOption, setSelectedOption] = useState(null);
  const [isFinalAnswer, setIsFinalAnswer] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [showRationale, setShowRationale] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [currentMilestone, setCurrentMilestone] = useState("Clinical Beginner");

  const subjects = useMemo(() => {
    const counts = {};
    flashcards.forEach(c => {
      const sub = c.subject || 'General';
      counts[sub] = (counts[sub] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count);
  }, [flashcards]);

  useEffect(() => {
    let timer;
    if (quizStarted && !showResults && !showRationale && (quizMode === 'speed' || useTimer)) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            handleTimeOut();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [quizStarted, showResults, showRationale, quizMode, useTimer, currentQuestionIndex]);

  const handleTimeOut = () => {
    confirmAnswer(null);
  };

  const updateQuizStats = useCallback((updates) => {
    setStudyStats(prev => ({ ...prev, ...updates }));
  }, [setStudyStats]);

  const initQuiz = (mode, subjectFilter = null) => {
    let pool = [...flashcards];
    if (subjectFilter) {
      pool = pool.filter(c => c.subject === subjectFilter);
    }
    if (pool.length === 0) return;

    const seen = new Set();
    const uniquePool = pool.filter(c => seen.has(c.question) ? false : seen.add(c.question));

    const limit = mode === 'speed' ? 15 : questionLimit;
    const shuffled = uniquePool.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(limit, uniquePool.length));

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
    setConsecutiveCorrect(0);
    setCurrentMilestone("Clinical Beginner");
    if (mode === 'speed') setTimeLeft(getSpeedTimerValue(0));
    else if (useTimer) setTimeLeft(30);
  };

  const handleOptionClick = (option) => {
    if (showRationale) return;
    if (eliminatedOptions.includes(option)) return;
    if (selectedOption === option) {
       confirmAnswer(option);
    } else {
       setSelectedOption(option);
       setIsFinalAnswer(true);
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
      if (milestone) setCurrentMilestone(milestone.label);
      setConsecutiveCorrect(prev => prev + 1);
      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      setConsecutiveCorrect(0);
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
      if (quizMode === 'speed') setTimeLeft(getSpeedTimerValue(nextIdx));
      else if (useTimer) setTimeLeft(30);
    } else {
      setShowResults(true);
    }
  };

  const walkAway = () => {
    const prompt = EXIT_PROMPTS[Math.floor(Math.random() * EXIT_PROMPTS.length)];
    if (confirm(`${prompt}\n\nAre you sure you want to exit?`)) {
      if (quizStarted && !showResults) setShowResults(true);
      else setQuizMode('selection');
    }
  };

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
    const results = {};
    let remainingPercentage = 100;
    const isAudienceCorrect = Math.random() < 0.75;
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

  if (quizMode === 'selection') {
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="text-center mb-12">
          <div className="w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 shadow-2xl border-2 border-medical-500/20">
            <Brain size={40} className="animate-pulse" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">Quiz Central</h2>
          <p className="text-slate-500 font-medium">Choose your clinical training path</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ModeCard title="Clinical Challenge" desc="Full NMCN-style exam simulation. Requires final answer confirmation." icon={<Shield size={24} />} duration="10-20 min" timer="Optional" color="medical" onClick={() => setQuizMode('clinical-select')} />
          <ModeCard title="Speed Challenge" desc="Kahoot-style rapid fire. High tension, high reward." icon={<Zap size={24} />} duration="5-15 min" timer="Progressive" color="amber" onClick={() => initQuiz('speed')} />
          <ModeCard title="Quick Quiz" desc="5-10 rapid questions for a fast revision." icon={<Clock size={24} />} duration="2-5 min" timer="Optional" color="indigo" onClick={() => setQuizMode('quick-select')} />
          <ModeCard title="Subject Mastery" desc="Master one nursing course with strict filtering." icon={<Target size={24} />} duration="Custom" timer="Optional" color="emerald" onClick={() => setQuizMode('subject-select')} />
        </div>
      </div>
    );
  }

  if (quizMode.endsWith('-select')) {
    const baseMode = quizMode.split('-')[0];
    const isSubject = baseMode === 'subject';
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in duration-500">
        <button onClick={() => setQuizMode('selection')} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-8">
          <ChevronLeft size={16} /> Back to Selection
        </button>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-4 uppercase tracking-tight">{baseMode.replace('-', ' ')} Configuration</h3>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 mb-8 space-y-8 shadow-clinical text-center sm:text-left">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question Count</p>
                 <div className="flex gap-4 justify-center sm:justify-start">
                    {[10, 20, 50].map(n => (
                       <button key={n} onClick={() => setQuestionLimit(n)} className={`flex-1 py-4 rounded-2xl font-black transition-all ${questionLimit === n ? 'bg-medical-600 text-white shadow-lg' : 'bg-slate-50 dark:bg-white/5 text-slate-400'}`}>{n}</button>
                    ))}
                 </div>
              </div>
              <div className="space-y-4">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Time Pressure</p>
                 <button onClick={() => setUseTimer(!useTimer)} className={`w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${useTimer ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-50 dark:bg-white/5 text-slate-400'}`}><Timer size={16} /> {useTimer ? '30s Per Question' : 'No Timer'}</button>
              </div>
           </div>
        </div>
        {isSubject && (
           <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
             {subjects.map(sub => (
               <button key={sub.name} onClick={() => initQuiz('subject', sub.name)} className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border-2 border-slate-100 dark:border-slate-700 hover:border-emerald-500 transition-all text-left group shadow-sm hover:shadow-md">
                 <p className="text-[10px] font-black uppercase text-slate-400 mb-1 group-hover:text-emerald-500 transition-colors">{sub.count} Questions</p>
                 <p className="font-black text-slate-900 dark:text-white truncate">{sub.name}</p>
               </button>
             ))}
           </div>
        )}
        {!isSubject && <button onClick={() => initQuiz(baseMode)} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl uppercase tracking-widest shadow-2xl active:scale-95 transition-all hover:bg-slate-800">Enter Challenge</button>}
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32 px-4 text-slate-900 dark:text-white">
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" />
          <div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 shadow-2xl"><Trophy size={64} /></div>
        </div>
        <div className="space-y-2">
          <h2 className="text-4xl sm:text-5xl font-black tracking-tighter">Challenge Complete</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xl font-medium uppercase tracking-tight">Milestone Earned: <span className="text-medical-600 dark:text-medical-400 font-black">{currentMilestone}</span></p>
        </div>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical text-center"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Total Score</p><p className="text-3xl sm:text-4xl font-black">{score}</p></div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical text-center"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Max Streak</p><p className="text-3xl sm:text-4xl font-black text-medical-600">{studyStats.quizStreak || 0}</p></div>
        </div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto">
          <button onClick={() => setQuizMode('selection')} className="w-full py-6 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-slate-800"><RefreshCw size={24} /> New Challenge</button>
          <button onClick={() => navigate('/dashboard')} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-[2rem] font-black uppercase tracking-widest text-xs border border-slate-100 dark:border-slate-700 hover:bg-slate-50 transition-all">Exit to Dashboard</button>
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];
  if (!currentQ) return null;
  const isSpeed = quizMode === 'speed';
  const isRichard = currentQ.source?.toLowerCase().includes('richard');

  return (
    <div className={`max-w-4xl mx-auto space-y-6 pb-32 relative ${isSpeed ? 'dark' : ''} text-slate-900 dark:text-white`}>
      <div className="flex justify-between items-center px-4">
        <button onClick={walkAway} className="p-2 text-slate-400 hover:text-slate-600 transition-colors"><ChevronLeft size={28} /></button>
        <div className="flex items-center gap-3">
          <div className="px-5 py-2 bg-slate-100 dark:bg-white/10 rounded-2xl border border-slate-200 dark:border-white/5"><p className="text-[10px] font-black uppercase text-slate-400 dark:text-white/40 tracking-[0.2em]">Score</p><p className="text-sm font-black tabular-nums">{score}</p></div>
          {isSpeed && <div className="px-5 py-2 bg-amber-500 text-white rounded-2xl shadow-lg shadow-amber-500/20"><p className="text-[10px] font-black uppercase opacity-60 tracking-[0.1em]">Milestone</p><p className="text-[10px] font-black whitespace-nowrap">{currentMilestone}</p></div>}
        </div>
      </div>
      <div className="px-4">
        <div className="flex justify-between items-end mb-2">
           <span className="text-xs font-black text-slate-400 dark:text-white/40 uppercase tracking-widest">Question {currentQuestionIndex + 1} of {quizQuestions.length}</span>
           <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${isRichard ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)] animate-pulse' : 'bg-medical-50 dark:bg-white/5 text-medical-600 dark:text-medical-400 border-medical-100 dark:border-white/5'}`}>
             SOURCE: {currentQ.source || (isRichard ? "RICHARD'S BANK" : "Apex Scholars Core Bank")}
           </span>
        </div>
        <div className="h-3 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden border border-slate-200 dark:border-white/5">
          <motion.div className="h-full bg-medical-500" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} />
        </div>
      </div>
      {(isSpeed || ((quizMode === 'subject' || quizMode === 'quick') && useTimer)) && !showRationale && (
        <div className="px-4">
            <div className="h-1 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
               <motion.div className={`h-full ${timeLeft < 5 ? 'bg-red-500' : 'bg-amber-500'}`} initial={{ width: '100%' }} animate={{ width: `${(timeLeft / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30)) * 100}%` }} transition={{ duration: 1, ease: 'linear' }} />
            </div>
            <div className={`mt-2 text-right ${timeLeft < 5 ? 'text-red-500 animate-bounce' : 'text-slate-400'}`}><span className="text-xl font-black tabular-nums">{timeLeft}s</span></div>
        </div>
      )}
      <motion.div key={currentQuestionIndex} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="px-4">
        <div className="bg-white dark:bg-slate-800 p-8 sm:p-12 rounded-[3rem] border border-slate-100 dark:border-slate-700 shadow-clinical relative overflow-hidden">
           <div className="absolute top-0 right-0 p-8 opacity-[0.03] dark:opacity-[0.05] pointer-events-none"><Brain size={160} /></div>
           <div className="relative z-10">
              <span className="inline-block px-4 py-1.5 bg-medical-50 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 rounded-xl text-[10px] font-black uppercase tracking-widest mb-6 border border-medical-100 dark:border-medical-800">{currentQ.subject}</span>
              <h3 className="text-[clamp(1rem,4vw,1.5rem)] sm:text-2xl font-black leading-tight tracking-tight text-balance">{currentQ.question}</h3>
           </div>
        </div>
      </motion.div>
      <div className={`px-4 grid gap-4 ${isSpeed ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {currentQ.options.map((option, idx) => (
          <OptionButton key={idx} label={option} index={idx} state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : 'normal')} onClick={() => handleOptionClick(option)} disabled={showRationale || eliminatedOptions.includes(option)} dark={isSpeed} isSpeed={isSpeed} pollValue={classPoll ? classPoll[option] : undefined} />
        ))}
      </div>
      <div className="px-4 grid grid-cols-3 gap-4">
         <LifelineButton icon={<ShuffleIcon />} label="50/50" used={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} dark={isSpeed} />
         <LifelineButton icon={<Users />} label="Poll" used={lifelinesUsed.askClass} onClick={askClass} dark={isSpeed} />
         <LifelineButton icon={<Info />} label="Mentor" used={lifelinesUsed.hint} onClick={useMentor} dark={isSpeed} />
      </div>
      <AnimatePresence>
         {isFinalAnswer && !showRationale && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-x-0 bottom-0 z-40 p-6 bg-slate-900/90 backdrop-blur-md border-t border-white/10 flex flex-col items-center gap-4">
               <p className="text-white font-black uppercase tracking-[0.3em] text-xs">Is that your final answer?</p>
               <div className="flex gap-4 w-full max-w-sm">
                  <button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="flex-1 py-4 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-[10px]">Change</button>
                  <button onClick={() => confirmAnswer()} className="flex-1 py-4 bg-amber-500 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-amber-500/20 animate-pulse">Confirm</button>
               </div>
            </motion.div>
         )}
      </AnimatePresence>
      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={nextQuestion} />
             <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[3rem] sm:rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-white/10">
                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-8 mx-auto sm:mx-0 ${isCorrect ? 'bg-emerald-100 text-emerald-600 shadow-lg shadow-emerald-500/20' : 'bg-red-100 text-red-600 shadow-lg shadow-red-500/20'}`}>{isCorrect ? <CheckCircle2 size={40} /> : <XCircle size={40} />}</div>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4 text-center sm:text-left">
                   <div className="w-full">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">{isCorrect ? 'Logic Validated' : 'Conceptual Misalignment'}</p>
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">{isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}</h4>
                   </div>
                   {consecutiveCorrect >= 5 && isCorrect && (
                      <div className="px-4 py-2 bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-widest animate-bounce flex items-center gap-2 border border-amber-200">
                         <Zap size={12} /> Lifeline Restored!
                      </div>
                   )}
                </div>
                <div className="max-h-40 overflow-y-auto custom-scrollbar mb-8 text-slate-600 dark:text-slate-300"><p className="font-medium text-base leading-relaxed italic">{currentQ.rationale || "Nurses must apply critical thinking and clinical protocols to ensure patient safety and prioritize airway, breathing, and circulation."}</p></div>
                <div className="p-6 bg-slate-50 dark:bg-white/5 rounded-2xl mb-10 border border-slate-100 dark:border-white/5 flex gap-4 items-start text-left text-slate-700 dark:text-slate-300">
                   <div className="p-2 bg-medical-100 text-medical-600 rounded-lg shrink-0"><Target size={16} /></div>
                   <div>
                      <p className="text-[10px] font-black uppercase text-medical-600 mb-1 tracking-widest">Clinical Mentor Note</p>
                      <p className="text-sm font-bold leading-snug italic text-balance">"{currentQ.hint || 'Focus on the physiological foundation and the primary action that ensures long-term stability.'}"</p>
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
                <p className="text-slate-600 dark:text-slate-300 font-medium italic text-lg leading-relaxed mb-10 text-balance text-center">"{currentQ.hint || 'Prioritize patient safety and focus on the intervention that addresses the root cause of the clinical presentation.'}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-all">Return to Question</button>
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

const ShuffleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" />
  </svg>
);

export default Quiz;
