import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import SourceBadge from "../components/SourceBadge";
import {
  Shield, Zap, Clock, Target, ChevronLeft, Timer, Brain, Trophy,
  ArrowRight, CheckCircle2, XCircle, Puzzle, AlertCircle, HelpCircle,
  RefreshCw, Users, Star, Info, Bookmark, X, History, Shuffle
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import Toast from '../components/Toast';

const MOTIVATIONAL_MESSAGES = [
  "You’re only a few questions away from your next achievement.",
  "Your clinical reasoning is improving. Keep going.",
  "Future Registered Nurses don’t stop halfway.",
  "You’re making excellent progress.",
  "One more correct answer could restore a lifeline.",
  "You’re almost at your next XP milestone."
];

const ACHIEVEMENTS = [
  { q: 1, label: "Clinical Novice" },
  { q: 10, label: "Ward Helper" },
  { q: 20, label: "Senior Student" },
  { q: 30, label: "Future Matron" },
  { q: 50, label: "Clinical Leader" },
  { q: 75, label: "Clinical Legend" }
];

const QUIZ_STATES = {
  SELECTION: 'SELECTION',
  LOADING: 'LOADING',
  ANSWERING: 'ANSWERING',
  CONFIRMING: 'CONFIRMING',
  REVIEWING: 'REVIEWING',
  RESULTS: 'RESULTS'
};

const getSpeedTimerValue = (index) => {
  if (index < 5) return 30;
  if (index < 10) return 20;
  if (index < 20) return 15;
  return 10;
};

const QuestionSkeleton = () => (
  <div className="w-full max-w-3xl mx-auto space-y-6 animate-pulse p-4">
    <div className="bg-[#1B2343] rounded-[2.5rem] p-10 h-64 relative overflow-hidden border border-white/5">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>
      <div className="flex justify-between items-center mb-8">
        <div className="w-32 h-4 bg-white/10 rounded-full"></div>
        <div className="flex gap-2">
            {[1,2,3,4].map(i => <div key={i} className="w-8 h-8 bg-white/5 rounded-lg"></div>)}
        </div>
      </div>
      <div className="space-y-4">
        <div className="w-full h-6 bg-white/10 rounded-lg"></div>
        <div className="w-2/3 h-6 bg-white/10 rounded-lg"></div>
      </div>
      <div className="absolute bottom-8 left-10 right-10 flex justify-center">
         <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/20">Loading verified clinical question...</p>
      </div>
    </div>
    <div className="space-y-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-[#1B2343] rounded-[2rem] h-20 border border-white/5 opacity-50"></div>
      ))}
    </div>
  </div>
);

const normalizeQuestion = (q) => {
  if (!q) return null;
  try {
    // Definitive Extraction Chain
    let questionText = q.question || q.text || q.front || q.title || q.prompt || q.q || q.item || "";

    // Support nested data structures from bulk imports
    if (!questionText && q.data) {
        questionText = q.data.question || q.data.text || q.data.item || "";
    }

    // Force string and trim
    questionText = String(questionText).trim();

    // Critical Filter: Skip obvious placeholders in the database
    if (questionText.toLowerCase().includes("sample question") || questionText === "") {
        console.warn("Skipping placeholder or empty question:", q.id);
        return null;
    }

    let options = [];
    let correctAnswerText = "";

    if (Array.isArray(q.options) && q.options.length > 0) {
      options = [...q.options];
    } else if (q.options && typeof q.options === 'object') {
      options = Object.values(q.options);
    } else if (q.option_a || q.option_A || q.option_1) {
      options = [
        q.option_a || q.option_A || q.option_1,
        q.option_b || q.option_B || q.option_2,
        q.option_c || q.option_C || q.option_3,
        q.option_d || q.option_D || q.option_4
      ].filter(Boolean);
    }

    // Filter out obvious placeholder options
    if (options.some(opt => String(opt).toLowerCase() === "option a")) {
        console.warn("Skipping question with placeholder options:", q.id);
        return null;
    }

    const ca = q.correct_answer || q.correctAnswer || q.answer || q.back || q.correct || "";
    if (options.length > 0) {
        if (typeof ca === 'number' && ca >= 0 && ca < options.length) {
          correctAnswerText = options[ca];
        } else if (typeof ca === 'string' && ca.length === 1 && /^[A-D]$/i.test(ca)) {
          const index = ca.toUpperCase().charCodeAt(0) - 65;
          if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) {
             correctAnswerText = q.options[ca.toUpperCase()] || q.options[ca.toLowerCase()] || options[index] || options[0];
          } else {
             correctAnswerText = options[index] || ca;
          }
        } else {
          correctAnswerText = ca || options[0];
        }
    } else {
        // Questions without options are flashcards, not quiz items
        console.warn("Skipping non-quiz item (no options):", q.id);
        return null;
    }

    return {
      id: q.id || 'gen-' + Math.random().toString(36).substr(2, 9),
      subject: q.subject || q.category || q.topic || "General Nursing",
      source: q.source || (String(q.id).includes('richard') ? "Richard's Bank" : "NMCN Bank"),
      question: questionText,
      options: options.map(opt => String(opt).trim()),
      correctAnswer: String(correctAnswerText).trim(),
      correctAnswerText: String(correctAnswerText).trim(),
      rationale: q.rationale || q.explanation || q.back || "Clinical judgment and patient safety protocols guide this nursing intervention.",
      clinical_application: q.clinical_application || q.clinicalApplication || q.context || "Apply nursing priorities (ABC) to ensure patient stability.",
      simplification: q.simplification || "Focus on the most immediate threat or priority.",
      hints: Array.isArray(q.hints) ? q.hints : (q.hint ? [q.hint] : ["Think about the most immediate threat to the patient."])
    };
  } catch (error) {
    console.error("Normalization Error:", error);
    return null;
  }
};

