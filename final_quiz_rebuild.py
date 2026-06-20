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
  const [showReview, setShowReview] = useState(false);
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

    if (mode === 'speed') {
       const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
       const nmcn = pool.filter(c => c.source?.toLowerCase().includes('nmcn') || c.category === 'NMCN');
       const others = pool.filter(c => !richard.includes(c) && !nmcn.includes(c));
       richard.sort(() => 0.5 - Math.random());
       nmcn.sort(() => 0.5 - Math.random());
       others.sort(() => 0.5 - Math.random());
       const rCount = Math.min(11, richard.length);
       const nmCount = Math.min(2, nmcn.length);
       pool = [...richard.slice(0, rCount), ...nmcn.slice(0, nmCount), ...others.slice(0, 15 - (rCount + nmCount))].sort(() => 0.5 - Math.random());
    }

    const uniquePool = pool.filter((c, i, s) => s.findIndex(t => t.question === c.question) === i);
    const limit = mode === 'speed' ? 15 : questionLimit;
    const selected = uniquePool.sort(() => 0.5 - Math.random()).slice(0, limit);
    const questions = selected.map(q => {
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
    const keyword = currentQ.question.toLowerCase().includes('priority') ? 'priority' : 'presentation';
    const text = `Nurse's insight: testing ${currentQ.subject.toLowerCase()}. Considering the ${keyword}, I recommend "${currentQ.correctAnswerText}" because ${currentQ.simplification.toLowerCase()}.`;
    setMentorAdvice({ type: 'Clinical Mentor', text, confidence: Math.floor(Math.random() * 10 + 85) });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, mentor: true }));
  };

  if (quizMode === 'selection') {
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="text-center mb-12">
          <div className="w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 shadow-2xl border-2 border-medical-500/20"><Brain size={40} className="animate-pulse" /></div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">Quiz Central</h2>
          <p className="text-slate-500 font-medium">Choose your clinical training path</p>
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
        <button onClick={() => setQuizMode('selection')} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-8"><ChevronLeft size={16} /> Back</button>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-4 uppercase tracking-tight">{baseMode} Configuration</h3>
        <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 mb-8 shadow-clinical text-center sm:text-left">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Question Count</p><div className="flex gap-4">{[10, 20, 50].map(n => (<button key={n} onClick={() => setQuestionLimit(n)} className={`flex-1 py-4 rounded-2xl font-black transition-all ${questionLimit === n ? 'bg-medical-600 text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-400'}`}>{n}</button>))}</div></div>
              <div><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-4">Time Pressure</p><button onClick={() => setUseTimer(!useTimer)} className={`w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${useTimer ? 'bg-red-500 text-white' : 'bg-slate-50 dark:bg-white/5 text-slate-400'}`}><Timer size={16} /> {useTimer ? '30s Per Question' : 'No Timer'}</button></div>
           </div>
        </div>
        {isSubject && <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">{subjects.map(sub => (<button key={sub.name} onClick={() => initQuiz('subject', sub.name)} className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border-2 border-slate-100 hover:border-emerald-500 transition-all text-left shadow-sm"><p className="text-[10px] font-black text-slate-400 mb-1">{sub.count} Questions</p><p className="font-black text-slate-900 dark:text-white truncate">{sub.name}</p></button>))}</div>}
        {!isSubject && <button onClick={() => initQuiz(baseMode)} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl uppercase tracking-widest shadow-2xl active:scale-95 transition-all hover:bg-slate-800">Enter Challenge</button>}
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32 px-4 text-slate-900 dark:text-white">
        <div className="relative inline-block"><div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" /><div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 shadow-2xl"><Trophy size={64} /></div></div>
        <div className="space-y-2"><h2 className="text-4xl sm:text-5xl font-black tracking-tighter">Complete</h2><p className="text-slate-500 dark:text-slate-400 text-xl font-medium">Milestone: <span className="text-medical-600 dark:text-medical-400 font-black">{currentMilestone}</span></p></div>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto"><div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1">Score</p><p className="text-3xl font-black">{score}</p></div><div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1">XP</p><p className="text-3xl font-black text-medical-600">+{sessionXP}</p></div></div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto"><button onClick={() => setQuizMode('selection')} className="w-full py-6 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all">New Challenge</button><button onClick={() => navigate('/dashboard')} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 rounded-[2rem] font-black border border-slate-100 hover:bg-slate-50 transition-all">Dashboard</button></div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];
  if (!currentQ) return null;
  const isSpeed = quizMode === 'speed';

  return (
    <div className={`fixed inset-0 z-[60] bg-white dark:bg-slate-950 flex flex-col ${isSpeed ? 'dark' : ''} text-slate-900 dark:text-white`}>
      <div className="p-4 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-4">
        <button onClick={walkAway} className="p-2 text-slate-400 hover:text-slate-600 shrink-0"><ChevronLeft size={24} /></button>
        <div className="flex-1 max-w-md h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
           <motion.div className="h-full bg-medical-500" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} />
        </div>
        <div className="flex items-center gap-2">
           {(isSpeed || useTimer) && !showRationale && (
              <div className={`px-3 py-1 rounded-xl font-black text-xs tabular-nums ${timeLeft < 5 ? 'bg-red-500 text-white animate-pulse' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'}`}>{timeLeft}s</div>
           )}
           <div className="flex items-center gap-1">
              <button disabled={lifelinesUsed.fiftyFifty || showRationale} onClick={eliminateTwo} className={`p-2 rounded-lg transition-all ${lifelinesUsed.fiftyFifty ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600'}`}><ShuffleIcon size={14} /></button>
              <button disabled={lifelinesUsed.askClass || showRationale} onClick={askClass} className={`p-2 rounded-lg transition-all ${lifelinesUsed.askClass ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600'}`}><Users size={14} /></button>
              <button disabled={lifelinesUsed.mentor || showRationale} onClick={useMentor} className={`p-2 rounded-lg transition-all ${lifelinesUsed.mentor ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600'}`}><Shield size={14} /></button>
              <button disabled={lifelinesUsed.hint || showRationale} onClick={useHint} className={`p-2 rounded-lg transition-all ${lifelinesUsed.hint ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600'}`}><Zap size={14} /></button>
           </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col p-4 sm:p-8">
        <div className="max-w-3xl mx-auto w-full flex flex-col gap-6">
          <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question {currentQuestionIndex + 1} / {quizQuestions.length}</span><SourceBadge source={currentQ.source} /></div>
          <div className="bg-white dark:bg-white/5 p-8 rounded-[2.5rem] border border-slate-100 dark:border-white/10 shadow-soft relative overflow-hidden min-h-[160px] flex items-center justify-center">
             <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={120} /></div>
             <h3 className="text-xl sm:text-2xl font-black leading-tight tracking-tight text-center z-10">{currentQ.question}</h3>
          </div>
          <div className={`grid gap-3 sm:gap-4 ${quizMode === 'speed' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {currentQ.options.map((option, idx) => (
              <OptionButton key={idx} label={option} index={idx} state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : (eliminatedOptions.includes(option) ? 'eliminated' : 'normal'))} onClick={() => handleOptionClick(option)} disabled={showRationale} dark={isSpeed} isSpeed={isSpeed} pollValue={classPoll ? classPoll[option] : undefined} />
            ))}
          </div>
        </div>
      </div>
      <AnimatePresence>
         {isFinalAnswer && !showRationale && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-white/10 flex flex-col items-center gap-6 max-w-sm w-full text-center">
                  <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center"><HelpCircle size={32}/></div>
                  <div><h4 className="text-xl font-black text-slate-900 dark:text-white">Final Answer?</h4><p className="text-sm text-slate-500 font-medium">Ready to validate?</p></div>
                  <div className="flex gap-4 w-full"><button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="flex-1 py-4 bg-slate-100 dark:bg-white/5 text-slate-600 rounded-2xl font-black uppercase text-[10px]">Change</button><button onClick={() => confirmAnswer()} className="flex-1 py-4 bg-amber-500 text-white rounded-2xl font-black uppercase text-[10px] animate-pulse">Confirm</button></div>
               </motion.div>
            </div>
         )}
      </AnimatePresence>
      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center p-0 sm:p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={nextQuestion} />
             <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[3rem] sm:rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-white/10">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4 text-center sm:text-left">
                   <div className="w-full">
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-1">{isCorrect ? 'Logic Validated' : 'Misalignment'}</p>
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white leading-none">{isCorrect ? 'Mastery Confirmed' : 'Opportunity'}</h4>
                      <div className="mt-4"><SourceBadge source={currentQ.source} /></div>
                   </div>
                   {restoredThisTurn && isCorrect && <div className="px-4 py-2 bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase animate-bounce flex items-center gap-2 border border-amber-200 shrink-0"><Zap size={12} /> Lifeline Restored!</div>}
                </div>
                <div className="max-h-60 overflow-y-auto custom-scrollbar mb-8 space-y-6 text-left">
                   <div><p className="text-[10px] font-black uppercase text-slate-400 mb-1">✔ Rationale</p><p className="font-medium text-sm italic text-slate-600 dark:text-slate-300">{currentQ.rationale}</p></div>
                   <div><p className="text-[10px] font-black uppercase text-medical-600 mb-1">🏥 Application</p><p className="text-sm font-bold text-slate-700 dark:text-slate-200">{currentQ.clinical_application}</p></div>
                   <div className="p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100"><p className="text-[10px] font-black uppercase text-amber-600 mb-1">💡 Simplification</p><p className="text-sm font-medium text-amber-800 dark:text-amber-200">{currentQ.simplification}</p></div>
                </div>
                <button onClick={nextQuestion} className="w-full py-6 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-[2rem] font-black uppercase text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4">{currentQuestionIndex < quizQuestions.length - 1 ? 'Next' : 'Complete'} <ArrowRight size={20} /></button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowHint(false)} />
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white dark:bg-slate-800 p-10 rounded-[3rem] shadow-2xl text-center">
                <div className="w-20 h-20 bg-medical-50 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8"><Target size={40} /></div>
                <h4 className="text-2xl font-black mb-1">{mentorAdvice?.type}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase mb-6">Confidence: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-600 dark:text-slate-300 font-medium italic text-lg leading-relaxed mb-10">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-slate-100 dark:bg-white/10 rounded-2xl font-black uppercase text-[10px]">Return</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] shadow-2xl max-w-sm w-full text-center">
                <div className="w-20 h-20 bg-red-100 text-red-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8"><AlertCircle size={40} /></div>
                <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-4">Pause Journey?</h4>
                <p className="text-slate-500 font-medium italic mb-10 leading-relaxed">"{exitPrompt}"</p>
                <div className="flex flex-col gap-3">
                   <button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase text-[10px]">Continue</button>
                   <button onClick={() => { setQuizStarted(false); setShowResults(true); setIsQuizActive(false); }} className="w-full py-4 bg-slate-100 dark:bg-white/5 text-slate-400 rounded-2xl font-black uppercase text-[10px] hover:text-red-500">End Session</button>
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

const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark, isSpeed }) => {
  const shapes = ['■', '●', '▲', '◆'];
  let baseStyles = dark ? 'bg-white/5 border-white/10 text-white/80' : 'bg-white border-slate-100 text-slate-700';
  if (state === 'selected') baseStyles = dark ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-medical-50 border-medical-500 text-medical-700';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500';
  if (state === 'eliminated') baseStyles = 'opacity-0 pointer-events-none scale-90 grayscale';

  return (
    <button
      disabled={disabled || state === 'eliminated'}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center p-4 rounded-3xl border-2 transition-all duration-200 ${baseStyles} ${isSpeed ? 'h-[120px] sm:h-[150px]' : 'min-h-[80px]'} active:scale-95 overflow-hidden shadow-sm`}
    >
      <div className="flex flex-col items-center gap-2 h-full w-full">
         <span className="text-xl font-black opacity-30 shrink-0">{shapes[index]}</span>
         <div className="overflow-y-auto w-full custom-scrollbar flex items-center justify-center">
            <p className="font-bold text-center leading-tight text-xs sm:text-sm px-1">{label}</p>
         </div>
      </div>
      {pollValue !== undefined && <div className="absolute bottom-2 inset-x-4"><div className="h-1 bg-white/20 rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pollValue}%`}} className="h-full bg-medical-500" /></div><p className="text-[8px] font-black mt-1">{pollValue}%</p></div>}
      {state === 'correct' && <motion.div initial={{scale:0}} animate={{scale:1}} className="absolute right-2 top-2 text-emerald-500 shrink-0"><CheckCircle2 size={18} /></motion.div>}
    </button>
  );
};

const ShuffleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 3h5v5" /><path d="M4 20L21 3" /><path d="M21 16v5h-5" /><path d="M15 15l6 6" /><path d="M4 4l5 5" />
  </svg>
);

export default Quiz;"""

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
