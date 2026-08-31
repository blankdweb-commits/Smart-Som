import React, { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Clock,
  Shuffle,
  Target,
  Zap,
  Shield,
  List,
  Lock,
  Sparkles,
  BookOpen,
  Heart
} from './Icons';

// Per-quiz-type configuration — drives what Step 2 shows.
const QUIZ_CONFIGS = {
  'clinical-challenge': {
    title: 'Clinical Challenge',
    identity: 'Simulated exam environment with critical rationales.',
    icon: <Shield size={22} />,
    accentText: 'text-medical-400',
    accentBg: 'bg-medical-500/20 border-medical-500/30',
    questionCounts: [10, 20, 30, 50],
    timerOptions: [
      { value: null, label: 'No Time Limit' },
      { value: 10, label: '10s / Q' },
      { value: 20, label: '20s / Q' },
      { value: 30, label: '30s / Q' },
      { value: 60, label: '60s / Q' }
    ],
    allowOrderChoice: true,
    allowExamMode: true,
    defaultOrder: 'randomized',
    bankNote: null,
    allowExamSource: true,
    examSources: [
      { value: 'both', label: 'NMCN + NCLEX', desc: 'Mixed exam-style questions' },
      { value: 'nmcn', label: 'NMCN', desc: 'Nigerian nursing council questions' },
      { value: 'nclex', label: 'NCLEX', desc: 'North American licensing questions' }
    ],
    defaultExamSource: 'both'
  },
  'quick-quiz': {
    title: 'Quick Quiz',
    identity: 'Rapid questions for instant knowledge verification.',
    icon: <Zap size={22} />,
    accentText: 'text-amber-400',
    accentBg: 'bg-amber-500/20 border-amber-500/30',
    questionCounts: [10],
    timerOptions: [
      { value: 10, label: '10s / Q' },
      { value: 20, label: '20s / Q' },
      { value: 30, label: '30s / Q' }
    ],
    allowOrderChoice: true,
    allowExamMode: false,
    defaultAnswerMode: 'instant-feedback',
    defaultOrder: 'randomized',
    bankNote: null,
    allowExamSource: true,
    examSources: [
      { value: 'both', label: 'NMCN + NCLEX', desc: 'Mixed exam-style questions' },
      { value: 'nmcn', label: 'NMCN', desc: 'Nigerian nursing council questions' },
      { value: 'nclex', label: 'NCLEX', desc: 'North American licensing questions' }
    ],
    defaultExamSource: 'both'
  },
  'uselu-test': {
    title: 'Uselu Test Questions',
    identity: 'Focused practice with the Uselu Posting test question bank.',
    icon: <Target size={22} />,
    accentText: 'text-indigo-400',
    accentBg: 'bg-indigo-500/20 border-indigo-500/30',
    questionCounts: [10, 20, 30, 50],
    timerOptions: [
      { value: null, label: 'No Time Limit' },
      { value: 15, label: '15s / Q' },
      { value: 30, label: '30s / Q' },
      { value: 45, label: '45s / Q' },
      { value: 60, label: '60s / Q' }
    ],
    allowOrderChoice: true,
    allowExamMode: true,
    defaultOrder: 'randomized',
    bankNote: '61 questions available in this bank'
  },
    'nursing-200': {
    title: 'Nursing 200-Level',
    identity: '200-Level course questions across twelve core subjects.',
    icon: <BookOpen size={22} />,
    accentText: 'text-emerald-400',
    accentBg: 'bg-emerald-500/20 border-emerald-500/30',
    subjects: [
      'Community Health Nursing I',
      'Fundamentals of Nursing',
      'Medical-Surgical Nursing',
      'Unit I: Introduction to Nutrition',
      'Unit II: Nutritional Needs',
      'Unit III: Food Planning, Preparation, and Safety',
      'Pharmacology III',
      'Concept of Politics and Government',
      'Political Interaction',
      'Political Activities',
      'Reproductive Health',
      'Research Methodology'
    ],
    questionCounts: [10, 20, 30, 50],
    timerOptions: [
      { value: null, label: 'No Time Limit' },
      { value: 15, label: '15s / Q' },
      { value: 30, label: '30s / Q' },
      { value: 45, label: '45s / Q' },
      { value: 60, label: '60s / Q' }
    ],
    allowOrderChoice: true,
    allowExamMode: true,
    defaultOrder: 'randomized',
    bankNote: '3,517 questions available in this bank'
  },
  'weakness-challenge': {
    title: 'Fix My Weak Areas',
    identity: 'A custom quiz pulled from your weakest topics (accuracy < 60%). Unlocks after 100 questions.',
    icon: <Target size={22} />,
    accentText: 'text-rose-400',
    accentBg: 'bg-rose-500/20 border-rose-500/30',
    questionCounts: [10, 15, 20, 30],
    timerOptions: [
      { value: null, label: 'No Time Limit' },
      { value: 15, label: '15s / Q' },
      { value: 30, label: '30s / Q' },
      { value: 45, label: '45s / Q' }
    ],
    allowOrderChoice: false,
    allowExamMode: false,
    defaultAnswerMode: 'instant-feedback',
    defaultOrder: 'randomized',
    bankNote: 'Questions are drawn from your computed weak topics'
  },
  'midwifery-200': {
    title: 'Midwifery 200-Level',
    identity: '200-Level midwifery questions across five core subjects.',
    icon: <Heart size={22} />,
    accentText: 'text-pink-400',
    accentBg: 'bg-pink-500/20 border-pink-500/30',
    subjects: [
      'Principles of Management and Teaching',
      'Medical-Surgical Nursing II',
      'Child Health',
      'Home Health Care Nursing',
      'Entrepreneurship in Midwifery'
    ],
    questionCounts: [10, 20, 30, 50],
    timerOptions: [
      { value: null, label: 'No Time Limit' },
      { value: 15, label: '15s / Q' },
      { value: 30, label: '30s / Q' },
      { value: 45, label: '45s / Q' },
      { value: 60, label: '60s / Q' }
    ],
    allowOrderChoice: true,
    allowExamMode: true,
    defaultOrder: 'randomized',
    bankNote: '709 questions available in this bank'
  }
};

