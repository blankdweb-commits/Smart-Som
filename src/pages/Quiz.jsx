import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Brain,
  Timer,
  Zap,
  Target,
  Trophy,
  Shield,
  BookOpen,
  Heart,
  Lock
} from '../components/Icons';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import QuizSetupFlow, { QUIZ_CONFIGS, LEVEL_SUBJECTS } from '../components/QuizSetupFlow';
import QuizPlayer from '../components/QuizPlayer';
import { useQuizBatch } from '../hooks/useQuizBatch';
import { generateUuid } from '../utils/safeStorage';

// Maps setup-flow quiz ids to engine mode ids.
const SETUP_TO_MODE = {
  'clinical-challenge': 'nclex',
  'quick-quiz': 'nmcn',
  'uselu-test': 'uselu',
  'nursing-200': 'nursing200',
  'midwifery-200': 'midwifery',
  'nursing-300': 'nursing300',
  'midwifery-300': 'midwifery300',
  'midwifery-200-s2': 'midwifery200s2',
  'weakness-challenge': 'weakness'
};
const MODE_TO_SETUP = {
  nclex: 'clinical-challenge',
  nmcn: 'quick-quiz',
  uselu: 'uselu-test',
  nursing200: 'nursing-200',
  midwifery: 'midwifery-200',
  nursing300: 'nursing-300',
  midwifery300: 'midwifery-300',
  midwifery200s2: 'midwifery-200-s2',
  weakness: 'weakness-challenge'
};

const PLAYER_MODE_LABELS = {
  nclex: 'NCLEX',
  nmcn: 'NMCN',
  uselu: 'Uselu Test Questions',
  nursing200: 'Nursing 200-Level',
  midwifery: 'Midwifery 200-Level',
  nursing300: 'Nursing 300-Level',
  midwifery300: 'Midwifery 300-Level',
  midwifery200s2: 'Midwifery 200-Level · 2nd Semester',
  weakness: 'Fix My Weak Areas'
};

// Human-friendly course name for the cooldown dialog.
const courseLabel = (engineMode, cfg) => {
  if (cfg?.subject) return cfg.subject;
  if (cfg?.courseKey && !/^[a-z0-9-]+:(both|nmcn|nclex)$/.test(cfg.courseKey)) return cfg.courseKey;
  return PLAYER_MODE_LABELS[engineMode] || cfg?.courseKey || 'this course';
};

const fmtClock = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

// Composite server-side course keys (mirrors CourseList.jsx):
//   - NCLEX / NMCN are framework-dedicated (Clinical->nclex, Quick Quiz->nmcn).
//   - 200/300-Level banks are per SUBJECT (<courseId>:<subject>).
//   - Uselu / Weakness / Daily Challenge use the bare course id.
const statusKey = (courseId, subject) => {
  if (subject) return `${courseId}:${subject}`;
  if (courseId === 'clinical-challenge') return `${courseId}:nclex`;
  if (courseId === 'quick-quiz') return `${courseId}:nmcn`;
  return courseId;
};

// Course-row selection state. Server-authoritative ONLY: what the quota RPC
// returned decides everything; the local clock is never allowed to unlock a
// locked course (unlock requires a refetch where the server says is_ready).
// FAIL-CLOSED: 'idle' (no fetch yet) and 'loading' stay NON-selectable, and a
// failed status fetch ('error') keeps the row NON-selectable with a retry —
// unknown availability must never look startable.
const ROW_STATE = { AVAILABLE: 'AVAILABLE', COOLDOWN: 'COOLDOWN', LOADING: 'LOADING', ERROR: 'ERROR' };

const rowState = (courseId, subject, courseQuota, quotaStatus, isPremium) => {
  if (isPremium) return { state: ROW_STATE.AVAILABLE, expiresAt: null };
  if (quotaStatus === 'idle' || quotaStatus === 'loading') {
    // No authoritative map yet (or re-fetch in flight): not selectable. If we
    // already hold last-known data AND a fetch is in flight we still trust the
    // last map below — but with NO map there is nothing safe to unlock on.
    if (!courseQuota || Object.keys(courseQuota).length === 0) {
      return { state: ROW_STATE.LOADING, expiresAt: null };
    }
  }
  if (quotaStatus === 'error') return { state: ROW_STATE.ERROR, expiresAt: null };
  const row = (courseQuota || {})[statusKey(courseId, subject)] || null;
  if (!row) return { state: ROW_STATE.AVAILABLE, expiresAt: null };
  if (row.is_ready === true) return { state: ROW_STATE.AVAILABLE, expiresAt: null };
  // Window in the past with is_ready still false = stale map; stays locked until
  // the refetch-on-expiry effect refreshes it (local clock never unlocks).
  return { state: ROW_STATE.COOLDOWN, expiresAt: row.window_expires_at || null };
};

// ----- Bundled local audio manager (Part 20) -----
// Replaces the old Supabase-hosted / remote-dependent sound system. All clips
// ship in /public/audio and are played through the shared AudioManager, which
// is created once (module singleton) and hardened against failures.
import { audioManager } from '../utils/audio';
import { useQuizAudio } from '../hooks/useQuizAudio';

// Single-clip events played directly from the manager (intro/exit/correct/wrong).
const playQuizSound = (type) => audioManager.play(type);

const exitFullscreen = async () => {
  try {
    const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) {
      await exitFs.call(document);
    }
  } catch (err) {
    console.warn("Exit fullscreen failed", err);
  }
};

// ----- Main Quiz Component -----
// Difficulty tiers are module constants so they stay a single stable reference
// for the readiness computation and deep-link handling.
const DIFFICULTY_TIERS = [
  { id: 'Easy', dot: 'bg-emerald-500', ring: 'border-emerald-500/30', label: 'Build your foundation', passMark: 50, unlock: null },
  { id: 'Moderate', dot: 'bg-blue-500', ring: 'border-blue-500/30', label: 'Test your understanding', passMark: 60, unlock: null },
  { id: 'Hard', dot: 'bg-orange-500', ring: 'border-orange-500/30', label: 'Challenge your clinical reasoning', passMark: 70, unlock: null },
  { id: 'Expert', dot: 'bg-red-500', ring: 'border-red-500/30', label: 'Deeper clinical reasoning', passMark: 75, unlock: { from: 'Hard', count: 3 } },
  { id: 'Master', dot: 'bg-purple-500', ring: 'border-purple-500/30', label: 'Advanced examination scenarios', passMark: 80, unlock: { from: 'Expert', count: 10 } },
  { id: 'Extreme', dot: 'bg-slate-900 dark:bg-white', ring: 'border-slate-500/30', label: 'The hardest questions we have', passMark: 85, unlock: { from: 'Master', count: 14 } }
];

