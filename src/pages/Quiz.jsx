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
  Heart
} from '../components/Icons';
import {
  USELU_POOL,
  NMCN_POOL,
  NCLEX_POOL,
  ALL_EXAM_POOL,
  NURSING200_POOL,
  MIDWIFERY_POOL
} from '../data/flashcardPools';
import { selectQuestions } from '../utils/questionSelection';
import CourseList from '../components/CourseList';

  // eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import QuizSetupFlow, { QUIZ_CONFIGS, LEVEL_SUBJECTS } from '../components/QuizSetupFlow';
import QuizPlayer from '../components/QuizPlayer';

// Maps setup-flow quiz ids to engine mode ids.
const SETUP_TO_MODE = {
  'clinical-challenge': 'clinical',
  'quick-quiz': 'quick',
  'uselu-test': 'uselu',
  'nursing-200': 'nursing200',
  'midwifery-200': 'midwifery',
  'weakness-challenge': 'weakness'
};
const MODE_TO_SETUP = {
  clinical: 'clinical-challenge',
  quick: 'quick-quiz',
  uselu: 'uselu-test',
  nursing200: 'nursing-200',
  midwifery: 'midwifery-200',
  weakness: 'weakness-challenge'
};

const PLAYER_MODE_LABELS = {
  clinical: 'Clinical Challenge',
  quick: 'Quick Quiz',
  uselu: 'Uselu Test Questions',
  nursing200: 'Nursing 200-Level',
  midwifery: 'Midwifery 200-Level',
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

// ----- Sound System (Supabase-hosted; every clip is <= 4s) -----
const MAX_SOUND_SECONDS = 4;
const SOUND_BASE = `${(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/sounds`;
const soundAt = (name) => `${SOUND_BASE}/${name}`;
const SOUND_POOL = {
  start: [soundAt('start-0')],
  correct: ['correct-0', 'correct-1', 'correct-2', 'correct-3', 'correct-4'].map(soundAt),
  wrong: ['wrong-0', 'wrong-1', 'wrong-2', 'wrong-3'].map(soundAt),
  timeout: [soundAt('timeout-0')]
};

const audioCache = {};
const clipTimers = new Map();

const stopClip = (el) => {
  const t = clipTimers.get(el);
  if (t) {
    clearTimeout(t);
    clipTimers.delete(el);
  }
  try { el.pause(); } catch { /* ignore */ }
};

const playQuizSound = (type) => {
  try {
    const pool = SOUND_POOL[type] || [];
    if (pool.length === 0) return;

    const url = pool[Math.floor(Math.random() * pool.length)];

    if (!audioCache[url]) {
      audioCache[url] = Array.from({ length: 3 }).map(() => {
        const audio = new Audio(url);
        audio.preload = 'auto';
        return audio;
      });
    }

    const audioPool = audioCache[url];
    let el = audioPool.find(a => a.paused || a.ended) || audioPool[0];

    stopClip(el);
    el.currentTime = 0;
    el.volume = 1.0;
    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => console.warn('Audio playback blocked:', err));
    }

    // Hard-stop any clip at MAX_SOUND_SECONDS, regardless of source length.
    clipTimers.set(el, setTimeout(() => stopClip(el), MAX_SOUND_SECONDS * 1000));
  } catch (e) {
    console.warn('Sound system error:', e);
  }
};

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
  { id: 'Medium', dot: 'bg-blue-500', ring: 'border-blue-500/30', label: 'Test your understanding', passMark: 60, unlock: null },
  { id: 'Hard', dot: 'bg-orange-500', ring: 'border-orange-500/30', label: 'Challenge your clinical reasoning', passMark: 70, unlock: null },
  { id: 'Expert', dot: 'bg-red-500', ring: 'border-red-500/30', label: 'Deeper clinical reasoning', passMark: 75, unlock: { from: 'Hard', count: 3 } },
  { id: 'Master', dot: 'bg-purple-500', ring: 'border-purple-500/30', label: 'Advanced examination scenarios', passMark: 80, unlock: { from: 'Expert', count: 10 } },
  { id: 'Extreme', dot: 'bg-slate-900 dark:bg-white', ring: 'border-slate-500/30', label: 'The hardest questions we have', passMark: 85, unlock: { from: 'Master', count: 14 } }
];