const Quiz = () => {
  const navigate = useNavigate();
  const { flashcards, learningAnalytics, setIsQuizActive } = useAppContext();
  const [toast, setToast] = useState(null);

  const [quizStatus, setQuizStatus] = useState(QUIZ_STATES.SELECTION);
  const [quizMode, setQuizMode] = useState(null);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [sessionXP, setSessionXP] = useState(0);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [currentMilestone, setCurrentMilestone] = useState("Clinical Beginner");
  const [hintLevel, setHintLevel] = useState(0);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitPrompt, setExitPrompt] = useState("");
  const [lastMotivationIndex, setLastMotivationIndex] = useState(-1);
  const [showHint, setShowHint] = useState(false);
  const [mentorAdvice, setMentorAdvice] = useState(null);
  const [questionLimit, setQuestionLimit] = useState(10);
  const [useTimer, setUseTimer] = useState(true);
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  const [isLoadingQuestion, setIsLoadingQuestion] = useState(false);
  const [sessionHistory, setSessionHistory] = useState([]);

  useEffect(() => {
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) setIsLowPowerMode(true);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setIsLowPowerMode(true);
  }, []);

  // Recovery Logic (Auto-restore)
  useEffect(() => {
    const saved = localStorage.getItem('APEX_QUIZ_SESSION');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.questions?.length > 0) {
          setQuizMode(parsed.quizMode);
          setQuizQuestions(parsed.questions);
          setCurrentQuestionIndex(parsed.currentIndex);
          setScore(parsed.score);
          setSessionXP(parsed.sessionXP);
          setConsecutiveCorrect(parsed.consecutiveCorrect);
          setLifelinesUsed(parsed.lifelinesUsed);
          setCurrentMilestone(parsed.currentMilestone);
          setTimeLeft(parsed.timeLeft);
          setUseTimer(parsed.useTimer);
          setQuestionLimit(parsed.questionLimit);
          setSessionHistory(parsed.sessionHistory || []);
          setSelectedOption(parsed.selectedOption || null);
          setIsCorrect(parsed.isCorrect ?? null);
          setEliminatedOptions(parsed.eliminatedOptions || []);
          setClassPoll(parsed.classPoll || null);
          setHintLevel(parsed.hintLevel || 0);
          setQuizStatus(parsed.quizStatus || QUIZ_STATES.ANSWERING);
          setIsQuizActive(true);
          setToast({ message: "Previous session restored.", type: 'info' });
        }
      } catch (e) { localStorage.removeItem('APEX_QUIZ_SESSION'); }
    }
  }, [setIsQuizActive]);

  // Persistent Save
  useEffect(() => {
    if (quizStatus !== QUIZ_STATES.SELECTION && quizStatus !== QUIZ_STATES.RESULTS) {
      const session = {
        quizMode, questions: quizQuestions, currentIndex: currentQuestionIndex, score, sessionXP,
        consecutiveCorrect, lifelinesUsed, currentMilestone, timeLeft, useTimer, questionLimit,
        sessionHistory, selectedOption, isCorrect, quizStatus, eliminatedOptions, classPoll, hintLevel
      };
      localStorage.setItem('APEX_QUIZ_SESSION', JSON.stringify(session));
    } else if (quizStatus === QUIZ_STATES.RESULTS) {
        localStorage.removeItem('APEX_QUIZ_SESSION');
    }
  }, [quizStatus, currentQuestionIndex, score, sessionXP, consecutiveCorrect, lifelinesUsed, quizMode, quizQuestions, currentMilestone, timeLeft, useTimer, questionLimit, sessionHistory, selectedOption, isCorrect, eliminatedOptions, classPoll, hintLevel]);

  useEffect(() => {
    let timer;
    if (quizStatus === QUIZ_STATES.ANSWERING && (quizMode === 'speed' || useTimer)) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { clearInterval(timer); handleConfirmAnswer(null); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [quizStatus, quizMode, useTimer, currentQuestionIndex]);

  const initQuiz = (mode, subjectFilter = null) => {
    let pool = [...flashcards].filter(c => {
        const n = normalizeQuestion(c);
        return n !== null;
    });

    if (mode === 'revision' && learningAnalytics?.recommendedRevision?.length > 0) {
        pool = learningAnalytics.recommendedRevision.filter(c => normalizeQuestion(c) !== null);
    }

    if (subjectFilter) pool = pool.filter(c => c.subject === subjectFilter);
    if (pool.length === 0) {
        setToast({ message: "No verified clinical items found for this selection.", type: 'error' });
        setQuizStatus(QUIZ_STATES.SELECTION);
        return;
    }

    const richard = pool.filter(c => String(c.id).includes('richard') || (c.source && c.source.toLowerCase().includes('richard')));

    let combined = [];
    const limit = (mode === 'speed' || mode === 'quick' || mode === 'revision') ? 10 : (mode === 'subject' || mode === 'clinical' || mode === 'mock' ? Math.min(pool.length, questionLimit) : questionLimit);

    if (mode === 'speed') {
      const shuffledRichard = [...richard].sort(() => 0.5 - Math.random());
      const nmcnPool = pool.filter(c => !String(c.id).includes('richard') && !(c.source && c.source.toLowerCase().includes('richard')));
      const shuffledNmcn = [...nmcnPool].sort(() => 0.5 - Math.random());
      const rCount = Math.min(Math.ceil(limit * 0.7), shuffledRichard.length);
      combined = [...shuffledRichard.slice(0, rCount), ...shuffledNmcn.slice(0, Math.max(0, limit - rCount))];
    } else if (mode === 'mock') {
        const shuffledRichard = [...richard].sort(() => 0.5 - Math.random());
        const nmcnPool = pool.filter(c => !String(c.id).includes('richard'));
        const shuffledNmcn = [...nmcnPool].sort(() => 0.5 - Math.random());
        const half = Math.floor(limit / 2);
        combined = [...shuffledRichard.slice(0, half), ...shuffledNmcn.slice(0, limit - half)];
    } else if (mode === 'revision') {
        const highYield = pool.filter(c =>
            String(c.id).includes('richard') ||
            String(c.id).includes('nclex') ||
            (c.source && (c.source.toLowerCase().includes('richard') || c.source.toLowerCase().includes('nclex')))
        );
        combined = [...highYield].sort(() => 0.5 - Math.random()).slice(0, limit);
        if (combined.length < limit) {
             const others = pool.filter(c => !highYield.includes(c)).sort(() => 0.5 - Math.random());
             combined = [...combined, ...others].slice(0, limit);
        }
    } else {
        combined = [...pool].sort(() => 0.5 - Math.random()).slice(0, limit);
    }

    const questions = combined.map(q => {
      const n = normalizeQuestion(q);
      if (!n) return null;
      return { ...n, options: [...n.options].sort(() => 0.5 - Math.random()) };
    }).filter(Boolean);

    setQuizQuestions(questions);
    setQuizMode(mode);
    setCurrentQuestionIndex(0);
    setScore(0);
    setSessionXP(0);
    setConsecutiveCorrect(0);
    setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
    setCurrentMilestone("Clinical Beginner");
    setTimeLeft(mode === 'speed' ? getSpeedTimerValue(0) : 30);
    setQuizStatus(QUIZ_STATES.ANSWERING);
    setIsQuizActive(true);
    setSessionHistory([]);
  };

  const handleOptionSelect = (option) => {
    if (quizStatus !== QUIZ_STATES.ANSWERING || isLoadingQuestion) return;
    setSelectedOption(option);
    setQuizStatus(QUIZ_STATES.CONFIRMING);
  };

  const handleConfirmAnswer = (opt = selectedOption) => {
    const currentQ = quizQuestions[currentQuestionIndex];
    if (!currentQ) return;
    const correct = opt === currentQ.correctAnswer;
    setIsCorrect(correct);
    setSessionHistory(prev => [...prev, { qIdx: currentQuestionIndex, selected: opt, correct }]);

    if (correct) {
      setScore(s => s + 1);
      const ach = ACHIEVEMENTS.slice().reverse().find(a => (score + 1) >= a.q);
      if (ach) setCurrentMilestone(ach.label);
      const newCombo = consecutiveCorrect + 1;
      setConsecutiveCorrect(newCombo);
      setSessionXP(p => p + (10 * (newCombo >= 5 ? 2 : 1)));
    } else {
        setConsecutiveCorrect(0);
    }
    setQuizStatus(QUIZ_STATES.REVIEWING);
  };

  const handleNextQuestion = () => {
    setIsLoadingQuestion(true);
    setTimeout(() => {
        if (!isCorrect && quizMode === 'speed') {
            setQuizStatus(QUIZ_STATES.RESULTS);
            setIsQuizActive(false);
            setIsLoadingQuestion(false);
            return;
        }
        if (currentQuestionIndex < quizQuestions.length - 1) {
            const nextIdx = currentQuestionIndex + 1;
            setCurrentQuestionIndex(nextIdx);
            setSelectedOption(null);
            setIsCorrect(null);
            setEliminatedOptions([]);
            setClassPoll(null);
            setHintLevel(0);
            setTimeLeft(quizMode === 'speed' ? getSpeedTimerValue(nextIdx) : 30);
            setQuizStatus(QUIZ_STATES.ANSWERING);
        } else {
            setQuizStatus(QUIZ_STATES.RESULTS);
            setIsQuizActive(false);
        }
        setIsLoadingQuestion(false);
    }, 400);
  };

  const handleEliminateTwo = () => {
    if (lifelinesUsed.fiftyFifty || quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrect = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    const toRemove = incorrect.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toRemove);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const handleAskClass = () => {
    if (lifelinesUsed.askClass || quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const results = {};
    const visible = currentQ.options.filter(o => !eliminatedOptions.includes(o));
    const correctShare = Math.floor(Math.random() * 30 + 60);
    results[currentQ.correctAnswer] = correctShare;
    let rem = 100 - correctShare;
    const others = visible.filter(o => o !== currentQ.correctAnswer);
    others.forEach((opt, i) => {
        if (i === others.length - 1) results[opt] = rem;
        else { const s = Math.floor(Math.random() * (rem / 1.5)); results[opt] = s; rem -= s; }
    });
    currentQ.options.forEach(o => { if(!(o in results)) results[o] = 0; });
    setClassPoll(results);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  const handleUseHint = () => {
    if (quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const h = currentQ.hints[hintLevel] || currentQ.simplification;
    setMentorAdvice({ type: 'Progressive Hint', text: h });
    setShowHint(true);
    const nextLevel = hintLevel + 1;
    setHintLevel(nextLevel);
    if (nextLevel >= currentQ.hints.length) setLifelinesUsed(prev => ({ ...prev, hint: true }));
  };

  const handleUseMentor = () => {
    if (lifelinesUsed.mentor || quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const text = "Mentor Insight: " + (currentQ.simplification || "Priority ABC assessment recommended.") + ". Focus on patient stability.";
    setMentorAdvice({ type: 'Clinical Mentor', text, confidence: 96 });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, mentor: true }));
  };

  const handleWalkAway = () => {
    let nextIdx;
    do { nextIdx = Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length); } while (nextIdx === lastMotivationIndex);
    setLastMotivationIndex(nextIdx);
    setExitPrompt(MOTIVATIONAL_MESSAGES[nextIdx]);
    setShowExitConfirm(true);
  };

  const subjects = useMemo(() => {
    const counts = {}; flashcards.forEach(c => { const sub = c.subject || "General"; counts[sub] = (counts[sub] || 0) + 1; });
    return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a,b) => b.count - a.count);
  }, [flashcards]);

  const currentQ = quizQuestions[currentQuestionIndex];

  if (quizStatus === QUIZ_STATES.SELECTION) {
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="text-center mb-12">
          <div className={`w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 ${isLowPowerMode ? "" : "shadow-2xl"} border-2 border-medical-500/20`}><Brain size={40} className="animate-pulse" /></div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tighter mb-2 uppercase text-balance">Clinical Training Hub</h2>
          <p className="text-slate-500 font-medium tracking-tight">Select your specialization protocol</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ModeCard title="Clinical Challenge" desc="Full exam simulation." icon={<Shield size={24} />} duration="10-20 min" timer="Optional" color="medical" onClick={() => setQuizMode('clinical-select')} />
          <ModeCard title="Speed Challenge" desc="Kahoot-style rapid fire." icon={<Zap size={24} />} duration="5-15 min" timer="Progressive" color="amber" onClick={() => initQuiz('speed')} />
          <ModeCard title="Quick Quiz" desc="5-10 rapid questions." icon={<Clock size={24} />} duration="2-5 min" timer="Optional" color="indigo" onClick={() => setQuizMode('quick-select')} />
          <ModeCard title="Subject Mastery" desc="Master one course." icon={<Target size={24} />} duration="Custom" timer="Optional" color="emerald" onClick={() => setQuizMode('subject-select')} />
          <ModeCard title="Mock Exam" desc="Official NMCN blueprint." icon={<Trophy size={24} />} duration="60-90 min" timer="Strict" color="amber" onClick={() => setQuizMode("mock-select")} />
          <ModeCard title="Revision Challenge" desc="Targeted weakness fix." icon={<RefreshCw size={24} />} duration="5-10 min" timer="Optional" color="indigo" onClick={() => setQuizMode("revision-select")} />
        </div>
        {quizMode && quizMode.endsWith('-select') && (
           <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl animate-in fade-in duration-300">
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-800 p-8 rounded-[3rem] shadow-2xl max-w-lg w-full">
                 <button onClick={() => setQuizMode(null)} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-6 hover:text-medical-600"><ChevronLeft size={16} /> Back</button>
                 <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-6 uppercase tracking-tight">{quizMode.split('-')[0]} Protocol</h3>
                 <div className="space-y-6">
                    <div className="space-y-3"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest text-center sm:text-left">Protocol Depth</p><div className="flex gap-3">{[10, 20, 50].map(n => (<button key={n} onClick={() => setQuestionLimit(n)} className={`flex-1 py-4 rounded-2xl font-black transition-all ${questionLimit === n ? 'bg-medical-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}>{n}</button>))}</div></div>
                    <div className="space-y-3"><p className="text-[10px] font-black uppercase text-slate-400 tracking-widest text-center sm:text-left">Time Constraints</p><button onClick={() => setUseTimer(!useTimer)} className={`w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${useTimer ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}><Timer size={16} /> {useTimer ? '30s / Item' : 'Disabled'}</button></div>
                    {quizMode === 'subject-select' ? (
                       <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar"><div className="grid grid-cols-1 gap-2">{subjects.map(sub => (<button key={sub.name} onClick={() => initQuiz('subject', sub.name)} className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-emerald-500 transition-all text-left flex justify-between items-center"><p className="font-bold text-slate-900 dark:text-white truncate">{sub.name}</p><span className="text-[10px] font-black text-slate-400 bg-white dark:bg-slate-800 px-2 py-1 rounded-lg">{sub.count}</span></button>))}</div></div>
                    ) : ( <button onClick={() => initQuiz(quizMode.split('-')[0])} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl uppercase tracking-widest shadow-2xl active:scale-95 transition-all hover:bg-slate-800 mt-4">Activate Protocol</button> )}
                 </div>
              </motion.div>
           </div>
        )}
      </div>
    );
  }

  if (quizStatus === QUIZ_STATES.RESULTS) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32 px-4 text-slate-900 dark:text-white">
        <div className="relative inline-block"><div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" /><div className={`relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 ${isLowPowerMode ? "" : "shadow-2xl"}`}><Trophy size={64} /></div></div>
        <h2 className="text-4xl font-black tracking-tighter uppercase">Validation Complete</h2>
        <p className="text-slate-500 dark:text-slate-400 text-xl font-medium tracking-widest uppercase">Rank: <span className="text-medical-600 font-black">{currentMilestone}</span></p>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">Score</p><p className="text-3xl font-black">{score} / {quizQuestions.length}</p></div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">XP Earned</p><p className="text-3xl font-black text-medical-600">+{sessionXP}</p></div>
        </div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto"><button onClick={() => { setQuizStatus(QUIZ_STATES.SELECTION); setQuizMode(null); setIsQuizActive(false); }} className={`w-full py-6 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-[2rem] font-black text-lg ${isLowPowerMode ? "" : "shadow-2xl" } active:scale-95 transition-all uppercase`}>New Protocol</button><button onClick={() => navigate('/dashboard')} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 rounded-[2rem] font-black border border-slate-100 dark:border-slate-800 hover:bg-slate-50 transition-all uppercase">Dashboard</button></div>
      </div>
    );
  }

  const isSpeed = quizMode === 'speed';

  return (
    <div className={`fixed inset-0 z-[60] bg-[#0F172A] flex flex-col text-white overflow-hidden`}>
      <style>{` @keyframes shimmer { 100% { transform: translateX(100%); } } `}</style>

      {/* Header Section */}
      <div className={`h-[12dvh] sm:h-[15dvh] bg-indigo-600 w-full relative z-30 transition-colors duration-500 shadow-xl`}>
         <div className="p-4 pt-6 flex items-center justify-between gap-3 max-w-2xl mx-auto">
            <div className="bg-black/60 backdrop-blur-md rounded-2xl px-4 py-2 flex items-center gap-2 border border-white/5 shadow-xl">
               <Users size={16} className="text-white opacity-80" />
               <span className="text-white font-black text-sm tracking-tighter">{currentQuestionIndex + 1} of {quizQuestions.length}</span>
            </div>
            <div className="flex-1 h-2.5 bg-black/20 rounded-full overflow-hidden relative mx-2 shadow-inner">
               <motion.div className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full shadow-[0_0_10px_rgba(251,146,60,0.4)]" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} transition={{ duration: isLowPowerMode ? 0.3 : 0.8, ease: "easeOut" }} />
            </div>
            <div className="bg-orange-500 rounded-2xl px-4 py-2 flex items-center gap-2 shadow-lg shadow-orange-600/30 border border-white/10">
               <CheckCircle2 size={16} className="text-white fill-white" />
               <span className="text-white font-black text-sm tracking-tighter">{score}</span>
            </div>
         </div>
         <div className="absolute bottom-3 left-0 right-0 px-6 flex justify-between items-center max-w-3xl mx-auto opacity-70">
            <button onClick={handleWalkAway} className="flex items-center gap-1.5 text-white/60 hover:text-white transition-colors group">
               <X size={16} className="group-hover:rotate-90 transition-transform" /><span className="text-[10px] font-black uppercase tracking-widest">Exit protocol</span>
            </button>
            {isSpeed && <span className="text-[10px] font-black uppercase tracking-widest text-white bg-white/10 px-3 py-1 rounded-full">{currentMilestone}</span>}
         </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col px-4 -mt-10 z-10 max-w-3xl mx-auto w-full overflow-y-auto no-scrollbar pb-32">

         {/* Timer Section */}
         <div className="relative flex justify-center mb-6">
            <div className={`relative w-[88px] h-[88px] bg-[#1B2343] rounded-full flex items-center justify-center border-[6px] border-[#0F172A] ${isLowPowerMode ? "" : "shadow-xl"} z-20 overflow-hidden`}>
               <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="44" stroke="currentColor" strokeWidth="8" fill="transparent" className={timeLeft < 5 ? 'text-red-500' : 'text-[#FF7A00]'} style={{ strokeDasharray: 276.5, strokeDashoffset: 276.5 - (276.5 * timeLeft) / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30), transition: timeLeft === 30 ? 'none' : 'stroke-dashoffset 1s linear' }} />
               </svg>
               <span className={`text-2xl font-black tabular-nums ${timeLeft < 5 ? "text-red-500 animate-pulse" : "text-white"}`}>{timeLeft}</span>
            </div>
         </div>

         {isLoadingQuestion || !currentQ ? (
            <QuestionSkeleton />
         ) : (
            <>
               <motion.div key={currentQuestionIndex} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`bg-[#1B2343] rounded-[2.5rem] p-8 sm:p-10 border border-white/10 ${isLowPowerMode ? "" : "shadow-2xl"} text-center mb-6 relative overflow-hidden`}>
                  <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={160} /></div>
                  <div className="flex flex-col items-center gap-4 mb-6">
                     <SourceBadge source={currentQ.source} />
                     <div className="flex items-center justify-center gap-3 py-2 px-4 bg-white/5 rounded-2xl border border-white/5">
                        <button disabled={lifelinesUsed.hint} onClick={handleUseHint} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 transition-all ${lifelinesUsed.hint ? "opacity-20 grayscale" : "active:scale-95"}`} title="Hint"><Zap size={20} className="text-orange-400" /></button>
                        <button disabled={lifelinesUsed.fiftyFifty} onClick={handleEliminateTwo} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition-all ${lifelinesUsed.fiftyFifty ? "opacity-20 grayscale" : "active:scale-95"}`} title="50/50"><Shuffle size={20} className="text-white" /></button>
                        <button disabled={lifelinesUsed.askClass} onClick={handleAskClass} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition-all ${lifelinesUsed.askClass ? "opacity-20 grayscale" : "active:scale-95"}`} title="Poll"><Users size={20} className="text-white" /></button>
                        <button disabled={lifelinesUsed.mentor} onClick={handleUseMentor} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-all ${lifelinesUsed.mentor ? "opacity-20 grayscale" : "active:scale-95"}`} title="Mentor"><Shield size={20} className="text-blue-400" /></button>
                     </div>
                  </div>
                  <div>
                     <div className="flex items-center justify-center gap-3 mb-4">
                        <span className="text-[12px] font-black text-white/60 uppercase tracking-[0.2em] bg-white/5 px-3 py-1 rounded-lg border border-white/5">Item {String(currentQuestionIndex + 1).padStart(2, "0")}</span>
                        <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                        <span className="text-[12px] font-black text-indigo-300 uppercase tracking-widest">{currentQ.subject}</span>
                     </div>
                     <p className="text-xl sm:text-2xl font-black leading-tight text-white tracking-tight text-center px-2" style={{ display: "block", visibility: "visible", opacity: 1 }}>{currentQ.question || "Clinical data synchronized. Analyzing case..."}</p>
                  </div>
               </motion.div>

               <div className={`flex flex-col gap-4 ${eliminatedOptions.length > 0 ? "min-h-[300px]" : ""}`}>
                  {currentQ.options.map((option, idx) => {
                     const isEliminated = eliminatedOptions.includes(option);
                     const isSelected = selectedOption === option;
                     const isReview = quizStatus === QUIZ_STATES.REVIEWING;
                     let state = 'normal';
                     if (isSelected) state = 'selected';
                     if (isReview) {
                        if (option === currentQ.correctAnswer) state = 'correct';
                        else if (isSelected) state = 'wrong';
                     }
                     if (isEliminated) return null;
                     return (
                        <motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} layout transition={{ duration: isLowPowerMode ? 0.1 : 0.3 }} className={eliminatedOptions.length > 0 ? "flex-1 min-h-[120px]" : ""}>
                           <OptionButton label={option} index={idx} state={state} onClick={() => handleOptionSelect(option)} disabled={isReview || quizStatus === QUIZ_STATES.CONFIRMING || isLoadingQuestion} pollValue={classPoll ? classPoll[option] : undefined} isLowPowerMode={isLowPowerMode} />
                        </motion.div>
                     );
                  })}
               </div>

               <AnimatePresence>
                  {quizStatus === QUIZ_STATES.REVIEWING && (
                     <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-8 space-y-6 pb-20">
                        <div className={`p-6 ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-orange-500/10 border-orange-500/20'} rounded-[2.5rem] border flex items-center gap-4 shadow-lg`}>
                           <div className={`w-12 h-12 ${isCorrect ? 'bg-emerald-500' : 'bg-orange-500'} text-white rounded-full flex items-center justify-center shrink-0 shadow-lg`}>{isCorrect ? <CheckCircle2 size={24}/> : <XCircle size={24} />}</div>
                           <div><p className={`text-[10px] font-black uppercase ${isCorrect ? 'text-emerald-400' : 'text-orange-400'} tracking-widest`}>{isCorrect ? 'Verification Success' : 'Critical Correction Required'}</p><p className="font-black text-white text-lg leading-tight">{currentQ.correctAnswerText}</p></div>
                        </div>
                        <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 space-y-6">
                           <div><p className="text-[10px] font-black uppercase text-indigo-400 mb-2 tracking-widest flex items-center gap-2"><Info size={12} /> Clinical Rationale</p><p className="font-medium text-sm leading-relaxed text-slate-300 italic">"{currentQ.rationale}"</p></div>
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div className="p-5 bg-blue-500/5 rounded-2xl border border-blue-500/10"><p className="text-[10px] font-black uppercase text-blue-400 mb-2 tracking-widest">🏥 Clinical Application</p><p className="text-xs font-bold text-slate-200">{currentQ.clinical_application}</p></div>
                              <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/10"><p className="text-[10px] font-black uppercase text-amber-500 mb-2 tracking-widest">💡 Simplification</p><p className="text-xs font-medium text-amber-200/80 leading-relaxed">{currentQ.simplification}</p></div>
                           </div>
                        </div>
                     </motion.div>
                  )}
               </AnimatePresence>
            </>
         )}
      </div>

      {/* Overlays */}
      <AnimatePresence>
         {quizStatus === QUIZ_STATES.CONFIRMING && (
            <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/90 ${isLowPowerMode ? "" : "backdrop-blur-md"}`}>
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className={`bg-[#1B2343] p-10 rounded-[3.5rem] ${isLowPowerMode ? "" : "shadow-2xl"} border border-white/10 flex flex-col items-center gap-6 max-w-md w-full text-center relative overflow-hidden`}>
                  <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><HelpCircle size={160} /></div>
                  <div className="w-20 h-20 bg-orange-500/10 text-orange-500 rounded-[2rem] flex items-center justify-center shadow-inner relative z-10"><HelpCircle size={40}/></div>
                  <div className="relative z-10"><h4 className="text-2xl font-black text-white uppercase tracking-tighter">Final Selection?</h4><p className="text-sm text-slate-400 font-medium tracking-tight mt-2 italic px-4">"Are you locked in your clinical decision for this case?"</p></div>
                  <div className="flex gap-4 w-full relative z-10 pt-4">
                    <button onClick={() => { setSelectedOption(null); setQuizStatus(QUIZ_STATES.ANSWERING); }} className="flex-1 py-5 bg-white/5 text-white/60 rounded-2xl font-black uppercase text-[10px] hover:bg-white/10 transition-colors">Change</button>
                    <button onClick={() => handleConfirmAnswer()} className="flex-1 py-5 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-orange-500/30 active:scale-95 transition-all">Confirm</button>
                  </div>
               </motion.div>
            </div>
         )}
      </AnimatePresence>

      <AnimatePresence>
         {quizStatus === QUIZ_STATES.REVIEWING && (
            <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-0 left-0 right-0 p-6 bg-[#0F172A]/80 backdrop-blur-md border-t border-white/5 z-[80]">
               <button onClick={handleNextQuestion} className={`w-full max-w-3xl mx-auto py-6 bg-[#FF7A00] text-white rounded-[2.5rem] font-black text-xl uppercase tracking-widest ${isLowPowerMode ? "" : "shadow-2xl"} active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-orange-600 group`}>
                  {currentQuestionIndex === quizQuestions.length - 1 ? 'Finish Challenge' : 'Next Protocol'} <ArrowRight size={24} className="group-hover:translate-x-2 transition-transform" />
               </button>
            </motion.div>
         )}
      </AnimatePresence>

      <AnimatePresence>
        {showHint && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className={`relative w-full max-w-md bg-[#1B2343] p-10 rounded-[3.5rem] ${isLowPowerMode ? "" : "shadow-2xl"} border border-white/10 text-center`}>
                <div className={`w-20 h-20 ${mentorAdvice?.type?.includes('Mentor') ? 'bg-blue-500/10 text-blue-400' : 'bg-orange-500/10 text-orange-400'} rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner`}>{mentorAdvice?.type?.includes('Mentor') ? <Shield size={40} /> : <Zap size={40} />}</div>
                <h4 className="text-2xl font-black text-white mb-1 uppercase tracking-tighter">{mentorAdvice?.type}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase mb-6 tracking-[0.2em]">Confidence Level: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-300 font-medium italic text-lg leading-relaxed mb-10 px-4">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px] hover:bg-white/20 transition-all border border-white/5">Return to Case</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExitConfirm && (
          <div className={`fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/90 ${isLowPowerMode ? "" : "backdrop-blur-xl"}`}>
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`bg-[#1B2343] p-10 rounded-[3.5rem] ${isLowPowerMode ? "" : "shadow-2xl"} max-w-md w-full text-center border border-white/10 relative overflow-hidden`}>
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><AlertCircle size={160} /></div>
                <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner relative z-10"><AlertCircle size={40} /></div>
                <div className="relative z-10">
                  <h4 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">Leave Quiz?</h4>
                  <div className="space-y-4 mb-6 relative z-10">
                    <p className="text-slate-400 font-medium italic leading-relaxed text-balance px-4">"{exitPrompt}"</p>
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest px-8">If you leave now, this session will end. Your progress may or may not be saved depending on the mode.</p>
                  </div>
                </div>
                <div className="bg-white/5 rounded-3xl p-6 mb-8 text-left space-y-2 border border-white/5 relative z-10">
                   <div className="flex justify-between items-center"><span className="text-[10px] text-white/40 uppercase font-black tracking-widest">Completion</span><span className="text-xs text-white font-bold">{currentQuestionIndex} / {quizQuestions.length} Items</span></div>
                   <div className="flex justify-between items-center"><span className="text-[10px] text-white/40 uppercase font-black tracking-widest">Session XP</span><span className="text-xs text-amber-400 font-bold">{sessionXP} XP</span></div>
                   <div className="flex justify-between items-center"><span className="text-[10px] text-white/40 uppercase font-black tracking-widest">Current Streak</span><span className="text-xs text-emerald-400 font-bold">{consecutiveCorrect} Correct</span></div>
                </div>
                <div className="flex flex-col gap-3 relative z-10">
                  <button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg active:scale-95 transition-all">Continue Learning</button>
                  <button onClick={() => {
                      if (quizMode === 'speed') localStorage.removeItem('APEX_QUIZ_SESSION');
                      setQuizStatus(QUIZ_STATES.SELECTION);
                      setIsQuizActive(false);
                      setShowExitConfirm(false);
                    }} className="w-full py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[10px] hover:text-red-500 transition-colors">Leave Quiz</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
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
      <div>
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-8 transition-all group-hover:scale-110 shadow-inner ${colors[color].split(' ').pop()} ${colors[color].split(' ')[1]}`}>{icon}</div>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">{title}</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium leading-relaxed tracking-tight">{desc}</p>
      </div>
      <div className="flex gap-4 mt-8">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Clock size={12} /> {duration}</div>
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-400 tracking-wider"><Timer size={12} /> {timer}</div>
      </div>
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
    <button disabled={disabled || state === 'eliminated'} onClick={() => { if(label.length > 80 && !isExpanded) setIsExpanded(true); else onClick(); }} className={`relative flex items-center justify-between w-full h-full p-6 rounded-[2rem] border-2 transition-all duration-300 ${baseStyles} active:scale-[0.98] ${isLowPowerMode ? "" : "shadow-lg"} mb-4`}>
      <div className="flex flex-col items-start pr-8">
        <p className={`font-bold text-left text-sm sm:text-base tracking-tight ${!isExpanded && label.length > 100 ? 'line-clamp-2' : ''}`}>{label}</p>
        {pollValue !== undefined && (
          <div className="mt-2 w-32">
            <div className="h-1 bg-white/10 rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pollValue}%`}} className="h-full bg-blue-500" /></div>
            <p className="text-[10px] font-black mt-1 opacity-60 uppercase tracking-tighter">{pollValue}% choosing this</p>
          </div>
        )}
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