// ----- Course directory for the level selector -----
// Levels are shown first (one compact row each); the remaining quiz modes sit
// in a slim "Other Modes" group below. Course/subject picking happens INSIDE
// the setup flow — the directory never renders individual courses on this page.
const MODE_STYLE = {
  'clinical-challenge': { icon: <Shield size={20} />, chip: 'bg-medical-500/10 text-medical-500' },
  'quick-quiz': { icon: <Zap size={20} />, chip: 'bg-amber-500/10 text-amber-500' },
  'uselu-test': { icon: <Target size={20} />, chip: 'bg-indigo-500/10 text-indigo-500' },
  'weakness-challenge': { icon: <Target size={20} />, chip: 'bg-rose-500/10 text-rose-500' },
  'nursing-200': { icon: <BookOpen size={20} />, chip: 'bg-emerald-500/10 text-emerald-500' },
  'midwifery-200': { icon: <Heart size={20} />, chip: 'bg-pink-500/10 text-pink-500' },
  'nursing-300': { icon: <BookOpen size={20} />, chip: 'bg-teal-500/10 text-teal-500' },
  'midwifery-300': { icon: <Heart size={20} />, chip: 'bg-rose-500/10 text-rose-500' },
  'midwifery-200-s2': { icon: <Heart size={20} />, chip: 'bg-fuchsia-500/10 text-fuchsia-500' }
};

// Display order — levels first, then the remaining quiz modes.
const QUIZ_LEVEL_ORDER = ['nursing-200', 'midwifery-200', 'nursing-300', 'midwifery-300', 'midwifery-200-s2'];
const OTHER_MODE_ORDER = ['clinical-challenge', 'quick-quiz', 'uselu-test', 'weakness-challenge'];

const courseCount = (bankId) => (LEVEL_SUBJECTS[bankId] || []).length;

// Live ticking clock so cooldown chips count down in real time. Re-renders the
// host once a second for as long as it stays mounted.
const useNow = () => {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
};

const formatRemaining = (seconds) => {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
};

// Status chip — rendered ONLY on AVAILABLE rows (premium "Unlimited" / free
// "Ready"). Locked rows render the LockBadge instead, never a ready-looking pill.
const StatusChip = ({ premium }) => (
  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-widest">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {premium ? 'Unlimited' : 'Ready'}
  </span>
);

// Ticking cooldown pill on a NON-selectable course card. Display-only: the card
// stays locked and unlocking is driven by a server refetch, never this clock.
const CooldownPill = ({ expiresAt }) => {
  const now = useNow();
  const remainingSec = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-widest tabular-nums">
      <Lock size={10} /> On cooldown · {formatRemaining(remainingSec)}
    </span>
  );
};

