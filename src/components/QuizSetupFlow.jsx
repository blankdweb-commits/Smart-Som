import React, { useState, useMemo } from 'react';
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
  Timer,
  List,
  Lock,
  Sparkles
} from './Icons';

// Per-quiz-type configuration — drives what Step 2 shows.
const QUIZ_CONFIGS = {
  'clinical-challenge': {
    title: 'Clinical Challenge',
    identity: 'Simulated exam environment with critical rationales.',
    icon: <Shield size={22} />,
    accentText: 'text-medical-400',
    accentBg: 'bg-medical-500/20 border-medical-500/30',
    questionCounts: [10, 20, 30, 50, 100],
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
    bankNote: null
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
    bankNote: null
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
  speed: {
    title: 'Speed Challenge',
    identity: 'The ultimate test. One wrong answer ends the run.',
    icon: <Timer size={22} />,
    accentText: 'text-emerald-400',
    accentBg: 'bg-emerald-500/20 border-emerald-500/30',
    questionCounts: [10, 20, 30, 50, 100],
    timerOptions: [
      { value: null, label: 'No Time Limit' },
      { value: 10, label: '10s / Q' },
      { value: 20, label: '20s / Q' },
      { value: 30, label: '30s / Q' },
      { value: 60, label: '60s / Q' }
    ],
    allowOrderChoice: false,
    allowExamMode: false,
    forcedOrder: 'randomized',
    defaultAnswerMode: 'instant-feedback',
    defaultOrder: 'randomized',
    bankNote: null
  }
};

const DIFFICULTIES = [
  { id: 'Easy', dot: 'bg-emerald-500', ring: 'hover:border-emerald-500', activeRing: 'border-emerald-500', desc: 'Build your foundation' },
  { id: 'Medium', dot: 'bg-blue-500', ring: 'hover:border-blue-500', activeRing: 'border-blue-500', desc: 'Test your understanding' },
  { id: 'Hard', dot: 'bg-orange-500', ring: 'hover:border-orange-500', activeRing: 'border-orange-500', desc: 'Challenge your clinical reasoning' },
  { id: 'Expert', dot: 'bg-red-500', ring: 'hover:border-red-500', activeRing: 'border-red-500', desc: 'Deeper clinical reasoning' }
];

const ProgressIndicator = ({ step }) => (
  <div className="flex items-center justify-center gap-1.5" aria-label={`Step ${step} of 3`}>
    {[1, 2, 3].map((i) => (
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

const QuizSetupFlow = ({ quizType, initialDifficulty, onComplete, onCancel }) => {
  const config = QUIZ_CONFIGS[quizType] || QUIZ_CONFIGS['clinical-challenge'];

  const [step, setStep] = useState(1);
  const [difficulty, setDifficulty] = useState(
    DIFFICULTIES.some((d) => d.id === initialDifficulty) ? initialDifficulty : null
  );
  const [questionCount, setQuestionCount] = useState(config.questionCounts.includes(20) ? 20 : config.questionCounts[0]);
  const [timePerQuestion, setTimePerQuestion] = useState(
    config.timerOptions.find((t) => t.value === 30) != null ? 30 : config.timerOptions[0].value
  );
  const [order, setOrder] = useState(config.defaultOrder || 'randomized');
  const [answerMode, setAnswerMode] = useState(config.defaultAnswerMode || 'instant-feedback');

  const timeLabel = useMemo(() => {
    if (timePerQuestion == null) return 'No Time Limit';
    return `${timePerQuestion}s per question`;
  }, [timePerQuestion]);

  const handleStart = () => {
    onComplete({
      difficulty,
      questionCount,
      timePerQuestion,
      order,
      answerMode
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
        <ProgressIndicator step={step} />
        <p className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400">Step {step} of 3</p>
      </header>

      <div className="mt-6 bg-white dark:bg-slate-800 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 p-5 sm:p-8">
        <AnimatePresence mode="wait">
          {/* ---------------- STEP 1 : DIFFICULTY ---------------- */}
          {step === 1 && (
            <motion.div key="step1" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.25 }}>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">
                Choose Difficulty
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">
                Select a level to continue
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {DIFFICULTIES.map((d) => {
                  const active = difficulty === d.id;
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setDifficulty(d.id)}
                      className={`flex items-center gap-3 p-4 rounded-2xl border-2 text-left transition-all ${
                        active
                          ? `${d.activeRing} bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-lg scale-[1.02]`
                          : `border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40 ${d.ring}`
                      }`}
                    >
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${d.dot}`} />
                      <span className="flex-1 min-w-0">
                        <span className={`block font-black text-sm tracking-tight ${active ? '' : 'text-slate-900 dark:text-white'}`}>
                          {d.id}
                        </span>
                        <span className={`block text-[9px] font-bold uppercase tracking-widest truncate ${active ? 'text-white/60 dark:text-slate-900/60' : 'text-slate-400'}`}>
                          {d.desc}
                        </span>
                      </span>
                      {active && <CheckCircle2 size={18} className="text-emerald-400 dark:text-emerald-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                disabled={!difficulty}
                onClick={() => setStep(2)}
                className={`mt-6 w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 transition-all ${
                  difficulty
                    ? 'bg-medical-600 text-white shadow-xl shadow-medical-500/20 active:scale-95 hover:opacity-90'
                    : 'bg-slate-100 dark:bg-slate-900 text-slate-400 cursor-not-allowed'
                }`}
              >
                Continue <ArrowRight size={16} />
              </button>
            </motion.div>
          )}

          {/* ---------------- STEP 2 : SESSION PARAMETERS ---------------- */}
          {step === 2 && (
            <motion.div key="step2" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.25 }}>
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
                  <div className={`grid gap-2 ${config.timerOptions.length > 4 ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-3'}`}>
                    {config.timerOptions.map((t) => (
                      <ChoiceButton
                        key={t.label}
                        selected={timePerQuestion === t.value}
                        onClick={() => setTimePerQuestion(t.value)}
                        colorClass="bg-emerald-600"
                      >
                        {t.label}
                      </ChoiceButton>
                    ))}
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
              </div>

              <div className="flex gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="flex-1 py-4 rounded-2xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black uppercase tracking-widest text-xs flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
                >
                  <ArrowLeft size={16} /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="flex-[2] py-4 rounded-2xl bg-medical-600 text-white font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-500/20 flex items-center justify-center gap-2 active:scale-95 hover:opacity-90 transition-all"
                >
                  Continue <ArrowRight size={16} />
                </button>
              </div>
            </motion.div>
          )}

          {/* ---------------- STEP 3 : REVIEW SESSION ---------------- */}
          {step === 3 && (
            <motion.div key="step3" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.25 }}>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-1">
                Review Your Session
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">
                Confirm your setup before you begin
              </p>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {[
                  { label: 'Quiz', value: config.title },
                  { label: 'Difficulty', value: difficulty },
                  { label: 'Questions', value: String(questionCount) },
                  { label: 'Time', value: timeLabel },
                  { label: 'Question Order', value: order === 'sequential' ? 'Sequential' : 'Randomized' },
                  { label: 'Answer Mode', value: answerMode === 'exam-mode' ? 'Exam Mode' : 'Instant Feedback' }
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
                  onClick={() => setStep(2)}
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
