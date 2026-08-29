import React, { useState, useEffect, useRef } from 'react';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  Clock,
  X,
  AlertCircle,
  Zap,
  Coins,
  HelpCircle,
  SkipForward,
  Snowflake
} from './Icons';
import { useAppContext } from '../context/AppContext';

const pad = (n) => String(n).padStart(2, '0');

/**
 * Immersive quiz player for Clinical Challenge / Quick Quiz / Uselu Test.
 * Handles: question presentation, answer locking, one-look review with
 * Conceptual Misalignment, per-question timer, exam vs instant feedback.
 */
const QuizPlayer = ({ questions, config, modeLabel, onSound, onComplete, onQuit }) => {
  const { smartCoins, spendSC, streakFreezeActive, setStreakFreezeActive, submitQuestionFeedback } = useAppContext();
  const total = questions.length;
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState(null);
  const [lockedAnswer, setLockedAnswer] = useState(undefined); // undefined = not locked
  const [isCorrect, setIsCorrect] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [timeLeft, setTimeLeft] = useState(config.timePerQuestion ?? 0);
  const [score, setScore] = useState(0);
  const [showQuitModal, setShowQuitModal] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [powerups] = useState({
    skip: config.powerUps?.skip ?? 8,
    hint: config.powerUps?.hint ?? 5,
    streakFreeze: config.powerUps?.streakFreeze ?? 12
  });

  // Question feedback ("How was this question?") — one vote per question.
  const [feedback, setFeedback] = useState(null); // null | 'good' | 'bad'
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackSaved, setFeedbackSaved] = useState(false);
  const [showReason, setShowReason] = useState(false);

  // Reset feedback when advancing to a new question.
  React.useEffect(() => {
    setFeedback(null);
    setFeedbackReason('');
    setFeedbackSaved(false);
    setShowReason(false);
  }, [idx]);

  const answersRef = useRef([]);
  const startRef = useRef(null);
  React.useEffect(() => {
    startRef.current = Date.now();
  }, []);

  const q = questions[idx];
  const isLast = idx === total - 1;
  const isLocked = lockedAnswer !== undefined;
  const instant = config.answerMode === 'instant-feedback';
  const hasTimer = config.timePerQuestion != null;

  const recordAnswer = (opt, correct, wasTimeout) => {
    answersRef.current.push({
      question: typeof q.question === 'object' ? JSON.stringify(q.question) : q.question,
      questionId: q.id || '',
      subject: q.subject || 'General',
      category: q.category || 'General',
      topic: q.topic || q.category || 'General',
      difficulty: q.difficulty || config.difficulty || '',
      mode: config.mode || modeLabel || 'standard',
      isCorrect: correct,
      correct,
      timedOut: wasTimeout,
      yourAnswer: opt ?? 'No answer submitted',
      correctAnswer: q.correctAnswer,
      rationale:
        q.rationale ||
        'Nurses must apply critical thinking and clinical protocols to ensure patient safety and prioritize airway, breathing, and circulation.',
      hint: q.hint || ''
    });
    if (correct) {
      setScore((s) => s + 1);
      onSound?.('correct');
    } else if (wasTimeout) {
      onSound?.('timeout');
    } else {
      onSound?.('wrong');
    }
  };

  const confirmAnswer = (opt) => {
    if (isLocked || !opt) return;
    const correct = opt === q.correctAnswer;
    setLockedAnswer(opt);
    setIsCorrect(correct);
    setTimedOut(false);
    setSelected(opt);
    recordAnswer(opt, correct, false);
  };

  const handleTimeout = () => {
    if (isLocked) return;
    setLockedAnswer(selected); // may be null — counts as locked
    setIsCorrect(false);
    setTimedOut(true);
    recordAnswer(selected, false, true);
  };

  // Per-question countdown — expiry fires from within the timeout callback
  // so the state transition happens outside of render/effect body.
  useEffect(() => {
    if (!hasTimer || isLocked || timeLeft <= 0) return;
    const t = setTimeout(() => {
      if (timeLeft - 1 <= 0) {
        handleTimeout();
      } else {
        setTimeLeft(timeLeft - 1);
      }
    }, 1000);
    return () => clearTimeout(t);
  }, [timeLeft, isLocked, hasTimer]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOptionClick = (option) => {
    if (isLocked) return;
    if (selected === option) {
      // Second tap on same option confirms immediately
      confirmAnswer(option);
    } else {
      setSelected(option);
    }
  };

  const nextQuestion = () => {
    if (isLast) {
      onComplete({
        score,
        total,
        durationSeconds: Math.round((Date.now() - startRef.current) / 1000),
        answers: [...answersRef.current]
      });
      return;
    }
    setIdx((i) => i + 1);
    setSelected(null);
    setLockedAnswer(undefined);
    setIsCorrect(false);
    setTimedOut(false);
    setTimeLeft(hasTimer ? config.timePerQuestion : 0);
  };

  const submitFeedback = async () => {
    if (!feedback || feedbackSaved) return;
    setFeedbackSaved(true);
    await submitQuestionFeedback({
      questionId: q?.id || q?.question,
      rating: feedback === 'good',
      reason: feedback === 'bad' ? feedbackReason : ''
    });
  };

  // ---- SC power-ups ----
  const useSkip = async () => {
    if (isLocked) return;
    const newBalance = await spendSC(powerups.skip, 'powerup_skip');
    if (newBalance === smartCoins) return; // insufficient funds — no-op
    onSound?.('skip');
    setSelected(null);
    setLockedAnswer(undefined);
    setIsCorrect(false);
    setTimedOut(false);
    setTimeLeft(hasTimer ? config.timePerQuestion : 0);
    if (isLast) {
      onComplete({
        score,
        total,
        durationSeconds: Math.round((Date.now() - startRef.current) / 1000),
        answers: [...answersRef.current]
      });
    } else {
      setIdx((i) => i + 1);
    }
  };

  const useHint = async () => {
    if (isLocked) return;
    const newBalance = await spendSC(powerups.hint, 'powerup_hint');
    if (newBalance === smartCoins) return; // insufficient funds
    setShowHint(true);
    onSound?.('hint');
  };

  const toggleStreakFreeze = async () => {
    if (!streakFreezeActive) {
      const newBalance = await spendSC(powerups.streakFreeze, 'powerup_streak_freeze');
      if (newBalance === smartCoins) return; // insufficient funds
      setStreakFreezeActive(true);
      onSound?.('freeze');
    } else {
      setStreakFreezeActive(false);
    }
  };

  // Option card visual state
  const optionState = (option) => {
    if (!isLocked) return option === selected ? 'selected' : 'default';
    if (option === q.correctAnswer) return 'correct';
    if (option === lockedAnswer) return 'wrong';
    return 'dimmed';
  };

  const stateStyles = {
    default: 'bg-slate-900/60 border-white/10 text-slate-200 hover:border-medical-400/60 hover:bg-slate-900 active:scale-[0.98]',
    selected: 'bg-amber-500/10 border-amber-500/60 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.15)]',
    correct: 'bg-emerald-500/10 border-emerald-500/60 text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.15)]',
    wrong: 'bg-red-500/10 border-red-500/60 text-red-300 shadow-[0_0_20px_rgba(239,68,68,0.15)]',
    dimmed: 'bg-slate-900/40 border-white/5 text-slate-500 opacity-50'
  };

  const letters = ['A', 'B', 'C', 'D', 'E'];

  return (
    <div className="fixed inset-0 z-[80] bg-slate-950 text-white overflow-y-auto">
      {/* Ambient decoration */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-medical-500/10 blur-[120px] rounded-full" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-indigo-500/5 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 sm:px-6 py-6 sm:py-10 min-h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => setShowQuitModal(true)}
            className="p-2.5 rounded-xl hover:bg-white/10 transition-all"
            aria-label="Exit quiz"
          >
            <X size={22} className="text-slate-400" />
          </button>
          <div className="text-center">
            <p className="text-lg sm:text-xl font-black tracking-tighter uppercase leading-none">
              Question {pad(idx + 1)}
            </p>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.3em] mt-1">
              {idx + 1} of {total}
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-2 bg-white/10 backdrop-blur-md rounded-xl border border-white/10">
            <Zap size={14} className="text-amber-400" fill="currentColor" />
            <span className="text-sm font-black tabular-nums">{score}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 rounded-full overflow-hidden bg-white/10 border border-white/10 mb-6">
          <motion.div
            initial={false}
            animate={{ width: `${((idx + 1) / total) * 100}%` }}
            className="h-full bg-medical-500 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.5)]"
          />
        </div>

        {/* Question */}
        <motion.div key={idx} initial={{ x: 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.3 }} className="flex-1 flex flex-col">
          <div className="space-y-4 mb-6">
            {/* Category badges */}
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-medical-500/20 text-medical-300 rounded-full text-[9px] font-black uppercase tracking-widest border border-medical-500/30">
                {q?.subject || 'General'}
              </span>
              <span className="px-3 py-1 bg-indigo-500/20 text-indigo-300 rounded-full text-[9px] font-black uppercase tracking-widest border border-indigo-500/30">
                {q?.category || 'General'}
              </span>
              {config.difficulty && (
                <span className="px-3 py-1 bg-amber-500/20 text-amber-300 rounded-full text-[9px] font-black uppercase tracking-widest border border-amber-500/30">
                  {config.difficulty}
                </span>
              )}
              {hasTimer && (
                <span className={`ml-auto px-3 py-1 rounded-full text-[9px] font-black tabular-nums border flex items-center gap-1.5 ${
                  timeLeft <= 5 && !isLocked
                    ? 'bg-red-500/20 text-red-300 border-red-500/30 animate-pulse'
                    : 'bg-white/10 text-slate-200 border-white/10'
                }`}>
                  <Clock size={11} /> {timeLeft}s
                </span>
              )}
            </div>

            {/* Question text */}
            <h2 className="text-lg sm:text-2xl font-black leading-snug tracking-tight text-white">
              {typeof q?.question === 'object' ? JSON.stringify(q?.question) : q?.question}
            </h2>
          </div>

          {/* Options */}
          <div className="grid grid-cols-1 gap-3">
            {q?.options?.map((option, oIdx) => {
              const st = optionState(option);
              return (
                <button
                  key={oIdx}
                  disabled={isLocked}
                  onClick={() => handleOptionClick(option)}
                  className={`w-full flex items-center gap-4 p-4 sm:p-5 rounded-2xl border-2 text-left transition-all duration-200 min-h-[70px] ${stateStyles[st]} ${isLocked ? 'cursor-default' : ''}`}
                >
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm border-2 shrink-0 ${
                    st === 'selected' ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                    : st === 'correct' ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                    : st === 'wrong' ? 'bg-red-500/20 border-red-500/50 text-red-300'
                    : 'bg-white/5 border-white/10 text-slate-400'
                  }`}>
                    {st === 'correct' ? <CheckCircle2 size={18} /> : st === 'wrong' ? <XCircle size={18} /> : letters[oIdx]}
                  </span>
                  <span className="flex-1 font-bold text-base leading-snug">{String(option)}</span>
                </button>
              );
            })}
          </div>

          {/* SC power-ups bar */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="flex items-center mr-auto gap-1.5 px-3 py-2 rounded-xl bg-white/5 border border-white/10">
              <Coins size={14} className="text-amber-400" />
              <span className="text-xs font-black tabular-nums text-amber-300">{smartCoins} SC</span>
            </div>
            {!isLocked && (
              <>
                <button
                  onClick={useSkip}
                  disabled={smartCoins < powerups.skip}
                  className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-wide flex items-center gap-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <SkipForward size={14} /> Skip · {powerups.skip}
                </button>
                <button
                  onClick={useHint}
                  disabled={smartCoins < powerups.hint || showHint}
                  className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-wide flex items-center gap-1.5 hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
                >
                  <HelpCircle size={14} /> Hint · {powerups.hint}
                </button>
                <button
                  onClick={toggleStreakFreeze}
                  disabled={smartCoins < powerups.streakFreeze && !streakFreezeActive}
                  className={`px-3 py-2 rounded-xl border text-xs font-black uppercase tracking-wide flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed ${
                    streakFreezeActive
                      ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300'
                      : 'bg-white/5 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <Snowflake size={14} /> {streakFreezeActive ? 'Frozen' : 'Freeze'} · {powerups.streakFreeze}
                </button>
              </>
            )}
          </div>

          {showHint && !isLocked && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4 p-4 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-sm font-medium text-cyan-100"
            >
              <p className="text-[9px] font-black uppercase tracking-widest text-cyan-400 mb-1 flex items-center gap-1.5">
                <HelpCircle size={12} /> Hint
              </p>
              {q?.hint || q?.hints || 'Focus on the priority and the presenting signs to find the correct answer.'}
            </motion.div>
          )}

          {/* Confirm bar (pre-lock) */}
          <AnimatePresence>
            {!isLocked && selected && (
              <motion.div
                initial={{ y: 60, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 60, opacity: 0 }}
                className="sticky bottom-4 mt-6"
              >
                <button
                  onClick={() => confirmAnswer(selected)}
                  className="w-full py-4 sm:py-5 bg-amber-500 text-black rounded-2xl font-black uppercase tracking-[0.25em] text-xs sm:text-sm shadow-2xl shadow-amber-500/40 active:scale-95 transition-all"
                >
                  Confirm Answer
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---------- ONE-LOOK REVIEW ---------- */}
          <AnimatePresence>
            {isLocked && (
              <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-3">
                {/* Result banner */}
                <div className={`rounded-2xl p-4 sm:p-5 border-2 ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/40' : 'bg-red-500/10 border-red-500/40'}`}>
                  <div className="flex items-center gap-3">
                    {isCorrect ? (
                      <CheckCircle2 size={26} className="text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle size={26} className="text-red-400 shrink-0" />
                    )}
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-[0.3em] ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                        Result
                      </p>
                      <p className={`text-xl sm:text-2xl font-black tracking-tight uppercase ${isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isCorrect ? '✓ Correct' : timedOut ? '✕ Time Up' : '✕ Incorrect'}
                      </p>
                    </div>
                  </div>
                </div>

                {instant ? (
                  <>
                    {/* Your Answer */}
                    <ReviewCard label="Your Answer" tone={isCorrect ? 'good' : 'bad'}>
                      → {lockedAnswer || 'No answer submitted'}
                    </ReviewCard>

                    {!isCorrect && (
                      <ReviewCard label="Correct Answer" tone="good">
                        → {q.correctAnswer}
                      </ReviewCard>
                    )}

                    {isCorrect ? (
                      <ReviewCard label="Why You Got It Right" tone="neutral" icon={<CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />}>
                        {q.rationale || 'Strong clinical judgment — you prioritized correctly based on the presented findings.'}
                      </ReviewCard>
                    ) : (
                      <>
                        <ReviewCard label="Conceptual Misalignment" tone="bad" icon={<AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />}>
                          {timedOut
                            ? `Time expired before an answer was submitted. The priority here is "${q.correctAnswer}". ${q.hint || ''}`
                            : `Your selection addresses "${lockedAnswer}", but the priority in this situation is "${q.correctAnswer}". ${q.hint || ''}`}
                        </ReviewCard>
                        <ReviewCard label="Why the Correct Answer" tone="neutral" icon={<TargetIcon />}>
                          {q.rationale || 'Nurses must apply critical thinking and clinical protocols to ensure patient safety and prioritize airway, breathing, and circulation.'}
                        </ReviewCard>
                      </>
                    )}
                  </>
                ) : (
                  /* Exam mode: simple indicator only — full review at end */
                  <div className="rounded-2xl p-4 bg-slate-900/60 border border-white/10 text-center">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Exam Mode</p>
                    <p className="text-sm font-bold text-slate-200 mt-1">
                      {isCorrect ? 'Answer recorded ✓' : `Noted — the correct answer is "${q.correctAnswer}"`}
                    </p>
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mt-1">
                      Full review with rationales at the end of the session
                    </p>
                  </div>
                )}

                {/* How was this question? */}
                <div className="rounded-2xl p-4 bg-slate-900/40 border border-white/10">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center mb-3">How was this question?</p>
                  {feedbackSaved ? (
                    <p className="text-center text-[11px] font-black uppercase tracking-widest text-emerald-400 !italic">
                      Feedback recorded ✓
                    </p>
                  ) : (
                    <div className="flex gap-2 justify-center">
                      <button
                        onClick={() => { setFeedback('good'); setShowReason(false); }}
                        className={`flex-1 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 ${
                          feedback === 'good' ? 'bg-emerald-500 text-black' : 'bg-white/10 text-slate-300 hover:bg-white/20'
                        }`}
                      >
                        👍 Good Question
                      </button>
                      <button
                        onClick={() => { setFeedback('bad'); setShowReason(true); }}
                        className={`flex-1 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 ${
                          feedback === 'bad' ? 'bg-red-500 text-black' : 'bg-white/10 text-slate-300 hover:bg-white/20'
                        }`}
                      >
                        👎 Report Issue
                      </button>
                    </div>
                  )}

                  {showReason && !feedbackSaved && (
                    <div className="mt-3">
                      <input
                        value={feedbackReason}
                        onChange={(e) => setFeedbackReason(e.target.value)}
                        placeholder="Tell us what went wrong (optional)..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-slate-200 placeholder-slate-500 outline-none"
                        maxLength={300}
                      />
                    </div>
                  )}

                  {feedback && !feedbackSaved && (
                    <button
                      onClick={submitFeedback}
                      className="w-full mt-3 py-2.5 rounded-xl bg-medical-600 text-white font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-500/20 active:scale-95 transition-all"
                    >
                      Save Feedback
                    </button>
                  )}
                </div>

                {/* Next */}
                <button
                  onClick={nextQuestion}
                  className="w-full py-4 sm:py-5 mt-2 bg-white text-slate-900 rounded-2xl font-black uppercase tracking-[0.25em] text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3"
                >
                  {isLast ? 'View Results' : 'Next Question'} <ArrowRight size={16} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <p className="relative z-10 text-center text-[9px] font-black uppercase tracking-[0.3em] text-slate-600 mt-8">{modeLabel}</p>
      </div>

      {/* Quit Modal */}
      <AnimatePresence>
        {showQuitModal && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="relative p-6 sm:p-10 rounded-3xl sm:rounded-[3rem] shadow-2xl border bg-slate-900 border-white/20 text-center max-w-sm"
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-amber-500/20 text-amber-400 rounded-2xl sm:rounded-[2rem] flex items-center justify-center mx-auto mb-6 sm:mb-8">
                <AlertCircle size={32} className="sm:w-10 sm:h-10" />
              </div>
              <h4 className="text-xl sm:text-2xl font-black mb-3 text-white">Exit Quiz?</h4>
              <p className="text-slate-300 font-medium italic text-base leading-relaxed mb-8">
                "Every skipped challenge is a missed opportunity to strengthen your clinical judgment."
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => setShowQuitModal(false)}
                  className="w-full py-4 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-500/20 active:scale-95 transition-all"
                >
                  Stay and Master
                </button>
                <button
                  onClick={onQuit}
                  className="w-full py-3 text-slate-400 hover:text-red-400 font-black uppercase tracking-widest text-[9px] transition-colors"
                >
                  Exit for now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

const TargetIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-medical-400 shrink-0 mt-0.5">
    <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" />
  </svg>
);

const ReviewCard = ({ label, tone, icon, children }) => {
  const tones = {
    good: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-100',
    bad: 'bg-red-500/5 border-red-500/20 text-red-100',
    neutral: 'bg-white/5 border-white/10 text-slate-200'
  };
  const labelTone = {
    good: 'text-emerald-400',
    bad: 'text-red-400',
    neutral: 'text-medical-400'
  };
  return (
    <div className={`rounded-2xl p-4 sm:p-5 border ${tones[tone]}`}>
      <div className="flex items-start gap-2">
        {icon}
        <div className="min-w-0">
          <p className={`text-[9px] sm:text-[10px] font-black uppercase tracking-widest mb-1.5 ${labelTone[tone]}`}>{label}</p>
          <p className="text-sm font-medium leading-relaxed break-words">{children}</p>
        </div>
      </div>
    </div>
  );
};

export default React.memo(QuizPlayer);
