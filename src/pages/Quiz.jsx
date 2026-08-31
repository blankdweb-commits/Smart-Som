import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Brain,
  Timer,
  Zap,
  Target,
  Clock,
  Trophy,
  Shield,
  BookOpen,
  Heart
} from '../components/Icons';
import useluData from '../data/flashcards/nmcn/uselu-posting-tests.json';
import respirationData from '../data/flashcards/nmcn/Respiration-richard.json';
import fluidData from '../data/flashcards/nmcn/fluid-electrolytes.json';
import rawNclex from '../data/flashcards/nclex/nclex-rn-ngn.json';
import { pharmacologyData, musculoskeletalData, neurologicalData, nursing200Data, midwiferyData } from '../data/richardBank';
import { questionId } from '../utils/questionMetadata';

// Combined pool for all non-Uselu modes. Uselu Test Questions keeps its
// dedicated bank and never draws from this pool.
// NMCN-category exam banks (respiratory, pharmacology, musculoskeletal,
// neurological). fluid-electrolytes is NCLEX-category and is deliberately
// excluded from the NMCN pool.
const NMCN_POOL = [
  ...respirationData,
  ...pharmacologyData,
  ...musculoskeletalData,
  ...neurologicalData
];

// NCLEX-category exam banks — drawn ONLY by the Clinical and Quick modes when
// the learner picks the NCLEX (or Both) source. Never mixed into Uselu /
// 200-level modes. The rich fluid-electrolytes bank is a full MCQ bank;
// nclex-rn-ngn is flashcard-shaped (single `answer`, no options array), so
// `boxCard` synthesizes distractor options for it at build time.
const NCLEX_POOL = [
  ...fluidData,
  ...(Array.isArray(rawNclex) ? rawNclex : []).map((q, i) => ({
    id: String(q.id || `nclex-idx-${i}`),
    question: q.question,
    options: Array.isArray(q.options) ? [...q.options] : [],
    correctAnswer: q.correctAnswer || q.answer || undefined,
    rationale: q.rationale || undefined,
    hint: q.hint || 'Think through the nursing priority and reasoning being tested.',
    subject: q.subject || 'NCLEX-RN',
    topic: q.topic,
    category: 'NCLEX',
    difficulty: q.difficulty || 'Medium',
    source: 'NCLEX'
  }))
];

// All exam-purpose banks (used by Clinical/Quick "Both" and Weakness modes).
const ALL_EXAM_POOL = [...NMCN_POOL, ...NCLEX_POOL];

// Nursing 200-Level is a dedicated bank drawn by its own mode card only —
// it is intentionally NOT part of the NMCN/NCLEX exam pools so the
// Clinical/Quick modes don't mix 200-level questions into the general pools.
const NURSING200_POOL = nursing200Data;