// Full-view overlay shown INSTEAD of the directory when a free user taps a
// cooling course (or a deep link resolves to one). Nothing here can open setup:
// the ONLY "Open this course" path requires rowState() === AVAILABLE, which is
// decided purely by the server's quota map, never the local clock.
const CourseLockOverlay = ({ lock, courseQuota, quotaStatus, isPremium, onOpen, onRetry, onClose, onGoPremium }) => {
  const now = useNow();
  const st = rowState(lock.setupId, lock.subject, courseQuota, quotaStatus, isPremium);
  const title = lock.setupId && QUIZ_CONFIGS[lock.setupId] ? QUIZ_CONFIGS[lock.setupId].title : 'this course';
  const label = lock.subject || title;
  const expiresAt = st.state === ROW_STATE.COOLDOWN && st.expiresAt ? new Date(st.expiresAt).getTime() : null;
  const remainingSec = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : 0;
  const isError = st.state === ROW_STATE.ERROR;
  const isCooling = st.state === ROW_STATE.COOLDOWN && remainingSec > 0;
  const isVerifying = st.state === ROW_STATE.LOADING || (st.state === ROW_STATE.COOLDOWN && remainingSec <= 0);
  const isReady = st.state === ROW_STATE.AVAILABLE;
  const statusTitle = isReady ? 'Your next round is ready' : isError ? "We couldn't verify this course's availability" : isVerifying ? 'Checking availability…' : 'Course on cooldown';
  const iconBg = isReady ? 'bg-emerald-100 dark:bg-emerald-900/40' : isError ? 'bg-slate-100 dark:bg-slate-800' : isVerifying ? 'bg-slate-100 dark:bg-slate-800' : 'bg-amber-100 dark:bg-amber-900/40';
  const iconColor = isReady ? 'text-emerald-600 dark:text-emerald-400' : isError ? 'text-slate-500 dark:text-slate-300' : isVerifying ? 'text-slate-500 dark:text-slate-300' : 'text-amber-600 dark:text-amber-400';

  return (
    <div className="min-h-[70vh] max-w-md mx-auto px-4 pt-10 flex items-center justify-center animate-in fade-in">
      <div className="w-full text-center bg-white dark:bg-slate-800 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 p-6 sm:p-8">
        <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5 ${iconBg}`}>
          {isReady ? <Zap className={`w-8 h-8 ${iconColor}`} /> : <Lock className={`w-8 h-8 ${iconColor}`} />}
        </div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">{statusTitle}</h2>
        <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-4">
          {isReady ? (
            <>Fresh round for <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span> is available.</>
          ) : isError ? (
            <>We couldn't verify this course's availability. Please try again. We never unlock a course we cannot verify.</>
          ) : isVerifying ? (
            <>We're checking with the server whether <span className="font-semibold text-slate-700 dark:text-slate-200">{label}</span> is ready yet. Please stand by…</>
          ) : (
            <>This course is on cooldown. It will become available in{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">{fmtClock(remainingSec)}</span>.
              Free plan: one 10-question round per course, then a 30-minute cooldown.</>
          )}
        </p>
        <div className="grid gap-2.5 mt-5">
          {isReady && (
            <button type="button" onClick={onOpen} className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors">
              Open this course
            </button>
          )}
          {isVerifying && (
            <button type="button" disabled className="w-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-semibold py-3.5 rounded-xl cursor-wait">
              Checking availability…
            </button>
          )}
          {isError && (
            <button type="button" onClick={onRetry} className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors">
              🔄 Retry
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={isCooling ? "w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors" : "w-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-3.5 rounded-xl transition-colors"}
          >
            🔄 Try another course
          </button>
        </div>
        {!isReady && !isError && (
          <button type="button" onClick={onGoPremium} className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 py-2 hover:underline">
            ⭐ Go Premium — unlimited rounds
          </button>
        )}
      </div>
    </div>
  );
};

const DirectoryRow = ({ bankId, index = 0, onLaunch, onBlocked, courseQuota, quotaStatus, isPremium }) => {
  const style = MODE_STYLE[bankId];
  const title = QUIZ_CONFIGS[bankId].title;
  const count = courseCount(bankId);
  const subjects = LEVEL_SUBJECTS[bankId] || [];

  // Aggregate row state. Any ready subject keeps the PARENT selectable
  // (per-course isolation); otherwise the soonest cooldown expiry wins.
  const states = subjects.length > 0
    ? subjects.map(s => rowState(bankId, s, courseQuota, quotaStatus, isPremium))
    : [rowState(bankId, null, courseQuota, quotaStatus, isPremium)];
  const parentState = states.some(st => st.state === ROW_STATE.AVAILABLE)
    ? ROW_STATE.AVAILABLE
    : states.some(st => st.state === ROW_STATE.COOLDOWN)
      ? ROW_STATE.COOLDOWN
      : states.some(st => st.state === ROW_STATE.ERROR)
        ? ROW_STATE.ERROR
        : ROW_STATE.LOADING;
  const cooldownExpiry = states
    .filter(st => st.state === ROW_STATE.COOLDOWN && st.expiresAt)
    .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt))[0]?.expiresAt || null;

  const lockMeta = {
    [ROW_STATE.COOLDOWN]: {
      icon: <Lock size={20} />,
      pill: cooldownExpiry ? <CooldownPill expiresAt={cooldownExpiry} /> : null,
      overlayTitle: 'Course on cooldown',
      overlayBody: isPremium
        ? null
        : 'This course is on cooldown. It will become available when the cooldown ends. Free plan: one 10-question round per course, then a 30-minute cooldown.'
    },
    [ROW_STATE.LOADING]: {
      icon: <Timer size={20} />,
      pill: <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" /> Checking availability…
      </span>,
      overlayTitle: 'Checking availability…',
      overlayBody: 'We are confirming this course’s availability from the server before letting you in.'
    },
    [ROW_STATE.ERROR]: {
      icon: <Lock size={20} />,
      pill: <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-500/10 border border-slate-500/30 text-slate-500 dark:text-slate-400 text-[10px] font-black uppercase tracking-widest">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Couldn't verify
      </span>,
      overlayTitle: "We couldn't verify this course's availability",
      overlayBody: 'Please try again. We never unlock a course we cannot verify.'
    }
  }[parentState] || {
    icon: style.icon,
    pill: null,
    overlayTitle: null,
    overlayBody: null
  };

  if (parentState !== ROW_STATE.AVAILABLE) {
    return (
      <button
        type="button"
        aria-disabled="true"
        tabIndex={-1}
        onClick={() => onBlocked(bankId)}
        title={lockMeta.overlayTitle}
        className="w-full flex items-center gap-3 p-3 sm:p-4 text-left rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm opacity-70 cursor-not-allowed select-none"
      >
        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 ${style.chip}`}>
          {lockMeta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] sm:text-base font-black text-slate-900 dark:text-white tracking-tight leading-snug break-words">
            {title}
          </h3>
          {(count > 0 || lockMeta.pill) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
              {count > 0 && (
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300 tabular-nums">
                  {count} courses
                </span>
              )}
              {lockMeta.pill}
            </div>
          )}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onLaunch(bankId)}
      className="quiz-card-entrance w-full flex items-center gap-3 p-3 sm:p-4 text-left rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 active:scale-[0.98] transition-all"
      style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}
    >
      <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl flex items-center justify-center shrink-0 ${style.chip}`}>
        {style.icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[15px] sm:text-base font-black text-slate-900 dark:text-white tracking-tight leading-snug break-words">
          {title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          {count > 0 && (
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-300 tabular-nums">
              {count} courses
            </span>
          )}
          <StatusChip premium={isPremium} />
        </div>
      </div>
    </button>
  );
};

const Quiz = () => {
  const { flashcards, updateQuizStats } = useAppContext();
  const { unlock: unlockAudio, preload: preloadAudio, playIntro, manager: audioRef } = useQuizAudio();
  const introHandledRef = React.useRef(false);
  const navigate = useNavigate();
  const [secretTaps, setSecretTaps] = useState(0);

  // Server-authoritative batch system
  const { createBatch, recordAnswer, completeBatch } = useQuizBatch();

  // ----- Guided setup flow + immersive player (Clinical / Quick / Uselu) -----
  const [setupType, setSetupType] = useState(null);        // 'clinical-challenge' | 'quick-quiz' | 'uselu-test'
  const [presetDifficulty, setPresetDifficulty] = useState(null); // deep-linked difficulty
  const [presetSubject, setPresetSubject] = useState(null); // deep-linked subject
  const [groupQuizId, setGroupQuizId] = useState(null); // deep-linked study group id
  const [playerActive, setPlayerActive] = useState(false);
  const [activeConfig, setActiveConfig] = useState(null);  // config from QuizSetupFlow
  const [playerResult, setPlayerResult] = useState(null);  // { score, total, answers[], durationSeconds }
  const [activeQuestions, setActiveQuestions] = useState([]);
  // Per-course round gate: shown when a free user's round for this course is
  // still cooling down (server-authoritative result from consumeCourseQuota).
  const [cooldownNotice, setCooldownNotice] = useState(null); // { courseKey, label, seconds, engineMode, cfg }
  const [quizNote, setQuizNote] = useState(null); // content-gap fallback notice (subject has no questions yet)
  const pendingLaunchRef = React.useRef(null); // keeps the original engineMode/cfg for the "Start now" retry
  // Server re-verification of the cooldown expiry. The client countdown is
  // DISPLAY ONLY — when it reaches zero the frontend refetches authoritative
  // quota status and only then enables "Start round now".
  const [cooldownVerifying, setCooldownVerifying] = useState(false); // re-check in flight
  const [cooldownVerified, setCooldownVerified] = useState(null); // { forExpiresAt, ready } — server answer for one window

  // COURSE-LEVEL COOLDOWN LOCK: a free user must NOT open Quiz Setup for a
  // course while it is cooling. Replace the directory with an explanatory
  // overlay instead. Also set by deep links that resolve to a locked course.
  // { setupId, subject, difficulty }
  const [selectionLock, setSelectionLock] = useState(null);
  // Deferred deep-link intent — a URL may NEVER open setup around a cooldown;
  // resolution waits for the authoritative quota map, then opens or locks.
  const [deepLinkIntent, setDeepLinkIntent] = useState(null);
  const deepLinkResolvedRef = React.useRef(false);

  // In-flight guard: prevents a double-click / rapid retry from firing a second
  // batch-create while the first is still in flight. The server's idempotency
  // key is the second line of defense (same roundId -> no double charge).
  const launchInFlightRef = React.useRef(false);
  // Per-round idempotency key, stable for the lifetime of one quiz session so a
  // refresh / retry / replay of the SAME start cannot register as a new charge.
  const attemptIdRef = React.useRef(null);

  // ----- Difficulty progression -----
  const { recordQuizResult, recordWrongAnswers, learningAnalytics, userProfile, loadingAuth, smartCoins, fetchSCRank, studyStats, levelCompletions, session, fetchQuestionHistory, isPremium, fetchCourseQuotaStatus, courseQuota, quotaFetchStatus } = useAppContext();
  const [selectedDifficulty, setSelectedDifficulty] = useState(null);
  const [globalRank, setGlobalRank] = useState(null);

  // Load the live SC global rank once (lightweight, non-blocking).
  React.useEffect(() => {
    let active = true;
    fetchSCRank().then(rank => { if (active) setGlobalRank(rank); });
    return () => { active = false; };
  }, [fetchSCRank]);

  const weakConceptNames = React.useMemo(() => {
    const names = new Set();
    (learningAnalytics.weakConcepts || []).forEach(w => {
      if (w?.name) names.add(String(w.name).trim().toLowerCase());
      if (w?.subject) names.add(String(w.subject).trim().toLowerCase());
    });
    return names;
  }, [learningAnalytics.weakConcepts]);

  // Learner selection state — the scored no-repetition engine's input.
  // { attemptedIds: Set, questionHistory: Map, nicheCounts: Map, weakNiches: Set }
  const selectionStateRef = React.useRef({
    attemptedIds: new Set(),
    questionHistory: new Map(),
    nicheCounts: new Map(),
    weakNiches: new Set()
  });
  const refreshSelectionState = React.useCallback(async () => {
    const history = await fetchQuestionHistory();
    selectionStateRef.current = {
      ...history,
      weakNiches: weakConceptNames
    };
    return history;
  }, [fetchQuestionHistory, weakConceptNames]);
  React.useEffect(() => {
    if (session?.user) refreshSelectionState();
  }, [session?.user, refreshSelectionState]);

  // Refresh the per-course quota map whenever the learner changes, so the
  // Course List chips stay accurate.
  React.useEffect(() => {
    if (session?.user) fetchCourseQuotaStatus();
  }, [session?.user, fetchCourseQuotaStatus]);

  // Soonest cooldown expiry across all directory/level rows. LOCAL CLOCK IS
  // DISPLAY-ONLY: crossing it merely triggers a server refetch (below) and the
  // course unlocks only when the fresh map says is_ready.
  const directoryCooldownExpiry = React.useMemo(() => {
    if (isPremium) return null;
    const times = [];
    (courseQuota && typeof courseQuota === 'object' ? Object.entries(courseQuota) : []).forEach(([, row]) => {
      if (row && row.is_ready === false && row.window_expires_at) times.push(new Date(row.window_expires_at).getTime());
    });
    return times.length ? Math.min(...times) : null;
  }, [courseQuota, isPremium]);

  // Refetch-on-expiry: when the displayed countdown hits zero the frontend asks
  // the SERVER for fresh status. 'ok' maps + a future/absent expiry = waiting;
  // a crossed expiry = refetch. Failure leaves the row(s) in ERROR (locked).
  React.useEffect(() => {
    if (!session?.user || quotaFetchStatus !== 'ok') return;
    if (directoryCooldownExpiry === null) return;
    if (Date.now() >= directoryCooldownExpiry) {
      fetchCourseQuotaStatus();
    }
  }, [directoryCooldownExpiry, quotaFetchStatus, session?.user, fetchCourseQuotaStatus]);
  const [passInfo, setPassInfo] = useState(null); // { passed, pct }
  const wrongAnswersRef = React.useRef([]);
  const quizStartRef = React.useRef(null);
  const resultRecordedRef = React.useRef(false);
  const [weaknessIntentHandled, setWeaknessIntentHandled] = useState(false);

  // Exam Readiness score (0-100) derived from real learning data — display only.
  const readiness = React.useMemo(() => {
    const passedTiers = DIFFICULTY_TIERS.filter(t => (levelCompletions || {})[t.id]).length;
    const totalAttempts = (learningAnalytics && learningAnalytics.totalAttempts) || 0;
    const weakCount = ((learningAnalytics && learningAnalytics.weakConcepts) || []).length;
    const quizStreak = (studyStats && studyStats.quizStreak) || 0;
    const dayStreak = (studyStats && studyStats.streak) || 0;

    let score = 0;
    score += Math.min(50, (passedTiers / DIFFICULTY_TIERS.length) * 50); // up to 50 from passed tiers
    score += Math.min(20, totalAttempts * 0.5);                          // up to 20 from volume
    score += Math.min(15, quizStreak * 3);                               // up to 15 from quiz streak
    score += Math.min(10, dayStreak * 1.5);                              // up to 10 from daily streak
    score -= Math.min(20, weakCount * 2.5);                              // weak concepts reduce readiness
    return Math.max(0, Math.min(100, Math.round(score)));
  }, [levelCompletions, learningAnalytics, studyStats]);

  // Deep-link support: /quiz?difficulty=Hard | ?subject= | ?practiceSubject=
  // | ?groupId= | ?weakness=1. URLs pre-load state and queue an INTENT — setup
  // is opened by the resolver below only after the authoritative quota map has
  // settled, so a cooldown can never be auto-bypassed through a URL.
  const [, setSearchParams] = useSearchParams();
  const SUBJECT_FILTERS = ['Pharmacology', 'Musculoskeletal', 'Neurological Nursing', 'Medical Surgical', 'Chemistry', 'Mental Health', 'Principles of Management and Teaching', 'Medical-Surgical Nursing II', 'Child Health', 'Home Health Care Nursing', 'Entrepreneurship in Midwifery', 'Community Health Nursing I', 'Fundamentals of Nursing', 'Medical-Surgical Nursing', 'Unit I: Introduction to Nutrition', 'Unit II: Nutritional Needs', 'Unit III: Food Planning, Preparation, and Safety', 'Pharmacology III', 'Concept of Politics and Government', 'Political Interaction', 'Political Activities', 'Reproductive Health', 'Research Methodology', 'Nutrition & Dietetics', 'Politics and Governance in Nursing'];
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('difficulty');
    if (d && DIFFICULTY_TIERS.some(t => t.id === d) && !selectedDifficulty) {
      setSelectedDifficulty(d);
      setPresetDifficulty(d);
    }
    let intent = null;
    const s = params.get('subject');
    if (s && SUBJECT_FILTERS.includes(s)) {
      intent = { setupId: 'clinical-challenge', subject: s };
      setPresetSubject(s);
    }
    // Deep-link from the Study Plan "Practice <weakest subject>" CTA: the course
    // that contains the subject, subject preselected. Falls back to Clinical.
    const ps = params.get('practiceSubject');
    if (ps) {
      const levelMatch = ['nursing-200', 'midwifery-200', 'nursing-300', 'midwifery-300', 'midwifery-200-s2']
        .find((key) => (LEVEL_SUBJECTS[key] || []).includes(ps));
      intent = { setupId: levelMatch || 'clinical-challenge', subject: ps };
      setPresetSubject(ps);
      setSelectedDifficulty(null);
    }
    // Deep-link from a study group: stamp results with the group_id for the
    // per-group quiz streak. Defaults to the Midwifery 200-Level setup.
    const g = params.get('groupId');
    if (g && /^\d+$/.test(g)) {
      setGroupQuizId(Number(g));
      if (!s && !ps) intent = intent || { setupId: 'midwifery-200', subject: null };
    }
    // Deep-link: /quiz?weakness=1 → Fix My Weak Areas (PAID — gated server-side).
    if (params.get('weakness')) {
      intent = { setupId: 'weakness-challenge', subject: null, requireActivated: true };
    }
    if (intent) {
      if (d) intent.difficulty = d;
      setDeepLinkIntent(intent);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve a deep-link intent once quota status is authoritative. Waits (fails
  // closed) while the map is loading; a cooling target shows the SAME selection
  // lock overlay instead of opening setup.
  React.useEffect(() => {
    if (!deepLinkIntent || deepLinkResolvedRef.current) return;
    if (loadingAuth) return;
    if (deepLinkIntent.requireActivated && !userProfile.isActivated && !weaknessIntentHandled) {
      deepLinkResolvedRef.current = true;
      setWeaknessIntentHandled(true);
      navigate('/activate');
      return;
    }
    if (quotaFetchStatus !== 'ok') return; // wait for the server's map
    deepLinkResolvedRef.current = true;
    const target = rowState(deepLinkIntent.setupId, deepLinkIntent.subject, courseQuota, quotaFetchStatus, isPremium);
    if (target.state === ROW_STATE.AVAILABLE) {
      openSetup(deepLinkIntent.setupId);
      if (deepLinkIntent.subject) setPresetSubject(deepLinkIntent.subject);
      if (deepLinkIntent.difficulty) {
        setSelectedDifficulty(deepLinkIntent.difficulty);
        setPresetDifficulty(deepLinkIntent.difficulty);
      }
    } else {
      setSelectionLock(deepLinkIntent);
    }
    if (deepLinkIntent.requireActivated) setWeaknessIntentHandled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkIntent, quotaFetchStatus, loadingAuth, isPremium, userProfile.isActivated, navigate]);

  useEffect(() => {
    return () => {
      exitFullscreen();
    };
  }, []);

  // ----- Guided Setup Flow handlers (Clinical / Quick / Uselu entry) -----

  const openSetup = (setupId) => {
    setSelectionLock(null);
    setSetupType(setupId);
    window.scrollTo({ top: 0 });
  };

  const cancelSetup = () => {
    setSetupType(null);
    setPresetDifficulty(null);
    setPresetSubject(null);
    attemptIdRef.current = null;
  };

  // A lock on the course is only lifted by the server map; clicking a locked
  // row just explains why (countdown/verify/error) instead of opening setup.
  const handleCourseBlocked = (bankId) => setSelectionLock({ setupId: bankId, subject: null });

  // Normalizes a card into a quiz question with shuffled (or synthesized) options.
  const boxCard = (card) => {
    if (Array.isArray(card.options) && card.options.length >= 2 && card.correctAnswer) {
      return {
        ...card,
        options: [...card.options].sort(() => 0.5 - Math.random()),
      };
    }
    const targetAnswer = card.answer || card.correctAnswer;
    const distractors = flashcards
      .filter(c => c.id !== card.id && (c.answer || c.correctAnswer) !== targetAnswer)
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map(c => c.answer || c.correctAnswer);
    const options = [targetAnswer, ...distractors].sort(() => 0.5 - Math.random());
    return { ...card, options, correctAnswer: targetAnswer };
  };

  // Launch player using server-authoritative batch selection.
  // The batch API handles: quota enforcement, question selection, and exposure tracking.
  const launchPlayer = async (engineMode, cfg) => {
    // Guard: ignore a second Start while one is still in flight (double-click).
    if (launchInFlightRef.current) return;
    launchInFlightRef.current = true;
    // Remember exactly what was launched so the cooldown modal's retries
    // ("Start round now" / "Try again") re-run the SAME server authorization —
    // never a client-side shortcut.
    pendingLaunchRef.current = { engineMode, cfg };
    try {
      await doLaunch(engineMode, cfg);
    } finally {
      launchInFlightRef.current = false;
    }
  };

  const doLaunch = async (engineMode, cfg) => {
    // Build the courseKey for the batch API
    const courseKey = cfg.courseKey || (cfg.subject ? `${SETUP_TO_MODE[setupType] || 'clinical'}:${cfg.subject}` : SETUP_TO_MODE[setupType] || 'clinical');

    // Determine mode for the batch API
    const batchMode = engineMode === 'weakness' ? 'weakness' :
                      engineMode === 'nclex' || engineMode === 'nmcn' ? engineMode :
                      'practice';

    // Determine exam framework from the dedicated mode (NCLEX/NMCN only).
    const examFramework = engineMode === 'nclex' ? 'NCLEX' :
                          engineMode === 'nmcn' ? 'NMCN' : null;

    // Idempotency key for this quiz session. Stable across refresh/retry of the
    // SAME round so a replayed start cannot double-charge the course round.
    if (!attemptIdRef.current) attemptIdRef.current = generateUuid();
    const attemptId = attemptIdRef.current;

    // Create the batch via server API (handles quota, selection, exposure)
    const result = await createBatch({
      mode: batchMode,
      courseKey,
      examFramework,
      batchSize: cfg.questionCount || 10,
      difficultyDistribution: cfg.difficulty ? { [cfg.difficulty]: cfg.questionCount || 10 } : undefined,
      subjectFilter: cfg.subject,
      attemptId,
    });

    if (!result?.success || !result?.batch) {
      // Batch creation failed — the server rejected the request. Read the typed
      // error directly from the createBatch result instead of state: React state
      // has not re-rendered yet at this point, so a state read here is stale.
      const info = result?.errorInfo || null;
      if (info?.code === 'DIFFICULTY_LOCKED') {
        setCooldownNotice({
          courseKey,
          label: courseLabel(engineMode, cfg),
          seconds: 0,
          engineMode,
          cfg,
          unavailable: true,
          type: 'locked',
          lockedDifficulty: info.lockedDifficulty,
          message: info.message,
        });
      } else if (info?.code === 'QUOTA_EXHAUSTED' || info?.code === 'COOLDOWN_ACTIVE' || info?.status === 403) {
        // Quota/cooldown (or any 403): show the cooldown modal with live timer.
        const remSecs = Number(info.cooldown_remaining_seconds) || 0;
        const expiresAt = info.window_expires_at
          ? new Date(info.window_expires_at).getTime()
          : Date.now() + remSecs * 1000;
        setCooldownNotice({
          courseKey,
          label: courseLabel(engineMode, cfg),
          seconds: remSecs,
          expiresAt,
          engineMode,
          cfg,
          unavailable: false,
          type: 'cooldown',
        });
      } else {
        // Unexpected failure (network error, gateway problem, server 500, ...).
        // Show a calm generic message; log the technical diagnosis to the dev
        // console only — never dump response bodies or auth material to the UI.
        console.error('[Quiz] Batch create failed', {
          status: info?.status ?? null,
          code: info?.code ?? null,
          message: info?.message ?? null,
          courseKey,
          batchMode,
        });
        setCooldownNotice({
          courseKey,
          label: courseLabel(engineMode, cfg),
          seconds: 0,
          engineMode,
          cfg,
          unavailable: true,
          type: 'error',
          message: info?.code === 'NETWORK_ERROR'
            ? 'Network connection failed. Check your connection and try again.'
            : info?.code === 'API_MISROUTED'
              ? 'The API is not responding on this deployment yet. Please try again shortly.'
              : info?.code === 'UNAUTHORIZED'
                ? 'Your session expired. Please sign in again.'
                : "We couldn't start this quiz right now. Please try again.",
        });
      }
      return;
    }

    // Process questions through boxCard for option shuffling
    const questions = (result.questions || []).map(q => boxCard(q));
    if (questions.length === 0) return;

    setCooldownNotice(null);
    setCooldownVerified(null);
    setCooldownVerifying(false);
    pendingLaunchRef.current = null;
    setQuizNote(result.meta?.fallbackNote?.note || null);
    setActiveConfig({ ...cfg, engineMode, batchId: result.batch.id });
    setActiveQuestions(questions);
    setPlayerResult(null);
    setPassInfo(null);
    wrongAnswersRef.current = [];
    resultRecordedRef.current = false;
    quizStartRef.current = Date.now();

    // Audio (Part 20/23): the START gesture is when we unlock autoplay and
    // preload the local pool. Intro plays once per quiz start — not on every
    // render, not on StrictMode re-runs.
    if (!introHandledRef.current) {
      introHandledRef.current = true;
      unlockAudio();
      preloadAudio();
      playIntro();
    }

    setPlayerActive(true);
    setSetupType(null);
    exitFullscreen();
    window.scrollTo({ top: 0 });
  };

  const handleSetupComplete = (cfg) => {
    const engineMode = SETUP_TO_MODE[setupType] || 'clinical';
    launchPlayer(engineMode, cfg);
  };

  const handlePlayerComplete = async (result) => {
    setPlayerActive(false);
    document.body.classList.remove('quiz-active');
    setPlayerResult(result);
    setQuizNote(null);
    // A finished session allows the next Start to replay the intro sound once.
    introHandledRef.current = false;
    // The round is over — the next Start mints a NEW idempotency key so a
    // legitimate new round is not mistaken for a replay of this one.
    attemptIdRef.current = null;

    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;

    // Complete the batch on the server (records final score, updates history)
    if (activeConfig?.batchId) {
      try {
        await completeBatch();
      } catch (err) {
        console.warn('Batch completion error:', err);
      }
    }

    // Record quiz result for progress tracking
    if (activeConfig?.difficulty) {
      recordQuizResult({
        mode: activeConfig.engineMode,
        difficulty: activeConfig.difficulty,
        subject: activeConfig.subject || 'Mixed Bank',
        score: result.score,
        total: result.total,
        durationSeconds: result.durationSeconds,
        groupId: groupQuizId
      }).then(passed => setPassInfo({ passed, pct }));
    } else {
      setPassInfo({ passed: null, pct });
    }

    const wrongs = (result.answers || [])
      .filter(a => !a.isCorrect)
      .map(a => ({
        name: a.subject || 'General',
        subject: a.subject || 'General',
        question: a.question
      }));
    if (wrongs.length > 0) {
      recordWrongAnswers(wrongs);
      updateQuizStats({});
    }

    // Refresh the selection state so the next session starts fresh.
    await refreshSelectionState();
    await fetchCourseQuotaStatus();
  };

  const quitPlayer = () => {
    setPlayerActive(false);
    setActiveConfig(null);
    setActiveQuestions([]);
    setQuizNote(null);
    document.body.classList.remove('quiz-active');
    // Exit music already started when the Quit dialog opened (in QuizPlayer).
    // On a real exit let it ring out ~2s longer before stopping.
    audioRef.scheduleExitStop(2000);
    // Allow intro to replay on the next Start gesture.
    introHandledRef.current = false;
    // Refresh quota since the round was consumed
    fetchCourseQuotaStatus();
  };

  const backToModes = () => {
    setPlayerActive(false);
    setActiveConfig(null);
    setActiveQuestions([]);
    setPlayerResult(null);
    setPresetDifficulty(null);
    setPresetSubject(null);
    document.body.classList.remove('quiz-active');
    introHandledRef.current = false;
    // Leaving the player (abandon) = the round is over: the next Start is a NEW
    // round, so mint a fresh idempotency key (never reuse an old reservation id).
    attemptIdRef.current = null;
    // Refresh quota since the round was consumed
    fetchCourseQuotaStatus();
  };

  const retrySameSession = () => {
    if (!activeConfig) return;
    const { engineMode, ...cfg } = activeConfig;
    // FAIL-CLOSED retry: this re-runs the full server batch-create with the
    // SAME idempotency key (attemptIdRef), so the server re-authorizes quota/
    // cooldown and cannot double-charge the round. There is NO skip-quota path.
    launchPlayer(engineMode, cfg);
  };

  const editSessionSetup = () => {
    setPlayerResult(null);
    if (activeConfig?.engineMode) {
      setSetupType(MODE_TO_SETUP[activeConfig.engineMode] || 'clinical-challenge');
    } else {
      setSetupType('clinical-challenge');
    }
  };

  // Immersive mode hides bottom navigation for the new-flow quizzes.
  React.useEffect(() => {
    if (playerActive) {
      document.body.classList.add('quiz-active');
    } else {
      document.body.classList.remove('quiz-active');
    }
    return () => document.body.classList.remove('quiz-active');
  }, [playerActive]);

  // --- Render start ---

  // Per-course round cooldown (free users): show the centered gate before
  // anything else so the learner knows exactly when their next round is ready.
  const [tickNow, setTickNow] = useState(Date.now());
  React.useEffect(() => {
    if (!cooldownNotice || cooldownNotice.unavailable) return undefined;
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldownNotice && cooldownNotice.expiresAt, cooldownNotice && cooldownNotice.unavailable]);

  // Cooldown expiry MUST be confirmed by the server, never by the device clock.
  // Once the client-side countdown reaches zero we refetch GET /api/quota/course-status
  // and only surface "Start round now" when the server says the course is ready.
  // If the refetch fails or returns an unknown state, we FAIL CLOSED and show a
  // retryable error instead of enabling the start.
  React.useEffect(() => {
    if (!cooldownNotice || cooldownNotice.type !== 'cooldown' || cooldownNotice.unavailable) return undefined;
    if (cooldownVerifying) return undefined;
    // Server already answered for the current countdown window — never re-fire.
    if (cooldownVerified && cooldownVerified.forExpiresAt === cooldownNotice.expiresAt) return undefined;
    if (new Date(cooldownNotice.expiresAt).getTime() - tickNow > 0) return undefined;
    let active = true;
    setCooldownVerifying(true);
    fetchCourseQuotaStatus()
      .then((subjects) => {
        if (!active) return;
        if (subjects === null) {
          // Authoritative status unavailable (network/API/Supabase) — FAIL CLOSED.
          setCooldownNotice((prev) => ({
            ...prev,
            unavailable: true,
            type: 'error',
            message: "We couldn't verify this course's availability. Please try again.",
          }));
          return;
        }
        const row = subjects[cooldownNotice.courseKey] || null;
        const serverReady = row ? row.is_ready === true : true; // no row = never used = ready
        if (serverReady) {
          setCooldownVerified({ forExpiresAt: cooldownNotice.expiresAt, ready: true });
          return;
        }
        if (row.window_expires_at) {
          // Still on cooldown server-side: reset the countdown from the server
          // window and resume waiting (display stays server-time based).
          setCooldownNotice((prev) => ({
            ...prev,
            expiresAt: new Date(row.window_expires_at).getTime(),
          }));
          return;
        }
        // Row exists but no authoritative window (unknown state) — FAIL CLOSED.
        setCooldownNotice((prev) => ({
          ...prev,
          unavailable: true,
          type: 'error',
          message: "We couldn't verify this course's availability. Please try again.",
        }));
      })
      .catch(() => {
        if (!active) return;
        setCooldownNotice((prev) => ({
          ...prev,
          unavailable: true,
          type: 'error',
          message: "We couldn't verify this course's availability. Please try again.",
        }));
      })
      .finally(() => {
        // Reset unconditionally so an interrupted fetch never wedges a later start.
        setCooldownVerifying(false);
      });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cooldownNotice && cooldownNotice.expiresAt, cooldownNotice && cooldownNotice.type, cooldownNotice && cooldownNotice.unavailable, tickNow, cooldownVerifying, cooldownVerified]);

  // COURSE-LEVEL COOLDOWN LOCK — free user selecting a cooling course never
  // reaches Quiz Setup; this overlay replaces the directory until a server
  // refetch confirms the cooldown ended (rowState === AVAILABLE).
  if (selectionLock && !playerActive) {
    return (
      <CourseLockOverlay
        lock={selectionLock}
        courseQuota={courseQuota}
        quotaStatus={quotaFetchStatus}
        isPremium={isPremium}
        onOpen={() => {
          if (selectionLock.subject) setPresetSubject(selectionLock.subject);
          if (selectionLock.difficulty) {
            setSelectedDifficulty(selectionLock.difficulty);
            setPresetDifficulty(selectionLock.difficulty);
          }
          openSetup(selectionLock.setupId);
        }}
        onRetry={fetchCourseQuotaStatus}
        onClose={() => setSelectionLock(null)}
        onGoPremium={() => navigate('/activate')}
      />
    );
  }

  if (cooldownNotice && !playerActive) {
    const notifType = cooldownNotice.type || (cooldownNotice.unavailable ? 'error' : 'cooldown');
    const isLocked = notifType === 'locked';
    const isError = notifType === 'error';
    const isCooldown = !isLocked && !isError;
    const remaining = isCooldown
      ? Math.max(0, Math.ceil((new Date(cooldownNotice.expiresAt).getTime() - tickNow) / 1000))
      : 0;
    // Start is enabled ONLY after the server re-confirms readiness (see the
    // re-verify effect above). Until then, a zero-crossing shows a verifying
    // state and a failure shows a retryable error — never a start button.
    const ready = isCooldown && !!(cooldownVerified && cooldownVerified.forExpiresAt === cooldownNotice.expiresAt && cooldownVerified.ready);
    const isVerifying = isCooldown && remaining <= 0 && !ready;
    const statusTitle = isLocked ? 'Difficulty locked' : isError ? 'Could not start quiz' : ready ? 'Your next round is ready' : isVerifying ? 'Verifying availability…' : 'Next round not ready yet';
    const iconBg = isLocked ? 'bg-red-100 dark:bg-red-900/40' : isError ? 'bg-slate-100 dark:bg-slate-800' : ready ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-amber-100 dark:bg-amber-900/40';
    const iconColor = isLocked ? 'text-red-600 dark:text-red-400' : isError ? 'text-slate-500 dark:text-slate-300' : ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
    const clearCooldownNotice = () => {
      setCooldownNotice(null);
      setCooldownVerified(null);
      setCooldownVerifying(false);
    };
    return (
      <div className="min-h-[70vh] max-w-md mx-auto px-4 pt-10 flex items-center justify-center animate-in fade-in">
        <div className="w-full text-center bg-white dark:bg-slate-800 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 p-6 sm:p-8">
          <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5 ${iconBg}`}>
            {isLocked ? <Lock className={`w-8 h-8 ${iconColor}`} /> : <Timer className={`w-8 h-8 ${iconColor}`} />}
          </div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            {statusTitle}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-4">
            {isLocked ? (
              <>This difficulty isn't unlocked yet for <span className="font-semibold text-slate-700 dark:text-slate-200">{cooldownNotice.label}</span>. Progress through the earlier level to unlock it.</>
            ) : isError ? (
              <>{cooldownNotice.message || 'Something went wrong starting this quiz. Please try again.'}</>
            ) : ready ? (
              <>Fresh round for <span className="font-semibold text-slate-700 dark:text-slate-200">{cooldownNotice.label}</span> is available.</>
            ) : isVerifying ? (
              <>We're checking with the server whether a fresh round for <span className="font-semibold text-slate-700 dark:text-slate-200">{cooldownNotice.label}</span> is ready yet. Please stand by…</>
            ) : (
              <>Free plan: one <span className="font-semibold">10-question round per course</span>, then a 30-minute cooldown. Come back in{' '}
                <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                  {fmtClock(remaining)}
                </span> to restart <span className="font-semibold text-slate-700 dark:text-slate-200">{cooldownNotice.label}</span> — or go Premium for unlimited rounds.</>
            )}
          </p>

          <div className="grid gap-2.5 mt-5">
            {ready && (
              <button
                onClick={() => {
                  const pending = pendingLaunchRef.current;
                  clearCooldownNotice();
                  if (pending) launchPlayer(pending.engineMode, pending.cfg);
                }}
                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors"
              >
                Start round now
              </button>
            )}
            {isVerifying && (
              <button
                type="button"
                disabled
                className="w-full bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-300 font-semibold py-3.5 rounded-xl cursor-wait"
              >
                Checking availability…
              </button>
            )}
            {isError && (
              <button
                onClick={() => {
                  const pending = pendingLaunchRef.current;
                  clearCooldownNotice();
                  if (pending) launchPlayer(pending.engineMode, pending.cfg);
                }}
                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors"
              >
                🔄 Try again
              </button>
            )}
            <button
              onClick={() => {
                // "Try another course" -> leave the setup for the current
                // course behind and show the course grid (chips + Ready state).
                clearCooldownNotice();
                cancelSetup();
              }}
              className={ready || isError ? "w-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-3.5 rounded-xl transition-colors" : "w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors"}
            >
              🔄 Try another course
            </button>
          </div>
          {!isLocked && !isError && (
            <button
              onClick={() => navigate('/activate')}
              className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 py-2 hover:underline"
            >
              ⭐ Go Premium — unlimited rounds
            </button>
          )}
        </div>
      </div>
    );
  }

  // Guided 3-step setup flow (Clinical / Quick / Uselu entry)
  if (!playerActive && !playerResult && setupType) {
    return (
      <QuizSetupFlow
        quizType={setupType}
        initialDifficulty={presetDifficulty}
        initialSubject={presetSubject}
        onComplete={handleSetupComplete}
        onCancel={cancelSetup}
      />
    );
  }

  // Immersive player for Clinical / Quick / Uselu
  if (playerActive && activeConfig) {
    return (
      <>
        {quizNote && (
          <div className="sticky top-0 z-40 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold flex items-center gap-2">
            <span className="flex-1 leading-snug">💡 {quizNote}</span>
            <button
              onClick={() => setQuizNote(null)}
              aria-label="Dismiss"
              className="shrink-0 px-1.5 py-0.5 rounded-lg hover:bg-amber-500/20 text-amber-600 dark:text-amber-300"
            >
              ✕
            </button>
          </div>
        )}
        <QuizPlayer
          questions={activeQuestions}
          batchId={activeConfig.batchId}
          config={{
            difficulty: activeConfig.difficulty,
            timePerQuestion: activeConfig.timePerQuestion,
            answerMode: activeConfig.answerMode
          }}
          modeLabel={PLAYER_MODE_LABELS[activeConfig.engineMode] || ''}
          onSound={playQuizSound}
          onAnswer={recordAnswer}
          onComplete={handlePlayerComplete}
          onQuit={quitPlayer}
          onExitSoundStart={() => audioRef.playExitForDialog()}
          onExitSoundStop={() => audioRef.stopExit()}
        />
      </>
    );
  }

  // Results for the immersive flow
  if (playerResult) {
    const pct = playerResult.total > 0 ? Math.round((playerResult.score / playerResult.total) * 100) : 0;
    return (
      <div className="max-w-3xl mx-auto pb-32 px-4 animate-in fade-in duration-500 space-y-6">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="p-6 sm:p-10 rounded-3xl sm:rounded-[3.5rem] shadow-clinical border bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-center"
        >
          <div className="w-16 h-16 sm:w-24 sm:h-24 bg-medical-50 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 rounded-2xl sm:rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-lg">
            <Trophy size={32} className="sm:w-12 sm:h-12" />
          </div>
          <h2 className="text-2xl sm:text-4xl font-black mb-2 tracking-tight uppercase text-slate-900 dark:text-white">Session Complete</h2>
          <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px] sm:text-[10px] mb-6 sm:mb-10">Performance Analytics Generated</p>

          {passInfo && passInfo.passed !== null && activeConfig?.difficulty && (
            <div className={`mb-6 p-4 rounded-2xl border ${passInfo.passed
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'}`}>
              <p className="font-black uppercase tracking-widest text-xs">
                {activeConfig.difficulty} Level {passInfo.passed ? 'â€” Passed! Progress saved.' : `â€” Not passed (${pct}%).`}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-8">
            <div className="p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Final Score</p>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white">{playerResult.score} <span className="text-xs sm:text-sm text-slate-400">/ {playerResult.total}</span></p>
            </div>
            <div className="p-4 sm:p-6 rounded-2xl sm:rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
              <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Accuracy</p>
              <p className="text-2xl sm:text-3xl font-black text-medical-500">{pct}%</p>
            </div>
          </div>

          {/* Exam Mode full review */}
          {activeConfig?.answerMode === 'exam-mode' && (
            <div className="text-left space-y-3 mb-8">
              <h3 className="text-sm font-black uppercase tracking-widest text-slate-900 dark:text-white px-1">Full Session Review</h3>
              {(playerResult.answers || []).map((a, i) => (
                <div key={i} className={`rounded-2xl border p-4 ${a.isCorrect ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-red-500/5 border-red-500/20'}`}>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 leading-snug flex-1">{i + 1}. {a.question}</p>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest ${a.isCorrect ? 'bg-emerald-500/20 text-emerald-500' : 'bg-red-500/20 text-red-500'}`}>
                      {a.isCorrect ? 'âœ“ Correct' : 'âœ• Incorrect'}
                    </span>
                  </div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-2">Your Answer</p>
                  <p className={`text-xs font-bold ${a.isCorrect ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>â†’ {a.yourAnswer}</p>
                  {!a.isCorrect && (
                    <>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mt-2">Correct Answer</p>
                      <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">â†’ {a.correctAnswer}</p>
                      <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mt-2">Conceptual Misalignment</p>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        Your selection addresses "{a.yourAnswer}", but the priority here is "{a.correctAnswer}". {a.hint}
                      </p>
                    </>
                  )}
                  <p className="text-[10px] font-black uppercase tracking-widest text-medical-500 mt-2">
                    {a.isCorrect ? 'Why You Got It Right' : 'Why the Correct Answer'}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{a.rationale}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3">
            <button onClick={backToModes} className="flex-1 py-4 sm:py-5 rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-widest text-xs bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white hover:opacity-90 transition-all">
              Mode Selection
            </button>
            <button onClick={editSessionSetup} className="flex-1 py-4 sm:py-5 rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-widest text-xs bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white hover:opacity-90 transition-all">
              â† Edit Setup
            </button>
            <button onClick={retrySameSession} className="flex-1 py-4 sm:py-5 bg-medical-600 text-white rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-500/20 active:scale-95 transition-all">
              Try Again
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  const handleCourseLaunch = (setupType, preselectSubject) => {
    if (preselectSubject) {
      setPresetSubject(preselectSubject);
      setSelectedDifficulty(null);
    }
    openSetup(setupType);
  };

  // Mode selection
  const statCells = [
    { label: 'Global Rank', value: globalRank ? `#${globalRank}` : '—', className: 'text-indigo-600' },
    { label: 'Smart Coins', value: Number(smartCoins || 0).toLocaleString(undefined, { maximumFractionDigits: 1 }), className: 'text-emerald-500' },
    { label: 'Quiz Streak', value: `${studyStats?.quizStreak || 0}`, className: 'text-amber-500' },
    { label: 'Exam Readiness', value: `${readiness}%`, className: readiness >= 70 ? 'text-medical-500' : readiness >= 40 ? 'text-amber-500' : 'text-red-500' }
  ];
  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-700 max-w-6xl mx-auto px-1 sm:px-0 pb-[calc(env(safe-area-inset-bottom,0px)+6.5rem)] lg:pb-16">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
            <button
              onClick={() => {
                const next = secretTaps + 1;
                setSecretTaps(next);
                if (next >= 5) { navigate('/xp-hall'); setSecretTaps(0); }
              }}
              aria-label="Apex Scholars"
              className="p-2 text-slate-200 dark:text-slate-700 hover:text-medical-500 dark:hover:text-medical-400 transition-colors rounded-xl active:scale-90 shrink-0 order-2 sm:order-1"
            >
              <Brain size={22} />
            </button>
            <div className="min-w-0 flex-1 order-1 sm:order-2">
              <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Quiz Modes</h1>
              <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 uppercase tracking-[0.2em] text-[9px] sm:text-[10px]">Select your training intensity</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:flex items-center justify-between bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-2xl sm:rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 w-full">
            {statCells.map((cell, idx) => (
              <div
                key={cell.label}
                className={`text-center px-2 sm:px-4 py-1.5 sm:py-0 sm:flex-1 ${idx < statCells.length - 1 ? 'sm:border-r border-slate-100 dark:border-slate-700' : ''}`}
              >
                <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest">{cell.label}</p>
                <p className={`text-lg sm:text-xl font-black ${cell.className}`}>{cell.value}</p>
              </div>
            ))}
          </div>
        </header>

        {/* Plan banner (compact) */}
          <div className={`rounded-2xl sm:rounded-3xl border p-3 sm:p-4 flex items-start gap-3 ${isPremium ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/5 border-amber-500/30'}`}>
            <span className="text-base font-black shrink-0 mt-0.5">{isPremium ? '🟢' : '🕒'}</span>
            <p className="min-w-0 flex-1 text-[10px] sm:text-xs font-black text-slate-900 dark:text-white leading-relaxed">
              {isPremium ? 'Premium · Unlimited practice — no cooldowns' : 'Free plan · 10 questions per round · new round every 30 minutes (per course)'}
            </p>
          </div>

          {/* Quiz Levels — collapsed directory; courses are picked in setup */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1.5 px-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Quiz Levels</p>
              <p className="text-[11px] font-semibold text-slate-400">Tap a level to start</p>
            </div>
            <div className="space-y-2.5">
              {QUIZ_LEVEL_ORDER.map((bankId, idx) => (
                <DirectoryRow key={bankId} index={idx} bankId={bankId} onLaunch={handleCourseLaunch} onBlocked={handleCourseBlocked} courseQuota={courseQuota} quotaStatus={quotaFetchStatus} isPremium={isPremium} />
              ))}
            </div>
          </section>

          {/* Other Modes */}
          <section className="space-y-4">
            <div className="flex items-baseline justify-between px-1">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Other Modes</p>
            </div>
            <div className="space-y-2.5">
              {OTHER_MODE_ORDER.map((bankId, idx) => (
                <DirectoryRow key={bankId} index={idx + QUIZ_LEVEL_ORDER.length} bankId={bankId} onLaunch={handleCourseLaunch} onBlocked={handleCourseBlocked} courseQuota={courseQuota} quotaStatus={quotaFetchStatus} isPremium={isPremium} />
              ))}
            </div>
          </section>
        </div>
  );
};

export default React.memo(Quiz);