const DIFFICULTIES = [
  { id: 'Easy', dot: 'bg-emerald-500', ring: 'hover:border-emerald-500', activeRing: 'border-emerald-500', desc: 'Build your foundation' },
  { id: 'Medium', dot: 'bg-blue-500', ring: 'hover:border-blue-500', activeRing: 'border-blue-500', desc: 'Test your understanding' },
  { id: 'Hard', dot: 'bg-orange-500', ring: 'hover:border-orange-500', activeRing: 'border-orange-500', desc: 'Challenge your clinical reasoning' },
  { id: 'Expert', dot: 'bg-red-500', ring: 'hover:border-red-500', activeRing: 'border-red-500', desc: 'Deeper clinical reasoning' }
];

const ProgressIndicator = ({ step, total = 3 }) => (
  <div className="flex items-center justify-center gap-1.5" aria-label={`Step ${step} of ${total}`}>
    {Array.from({ length: total }, (_, i) => i + 1).map((i) => (
      <React.Fragment key={i}>
        {i > 1 && (
          <span className={`w-6 sm:w-10 h-[3px] rounded-full transition-colors duration-300 ${step >= i ? 'bg-medical-500' : 'bg-slate-300 dark:bg-slate-700'}`} />
        )}
        <span
          className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
            step === i
              ? 'bg-medical-500 shadow-[0_0_10px_rgba(6,182,212,0.7)] scale-125'
              : step > i
              ? 'bg-medical-500'
              : 'bg-slate-300 dark:bg-slate-700'
          }`}
        />
      </React.Fragment>
    ))}
  </div>
);

const SectionLabel = ({ children }) => (
  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 mb-2">{children}</label>
);

const ChoiceButton = ({ selected, onClick, children, disabled, colorClass = 'bg-medical-600' }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`py-3 px-2 rounded-xl font-black text-xs sm:text-sm transition-all border-2 ${
      disabled
        ? 'opacity-40 cursor-not-allowed bg-slate-100 dark:bg-slate-900 border-transparent text-slate-400'
        : selected
        ? `${colorClass} text-white border-transparent shadow-lg scale-[1.02]`
        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-medical-400'
    }`}
  >
    {children}
  </button>
);

const QuizSetupFlow = ({ quizType, initialDifficulty, initialSubject, onComplete, onCancel }) => {
  const config = QUIZ_CONFIGS[quizType] || QUIZ_CONFIGS['clinical-challenge'];
  const { difficultyProgress, isPremium } = useAppContext();

  // Free users must use a per-question timer (never "No Time Limit"); premium
  // users may go untimed. Filter the untimed option accordingly.
  const freeTimerLocked = !isPremium;
  const timerOptions = useMemo(() => {
    if (freeTimerLocked) return config.timerOptions.filter(t => t.value != null);
    return config.timerOptions;
  }, [config.timerOptions, freeTimerLocked]);

  // Difficulty unlock gating — Medium (50 Easy correct), Hard (80 Medium),
  // Expert (100 Hard correct), driven by the server-computed value.
  // Fail-open while the server status hasn't loaded (null) so the setup is
  // never blocked on first render.
  const unlockedTiers = useMemo(() => {
    if (difficultyProgress == null) return new Set(DIFFICULTIES.map(d => d.id));
    const set = new Set(['Easy']);
    const lookup = Array.isArray(difficultyProgress)
      ? new Map(difficultyProgress.map(p => [String(p.difficulty).toLowerCase(), p.unlocked === true]))
      : new Map();
    if (lookup.get('medium')) set.add('Medium');
    if (lookup.get('hard')) set.add('Hard');
    if (lookup.get('expert')) set.add('Expert');
    return set;
  }, [difficultyProgress]);

  const difficultyHint = (id) => {
    if (difficultyProgress == null) return null;
    const row = Array.isArray(difficultyProgress)
      ? difficultyProgress.find(p => String(p.difficulty).toLowerCase() === id.toLowerCase())
      : null;
    if (!row || row.unlocked) return null;
    return `${row.gate_progress ?? 0}/${row.target ?? 0} correct answers to unlock`;
  };

  const requiresSubject = config.subjects && config.subjects.length > 0;
  const totalSteps = requiresSubject ? 4 : 3;
  const diffStep = requiresSubject ? 2 : 1;
  const sessStep = requiresSubject ? 3 : 2;
  const reviewStep = requiresSubject ? 4 : 3;

  const [step, setStep] = useState(1);
  const [difficulty, setDifficulty] = useState(
    DIFFICULTIES.some((d) => d.id === initialDifficulty) ? initialDifficulty : null
  );
  const [subject, setSubject] = useState(() => {
    if (!requiresSubject) return initialSubject || null;
    if (initialSubject && config.subjects.includes(initialSubject)) return initialSubject;
    return null;
  });
  const [questionCount, setQuestionCount] = useState(config.questionCounts.includes(20) ? 20 : config.questionCounts[0]);
  const [timePerQuestion, setTimePerQuestion] = useState(
    config.timerOptions.find((t) => t.value === 30) != null ? 30 : config.timerOptions[0].value
  );
  const [order, setOrder] = useState(config.defaultOrder || 'randomized');
  const [answerMode, setAnswerMode] = useState(config.defaultAnswerMode || 'instant-feedback');
  const [examSource, setExamSource] = useState(config.defaultExamSource || 'both');

  const timeLabel = useMemo(() => {
    if (timePerQuestion == null) return 'No Time Limit';
    return `${timePerQuestion}s per question`;
  }, [timePerQuestion]);

  // Free users can't go untimed — snap any lingering null selection to a
  // default timed value (30s if offered, else the first available option).
  React.useEffect(() => {
    if (freeTimerLocked && timePerQuestion == null && timerOptions.length > 0) {
      const fallback = timerOptions.some(t => t.value === 30) ? 30 : timerOptions[0].value;
      setTimePerQuestion(fallback);
    }
  }, [freeTimerLocked, timePerQuestion, timerOptions]);

  const handleStart = () => {
    onComplete({
      difficulty,
      questionCount,
      timePerQuestion,
      order,
      answerMode,
      subject,
      examSource
    });
  };

  const stepVariants = {
    initial: { opacity: 0, x: 30 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -30 }
  };

  return (
    <div className="max-w-2xl mx-auto pb-32 px-4 animate-in fade-in duration-500">
      {/* Header */}
      <header className="flex flex-col items-center text-center gap-4 pt-4 sm:pt-8">
        <div className={`p-3 rounded-2xl border ${config.accentBg} ${config.accentText}`}>{config.icon}</div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
            {config.title}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm font-medium mt-1">{config.identity}</p>
        </div>
        <ProgressIndicator step={step} total={totalSteps} />
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Step {step} of {totalSteps}</p>
      </header>

      <div className="mt-6 bg-white dark:bg-slate-800 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 p-5 sm:p-8">
        <AnimatePresence mode="wait">
          {/* ---------------- SUBJECT SELECTION (Nursing 200-Level) ---------------- */}
          {requiresSubject && step === 1 && (
            <motion.div key="subject-step" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.25 }}>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">
                Choose Subject
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">
                Select one subject to focus your test
              </p>

              <div className="grid grid-cols-1 gap-3">
                {config.subjects.map((s) => {
                  const active = subject === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSubject(s)}
                      className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                        active
                          ? 'border-emerald-500 bg-emerald-500/10 text-slate-900 dark:text-white shadow-lg scale-[1.01]'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 hover:border-emerald-400'
                      }`}
                    >
                      <BookOpen size={18} className={`shrink-0 ${active ? 'text-emerald-500' : 'text-slate-400'}`} />
                      <span className="flex-1 min-w-0">
                        <span className={`block font-black text-sm tracking-tight ${active ? '' : 'text-slate-900 dark:text-white'}`}>{s}</span>
                      </span>
                      {active && <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={!subject}
                onClick={() => setStep(diffStep)}
                className={`mt-6 w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all ${
                  subject
                    ? 'bg-emerald-600 text-white shadow-xl shadow-emerald-500/20 active:scale-95 hover:opacity-90'
                    : 'bg-slate-100 dark:bg-slate-900 text-slate-400 cursor-not-allowed'
                }`}
              >
                Continue <ArrowRight size={16} />
              </button>
            </motion.div>
          )}

          {/* ---------------- STEP {diffStep} : DIFFICULTY ---------------- */}
          {step === diffStep && (
            <motion.div key="step-diff" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.25 }}>
              {subject && (
                <div className="mb-5 p-4 rounded-2xl bg-apex-600/10 border border-apex-500/30 flex items-center gap-3">
                  <Target size={18} className="text-apex-600 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black text-apex-600 uppercase tracking-widest">Targeted Practice</p>
                    <p className="text-sm font-black text-slate-900 dark:text-white">All questions from {subject}</p>
                  </div>
                </div>
              )}
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">
                Choose Difficulty
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">
                Select a level to continue
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {DIFFICULTIES.map((d) => {
                  const active = difficulty === d.id;
                  const locked = !unlockedTiers.has(d.id);
                  const hint = difficultyHint(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      disabled={locked}
                      onClick={() => !locked && setDifficulty(d.id)}
                      className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                        locked
                          ? 'opacity-45 cursor-not-allowed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40'
                          : active
                          ? `${d.activeRing} bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-lg scale-[1.02]`
                          : `border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 ${d.ring}`
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${locked ? 'bg-slate-300 dark:bg-slate-600' : d.dot}`} />
                      <span className="flex-1 min-w-0">
                        <span className={`flex items-center gap-1.5 font-black text-sm tracking-tight ${locked ? 'text-slate-400' : active ? '' : 'text-slate-900 dark:text-white'}`}>
                          {locked && <Lock size={13} className="shrink-0" />}
                          {d.id}
                        </span>
                        <span className={`block text-[9px] font-bold uppercase tracking-widest truncate ${locked ? 'text-slate-400' : active ? 'text-white/60 dark:text-slate-900/60' : 'text-slate-400'}`}>
                          {d.desc}
                        </span>
                        {locked && hint && (
                          <span className="block text-[9px] font-bold uppercase tracking-widest text-amber-500 mt-0.5">
                            {hint}
                          </span>
                        )}
                      </span>
                      {active && <CheckCircle2 size={18} className="text-emerald-400 dark:text-emerald-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <div className="flex gap-3 mt-6">
                {requiresSubject && (
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="flex-1 py-4 rounded-2xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
                  >
                    <ArrowLeft size={16} /> Back
                  </button>
                )}
                <button
                  type="button"
                  disabled={!difficulty}
                  onClick={() => setStep(sessStep)}
                  className={`${requiresSubject ? 'flex-[2]' : 'w-full'} py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all ${
                    difficulty
                      ? 'bg-medical-600 text-white shadow-xl shadow-medical-500/20 active:scale-95 hover:opacity-90'
                      : 'bg-slate-100 dark:bg-slate-900 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ---------------- STEP {sessStep} : SESSION PARAMETERS ---------------- */}
          {step === sessStep && (
            <motion.div key="step-sess" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.25 }}>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">
                Customize Your Session
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">
                {config.bankNote || 'Configure how you want to practice'}
              </p>

              <div className="space-y-6">
                {/* Number of Questions */}
                <div>
                  <SectionLabel>Number of Questions</SectionLabel>
                  <div className={`grid gap-2 ${config.questionCounts.length > 4 ? 'grid-cols-5' : `grid-cols-${Math.min(config.questionCounts.length, 4)}`}`}>
                    {config.questionCounts.map((val) => (
                      <ChoiceButton key={val} selected={questionCount === val} onClick={() => setQuestionCount(val)}>
                        {val}
                        {config.questionCounts.length === 1 && <Lock size={10} className="inline ml-1 -mt-0.5" />}
                      </ChoiceButton>
                    ))}
                  </div>
                </div>

                {/* Time Limit */}
                <div>
                  <SectionLabel>Time Limit</SectionLabel>
                  <div className={`grid gap-2 ${timerOptions.length > 4 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-3'}`}>
                    {timerOptions.map((t) => (
                      <ChoiceButton
                        key={t.label}
                        selected={timePerQuestion === t.value}
                        onClick={() => setTimePerQuestion(t.value)}
                        colorClass="bg-emerald-600"
                      >
                        {t.label}
                      </ChoiceButton>
                    ))}
                    {freeTimerLocked && !timerOptions.some(t => t.value === null) && (
                      <div className="flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-200 dark:border-slate-700 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                        <Lock size={11} className="shrink-0" /> No Time Limit is premium
                      </div>
                    )}
                  </div>
                </div>

                {/* Question Order */}
                {config.allowOrderChoice ? (
                  <div>
                    <SectionLabel>Question Order</SectionLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <ChoiceButton
                        selected={order === 'sequential'}
                        onClick={() => setOrder('sequential')}
                        colorClass="bg-indigo-600"
                      >
                        Sequential
                      </ChoiceButton>
                      <ChoiceButton
                        selected={order === 'randomized'}
                        onClick={() => setOrder('randomized')}
                        colorClass="bg-indigo-600"
                      >
                        <Shuffle size={12} className="inline mr-1 -mt-0.5" /> Randomized
                      </ChoiceButton>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                    <Shuffle size={13} className="text-indigo-400 shrink-0" />
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Questions always randomized in this mode
                    </p>
                  </div>
                )}

                {/* Answer Mode */}
                {config.allowExamMode ? (
                  <div>
                    <SectionLabel>Answer Mode</SectionLabel>
                    <div className="grid grid-cols-2 gap-2">
                      <ChoiceButton
                        selected={answerMode === 'instant-feedback'}
                        onClick={() => setAnswerMode('instant-feedback')}
                        colorClass="bg-amber-600"
                      >
                        Instant Feedback
                      </ChoiceButton>
                      <ChoiceButton
                        selected={answerMode === 'exam-mode'}
                        onClick={() => setAnswerMode('exam-mode')}
                        colorClass="bg-amber-600"
                      >
                        Exam Mode
                      </ChoiceButton>
                    </div>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                      {answerMode === 'exam-mode'
                        ? 'Correct/incorrect shown per question — full review at the end'
                        : 'Rationale and teaching notes appear after every answer'}
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-700">
                    <Zap size={13} className="text-amber-400 shrink-0" />
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                      Instant feedback mode — rationale after every answer
                    </p>
                  </div>
                )}

                {/* Question Source (Clinical / Quick only) */}
                {config.allowExamSource && config.examSources && (
                  <div>
                    <SectionLabel>Question Source</SectionLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {config.examSources.map((s) => (
                        <button
                          key={s.value}
                          type="button"
                          onClick={() => setExamSource(s.value)}
                          className={`p-3 rounded-2xl border-2 text-left transition-all ${
                            examSource === s.value
                              ? 'border-medical-500 bg-medical-500/10 text-slate-900 dark:text-white shadow-lg scale-[1.02]'
                              : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 hover:border-medical-400'
                          }`}
                        >
                          <span className={`block font-black text-xs tracking-tight ${examSource === s.value ? '' : 'text-slate-900 dark:text-white'}`}>
                            {s.label}
                          </span>
                          <span className="block text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">{s.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setStep(diffStep)}
                  className="flex-1 py-4 rounded-2xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(reviewStep)}
                  className="flex-[2] py-4 rounded-2xl bg-medical-600 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-500/20 flex items-center justify-center gap-2 active:scale-95 hover:opacity-90 transition-all"
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ---------------- STEP {reviewStep} : REVIEW SESSION ---------------- */}
          {step === reviewStep && (
            <motion.div key="step-review" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.25 }}>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">
                Review Your Session
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">
                Confirm your setup before you begin
              </p>

              {subject && (
                <div className="mb-5 p-4 rounded-2xl bg-apex-600/10 border border-apex-500/30 flex items-center gap-3">
                  <Target size={18} className="text-apex-600 shrink-0" />
                  <div>
                    <p className="text-[9px] font-black text-apex-600 uppercase tracking-widest">Targeted Practice</p>
                    <p className="text-sm font-black text-slate-900 dark:text-white">All questions from {subject}</p>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {[
                  { label: 'Quiz', value: config.title },
                  ...(subject ? [{ label: 'Subject', value: subject }] : []),
                  { label: 'Difficulty', value: difficulty },
                  { label: 'Questions', value: String(questionCount) },
                  { label: 'Time', value: timeLabel },
                  { label: 'Question Order', value: order === 'sequential' ? 'Sequential' : 'Randomized' },
                  { label: 'Answer Mode', value: answerMode === 'exam-mode' ? 'Exam Mode' : 'Instant Feedback' },
                  ...(config.allowExamSource && config.examSources ? [
                    { label: 'Source', value: (config.examSources.find(s => s.value === examSource) || {}).label || 'Both' }
                  ] : [])
                ].map((row, i) => (
                  <div
                    key={row.label}
                    className={`flex justify-between items-center px-4 py-3.5 ${
                      i % 2 === 0 ? 'bg-slate-50 dark:bg-slate-900/50' : 'bg-white dark:bg-slate-800'
                    }`}
                  >
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{row.label}</span>
                    <span className="font-black text-sm text-slate-900 dark:text-white text-right">{row.value}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setStep(sessStep)}
                  className="flex-1 py-4 rounded-2xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
                >
                  <ArrowLeft size={16} /> Edit
                </button>
                <button
                  type="button"
                  onClick={handleStart}
                  className="flex-[2] py-4 rounded-2xl bg-medical-600 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-500/20 flex items-center justify-center gap-2 active:scale-95 hover:opacity-90 transition-all"
                >
                  Start Quiz <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Cancel */}
      <button
        type="button"
        onClick={onCancel}
        className="mt-6 w-full py-3 text-slate-400 hover:text-red-400 font-black uppercase tracking-widest text-[10px] transition-colors"
      >
        ← Back to Quiz Modes
      </button>
    </div>
  );
};

export default React.memo(QuizSetupFlow);
