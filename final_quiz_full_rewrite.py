import sys

content = """import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import SourceBadge from "../components/SourceBadge";
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
  Bookmark
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
  { q: 40, label: "Clinical Leader" },
  { q: 60, label: "Clinical Legend" }
];

const MILESTONES = [
  { q: 1, label: "Clinical Beginner" },
  { q: 5, label: "Future Staff Nurse", checkpoint: true },
  { q: 10, label: "Future Charge Nurse", checkpoint: true },
  { q: 15, label: "Future Matron", checkpoint: true }
];

const normalizeQuestion = (q) => {
  let options = [];
  if (q.options && Array.isArray(q.options) && q.options.length > 0) {
    options = [...q.options];
  } else if (q.option_a) {
    options = [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean);
  }

  if (options.length === 0) {
    const fallbackAns = q.answer || q.correct_answer_text || "Consult medical protocol";
    options = [fallbackAns, "Increase monitoring of vital signs", "Document findings", "Perform head-to-toe assessment"];
  }

  const correctText = q.answer || q.correct_answer_text || q.correct_answer || options[0];

  return {
    ...q,
    id: q.id || Math.random().toString(36).substr(2, 9),
    subject: q.subject || 'General Nursing',
    source: q.source || 'Apex Scholars Core Bank',
    question: q.question || "Question text unavailable.",
    options: options,
    correctAnswer: correctText,
    correctAnswerText: correctText,
    rationale: q.rationale || q.explanation || "Clinical judgment and patient safety protocols guide this nursing intervention.",
    clinical_application: q.clinical_application || q.clinicalApplication || "Apply the ABC framework to prioritize patient care.",
    simplification: q.simplification || "Focus on the intervention that addresses the most immediate threat to patient stability.",
    hints: q.hints || (q.hint ? [q.hint] : ["Think about priorities."])
  };
};

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
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [currentMilestone, setCurrentMilestone] = useState("Clinical Beginner");
  const [sessionXP, setSessionXP] = useState(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitPrompt, setExitPrompt] = useState("");
  const [mentorAdvice, setMentorAdvice] = useState(null);
  const [restoredThisTurn, setRestoredThisTurn] = useState(false);

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
    if (quizStarted && !showResults && !showRationale && !isFinalAnswer && (quizMode === 'speed' || useTimer)) {
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
  }, [quizStarted, showResults, showRationale, quizMode, useTimer, currentQuestionIndex, isFinalAnswer]);

  const initQuiz = (mode, subjectFilter = null) => {
    let pool = [...flashcards];
    if (subjectFilter) pool = pool.filter(c => c.subject === subjectFilter);
    if (pool.length === 0) return;

    // Filter to exclude Apex Core and only use Richard and NMCN
    const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
    const nmcn = pool.filter(c => c.source?.toLowerCase().includes('nmcn') || c.category === 'NMCN');

    richard.sort(() => 0.5 - Math.random());
    nmcn.sort(() => 0.5 - Math.random());

    const limit = mode === 'speed' ? 15 : questionLimit;
    const rCount = Math.min(Math.ceil(limit * 0.7), richard.length);
    const nmCount = limit - rCount;

    const combined = [...richard.slice(0, rCount), ...nmcn.slice(0, Math.max(0, nmCount))];
    const uniquePool = combined.filter((c, i, s) => s.findIndex(t => t.question === c.question) === i);
    const questions = uniquePool.sort(() => 0.5 - Math.random()).slice(0, limit).map(q => {
       const n = normalizeQuestion(q);
       return { ...n, options: [...n.options].sort(() => 0.5 - Math.random()) };
    });

    setQuizQuestions(questions);
    setQuizMode(mode);
    setQuizStarted(true); setIsQuizActive(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
    setShowHint(false);
    setShowRationale(false);
    setIsCorrect(null);
    setEliminatedOptions([]);
    setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
    setClassPoll(null);
    setIsFinalAnswer(false);
    setConsecutiveCorrect(0);
    setSessionXP(0);
    setCurrentMilestone("Clinical Beginner");
    setTimeLeft(mode === 'speed' ? getSpeedTimerValue(0) : 30);
  };

  const handleOptionClick = (option) => {
    if (showRationale || eliminatedOptions.includes(option)) return;
    if (selectedOption === option) confirmAnswer(option);
    else { setSelectedOption(option); setIsFinalAnswer(true); }
  };

  const confirmAnswer = (opt = selectedOption) => {
    const currentQ = quizQuestions[currentQuestionIndex];
    const correct = opt === currentQ.correctAnswer;
    setIsCorrect(correct);
    setIsFinalAnswer(false);
    if (correct) {
      const newScore = score + 1;
      setScore(newScore);
      const ach = ACHIEVEMENTS.find(a => a.q === newScore);
      if (ach) setCurrentMilestone(ach.label);
      const newCombo = consecutiveCorrect + 1;
      if (newCombo % 5 === 0) {
        setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
        setRestoredThisTurn(true);
      }
      setConsecutiveCorrect(newCombo);
      setSessionXP(prev => prev + (10 * (newCombo >= 8 ? 5 : (newCombo >= 5 ? 3 : (newCombo >= 3 ? 2 : 1)))));
      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      setConsecutiveCorrect(0);
      updateQuizStats({ quizStreak: 0 });
    }
    setShowRationale(true);
  };

  const nextQuestion = () => {
    setShowRationale(false);
    setRestoredThisTurn(false);
    if (!isCorrect && quizMode === 'speed') { setShowResults(true); setIsQuizActive(false); return; }
    if (currentQuestionIndex < quizQuestions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      setSelectedOption(null);
      setShowHint(false);
      setIsCorrect(null);
      setEliminatedOptions([]);
      setClassPoll(null);
      setIsFinalAnswer(false);
      setTimeLeft(quizMode === 'speed' ? getSpeedTimerValue(nextIdx) : 30);
    } else { setShowResults(true); setIsQuizActive(false); }
  };

  const walkAway = () => {
    setExitPrompt(EXIT_PROMPTS[Math.floor(Math.random() * EXIT_PROMPTS.length)]);
    setShowExitConfirm(true);
  };

  const eliminateTwo = () => {
    if (lifelinesUsed.fiftyFifty || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrect = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    setEliminatedOptions(incorrect.sort(() => 0.5 - Math.random()).slice(0, 2));
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const askClass = () => {
    if (lifelinesUsed.askClass || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const results = {};
    const visible = currentQ.options.filter(o => !eliminatedOptions.includes(o));
    const correctShare = Math.floor(Math.random() * 30 + 60);
    results[currentQ.correctAnswer] = correctShare;
    let remaining = 100 - correctShare;
    const others = visible.filter(o => o !== currentQ.correctAnswer);
    others.forEach((opt, i) => {
       if (i === others.length - 1) results[opt] = remaining;
       else { const s = Math.floor(Math.random() * (remaining / 1.5)); results[opt] = s; remaining -= s; }
    });
    currentQ.options.forEach(o => { if(!(o in results)) results[o] = 0; });
    setClassPoll(results);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  const useHint = () => {
    if (lifelinesUsed.hint || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const h = (currentQ.hints && currentQ.hints.length > 0) ? currentQ.hints[0] : currentQ.simplification;
    setMentorAdvice({ type: 'Quick Hint', text: h });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, hint: true }));
  };

  const useMentor = () => {
    if (lifelinesUsed.mentor || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const text = `Mentor Insight: testing ${currentQ.subject.toLowerCase()}. Considering the clinical context, I recommend "${currentQ.correctAnswerText}" because ${currentQ.simplification.toLowerCase()}.`;
    setMentorAdvice({ type: 'Clinical Mentor', text, confidence: Math.floor(Math.random() * 10 + 85) });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, mentor: true }));
  };

  if (quizMode === 'selection') {
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="text-center mb-12">
          <div className="w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 shadow-2xl border-2 border-medical-500/20"><Brain size={40} className="animate-pulse" /></div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2 uppercase">Quiz Hub</h2>
          <p className="text-slate-500 font-medium">Select your training protocol</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ModeCard title="Clinical Challenge" desc="Full exam simulation." icon={<Shield size={24} />} duration="10-20 min" timer="Optional" color="medical" onClick={() => setQuizMode('clinical-select')} />
          <ModeCard title="Speed Challenge" desc="Kahoot-style rapid fire." icon={<Zap size={24} />} duration="5-15 min" timer="Progressive" color="amber" onClick={() => initQuiz('speed')} />
          <ModeCard title="Quick Quiz" desc="5-10 rapid questions." icon={<Clock size={24} />} duration="2-5 min" timer="Optional" color="indigo" onClick={() => setQuizMode('quick-select')} />
          <ModeCard title="Subject Mastery" desc="Master one course." icon={<Target size={24} />} duration="Custom" timer="Optional" color="emerald" onClick={() => setQuizMode('subject-select')} />
        </div>
      </div>
    );
  }

  if (quizMode.endsWith('-select')) {
    const baseMode = quizMode.split('-')[0];
    const isSubject = baseMode === 'subject';
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in duration-500">
        <button onClick={() => setQuizMode('selection')} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-8 hover:text-medical-600 transition-colors"><ChevronLeft size={16} /> Back to selection</button>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-6 uppercase tracking-tight">{baseMode} Protocol</h3>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 mb-8 shadow-clinical">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4 text-center sm:text-left"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question Quantity</p><div className="flex gap-4 justify-center sm:justify-start">{[10, 20, 50].map(n => (<button key={n} onClick={() => setQuestionLimit(n)} className={`flex-1 py-4 rounded-2xl font-black transition-all ${questionLimit === n ? 'bg-medical-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}>{n}</button>))}</div></div>
              <div className="space-y-4 text-center sm:text-left"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Temporal Stress</p><button onClick={() => setUseTimer(!useTimer)} className={`w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${useTimer ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}><Timer size={16} /> {useTimer ? '30s / Item' : 'Disabled'}</button></div>
           </div>
        </div>
        {isSubject && <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">{subjects.map(sub => (<button key={sub.name} onClick={() => initQuiz('subject', sub.name)} className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border-2 border-slate-100 dark:border-slate-700 hover:border-emerald-500 transition-all text-left shadow-sm hover:shadow-md"><p className="text-[10px] font-black text-slate-400 mb-1">{sub.count} Questions</p><p className="font-black text-slate-900 dark:text-white truncate">{sub.name}</p></button>))}</div>}
        {!isSubject && <button onClick={() => initQuiz(baseMode)} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl uppercase tracking-widest shadow-2xl active:scale-95 transition-all hover:bg-slate-800 mt-8">Activate Protocol</button>}
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32 px-4 text-slate-900 dark:text-white">
        <div className="relative inline-block"><div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" /><div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 shadow-2xl"><Trophy size={64} /></div></div>
        <div className="space-y-2"><h2 className="text-4xl sm:text-5xl font-black tracking-tighter">Mission Complete</h2><p className="text-slate-500 dark:text-slate-400 text-xl font-medium uppercase">Protocol Status: <span className="text-medical-600 dark:text-medical-400 font-black">{currentMilestone}</span></p></div>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto"><div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1">Score</p><p className="text-3xl font-black">{score}</p></div><div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1">XP Earned</p><p className="text-3xl font-black text-medical-600">+{sessionXP}</p></div></div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto"><button onClick={() => setQuizMode('selection')} className="w-full py-6 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all">New Protocol</button><button onClick={() => navigate('/dashboard')} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 rounded-[2rem] font-black border border-slate-100 hover:bg-slate-50 transition-all">Dashboard</button></div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];
  if (!currentQ) return null;
  const isSpeed = quizMode === 'speed';

  return (
    <div className={`fixed inset-0 z-[60] bg-gradient-to-b from-[#1B2343] to-[#0B1020] flex flex-col text-white`}>
      <div className="p-4 bg-slate-900/40 backdrop-blur-md border-b border-white/10 flex flex-col gap-3 relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 shrink-0"><span className="opacity-60 text-xs">👤</span><span className="font-black text-xs">{currentQuestionIndex + 1} / {quizQuestions.length}</span></div>
          <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden relative shadow-[0_0_15px_rgba(168,85,247,0.1)]">
             <motion.div className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} />
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 rounded-full border border-amber-500/20 shrink-0"><Star size={12} className="text-amber-500 fill-amber-500" /><span className="text-amber-500 font-black text-xs">{sessionXP} XP</span></div>
        </div>
        <div className="flex items-center justify-between">
           <div className="flex items-center gap-2">
              <button onClick={walkAway} className="p-1 text-white/40 hover:text-white transition-colors"><ChevronLeft size={20} /></button>
              <p className="text-[9px] font-black uppercase text-white/40 tracking-[0.2em]">{currentQ.source?.toLowerCase().includes('richard') ? "Richard's Bank" : "NMCN Exam Bank"}</p>
           </div>
           <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[200px]">
              <button disabled={lifelinesUsed.fiftyFifty || showRationale} onClick={eliminateTwo} className={`p-2 rounded-xl transition-all ${lifelinesUsed.fiftyFifty ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 shadow-lg active:scale-95'}`}><ShuffleIcon size={14} /></button>
              <button disabled={lifelinesUsed.askClass || showRationale} onClick={askClass} className={`p-2 rounded-xl transition-all ${lifelinesUsed.askClass ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 shadow-lg active:scale-95'}`}><Users size={14} /></button>
              <button disabled={lifelinesUsed.mentor || showRationale} onClick={useMentor} className={`p-2 rounded-xl transition-all ${lifelinesUsed.mentor ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 shadow-lg active:scale-95'}`}><Shield size={14} /></button>
              <button disabled={lifelinesUsed.hint || showRationale} onClick={useHint} className={`p-2 rounded-xl transition-all ${lifelinesUsed.hint ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 shadow-lg active:scale-95'}`}><Zap size={14} /></button>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col p-4 sm:p-8">
        <div className="max-w-3xl mx-auto w-full flex flex-col gap-8">
          <div className="relative mt-8">
             {(isSpeed || useTimer) && !showRationale && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-20">
                   <div className="relative w-20 h-20 bg-[#0B1020] rounded-full flex items-center justify-center border-4 border-white/5 shadow-2xl">
                      <svg className="absolute inset-0 w-full h-full -rotate-90">
                         <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="4" fill="transparent" className={timeLeft < 5 ? 'text-red-500' : (timeLeft < 10 ? 'text-yellow-500' : 'text-[#FF7A00]')} style={{ strokeDasharray: 226, strokeDashoffset: 226 - (226 * timeLeft) / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30), transition: 'stroke-dashoffset 1s linear' }} />
                      </svg>
                      <span className={`text-2xl font-black tabular-nums ${timeLeft < 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{timeLeft}</span>
                   </div>
                </div>
             )}
             <motion.div key={currentQuestionIndex} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-white/5 backdrop-blur-xl p-8 pt-14 sm:p-12 sm:pt-16 rounded-[2rem] border border-white/10 shadow-2xl relative overflow-hidden text-center">
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={160} /></div>
                <div className="relative z-10 space-y-4">
                   <div className="flex flex-col items-center gap-1">
                      <p className="text-[10px] font-black uppercase text-purple-400 tracking-[0.3em]">Item {currentQuestionIndex + 1}</p>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 bg-white/5 text-white/60 rounded-lg text-[8px] font-black uppercase tracking-widest border border-white/5">{currentQ.subject}</span>
                        <SourceBadge source={currentQ.source} />
                      </div>
                   </div>
                   <h3 className="text-xl sm:text-3xl font-black leading-tight tracking-tight text-white text-balance">{currentQ.question}</h3>
                </div>
             </motion.div>
          </div>

          <div className={`grid gap-4 ${isSpeed ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {currentQ.options.map((option, idx) => (
              <OptionButton key={idx} label={option} index={idx} state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : (eliminatedOptions.includes(option) ? 'eliminated' : 'normal'))} onClick={() => handleOptionClick(option)} disabled={showRationale} dark={true} isSpeed={true} pollValue={classPoll ? classPoll[option] : undefined} />
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
         {isFinalAnswer && !showRationale && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-[#0B1020]/90 backdrop-blur-md">
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-[#1B2343] p-8 rounded-[3rem] shadow-2xl border border-white/10 flex flex-col items-center gap-6 max-w-sm w-full text-center">
                  <div className="w-16 h-16 bg-[#FF7A00]/20 text-[#FF7A00] rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(255,122,0,0.2)]"><HelpCircle size={32}/></div>
                  <div><h4 className="text-xl font-black text-white">FINAL ANSWER?</h4><p className="text-sm text-slate-400 font-medium">Locked in your selection?</p></div>
                  <div className="flex gap-4 w-full"><button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="flex-1 py-4 bg-white/5 text-white/60 rounded-2xl font-black uppercase text-[10px]">Change</button><button onClick={() => confirmAnswer()} className="flex-1 py-4 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] animate-pulse">Confirm</button></div>
               </motion.div>
            </div>
         )}
      </AnimatePresence>

      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center p-0 sm:p-4 bg-slate-950/90 backdrop-blur-sm">
             <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} className="relative w-full max-w-2xl bg-[#0B1020] rounded-t-[3rem] sm:rounded-[3rem] p-10 shadow-2xl border border-white/10 overflow-hidden">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8">
                   <div className="w-full">
                      <p className="text-[10px] font-black uppercase text-purple-400 mb-1">{isCorrect ? 'Logic Validated' : 'Misalignment'}</p>
                      <h4 className="text-2xl font-black text-white">{isCorrect ? 'Mastery Confirmed' : 'Clinical Opportunity'}</h4>
                      <div className="mt-4"><SourceBadge source={currentQ.source} /></div>
                   </div>
                   {restoredThisTurn && isCorrect && <div className="px-4 py-2 bg-amber-500/10 text-amber-500 rounded-xl text-[10px] font-black uppercase animate-bounce flex items-center gap-2 border border-amber-500/20 shrink-0"><Zap size={12} /> Lifeline Restored!</div>}
                </div>
                <div className="max-h-[50vh] overflow-y-auto custom-scrollbar mb-10 space-y-6 text-left">
                   <div className="p-6 bg-emerald-500/10 rounded-[2rem] border border-emerald-500/20 flex items-center gap-4 shadow-[0_0_20px_rgba(34,197,94,0.1)]">
                      <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20"><CheckCircle2 size={24}/></div>
                      <div><p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Correct Answer</p><p className="font-black text-white text-lg">{currentQ.correctAnswerText}</p></div>
                   </div>
                   <div><p className="text-[10px] font-black uppercase text-white/40 mb-2 tracking-widest">📖 Clinical Rationale</p><p className="font-medium text-sm leading-relaxed text-slate-300 italic">{currentQ.rationale}</p></div>
                   <div><p className="text-[10px] font-black uppercase text-blue-400 mb-2 tracking-widest">🏥 Clinical Application</p><p className="text-sm font-bold text-slate-200">{currentQ.clinical_application}</p></div>
                   <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/10"><p className="text-[10px] font-black uppercase text-amber-500 mb-2 tracking-widest">💡 Simplification</p><p className="text-sm font-medium text-amber-200/80 leading-relaxed">{currentQ.simplification}</p></div>
                </div>
                <button onClick={nextQuestion} className="w-full py-6 bg-white text-[#0B1020] rounded-[2rem] font-black uppercase text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-slate-100">Next Protocol <ArrowRight size={20} /></button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-[#1B2343] p-10 rounded-[3rem] shadow-2xl border border-white/10 text-center">
                <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><Target size={40} /></div>
                <h4 className="text-2xl font-black text-white mb-1 uppercase tracking-tight">{mentorAdvice?.type}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase mb-8 tracking-[0.2em]">Confidence: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-300 font-medium italic text-lg leading-relaxed mb-10">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px] hover:bg-white/20 transition-all">Return to Protocol</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#1B2343] p-10 rounded-[3rem] shadow-2xl max-w-sm w-full text-center border border-white/10">
                <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><AlertCircle size={40} /></div>
                <h4 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter">Terminate Journey?</h4>
                <p className="text-slate-400 font-medium italic mb-10 leading-relaxed text-balance px-4">"{exitPrompt}"</p>
                <div className="flex flex-col gap-3">
                   <button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-[#FF7A00]/20">Stay and Continue</button>
                   <button onClick={() => { setQuizStarted(false); setShowResults(true); setIsQuizActive(false); }} className="w-full py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[10px] hover:text-red-500 transition-colors">End Session</button>
                </div>
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
      <div><div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 transition-all group-hover:scale-110 shadow-inner ${colors[color].split(' ').pop()} ${colors[color].split(' ')[1]}`}>{icon}</div><h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">{title}</h3><p className="text-slate-500 dark:text-slate-400 text-sm font-medium leading-relaxed">{desc}</p></div>
      <div className="flex gap-4 mt-8"><div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Clock size={12} /> {duration}</div><div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Timer size={12} /> {timer}</div></div>
    </button>
  );
};

const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark, isSpeed }) => {
  const shapes = ['■', '●', '▲', '◆'];
  const [isExpanded, setIsExpanded] = useState(false);
  let baseStyles = dark ? 'bg-white/5 border-white/10 text-white/80' : 'bg-white border-slate-100 text-slate-700';
  if (state === 'selected') baseStyles = 'bg-[#FF7A00]/20 border-[#FF7A00] text-white shadow-[0_0_20px_rgba(255,122,0,0.1)]';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(34,197,94,0.2)]';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]';
  if (state === 'eliminated') baseStyles = 'opacity-0 pointer-events-none scale-95 grayscale';

  return (
    <button disabled={disabled || state === 'eliminated'} onClick={() => { if(label.length > 60 && !isExpanded) setIsExpanded(true); else onClick(); }} className={`relative flex flex-col items-center justify-center p-4 rounded-3xl border-2 transition-all duration-200 ${baseStyles} ${isSpeed ? 'h-[120px] sm:h-[150px]' : 'min-h-[80px]'} active:scale-95 overflow-hidden shadow-sm`}>
      <div className="flex flex-col items-center gap-2 h-full w-full">
         <span className="text-xl font-black opacity-30 shrink-0">{shapes[index]}</span>
         <div className="overflow-y-auto w-full custom-scrollbar flex items-center justify-center h-full">
            <p className={`font-bold text-center leading-tight text-xs sm:text-sm px-1 ${!isExpanded && label.length > 80 ? 'line-clamp-3' : ''}`}>{label}</p>
         </div>
         {!isExpanded && label.length > 80 && <div className="text-[8px] font-black uppercase text-[#FF7A00] mt-1">Read More</div>}
      </div>
      {pollValue !== undefined && <div className="absolute bottom-2 inset-x-4"><div className="h-1 bg-white/20 rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pollValue}%`}} className="h-full bg-medical-500" /></div><p className="text-[8px] font-black mt-1">{pollValue}%</p></div>}
      {state === 'correct' && <motion.div initial={{scale:0}} animate={{scale:1}} className="absolute right-2 top-2 text-emerald-500 shrink-0"><CheckCircle2 size={18} /></motion.div>}
    </button>
  );
};

const ShuffleIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" /></svg>);

export default Quiz;"""

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
