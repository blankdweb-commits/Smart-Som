import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import SourceBadge from "../components/SourceBadge";
import ComingSoon from '../components/ComingSoon';
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
  Info,
  Bookmark,
  Puzzle,
  Shuffle
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';

const EXIT_PROMPTS = [
  "Every unanswered question is a missed opportunity to save a future patient.",
  "Today's revision prevents tomorrow's regret.",
  "Your future patients are counting on your knowledge.",
  "Clinical excellence is built one question at a time.",
  "Don't stop now—mastery is just a few challenges away.",
  "Persistence is the hallmark of a great healthcare professional.",
  "Your clinical judgment is sharpening with every answer."
];

const ACHIEVEMENTS = [
  { q: 1, label: "Clinical Novice" },
  { q: 10, label: "Ward Helper" },
  { q: 20, label: "Senior Student" },
  { q: 30, label: "Future Matron" },
  { q: 50, label: "Clinical Leader" },
  { q: 75, label: "Clinical Legend" }
];

const getSpeedTimerValue = (index) => {
  if (index < 5) return 30;
  if (index < 10) return 20;
  if (index < 20) return 15;
  return 10;
};

const Quiz = () => {
  const navigate = useNavigate();
  const { flashcards, studyStats, updateQuizStats, setIsQuizActive } = useAppContext();

  // Low RAM / Performance Detection
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  useEffect(() => {
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) setIsLowPowerMode(true);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setIsLowPowerMode(true);
  }, []);

  // Unified State Machine
  const [quizMode, setQuizMode] = useState('selection');
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const [selectedOption, setSelectedOption] = useState(null);
  const [isFinalAnswer, setIsFinalAnswer] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [timeLeft, setTimeLeft] = useState(30);

  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [currentMilestone, setCurrentMilestone] = useState("Clinical Beginner");
  const [sessionXP, setSessionXP] = useState(0);

  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitPrompt, setExitPrompt] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [mentorAdvice, setMentorAdvice] = useState(null);
  const [restoredThisTurn, setRestoredThisTurn] = useState(false);
  const [questionLimit, setQuestionLimit] = useState(10);
  const [useTimer, setUseTimer] = useState(true);

  const normalizeQuestion = useCallback((q) => {
    let options = q.options || q.choices || [q.correctAnswer, q.wrongAnswer1, q.wrongAnswer2, q.wrongAnswer3].filter(Boolean);
    if (options.length === 0) {
      const fallbackAns = q.answer || q.correct_answer_text || "Consult medical protocol";
      options = [fallbackAns, "Increase monitoring of vital signs", "Document findings", "Perform head-to-toe assessment"];
    }
    const correctText = q.answer || q.correct_answer_text || q.correctAnswer || q.back || options[0];

    return {
      question: q.question || q.front || "Question text unavailable.",
      options: options,
      correctAnswer: correctText,
      correctAnswerText: correctText,
      rationale: q.rationale || q.explanation || q.back || "Clinical judgment and patient safety protocols guide this nursing intervention.",
      clinical_application: q.clinical_application || q.clinicalApplication || "Apply the ABC framework to prioritize patient care.",
      simplification: q.simplification || "Focus on the intervention that addresses the most immediate threat to patient stability.",
      subject: q.subject || q.category || "General Nursing",
      source: q.source || "Apex Core",
      hints: q.hints || (q.hint ? [q.hint] : [])
    };
  }, []);

  const subjects = useMemo(() => {
    const counts = {};
    flashcards.forEach(c => {
      const sub = c.subject || 'General';
      counts[sub] = (counts[sub] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count);
  }, [flashcards]);

  const initQuiz = (mode, subjectFilter = null) => {
    let pool = [...flashcards];
    if (subjectFilter) pool = pool.filter(c => c.subject === subjectFilter);
    if (pool.length === 0) { setQuizMode('empty'); return; }

    // Weighting Logic
    const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
    const nmcn = pool.filter(c => !c.source?.toLowerCase().includes('richard'));
    richard.sort(() => 0.5 - Math.random());
    nmcn.sort(() => 0.5 - Math.random());

    const limit = (mode === 'speed' || mode === 'quick') ? 10 : (mode === 'subject' ? Math.min(pool.length, questionLimit) : questionLimit);
    let combined = [];
    if (mode === 'speed') {
      const rCount = Math.min(Math.ceil(limit * 0.7), richard.length);
      combined = [...richard.slice(0, rCount), ...nmcn.slice(0, Math.max(0, limit - rCount))];
    } else {
      combined = pool.sort(() => 0.5 - Math.random()).slice(0, limit);
    }

    setQuizQuestions(combined.map(q => {
       const n = normalizeQuestion(q);
       return { ...n, options: [...n.options].sort(() => 0.5 - Math.random()) };
    }));

    setQuizMode(mode); setQuizStarted(true); setIsQuizActive(true);
    setCurrentQuestionIndex(0); setScore(0); setShowResults(false);
    setSelectedOption(null); setShowHint(false); setShowRationale(false);
    setIsCorrect(null); setEliminatedOptions([]);
    setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
    setConsecutiveCorrect(0); setSessionXP(0); setCurrentMilestone("Clinical Beginner");
    setTimeLeft(mode === 'speed' ? getSpeedTimerValue(0) : 30);
  };

  useEffect(() => {
    let timer;
    if (quizStarted && !showResults && !showRationale && !isFinalAnswer && !showExitConfirm && (quizMode === 'speed' || useTimer)) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer); confirmAnswer(null); return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [quizStarted, showResults, showRationale, quizMode, useTimer, isFinalAnswer, showExitConfirm]);

  const confirmAnswer = (opt = selectedOption) => {
    const currentQ = quizQuestions[currentQuestionIndex];
    const correct = opt === currentQ.correctAnswer;
    setIsCorrect(correct); setIsFinalAnswer(false);

    if (correct) {
      setScore(s => s + 1);
      const ach = ACHIEVEMENTS.slice().reverse().find(a => (score + 1) >= a.q);
      if (ach) setCurrentMilestone(ach.label);
      const newCombo = consecutiveCorrect + 1;
      setConsecutiveCorrect(newCombo);
      const multiplier = newCombo >= 10 ? 5 : (newCombo >= 5 ? 3 : (newCombo >= 3 ? 2 : 1));
      setSessionXP(p => p + (10 * multiplier));
      if (newCombo % 5 === 0) {
        setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
        setRestoredThisTurn(true);
      }
    } else {
      setConsecutiveCorrect(0);
    }
    setShowRationale(true);
  };

  const nextQuestion = () => {
    setShowRationale(false); setRestoredThisTurn(false);
    if (!isCorrect && quizMode === 'speed') { setShowResults(true); setIsQuizActive(false); return; }
    if (currentQuestionIndex < quizQuestions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx); setSelectedOption(null);
      setIsCorrect(null); setEliminatedOptions([]); setClassPoll(null);
      setTimeLeft(quizMode === 'speed' ? getSpeedTimerValue(nextIdx) : 30);
    } else { setShowResults(true); setIsQuizActive(false); }
  };

  if (!quizStarted) {
    if (quizMode === 'empty') {
      return <ComingSoon title="Subject Under Calibration" description="This specific course specialization is currently being populated with clinical questions. Please select another subject in the meantime." />;
    }
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {quizMode === 'selection' ? (
          <>
            <header className="text-center mb-12">
              <div className={`w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 ${isLowPowerMode ? "" : "shadow-2xl"} border-2 border-medical-500/20`}><Brain size={40} className="animate-pulse" /></div>
              <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2 uppercase tracking-tighter">Clinical Training Hub</h2>
              <p className="text-slate-500 font-medium tracking-tight">Select your specialization protocol</p>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <ModeCard title="Clinical Challenge" desc="Full exam simulation." icon={<Shield size={24} />} duration="10-20 min" timer="Optional" color="medical" onClick={() => setQuizMode('clinical-select')} />
              <ModeCard title="Speed Challenge" desc="Kahoot-style rapid fire." icon={<Zap size={24} />} duration="5-15 min" timer="Progressive" color="amber" onClick={() => initQuiz('speed')} />
              <ModeCard title="Quick Quiz" desc="5-10 rapid questions." icon={<Clock size={24} />} duration="2-5 min" timer="Optional" color="indigo" onClick={() => setQuizMode('quick-select')} />
              <ModeCard title="Subject Mastery" desc="Master one course." icon={<Target size={24} />} duration="Custom" timer="Optional" color="emerald" onClick={() => setQuizMode('subject-select')} />
            </div>
          </>
        ) : (
          <div className="max-w-4xl mx-auto animate-in fade-in duration-500">
            <button onClick={() => setQuizMode('selection')} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-8 hover:text-medical-600 transition-colors"><ChevronLeft size={16} /> Back</button>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-6 uppercase tracking-tight">{quizMode.split('-')[0]} Protocol</h3>
            <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 mb-8 shadow-clinical">
               <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest text-center sm:text-left">Protocol Depth</p><div className="flex gap-4">{[10, 20, 50].map(n => (<button key={n} onClick={() => setQuestionLimit(n)} className={`flex-1 py-4 rounded-2xl font-black transition-all ${questionLimit === n ? 'bg-medical-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}>{n}</button>))}</div></div>
                  <div className="space-y-4"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest text-center sm:text-left">Time Constraints</p><button onClick={() => setUseTimer(!useTimer)} className={`w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${useTimer ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}><Timer size={16} /> {useTimer ? '30s / Item' : 'Disabled'}</button></div>
               </div>
            </div>
            {quizMode === 'subject-select' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">{subjects.map(sub => (<button key={sub.name} onClick={() => initQuiz('subject', sub.name)} className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border-2 border-slate-100 dark:border-slate-700 hover:border-emerald-500 transition-all text-left shadow-sm hover:shadow-md"><p className="text-[10px] font-black text-slate-400 mb-1">{sub.count} Items</p><p className="font-black text-slate-900 dark:text-white truncate">{sub.name}</p></button>))}</div>
            ) : (
              <button onClick={() => initQuiz(quizMode.split('-')[0])} className={`w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl uppercase tracking-widest ${isLowPowerMode ? "" : "shadow-2xl"} active:scale-95 transition-all hover:bg-slate-800 mt-8`}>Activate Protocol</button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32 px-4 text-slate-900 dark:text-white">
        <div className="relative inline-block"><div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" /><div className={`relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 ${isLowPowerMode ? "" : "shadow-2xl"}`}><Trophy size={64} /></div></div>
        <h2 className="text-4xl font-black tracking-tighter uppercase">Validation Complete</h2>
        <p className="text-slate-500 dark:text-slate-400 text-xl font-medium tracking-widest uppercase">Rank: <span className="text-medical-600 font-black">{currentMilestone}</span></p>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">Score</p><p className="text-3xl font-black">{score} / {quizQuestions.length}</p></div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">XP Earned</p><p className="text-3xl font-black text-medical-600">+{sessionXP}</p></div>
        </div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto"><button onClick={() => { setQuizMode('selection'); setQuizStarted(false); setShowResults(false); setIsQuizActive(false); }} className={`w-full py-6 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-[2rem] font-black text-lg ${isLowPowerMode ? "" : "shadow-2xl"} active:scale-95 transition-all uppercase`}>New Protocol</button><button onClick={() => navigate('/dashboard')} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 rounded-[2rem] font-black border border-slate-100 dark:border-slate-800 hover:bg-slate-50 transition-all uppercase">Dashboard</button></div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];
  const isSpeed = quizMode === 'speed';

  return (
    <div className={`fixed inset-0 z-[60] bg-[#0F172A] flex flex-col text-white overflow-hidden`}>
      <div className={`h-[20vh] bg-[#6366f1] w-full relative transition-colors duration-500`}>
         <div className="p-6 pt-10 flex items-center justify-between gap-4 max-w-2xl mx-auto">
            <div className="bg-black/80 rounded-xl px-4 py-2.5 flex items-center gap-2 border border-white/5 shadow-xl">
               <Users size={16} className="text-white" /><span className="text-white font-black text-sm">{currentQuestionIndex + 1} of {quizQuestions.length}</span>
            </div>
            <div className="flex-1 h-2 bg-black/30 rounded-full overflow-hidden relative mx-2">
               <motion.div className="h-full bg-[#FF7A00] rounded-full shadow-[0_0_10px_rgba(255,122,0,0.4)]" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} transition={{ duration: 0.8 }} />
            </div>
            <div className="bg-[#FF7A00] rounded-xl px-4 py-2.5 flex items-center gap-2 shadow-lg shadow-orange-600/30">
               <Puzzle size={16} className="text-white fill-white" /><span className="text-white font-black text-sm">{score} Correct</span>
            </div>
         </div>
         <div className="absolute bottom-6 left-0 right-0 px-6 flex justify-between items-center max-w-2xl mx-auto opacity-60">
            <div className="flex items-center gap-2"><SourceBadge source={currentQ.source} /><span className="text-[10px] font-black uppercase tracking-widest text-white/60">{currentQ.subject}</span></div>
            {isSpeed && <span className="text-[10px] font-black uppercase tracking-widest text-white/80 bg-white/10 px-3 py-1 rounded-full">{currentMilestone}</span>}
         </div>
      </div>

      <div className="flex-1 flex flex-col px-4 -mt-12 z-10 max-w-2xl mx-auto w-full overflow-y-auto no-scrollbar pb-32">
         <div className="relative flex justify-center mb-4 -mt-12">
            <div className={`relative w-24 h-24 bg-[#1B2343] rounded-full flex items-center justify-center border-[8px] border-[#0F172A] ${isLowPowerMode ? "" : "shadow-2xl"}`}>
               <svg className="absolute inset-0 w-full h-full -rotate-90 p-1">
                  <circle cx="44" cy="44" r="38" stroke="currentColor" strokeWidth="8" fill="transparent" className={timeLeft < 5 ? 'text-red-500' : 'text-[#FF7A00]'} style={{ strokeDasharray: 239, strokeDashoffset: 239 - (239 * timeLeft) / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30), transition: timeLeft === (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30) ? 'none' : 'stroke-dashoffset 1s linear' }} />
               </svg>
               <span className={`text-3xl font-black tabular-nums ${timeLeft < 5 ? "text-red-500 animate-pulse" : "text-white"}`}>{timeLeft}</span>
            </div>
         </div>

         <motion.div key={currentQuestionIndex} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`bg-[#1B2343] rounded-[3rem] p-10 border border-white/10 ${isLowPowerMode ? "" : "shadow-2xl"} text-center mb-8 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={160} /></div>
            <div className="flex justify-between items-center mb-8">
               <button disabled={lifelinesUsed.hint || showRationale} onClick={() => { if(lifelinesUsed.hint || showRationale) return; setMentorAdvice({ type: 'Quick Hint', text: currentQ.hints[0] || currentQ.simplification }); setShowHint(true); setLifelinesUsed(l => ({ ...l, hint: true })); }} className={`bg-orange-500/10 text-orange-500 px-4 py-2 rounded-xl border border-orange-500/20 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest hover:bg-orange-500/20 transition-all ${lifelinesUsed.hint ? "opacity-20 grayscale" : "active:scale-95"}`}><Zap size={14} /> Hint</button>
               <div className="flex items-center gap-2">
                  <button disabled={lifelinesUsed.fiftyFifty || showRationale} onClick={() => { if(lifelinesUsed.fiftyFifty || showRationale) return; setEliminatedOptions(currentQ.options.filter(o => o !== currentQ.correctAnswer).sort(() => 0.5 - Math.random()).slice(0, 2)); setLifelinesUsed(l => ({ ...l, fiftyFifty: true })); }} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.fiftyFifty ? "opacity-20 grayscale" : "active:scale-95"}`}><Shuffle size={14} /></button>
                  <button disabled={lifelinesUsed.askClass || showRationale} onClick={() => { if(lifelinesUsed.askClass || showRationale) return; const res = {}; const vis = currentQ.options.filter(o => !eliminatedOptions.includes(o)); const correctS = Math.floor(Math.random() * 30 + 60); res[currentQ.correctAnswer] = correctS; let rem = 100 - correctS; const others = vis.filter(o => o !== currentQ.correctAnswer); others.forEach((o, i) => { if(i === others.length-1) res[o] = rem; else { const s = Math.floor(Math.random() * (rem / 1.5)); res[o] = s; rem -= s; } }); currentQ.options.forEach(o => { if(!(o in res)) res[o] = 0; }); setClassPoll(res); setLifelinesUsed(l => ({ ...l, askClass: true })); }} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.askClass ? "opacity-20 grayscale" : "active:scale-95"}`}><Users size={14} /></button>
                  <button disabled={lifelinesUsed.mentor || showRationale} onClick={() => { if(lifelinesUsed.mentor || showRationale) return; setMentorAdvice({ type: 'Clinical Mentor', text: `Clinical Insight: Based on the patient case, I recommend "${currentQ.correctAnswerText}" because ${currentQ.simplification.toLowerCase()}.`, confidence: 95 }); setShowHint(true); setLifelinesUsed(l => ({ ...l, mentor: true })); }} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.mentor ? "opacity-20 grayscale" : "active:scale-95"}`}><Shield size={14} /></button>
               </div>
            </div>
            <div>
               <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Question <span className="text-[#FF7A00]">{String(currentQuestionIndex + 1).padStart(2, '0')}</span></h2>
               <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mt-1 italic italic">Clinical Simulation Protocol</p>
               <div className="w-full border-t border-white/5 border-dashed my-8" />
               <h3 className="text-xl sm:text-2xl font-bold leading-tight text-white px-2 tracking-tight italic">"{currentQ.question}"</h3>
            </div>
         </motion.div>

         <div className="space-y-1">
            {currentQ.options.map((option, idx) => {
               const isEliminated = eliminatedOptions.includes(option);
               return (
                  <AnimatePresence key={idx}>
                     {!isEliminated && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.8, filter: "blur(10px)" }} transition={{ duration: 0.4 }}>
                           <OptionButton label={option} index={idx} state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : 'normal')} onClick={() => handleOptionClick(option)} disabled={showRationale} pollValue={classPoll ? classPoll[option] : undefined} isLowPowerMode={isLowPowerMode} />
                        </motion.div>
                     )}
                  </AnimatePresence>
               );
            })}
         </div>

         <AnimatePresence>
            {showRationale && (
               <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-8 space-y-6 pb-10">
                  <div className="p-6 bg-emerald-500/10 rounded-[2rem] border border-emerald-500/20 flex items-center gap-4 shadow-[0_0_20px_rgba(34,197,94,0.1)]">
                     <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20"><CheckCircle2 size={24}/></div>
                     <div><p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Correct Answer</p><p className="font-black text-white text-lg leading-tight">{currentQ.correctAnswerText}</p></div>
                  </div>
                  <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 space-y-6">
                     <div><p className="text-[10px] font-black uppercase text-[#FF7A00] mb-2 tracking-widest flex items-center gap-2"><Info size={12} /> Clinical Rationale</p><p className="font-medium text-sm leading-relaxed text-slate-300 italic italic">"{currentQ.rationale}"</p></div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-5 bg-blue-500/5 rounded-2xl border border-blue-500/10"><p className="text-[10px] font-black uppercase text-blue-400 mb-2 tracking-widest">🏥 Application</p><p className="text-xs font-bold text-slate-200">{currentQ.clinical_application}</p></div>
                        <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/10"><p className="text-[10px] font-black uppercase text-amber-500 mb-2 tracking-widest">💡 Simplification</p><p className="text-xs font-medium text-amber-200/80 leading-relaxed">{currentQ.simplification}</p></div>
                     </div>
                  </div>
               </motion.div>
            )}
         </AnimatePresence>
      </div>

      <AnimatePresence>
         {isFinalAnswer && !showRationale && (
            <div className={`fixed inset-0 z-[70] flex items-center justify-center p-6 bg-[#0B1020]/90 ${isLowPowerMode ? "" : "backdrop-blur-md"}`}>
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className={`bg-[#1B2343] p-8 rounded-[3rem] ${isLowPowerMode ? "" : "shadow-2xl"} border border-white/10 flex flex-col items-center gap-6 max-w-sm w-full text-center`}>
                  <div className="w-16 h-16 bg-[#FF7A00]/20 text-[#FF7A00] rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(255,122,0,0.2)]"><HelpCircle size={32}/></div>
                  <div><h4 className="text-xl font-black text-white uppercase">Confirm Selection?</h4><p className="text-sm text-slate-400 font-medium tracking-tight">Locked in your clinical decision?</p></div>
                  <div className="flex gap-4 w-full"><button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="flex-1 py-4 bg-white/5 text-white/60 rounded-2xl font-black uppercase text-[10px]">Change</button><button onClick={() => confirmAnswer()} className="flex-1 py-4 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] animate-pulse">Confirm</button></div>
               </motion.div>
            </div>
         )}
      </AnimatePresence>

      <AnimatePresence>
         {showRationale && (
            <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-slate-950 to-transparent z-[100]">
               <button onClick={nextQuestion} className={`w-full max-w-2xl mx-auto py-6 bg-[#FF7A00] text-white rounded-[2rem] font-black text-xl uppercase tracking-widest ${isLowPowerMode ? "" : "shadow-2xl"} active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-orange-600 group`}>Next <ArrowRight size={24} className="group-hover:translate-x-2 transition-transform" /></button>
            </motion.div>
         )}
      </AnimatePresence>

      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`relative w-full max-w-md bg-[#1B2343] p-10 rounded-[3rem] ${isLowPowerMode ? "" : "shadow-2xl"} border border-white/10 text-center`}>
                <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><Target size={40} /></div>
                <h4 className="text-2xl font-black text-white mb-1 uppercase tracking-tight">{mentorAdvice?.type}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase mb-8 tracking-[0.2em]">Confidence: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-300 font-medium italic text-lg leading-relaxed mb-10 px-4">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px] hover:bg-white/20 transition-all border border-white/5">Return to Specialization</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExitConfirm && (
          <div className={`fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 ${isLowPowerMode ? "" : "backdrop-blur-xl"}`}>
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`bg-[#1B2343] p-10 rounded-[3rem] ${isLowPowerMode ? "" : "shadow-2xl"} max-w-sm w-full text-center border border-white/10`}>
                <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><AlertCircle size={40} /></div>
                <h4 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter">Terminate Protocol?</h4>
                <p className="text-slate-400 font-medium italic mb-10 leading-relaxed text-balance px-4 italic">"{exitPrompt}"</p>
                <div className="flex flex-col gap-3"><button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-[#FF7A00]/20 active:scale-95 transition-transform">Stay and Continue</button><button onClick={() => { setQuizStarted(false); setShowResults(true); setIsQuizActive(false); setShowExitConfirm(false); }} className="w-full py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[10px] hover:text-red-500 transition-colors">End Session</button></div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const ModeCard = ({ title, desc, icon, duration, timer, color, onClick }) => {
  const colors = {
    medical: 'hover:border-medical-500 bg-medical-500/10 text-medical-600',
    amber: 'hover:border-amber-500 bg-amber-500/10 text-amber-600',
    indigo: 'hover:border-indigo-500 bg-indigo-500/10 text-indigo-600',
    emerald: 'hover:border-emerald-500 bg-emerald-500/10 text-emerald-600'
  };
  return (
    <button onClick={onClick} className={`p-8 bg-white dark:bg-slate-800 rounded-[2.5rem] border-2 border-slate-100 dark:border-slate-700 transition-all text-left group active:scale-95 flex flex-col justify-between min-h-[260px] shadow-sm hover:shadow-xl ${colors[color].split(' ')[0]}`}>
      <div><div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 transition-all group-hover:scale-110 shadow-inner ${colors[color].split(' ').pop()} ${colors[color].split(' ')[1]}`}>{icon}</div><h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">{title}</h3><p className="text-slate-500 dark:text-slate-400 text-sm font-medium leading-relaxed tracking-tight">{desc}</p></div>
      <div className="flex gap-4 mt-8"><div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Clock size={12} /> {duration}</div><div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Timer size={12} /> {timer}</div></div>
    </button>
  );
};

const OptionButton = ({ label, index, state, pollValue, onClick, disabled, isLowPowerMode }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  let baseStyles = 'bg-[#222831] border-white/5 text-white/70';
  if (state === 'selected') baseStyles = 'bg-[#FF7A00]/10 border-[#FF7A00] text-white';
  if (state === 'correct') baseStyles = 'bg-[#1a3a2a] border-emerald-500 text-emerald-500';
  if (state === 'wrong') baseStyles = 'bg-[#1E1E1E] border-[#FF7A00] text-[#FF7A00]';
  if (state === 'eliminated') baseStyles = 'opacity-0 pointer-events-none scale-95';

  return (
    <button disabled={disabled || state === 'eliminated'} onClick={() => { if(label.length > 80 && !isExpanded) setIsExpanded(true); else onClick(); }} className={`relative flex items-center justify-between w-full p-6 rounded-[2rem] border-2 transition-all duration-300 ${baseStyles} active:scale-[0.98] ${isLowPowerMode ? "" : "shadow-lg"} mb-4`}>
      <div className="flex flex-col items-start pr-8">
        <p className={`font-bold text-left text-sm sm:text-base tracking-tight ${!isExpanded && label.length > 100 ? 'line-clamp-2' : ''}`}>{label}</p>
        {pollValue !== undefined && (<div className="mt-2 w-32"><div className="h-1 bg-white/10 rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pollValue}%`}} className="h-full bg-blue-500" /></div><p className="text-[10px] font-black mt-1 opacity-60 uppercase tracking-tighter">{pollValue}% choosing this</p></div>)}
      </div>
      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center shrink-0 ${state === 'correct' ? 'bg-emerald-500 border-emerald-500 text-white' : (state === 'wrong' ? 'bg-orange-600 border-orange-600 text-white' : 'border-white/10')}`}>
        {state === 'correct' && <CheckCircle2 size={20} />}
        {state === 'wrong' && <XCircle size={20} />}
        {state === 'normal' && <div className="w-2 h-2 rounded-full bg-white/20" />}
        {state === 'selected' && <div className="w-3 h-3 rounded-full bg-[#FF7A00]" />}
      </div>
    </button>
  );
};

export default Quiz;