// Midwifery 200-Level — dedicated bank with its own mode
const MIDWIFERY_POOL = midwiferyData;
  // eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import QuizSetupFlow from '../components/QuizSetupFlow';
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
  // Free-user 50/12h quota gate: surfaced when the user exhausts their window.
  const [quotaNotice, setQuotaNotice] = useState(null); // { remaining, exhausted }

  // ----- Difficulty progression -----
  const { recordQuizResult, recordWrongAnswers, recordAttempts, learningAnalytics, userProfile, loadingAuth, smartCoins, fetchSCRank, studyStats, levelCompletions, session, fetchAttemptedQuestionIds, consumeQuota, isPremium, fetchQuotaStatus, recordAnsweredBatch } = useAppContext();
  const [selectedDifficulty, setSelectedDifficulty] = useState(null);
  const [globalRank, setGlobalRank] = useState(null);

  // Load the live SC global rank once (lightweight, non-blocking).
  React.useEffect(() => {
    let active = true;
    fetchSCRank().then(rank => { if (active) setGlobalRank(rank); });
    return () => { active = false; };
  }, [fetchSCRank]);

  // Set of question ids this learner has already answered — powers the
  // no-repetition / same-niche-different-angle selection engine.
  const attemptedIdsRef = React.useRef(new Set());
  const refreshAttemptedIds = React.useCallback(async () => {
    const ids = await fetchAttemptedQuestionIds();
    attemptedIdsRef.current = ids;
  }, [fetchAttemptedQuestionIds]);
  React.useEffect(() => {
    if (session?.user) refreshAttemptedIds();
  }, [session?.user, refreshAttemptedIds]);
  const [passInfo, setPassInfo] = useState(null); // { passed, pct }
  const wrongAnswersRef = React.useRef([]);
  const quizStartRef = React.useRef(null);
  const resultRecordedRef = React.useRef(false);
  const [weaknessIntentHandled, setWeaknessIntentHandled] = useState(false);

  const weakConceptNames = React.useMemo(() => {
    const names = new Set();
    (learningAnalytics.weakConcepts || []).forEach(w => {
      if (w?.name) names.add(String(w.name).trim().toLowerCase());
      if (w?.subject) names.add(String(w.subject).trim().toLowerCase());
    });
    return names;
  }, [learningAnalytics.weakConcepts]);

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

  const matchesTier = (cardDifficulty, tierId) => {
    const d = String(cardDifficulty || '').toLowerCase();
    switch (tierId) {
      case 'Easy': return d === 'easy';
      case 'Medium': return d === 'medium' || d === 'moderate';
      case 'Hard': return d === 'hard';
      // Authored Expert/Master/Extreme banks do not exist yet; these tiers draw
      // from the Hard pool with stricter passing marks until curated content lands.
      case 'Expert':
      case 'Master':
      case 'Extreme': return d === 'hard' || d === 'expert' || d === 'master' || d === 'extreme';
      default: return true;
    }
  };

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

  // Builds a question set for the immersive player.
  const buildQuestionSet = (engineMode, difficulty, count, order, subject, examSource) => {
    let pool;
    if (engineMode === 'uselu') pool = useluData;
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
    if (subject) {
      pool = pool.filter(c => c.subject === subject);
    }
    const seen = new Set();
    const uniquePool = pool.filter(c => seen.has(c.question) ? false : seen.add(c.question));

    // No-repetition: never re-serve a question the learner has already answered
    // while undiscovered ones remain.
    const attempted = attemptedIdsRef.current;

    // Weakness Challenge: prioritize the learner's computed weak topics.
    if (engineMode === 'weakness') {
      const weakMatches = uniquePool.filter(c => {
        const probe = [c.topic, c.category, c.subject].map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
        return probe.some(p => weakConceptNames.has(p));
      });
      if (weakMatches.length >= 5) {
        // Same-niche-different-angle: put unseen weak matches first so repeats
        // are only used once the learner has cleared the weakness pool.
        const unseenWeak = weakMatches.filter(c => !attempted.has(questionId(c)));
        const ordered = [...unseenWeak, ...weakMatches];
        return ordered
          .sort(() => 0.5 - Math.random())
          .slice(0, Math.min(count, ordered.length))
          .map(card => boxCard(card));
      }
    }

    let tierPool = uniquePool;
    if (difficulty) {
      const tierMatches = uniquePool.filter(c => matchesTier(c.difficulty, difficulty));
      if (tierMatches.length >= 5) {
        tierPool = tierMatches;
      } else {
        const globalTier = flashcards.filter(c =>
          matchesTier(c.difficulty, difficulty) &&
          (!subject || c.subject === subject)
        );
        tierPool = [...tierMatches, ...globalTier];
      }
    }
    const activePool = tierPool.length > 0 ? tierPool : uniquePool;

    // No-repetition: serve unseen tier questions first, then previously-seen
    // ones only as a top-up (same-niche-different-angle) so the set is never
    // empty. Shuffling happens within each group to preserve that priority.
    const activeUnseen = activePool.filter(c => !attempted.has(questionId(c)));
    const activeSeen = activePool.filter(c => attempted.has(questionId(c)));
    const shuffleArr = (arr) => [...arr].sort(() => 0.5 - Math.random());
    let working;
    if (order === 'randomized') {
      working = [...shuffleArr(activeUnseen), ...shuffleArr(activeSeen)];
    } else {
      working = [...activeUnseen, ...activeSeen];
    }
    const picked = working.slice(0, Math.min(count, working.length));

    return picked.map(card => boxCard(card));
  };

  const launchPlayer = async (engineMode, cfg, opts = {}) => {
    const questions = buildQuestionSet(engineMode, cfg.difficulty, cfg.questionCount, cfg.order, cfg.subject, cfg.examSource);
    if (questions.length === 0) return;

    // FREE-USER QUOTA GATE (50 questions / 12h cooldown).
    // Premium users are unlimited (server-verified; consumeQuota short-circuits).
    // We reserve the whole set up front so a user cannot bank more than the cap.
    // Retrying the SAME already-reserved set skips consumption (no double charge).
    if (!opts.skipQuota && !isPremium && session) {
      try {
        const res = await consumeQuota(questions.length, session);
        if (!res) { setQuotaNotice({ remaining: 0, exhausted: true }); fetchQuotaStatus(); return; }
        if (res.in_cooldown) {
          setQuotaNotice({ remaining: res.questions_remaining ?? 0, exhausted: true });
          fetchQuotaStatus();
          return;
        }
      } catch (err) {
        console.warn('Quota gate skipped (fallback allow):', err.message);
      }
    }

    setQuotaNotice(null);
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

      // Difficulty unlock progression — record genuinely correct answers per
      // difficulty tier (server ignores incorrect, tracks the gate counts).
      // Correct answers only count toward unlocking (spec requirement).
      const byDifficulty = {};
      (result.answers || []).forEach(a => {
        if (!a.correct) return;
        const d = (a.difficulty || activeConfig?.difficulty || 'Easy');
        (byDifficulty[d] = byDifficulty[d] || []).push({
          question_id: String(a.questionId ?? a.id ?? '').trim(),
          correct: true
        });
      });
      for (const [diff, ans] of Object.entries(byDifficulty)) {
        if (ans.length > 0) await recordAnsweredBatch({ difficulty: diff, answers: ans });
      }
    }
    // Refresh the no-repetition set so the next session starts fresh.
    await refreshAttemptedIds();
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

  // Free-user quota exhausted: show the cooldown gate before anything else.
  if (quotaNotice && !playerActive) {
    return (
      <div className="min-h-[70vh] max-w-md mx-auto px-4 pt-10 flex items-center justify-center animate-in fade-in">
        <div className="w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mb-5">
            <Timer className="w-8 h-8 text-amber-600 dark:text-amber-400" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Daily question limit reached</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm leading-relaxed mb-6">
            Free learners get <span className="font-semibold">50 questions every 12 hours</span>. You've used them all
            for this window. Your cooldown begins the moment you hit the limit — come back soon, or{' '}
            <span className="font-semibold text-teal-600">go Premium for unlimited questions</span>.
          </p>
          <button
            onClick={async () => { setQuotaNotice(null); await fetchQuotaStatus(); }}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors"
          >
            Check my quota
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
    const playerModeLabels = {
      clinical: 'Clinical Challenge',
      quick: 'Quick Quiz',
      uselu: 'Uselu Test Questions',
      nursing200: 'Nursing 200-Level',
      midwifery: 'Midwifery 200-Level',
      weakness: 'Fix My Weak Areas'
    };
    return (
      <QuizPlayer
        questions={activeQuestions}
        config={{
          difficulty: activeConfig.difficulty,
          timePerQuestion: activeConfig.timePerQuestion,
          answerMode: activeConfig.answerMode
        }}
        modeLabel={playerModeLabels[activeConfig.engineMode] || ''}
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
          Select a mode below to configure your session
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <ModeCard
            title="Clinical Challenge"
            desc="Simulated exam environment with critical rationales."
            icon={<Shield size={28} className="sm:w-8 sm:h-8" />}
            duration="Variable"
            timer="Adaptive"
            color="medical"
            onClick={() => openSetup(MODE_TO_SETUP.clinical)}
          />
          <ModeCard
            title="Quick Quiz"
            desc="Rapid questions for instant knowledge verification."
            icon={<Zap size={28} className="sm:w-8 sm:h-8" />}
            duration="Fast"
            timer="Instant"
            color="amber"
            onClick={() => openSetup(MODE_TO_SETUP.quick)}
          />
          <ModeCard
            title="Uselu Test Questions"
            desc="Focused practice with the Uselu Posting test question bank."
            icon={<Target size={28} className="sm:w-8 sm:h-8" />}
            duration="Focused"
            timer="Adaptive"
            color="indigo"
            onClick={() => openSetup(MODE_TO_SETUP.uselu)}
          />
          <ModeCard
            title="Nursing 200-Level"
            desc="200-Level course questions across seven subjects."
            icon={<BookOpen size={28} className="sm:w-8 sm:h-8" />}
            duration="Focused"
            timer="Adaptive"
            color="emerald"
            onClick={() => openSetup(MODE_TO_SETUP.nursing200)}
          />
          <ModeCard
            title="Midwifery 200-Level"
            desc="200-Level midwifery questions across five core subjects."
            icon={<Heart size={28} className="sm:w-8 sm:h-8" />}
            duration="Focused"
            timer="Adaptive"
            color="pink"
            onClick={() => openSetup(MODE_TO_SETUP.midwifery)}
          />
        </div>
      </div>
  );
};

const ModeCard = ({ title, desc, icon, duration, timer, color, onClick }) => {
  const colors = {
    medical: 'hover:border-medical-500 group-hover:text-medical-500 bg-medical-500/10 text-medical-600',
    amber: 'hover:border-amber-500 group-hover:text-amber-500 bg-amber-500/10 text-amber-600',
    indigo: 'hover:border-indigo-500 group-hover:text-indigo-500 bg-indigo-500/10 text-indigo-600',
    emerald: 'hover:border-emerald-500 group-hover:text-emerald-500 bg-emerald-500/10 text-emerald-600',
    pink: 'hover:border-pink-500 group-hover:text-pink-500 bg-pink-500/10 text-pink-600'
  };
  return (
    <button onClick={onClick} className={`p-4 sm:p-6 bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border-2 border-slate-100 dark:border-slate-700 transition-all text-left group active:scale-95 flex flex-col justify-between min-h-[160px] sm:min-h-[200px] shadow-sm hover:shadow-xl ${colors[color].split(' ')[0]}`}>
      <div>
        <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center mb-3 sm:mb-6 transition-all group-hover:scale-110 shadow-inner ${colors[color].split(' ').pop()} ${colors[color].split(' ')[1]}`}>{icon}</div>
        <h3 className="text-base sm:text-xl font-black text-slate-900 dark:text-white mb-1 sm:mb-2 tracking-tight group-hover:translate-x-1 transition-transform">{title}</h3>
        <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm font-medium leading-relaxed line-clamp-2">{desc}</p>
      </div>
      <div className="flex gap-3 sm:gap-4 mt-3 sm:mt-6">
        <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-wider"><Clock size={12} /> {duration}</div>
        <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-wider"><Timer size={12} /> {timer}</div>
      </div>
    </button>
  );
};

export default React.memo(Quiz);
