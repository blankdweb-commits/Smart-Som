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

const ACHIEVEMENTS = [
  { q: 1, label: "Clinical Novice" },
  { q: 10, label: "Ward Helper" },
  { q: 20, label: "Senior Student" },
  { q: 30, label: "Future Matron" },
  { q: 40, label: "Clinical Leader" },
  { q: 60, label: "Clinical Legend" }
];

const getSpeedTimerValue = (index) => {
  if (index < 5) return 20;
  if (index < 10) return 18;
  return 15;
};

const Quiz = () => {
  const { flashcards, studyStats, setStudyStats, setIsQuizActive } = useAppContext();
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
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false, mentor: false });
  const [hintIndex, setHintIndex] = useState(0);
  const [classPoll, setClassPoll] = useState(null);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [currentMilestone, setCurrentMilestone] = useState("Clinical Beginner");
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitPrompt, setExitPrompt] = useState("");

  const updateQuizStats = useCallback((updates) => {
    setStudyStats(prev => ({ ...prev, ...updates }));
  }, [setStudyStats]);

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
    if (quizStarted && !showResults && !showRationale && !isFinalAnswer && !showExitConfirm && (quizMode === 'speed' || useTimer)) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            confirmAnswer(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [quizStarted, showResults, showRationale, isFinalAnswer, showExitConfirm, quizMode, useTimer, currentQuestionIndex]);

  const initQuiz = (mode, subjectFilter = null) => {
    let pool = [...flashcards];
    if (subjectFilter) pool = pool.filter(c => c.subject === subjectFilter);
    if (pool.length === 0) return;

    if (mode === 'speed') {
       const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
       const nmcn = pool.filter(c => c.source?.toLowerCase().includes('nmcn') || c.category === 'NMCN');
       const nclex = pool.filter(c => c.source?.toLowerCase().includes('nclex') || c.category === 'NCLEX');
       const core = pool.filter(c => !richard.includes(c) && !nmcn.includes(c) && !nclex.includes(c));

       const targetCount = 15;
       const rCount = Math.min(richard.length, Math.floor(targetCount * 0.7));
       const nmcnCount = Math.min(nmcn.length, Math.floor(targetCount * 0.2));
       const selected = [
         ...richard.sort(() => 0.5 - Math.random()).slice(0, rCount),
         ...nmcn.sort(() => 0.5 - Math.random()).slice(0, nmcnCount),
         ...nclex.sort(() => 0.5 - Math.random()).slice(0, 1),
         ...core.sort(() => 0.5 - Math.random()).slice(0, Math.max(0, targetCount - rCount - nmcnCount - 1))
       ].sort(() => 0.5 - Math.random());
       pool = selected;
    }

    const seen = new Set();
    const uniquePool = pool.filter(c => seen.has(c.question) ? false : seen.add(c.question));
    const limit = mode === 'speed' ? 15 : questionLimit;
    const shuffled = uniquePool.sort(() => 0.5 - Math.random());
    const selectedCards = shuffled.slice(0, Math.min(limit, uniquePool.length));

    const questions = selectedCards.map(card => {
      let options;
      if (card.options && card.options.length > 0) {
        options = [...card.options].sort(() => 0.5 - Math.random());
      } else {
        const distractors = flashcards
          .filter(c => c.id !== card.id && c.answer !== card.answer)
          .sort(() => 0.5 - Math.random())
          .slice(0, 3)
          .map(c => c.answer);
        options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());
      }
      return { ...card, options, correctAnswer: card.answer };
    });

    setQuizQuestions(questions);
    setQuizMode(mode);
    setQuizStarted(true);
    setIsQuizActive(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
    setShowHint(false);
    setShowRationale(false);
    setIsCorrect(null);
    setEliminatedOptions([]);
    setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false, mentor: false });
    setConsecutiveCorrect(0);
    setCurrentMilestone("Clinical Beginner");
    setTimeLeft(mode === 'speed' ? getSpeedTimerValue(0) : 30);
  };

  const handleOptionClick = (option) => {
    if (showRationale) return;
    if (eliminatedOptions.includes(option)) return;
    setSelectedOption(option);
    setIsFinalAnswer(true);
  };

  const confirmAnswer = (opt = selectedOption) => {
    if (showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    if (!currentQ) return;
    const correct = opt === currentQ.correctAnswer;
    setIsCorrect(correct);
    setIsFinalAnswer(false);
    if (correct) {
      const newScore = score + 1;
      setScore(newScore);
      const ach = ACHIEVEMENTS.find(a => a.q === newScore);
      if (ach) setCurrentMilestone(ach.label);
      const newCombo = consecutiveCorrect + 1;
      setConsecutiveCorrect(newCombo);
      if (newCombo % 5 === 0) {
        setLifelinesUsed(prev => {
           if (prev.fiftyFifty) return { ...prev, fiftyFifty: false };
           if (prev.hint) return { ...prev, hint: false };
           if (prev.askClass) return { ...prev, askClass: false };
           if (prev.mentor) return { ...prev, mentor: false };
           return prev;
        });
      }
    } else {
      setConsecutiveCorrect(0);
    }
    setShowRationale(true);
  };

  const nextQuestion = () => {
    setShowRationale(false);
    if (quizMode === 'speed' && isCorrect === false) {
       setShowResults(true); setIsQuizActive(false);
       return;
    }
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedOption(null);
      setIsCorrect(null);
      setEliminatedOptions([]);
      setClassPoll(null);
      setHintIndex(0);
      if (quizMode === 'speed') setTimeLeft(getSpeedTimerValue(currentQuestionIndex + 1));
      else if (useTimer) setTimeLeft(30);
    } else {
      setShowResults(true); setIsQuizActive(false);
    }
  };

  const walkAway = () => {
    const prompts = [
      "Future nurses are built through consistency.",
      "Patients depend on the knowledge you gain today.",
      "Are you sure you want to walk away?",
      "Failure to prepare is preparing to fail."
    ];
    setExitPrompt(prompts[Math.floor(Math.random() * prompts.length)]);
    setShowExitConfirm(true);
  };

  const eliminateTwo = () => {
    if (lifelinesUsed.fiftyFifty || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrectOptions = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    const toEliminate = incorrectOptions.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const useMentor = () => {
    if (lifelinesUsed.mentor || showRationale) return;
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, mentor: true }));
  };

  const askClass = () => {
    if (lifelinesUsed.askClass || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const results = {};
    const visibleOptions = currentQ.options.filter(o => !eliminatedOptions.includes(o));
    let remaining = 100;
    const correctShare = Math.floor(Math.random() * 30 + 60);
    results[currentQ.correctAnswer] = correctShare;
    remaining -= correctShare;
    const others = visibleOptions.filter(o => o !== currentQ.correctAnswer);
    others.forEach((opt, i) => {
      if (i === others.length - 1) results[opt] = remaining;
      else {
        const share = Math.floor(Math.random() * remaining);
        results[opt] = share;
        remaining -= share;
      }
    });
    setClassPoll(results);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  const handleHintLifeline = () => {
    const currentQ = quizQuestions[currentQuestionIndex];
    const hints = currentQ.hints || (currentQ.hint ? [currentQ.hint] : []);
    if (hints.length > 0) {
       setHintIndex(prev => (prev + 1) % hints.length);
    }
    setLifelinesUsed(prev => ({ ...prev, hint: true }));
    setShowHint(true);
  };

  if (!quizStarted) {
    if (quizMode === 'selection') {
      return (
        <div className="max-w-6xl mx-auto py-10 px-4 animate-in fade-in duration-700 pb-32">
          <div className="text-center mb-16 space-y-4">
            <div className="w-20 h-20 bg-apex-600 rounded-[2rem] flex items-center justify-center text-white mx-auto shadow-2xl mb-6 shadow-apex-500/20 rotate-3"><Brain size={40} /></div>
            <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">Clinical Simulation Center</h2>
            <p className="text-slate-500 dark:text-slate-400 text-lg max-w-2xl mx-auto font-medium">Select your training intensity. From rapid fire challenges to full NMCN simulations.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ModeCard title="Clinical Challenge" desc="Full NMCN-style exam simulation. Requires final answer confirmation." icon={<Shield size={24} />} duration="10-20 min" timer="Optional" color="medical" onClick={() => setQuizMode('clinical-select')} />
            <ModeCard title="Speed Challenge" desc="70% Richard's Bank priority. Kahoot-style rapid fire." icon={<Zap size={24} />} duration="5-15 min" timer="Progressive" color="amber" onClick={() => initQuiz('speed')} />
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
          <button onClick={() => setQuizMode('selection')} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-8"><ChevronLeft size={16} /> Back to Selection</button>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-4 uppercase tracking-tight">{baseMode.replace('-', ' ')} Configuration</h3>
          <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 mb-8 space-y-8 shadow-clinical">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-4">
                   <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question Count</p>
                   <div className="flex gap-4">
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
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32 px-4 text-slate-900 dark:text-white">
        <div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 shadow-2xl"><Trophy size={64} /></div>
        <div className="space-y-2">
          <h2 className="text-4xl sm:text-5xl font-black tracking-tighter">Challenge Complete</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xl font-medium uppercase tracking-tight">Milestone Earned: <span className="text-medical-600 dark:text-medical-400 font-black">{currentMilestone}</span></p>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm"><p className="text-[10px] font-black uppercase text-slate-400 mb-1">Final Score</p><p className="text-3xl font-black">{score}</p></div>
          <div className="p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm"><p className="text-[10px] font-black uppercase text-slate-400 mb-1">Accuracy</p><p className="text-3xl font-black">{Math.round((score / Math.max(1, quizQuestions.length)) * 100)}%</p></div>
          <div className="p-6 bg-white dark:bg-slate-800 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-sm"><p className="text-[10px] font-black uppercase text-slate-400 mb-1">XP Gained</p><p className="text-3xl font-black text-emerald-500">+{score * 10}</p></div>
        </div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto">
          <button onClick={() => setQuizMode('selection')} className="w-full py-6 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-slate-800"><RefreshCw size={24} /> New Challenge</button>
          <button onClick={() => { setIsQuizActive(false); navigate('/dashboard'); }} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-[2rem] font-black uppercase tracking-widest text-xs border border-slate-100 dark:border-slate-700 hover:bg-slate-50 transition-all">Exit to Dashboard</button>
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];
  if (!currentQ) return null;
  const isSpeed = quizMode === 'speed';
  const isRichard = currentQ.source?.toLowerCase().includes('richard');

  return (
    <div className={`fixed inset-0 z-50 bg-white dark:bg-slate-950 overflow-y-auto custom-scrollbar ${isSpeed ? 'dark' : ''}`}>
      <div className="max-w-4xl mx-auto space-y-6 pb-32 pt-8 relative text-slate-900 dark:text-white">
        <div className="flex justify-between items-center px-6 mb-4">
           <div className="flex items-center gap-4">
              <div className="px-4 py-2 bg-slate-100 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question</p>
                 <p className="text-lg font-black">{currentQuestionIndex + 1}<span className="text-slate-400 text-sm">/{quizQuestions.length}</span></p>
              </div>
              <div className="px-4 py-2 bg-slate-100 dark:bg-white/5 rounded-2xl border border-slate-200 dark:border-white/10">
                 <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Score</p>
                 <p className="text-lg font-black">{score}</p>
              </div>
           </div>
           <div className="flex items-center gap-3">
              {isSpeed && <div className="px-5 py-2 bg-amber-500 text-white rounded-2xl shadow-lg hidden sm:block"><p className="text-[10px] font-black uppercase opacity-60 tracking-[0.1em]">Milestone</p><p className="text-[10px] font-black text-xs">{currentMilestone}</p></div>}
              <button onClick={walkAway} className="px-4 py-3 bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2">✕ Exit</button>
           </div>
        </div>

        {(isSpeed || ((quizMode === 'subject' || quizMode === 'quick') && useTimer)) && !showRationale && (
          <div className="px-6">
              <div className="h-1.5 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                 <motion.div className={`h-full ${timeLeft < 5 ? 'bg-red-500' : 'bg-amber-500'}`} initial={{ width: '100%' }} animate={{ width: `${(timeLeft / (quizMode === 'speed' ? getSpeedTimerValue(currentQuestionIndex) : 30)) * 100}%` }} transition={{ duration: 1, ease: 'linear' }} />
              </div>
              <div className={`mt-2 text-right ${timeLeft < 5 ? 'text-red-500 animate-pulse font-black' : 'text-slate-400 font-bold'}`}><span className="text-xl tabular-nums">{timeLeft}s</span></div>
          </div>
        )}

        <motion.div key={currentQuestionIndex} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="px-6">
          <div className="bg-white dark:bg-slate-800 p-8 sm:p-12 rounded-[3rem] border border-slate-100 dark:border-slate-700 shadow-clinical relative overflow-hidden">
             <div className="relative z-10">
                <div className="flex justify-between items-start mb-6">
                   <span className="inline-block px-4 py-1.5 bg-medical-50 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 rounded-xl text-[10px] font-black uppercase tracking-widest border border-medical-100 dark:border-medical-800">{currentQ.subject}</span>
                   <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest border ${isRichard ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_20px_rgba(99,102,241,0.6)] animate-pulse' : 'bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-slate-100 dark:border-white/5'}`}>
                      SOURCE: {currentQ.source || (isRichard ? "Richard's Bank" : "Apex Scholars Core")}
                   </span>
                </div>
                <h3 className="text-[clamp(1.1rem,4vw,1.75rem)] sm:text-2xl font-black leading-tight tracking-tight text-balance">{currentQ.question}</h3>
             </div>
          </div>
        </motion.div>

        <div className={`px-6 grid gap-4 ${quizMode === 'speed' ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {currentQ.options.map((option, idx) => (
            <OptionButton key={idx} label={option} index={idx} state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : 'normal')} onClick={() => handleOptionClick(option)} disabled={showRationale || eliminatedOptions.includes(option)} dark={isSpeed} isSpeed={isSpeed} pollValue={classPoll ? classPoll[option] : undefined} />
          ))}
        </div>

        <div className="px-6 grid grid-cols-4 gap-3">
           <LifelineButton icon={<ShuffleIcon />} label="50/50" used={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} dark={isSpeed} />
           <LifelineButton icon={<Users />} label="Poll" used={lifelinesUsed.askClass} onClick={askClass} dark={isSpeed} />
           <LifelineButton icon={<HelpCircle />} label="Hint" used={lifelinesUsed.hint && (currentQ.hints || [currentQ.hint]).length <= (hintIndex + 1)} onClick={handleHintLifeline} dark={isSpeed} />
           <LifelineButton icon={<Info />} label="Mentor" used={lifelinesUsed.mentor} onClick={useMentor} dark={isSpeed} />
        </div>

        <AnimatePresence>
           {isFinalAnswer && !showRationale && (
              <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
                 <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-950/60 backdrop-blur-md" onClick={() => setIsFinalAnswer(false)} />
                 <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-sm bg-white dark:bg-slate-900 p-8 rounded-[2.5rem] shadow-2xl text-center border border-slate-100 dark:border-white/10">
                    <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center mx-auto mb-6"><Zap size={32} /></div>
                    <p className="text-slate-900 dark:text-white font-black uppercase tracking-[0.3em] text-xs mb-8">Is this your final answer?</p>
                    <div className="flex flex-col gap-3">
                       <button onClick={() => confirmAnswer()} className="w-full py-5 bg-amber-500 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] shadow-xl shadow-amber-500/20 animate-pulse active:scale-95 transition-all">✅ Confirm Answer</button>
                       <button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="w-full py-4 bg-slate-50 dark:bg-white/5 text-slate-400 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-100 transition-all">↩ Change Answer</button>
                    </div>
                 </motion.div>
              </div>
           )}
        </AnimatePresence>

        <AnimatePresence>
          {showRationale && (
            <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center p-0 sm:p-6 overflow-hidden">
               <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={nextQuestion} />
               <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[3rem] sm:rounded-[3rem] p-8 sm:p-12 shadow-2xl border border-slate-100 dark:border-white/10 overflow-y-auto max-h-[95vh] custom-scrollbar">
                  <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-8 mx-auto sm:mx-0 ${isCorrect ? 'bg-emerald-100 text-emerald-600 shadow-lg shadow-emerald-500/20' : 'bg-red-100 text-red-600 shadow-lg shadow-red-500/20'}`}>{isCorrect ? <CheckCircle2 size={40} /> : <XCircle size={40} />}</div>
                  <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8 text-center sm:text-left">
                     <div className="w-full">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">{isCorrect ? 'Logic Validated' : 'Conceptual Misalignment'}</p>
                        <h4 className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter leading-none">{isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}</h4>
                     </div>
                     {consecutiveCorrect >= 5 && isCorrect && (
                        <div className="px-4 py-2 bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-widest animate-bounce flex items-center gap-2 border border-amber-200 shrink-0">
                           <Zap size={12} /> Lifeline Restored!
                        </div>
                     )}
                  </div>

                  <div className="space-y-8 mb-10">
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-5 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/5">
                           <p className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">Selected Answer</p>
                           <p className={`font-bold ${isCorrect ? 'text-emerald-600' : 'text-red-600'}`}>{selectedOption || "Timed Out"}</p>
                        </div>
                        <div className="p-5 bg-medical-50 dark:bg-medical-900/20 rounded-2xl border border-medical-100 dark:border-medical-900/50">
                           <p className="text-[10px] font-black uppercase text-medical-600 mb-2 tracking-widest">Correct Answer</p>
                           <p className="font-bold text-slate-900 dark:text-white">{currentQ.correctAnswer}: {currentQ.correct_answer_text || currentQ.answer}</p>
                        </div>
                     </div>

                     <div className="space-y-6 text-left">
                        <ReviewItem icon={<Brain size={16} />} title="Rationale" text={currentQ.rationale} fallback="No rationale supplied." />
                        <ReviewItem icon={<Target size={16} />} title="Clinical Application" text={currentQ.clinical_application} fallback="Clinical application not yet available." />
                        <ReviewItem icon={<Zap size={16} />} title="Simplification" text={currentQ.simplification} fallback="Simplified explanation coming soon." />
                     </div>
                  </div>

                  <button onClick={nextQuestion} className="w-full py-6 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:gap-6">{currentQuestionIndex < quizQuestions.length - 1 ? 'Continue Challenge' : 'Finish Challenge'} <ArrowRight size={20} /></button>
               </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showHint && !showRationale && (
            <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
               <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" onClick={() => setShowHint(false)} />
               <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className="relative w-full max-w-md bg-white dark:bg-slate-800 p-10 rounded-[3rem] shadow-2xl border border-vintage-100 dark:border-vintage-800 text-center">
                  <div className="w-20 h-20 bg-medical-50 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><HelpCircle size={40} /></div>
                  <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-3">Clinical Hint</h4>
                  <p className="text-slate-600 dark:text-slate-300 font-medium italic text-lg leading-relaxed mb-10 text-balance text-center">"{(currentQ.hints || (currentQ.hint ? [currentQ.hint] : []))[hintIndex] || 'No additional hints available.'}"</p>
                  <button onClick={() => setShowHint(false)} className="w-full py-5 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:scale-[1.02] active:scale-95 transition-all shadow-xl">Return to Question</button>
               </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showExitConfirm && (
            <div className="fixed inset-0 z-[130] flex items-center justify-center p-6">
               <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-red-950/90 backdrop-blur-xl" />
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white dark:bg-slate-900 p-10 rounded-[3rem] shadow-2xl text-center border-4 border-red-500/20">
                  <div className="w-20 h-20 bg-red-50 text-red-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8"><AlertCircle size={40} /></div>
                  <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-4">Walk Away?</h4>
                  <p className="text-slate-500 dark:text-slate-400 font-medium text-lg leading-relaxed mb-10 italic text-center">"{exitPrompt}"</p>
                  <div className="flex flex-col gap-3">
                     <button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-500/20 hover:scale-[1.02] active:scale-95 transition-all">Keep Studying</button>
                     <button onClick={() => { setShowExitConfirm(false); setQuizStarted(false); setIsQuizActive(false); setQuizMode('selection'); }} className="w-full py-5 bg-red-50 text-red-600 rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-red-100 transition-all">Walk Away Anyway</button>
                  </div>
               </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

const ReviewItem = ({ icon, title, text, fallback }) => (
   <div className="flex gap-4 items-start">
      <div className="p-2.5 bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400 rounded-xl shrink-0 mt-1">{icon}</div>
      <div>
         <p className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">{title}</p>
         <p className="text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300 italic">"{text || fallback}"</p>
      </div>
   </div>
);

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
  <button disabled={used} onClick={onClick} className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all active:scale-90 shadow-sm ${used ? (dark ? 'bg-white/5 border-white/5 text-white/5' : 'bg-slate-50 border-slate-100 text-slate-200') : (dark ? 'bg-white/10 border-white/10 text-amber-500 hover:border-amber-400' : 'bg-white border-slate-100 text-medical-600 hover:border-medical-500')}`}>
    {React.cloneElement(icon, { size: 20 })}
    <span className="text-[8px] font-black uppercase tracking-[0.2em] mt-2">{label}</span>
  </button>
);

const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark, isSpeed }) => {
  const shapes = ['■', '●', '▲', '◆'];
  let baseStyles = dark ? 'bg-white/5 border-white/10 text-white/80' : 'bg-white border-slate-100 text-slate-700';
  if (state === 'selected') baseStyles = dark ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-medical-50 border-medical-500 text-medical-700';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500';
  if (state === 'eliminated') baseStyles = 'opacity-10 grayscale pointer-events-none';

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center p-4 rounded-[2rem] border-2 transition-all duration-300 ${baseStyles} ${isSpeed ? 'min-h-[120px]' : 'min-h-[80px]'} active:scale-95`}
    >
      <div className="flex flex-col items-center gap-2">
         <span className="text-2xl font-black opacity-40">{shapes[index]}</span>
         <p className="font-bold text-center leading-tight text-sm sm:text-base">{label}</p>
      </div>
      {pollValue !== undefined && <div className="absolute bottom-2 inset-x-4"><div className="h-1 bg-white/20 rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pollValue}%`}} className="h-full bg-medical-500" /></div><p className="text-[8px] font-black mt-1">{pollValue}%</p></div>}
      {state === 'correct' && <motion.div initial={{scale:0}} animate={{scale:1}} className="absolute right-2 top-2 text-emerald-500"><CheckCircle2 size={24} /></motion.div>}
    </button>
  );
};

const ShuffleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" />
  </svg>
);

export default Quiz;