const Quiz = () => {
  const { flashcards, updateQuizStats } = useAppContext();
  const navigate = useNavigate();
  const [secretTaps, setSecretTaps] = useState(0);

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
  const pendingLaunchRef = React.useRef(null); // keeps the original engineMode/cfg for the "Start now" retry

  // ----- Difficulty progression -----
  const { recordQuizResult, recordWrongAnswers, recordAttempts, learningAnalytics, userProfile, loadingAuth, smartCoins, fetchSCRank, studyStats, levelCompletions, session, fetchQuestionHistory, consumeCourseQuota, isPremium, fetchCourseQuotaStatus, recordAnsweredBatch, courseQuota } = useAppContext();
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

  // Deep-link support: /quiz?difficulty=Hard (e.g. from a completed flashcard session)
  const [, setSearchParams] = useSearchParams();
  const SUBJECT_FILTERS = ['Pharmacology', 'Musculoskeletal', 'Neurological Nursing', 'Medical Surgical', 'Chemistry', 'Mental Health', 'Principles of Management and Teaching', 'Medical-Surgical Nursing II', 'Child Health', 'Home Health Care Nursing', 'Entrepreneurship in Midwifery', 'Community Health Nursing I', 'Fundamentals of Nursing', 'Medical-Surgical Nursing', 'Unit I: Introduction to Nutrition', 'Unit II: Nutritional Needs', 'Unit III: Food Planning, Preparation, and Safety', 'Pharmacology III', 'Concept of Politics and Government', 'Political Interaction', 'Political Activities', 'Reproductive Health', 'Research Methodology'];
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get('difficulty');
    if (d && DIFFICULTY_TIERS.some(t => t.id === d) && !selectedDifficulty) {
      setSelectedDifficulty(d);
      setPresetDifficulty(d);
    }
    const s = params.get('subject');
    if (s && SUBJECT_FILTERS.includes(s)) {
      setPresetSubject(s);
      setSetupType('clinical-challenge');
    }
    // Deep-link from the Study Plan "Practice <weakest subject>" CTA: open the
    // setup flow for the course that contains the subject, preselecting it so
    // the learner only presses Start. Falls back to Clinical Challenge.
    const ps = params.get('practiceSubject');
    if (ps) {
      if (LEVEL_SUBJECTS['nursing-200'].includes(ps)) setSetupType('nursing-200');
      else if (LEVEL_SUBJECTS['midwifery-200'].includes(ps)) setSetupType('midwifery-200');
      else setSetupType('clinical-challenge');
      setPresetSubject(ps);
      setSelectedDifficulty(null);
    }
    // Deep-link from a study group: stamp results with the group_id so the
    // per-group quiz streak can advance. Opens the Midwifery 200-Level setup.
    const g = params.get('groupId');
    if (g && /^\d+$/.test(g)) {
      setGroupQuizId(Number(g));
      if (!s) setSetupType('midwifery-200');
    }
    if (d && s) {
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Deep-link: /quiz?weakness=1 → Fix My Weak Areas (PAID — gated by is_activated).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('weakness') || weaknessIntentHandled) return;
    if (loadingAuth) return;
    setWeaknessIntentHandled(true);
    setSearchParams({}, { replace: true });
    if (!userProfile.isActivated) {
      navigate('/activate');
      return;
    }
    setSetupType('weakness-challenge');
    window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingAuth, userProfile.isActivated, weaknessIntentHandled, navigate]);

  useEffect(() => {
    return () => {
      exitFullscreen();
    };
  }, []);

  // ----- Guided Setup Flow handlers (Clinical / Quick / Uselu entry) -----

  const openSetup = (setupId) => {
    setSetupType(setupId);
    window.scrollTo({ top: 0 });
  };

  const cancelSetup = () => {
    setSetupType(null);
    setPresetDifficulty(null);
    setPresetSubject(null);
  };

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

  // Builds a question set for the immersive player via the configurable
  // no-repetition selection engine (see utils/questionSelection.js + the
  // SELECTION_CONFIG tunables in utils/selectionConfig.js).
  const buildQuestionSet = (engineMode, difficulty, count, order, subject, examSource) => {
    let pool;
    if (engineMode === 'uselu') pool = USELU_POOL;
    else if (engineMode === 'nursing200') pool = NURSING200_POOL;
    else if (engineMode === 'midwifery') pool = MIDWIFERY_POOL;
    else {
      // Clinical / Quick: honor the exam-source toggle. NCLEX / NMCN are ONLY
      // available here — never in Uselu / 200-level modes (Weakness uses the
      // full merged pool below). Fluid-electrolytes is NCLEX-category.
      if (examSource === 'nclex') pool = NCLEX_POOL;
      else if (examSource === 'nmcn') pool = NMCN_POOL;
      else pool = ALL_EXAM_POOL;
    }

    const intended = selectQuestions(pool, {
      questionCount: count,
      order,
      subject,
      difficulty,
      prioritizeWeakness: engineMode === 'weakness'
    }, selectionStateRef.current);

    return intended.map(card => boxCard(card));
  };

  const launchPlayer = async (engineMode, cfg, opts = {}) => {
    const questions = buildQuestionSet(engineMode, cfg.difficulty, cfg.questionCount, cfg.order, cfg.subject, cfg.examSource);
    if (questions.length === 0) return;

    // FREE-USER PER-COURSE ROUND GATE (v13): one 10-question round per course,
    // then a 1h cooldown on THAT course only. The charge happens here — the
    // round is reserved SERVER-SIDE (consumeCourseQuota → RPC) before any
    // question renders, so quitting early still consumes the round and a
    // manipulated client can never bypass the cooldown.
    // Retrying the SAME already-reserved set skips consumption (no double charge).
    if (!opts.skipQuota && !isPremium && session) {
      try {
        const courseKey = (cfg.courseKey || '').trim();
        const res = await consumeCourseQuota(courseKey, questions.length, session);
        pendingLaunchRef.current = { engineMode, cfg };
        if (!res) {
          setCooldownNotice({ courseKey, label: courseLabel(engineMode, cfg), seconds: 0, engineMode, cfg, unavailable: true });
          return;
        }
        if (res.allowed === false) {
          const seconds = Number(res.cooldown_remaining_seconds) || 0;
          setCooldownNotice({
            courseKey,
            label: courseLabel(engineMode, cfg),
            seconds,
            expiresAt: res.window_expires_at || new Date(Date.now() + seconds * 1000).toISOString(),
            engineMode,
            cfg,
            unavailable: false
          });
          fetchCourseQuotaStatus();
          return;
        }
      } catch (err) {
        console.warn('Course quota gate skipped (fallback allow):', err.message);
      }
    }

    setCooldownNotice(null);
    pendingLaunchRef.current = null;
    setActiveConfig({ ...cfg, engineMode });
    setActiveQuestions(questions);
    setPlayerResult(null);
    setPassInfo(null);
    wrongAnswersRef.current = [];
    resultRecordedRef.current = false;
    quizStartRef.current = Date.now();
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

    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0;

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

    // Weakness Challenge data source — log every answered question.
    if (result.answers && result.answers.length > 0) {
      await recordAttempts(result.answers);

      // Full exposure history — record EVERY answered question id (hits and
      // misses) so user_question_history reflects the true review store. The
      // server only credits difficulty-unlock counters for genuinely correct
      // answers (record_difficulty_correct is gated internally on a.correct).
      const byDifficulty = {};
      (result.answers || []).forEach(a => {
        const d = (a.difficulty || activeConfig?.difficulty || 'Easy');
        (byDifficulty[d] = byDifficulty[d] || []).push({
          question_id: String(a.questionId ?? a.id ?? '').trim(),
          correct: !!a.correct
        });
      });
      for (const [diff, ans] of Object.entries(byDifficulty)) {
        if (ans.length > 0) await recordAnsweredBatch({ difficulty: diff, answers: ans });
      }
    }
    // Refresh the selection state so the next session starts fresh.
    await refreshSelectionState();
    await fetchCourseQuotaStatus();
  };

  const quitPlayer = () => {
    setPlayerActive(false);
    setActiveConfig(null);
    setActiveQuestions([]);
    document.body.classList.remove('quiz-active');
  };

  const backToModes = () => {
    setPlayerActive(false);
    setActiveConfig(null);
    setActiveQuestions([]);
    setPlayerResult(null);
    setPresetDifficulty(null);
    setPresetSubject(null);
    document.body.classList.remove('quiz-active');
  };

  const retrySameSession = () => {
    if (!activeConfig) return;
    const { engineMode, ...cfg } = activeConfig;
    launchPlayer(engineMode, cfg, { skipQuota: true });
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
  if (cooldownNotice && !playerActive) {
    const remaining = cooldownNotice.unavailable
      ? 0
      : Math.max(0, Math.ceil((new Date(cooldownNotice.expiresAt).getTime() - tickNow) / 1000));
    const ready = !cooldownNotice.unavailable && remaining <= 0;
    return (
      <div className="min-h-[70vh] max-w-md mx-auto px-4 pt-10 flex items-center justify-center animate-in fade-in">
        <div className="w-full text-center bg-white dark:bg-slate-800 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 p-6 sm:p-8">
          <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5 ${ready ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}`}>
            <Timer className={`w-8 h-8 ${ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">
            {ready ? 'Your next round is ready' : 'Next round not ready yet'}
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-4">
            {cooldownNotice.unavailable ? (
              <>We couldn't reach the quota service. Please check your connection and try again.</>
            ) : ready ? (
              <>Fresh round for <span className="font-semibold text-slate-700 dark:text-slate-200">{cooldownNotice.label}</span> is available.</>
            ) : (
              <>Free plan: one <span className="font-semibold">10-question round per course</span>, then a 1-hour cooldown. Come back in{' '}
                <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                  {fmtClock(remaining)}
                </span> to restart <span className="font-semibold text-slate-700 dark:text-slate-200">{cooldownNotice.label}</span> — or go Premium for unlimited rounds.</>
            )}
          </p>

          {cooldownNotice.unavailable && (
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quota service unreachable</p>
          )}

          <div className="grid gap-2.5 mt-5">
            {ready && !cooldownNotice.unavailable && (
              <button
                onClick={() => {
                  const pending = pendingLaunchRef.current;
                  setCooldownNotice(null);
                  if (pending) launchPlayer(pending.engineMode, pending.cfg);
                }}
                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors"
              >
                Start round now
              </button>
            )}
            <button
              onClick={() => {
                // "Try another course" -> leave the setup for the current
                // course behind and show the course grid (chips + Ready state).
                setCooldownNotice(null);
                cancelSetup();
              }}
              className={ready ? "w-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-semibold py-3.5 rounded-xl transition-colors" : "w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors"}
            >
              🔄 Try another course
            </button>
          </div>
          <button
            onClick={() => navigate('/activate')}
            className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-black uppercase tracking-widest text-teal-600 dark:text-teal-400 py-2 hover:underline"
          >
            ⭐ Go Premium — unlimited rounds
          </button>
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
      <QuizPlayer
        questions={activeQuestions}
        config={{
          difficulty: activeConfig.difficulty,
          timePerQuestion: activeConfig.timePerQuestion,
          answerMode: activeConfig.answerMode
        }}
        modeLabel={PLAYER_MODE_LABELS[activeConfig.engineMode] || ''}
        onSound={playQuizSound}
        onComplete={handlePlayerComplete}
        onQuit={quitPlayer}
      />
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

  // Mode selection
  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-700 max-w-6xl mx-auto pb-20 px-4">
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const next = secretTaps + 1;
                setSecretTaps(next);
                if (next >= 5) { navigate('/xp-hall'); setSecretTaps(0); }
              }}
              className="p-2 text-slate-200 dark:text-slate-700 hover:text-medical-500 dark:hover:text-medical-400 transition-colors rounded-xl active:scale-90"
            >
              <Brain size={22} />
            </button>
            <div>
              <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Quiz Modes</h1>
              <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 uppercase tracking-[0.2em] text-[9px] sm:text-[10px]">Select your training intensity</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-2xl sm:rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 w-full sm:w-auto justify-between sm:justify-start">
            <div className="text-center px-2 sm:px-4 border-r border-slate-100 dark:border-slate-700 flex-1 sm:flex-none">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Global Rank</p>
              <p className="text-lg sm:text-xl font-black text-indigo-600">{globalRank ? `#${globalRank}` : '—'}</p>
            </div>
            <div className="text-center px-2 sm:px-4 border-r border-slate-100 dark:border-slate-700 flex-1 sm:flex-none">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Smart Coins</p>
              <p className="text-lg sm:text-xl font-black text-emerald-500">{Number(smartCoins || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}</p>
            </div>
            <div className="text-center px-2 sm:px-4 border-r border-slate-100 dark:border-slate-700 flex-1 sm:flex-none">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Quiz Streak</p>
              <p className="text-lg sm:text-xl font-black text-amber-500">{studyStats?.quizStreak || 0}</p>
            </div>
            <div className="text-center px-2 sm:px-4 flex-1 sm:flex-none">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Exam Readiness</p>
              <p className={`text-lg sm:text-xl font-black ${readiness >= 70 ? 'text-medical-500' : readiness >= 40 ? 'text-amber-500' : 'text-red-500'}`}>{readiness}%</p>
            </div>
          </div>
        </header>

        <p className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-400 -mt-2">
          Select a course below to configure your session
        </p>

        <CourseList
          courses={[
            {
              id: 'clinical-challenge',
              title: 'Clinical Challenge',
              desc: QUIZ_CONFIGS['clinical-challenge'].identity,
              icon: <Shield size={24} className="sm:w-7 sm:h-7" />,
              color: { icon: 'bg-medical-500/10 text-medical-500' }
            },
            {
              id: 'quick-quiz',
              title: 'Quick Quiz',
              desc: QUIZ_CONFIGS['quick-quiz'].identity,
              icon: <Zap size={24} className="sm:w-7 sm:h-7" />,
              color: { icon: 'bg-amber-500/10 text-amber-500' }
            },
            {
              id: 'uselu-test',
              title: 'Uselu Test Questions',
              desc: QUIZ_CONFIGS['uselu-test'].identity,
              icon: <Target size={24} className="sm:w-7 sm:h-7" />,
              color: { icon: 'bg-indigo-500/10 text-indigo-500' }
            },
            {
              id: 'nursing-200',
              title: 'Nursing 200-Level',
              desc: QUIZ_CONFIGS['nursing-200'].identity,
              icon: <BookOpen size={24} className="sm:w-7 sm:h-7" />,
              color: { icon: 'bg-emerald-500/10 text-emerald-500' },
              subjects: LEVEL_SUBJECTS['nursing-200']
            },
            {
              id: 'midwifery-200',
              title: 'Midwifery 200-Level',
              desc: QUIZ_CONFIGS['midwifery-200'].identity,
              icon: <Heart size={24} className="sm:w-7 sm:h-7" />,
              color: { icon: 'bg-pink-500/10 text-pink-500' },
              subjects: LEVEL_SUBJECTS['midwifery-200']
            },
            {
              id: 'weakness-challenge',
              title: 'Fix My Weak Areas',
              desc: QUIZ_CONFIGS['weakness-challenge'].identity,
              icon: <Timer size={24} className="sm:w-7 sm:h-7" />,
              color: { icon: 'bg-rose-500/10 text-rose-500' }
            }
          ]}
          onLaunch={(setupType, preselectSubject) => {
            if (preselectSubject) {
              setPresetSubject(preselectSubject);
              setSelectedDifficulty(null);
            }
            openSetup(setupType);
          }}
          premium={isPremium}
          courseQuota={courseQuota}
        />
      </div>
  );
};

export default React.memo(Quiz);
