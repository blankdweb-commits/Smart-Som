import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { supabase } from '../utils/supabase';
import { authHeaders } from '../utils/apiHeaders';
import { safeGet, safeSet } from '../utils/safeStorage';
import {
  computeCurrentIdentity,
  computeProgressToNext,
  shouldCelebrate,
  acknowledgeUnlock
} from '../utils/identityEngine';
import { evaluateAchievements, ACHIEVEMENT_CATALOG } from '../utils/achievementEngine';

const AppContext = createContext();

const ANONYMOUS_PROFILE = {
  fullName: '',
  email: '',
  phone: '',
  department: '',
  level: '',
  isActivated: false,
  isAdmin: false,
  role: 'student',
  subscriptionStatus: 'none',
  subscriptionExpiry: null,
  graceUntil: null
};

// ---------- Curriculum Subject Index ----------
// Every official course across all years/semesters merged with every subject
// present in the bundled card banks. Powers autocomplete everywhere.
const normalizeSubjectName = (s) =>
  String(s || '').replace(/\s+and\s+/gi, ' & ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

const buildCurriculumIndex = () => {
  const subjects = [];
  const topics = {};
  Object.values(CURRICULUM_MASTER).forEach(semesters => {
    Object.values(semesters).forEach(courses => {
      courses.forEach(course => {
        const name = normalizeSubjectName(course.course);
        if (!subjects.includes(name)) subjects.push(name);
        if (!topics[name]) topics[name] = [];
        (course.units || []).forEach(unit => {
          (unit.topics || []).forEach(t => {
            if (!topics[name].includes(t)) topics[name].push(t);
          });
        });
      });
    });
  });
  return { subjects, topics };
};

const CURRICULUM_INDEX = buildCurriculumIndex();

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [flashcards, setFlashcards] = useState([...initialFlashcards, ...allBuiltInFlashcards]);
  const [exams, setExams] = useState([]);
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const saved = safeGet('soundEnabled', { parsed: true });
    return typeof saved === 'boolean' ? saved : true;
  });
  const [darkMode, setDarkMode] = useState(() => {
    const saved = safeGet('darkMode', { parsed: true });
    return typeof saved === 'boolean' ? saved : false;
  });
  const [studyStats, setStudyStats] = useState({
    streak: 0,
    lastStudyDate: null,
    cardsStudied: 0,
    quizStreak: 0,
    maxQuizStreak: 0,
    milestone: 'Auxibaby 👶'
  });
  const [userProfile, setUserProfile] = useState(ANONYMOUS_PROFILE);
  // ---- Smart Coin (SC) currency ----
  // Wallet is persisted on profiles.smart_coins; daily payout and the
  // once-per-day fail penalty are tracked so each is awarded/deducted once/day.
  const [smartCoins, setSmartCoins] = useState(0);
  const [scLastPayout, setScLastPayout] = useState(null);   // ISO timestamptz
  const [scLastFailDate, setScLastFailDate] = useState(null); // YYYY-MM-DD
  const [scLedger, setScLedger] = useState([]);
  const [streakFreezeActive, setStreakFreezeActive] = useState(false);
  const SC_DAILY_PAYOUT = 9;
  const SC_STREAK_BREAK_PENALTY = 5;
  const SC_QUIZ_FAIL_PENALTY = 3;
  const [paymentPurposes] = useState([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs] = useState([]);
  // Passed-level completions per difficulty: { Easy: n, Medium: n, Hard: n, ... }
  const [levelCompletions, setLevelCompletions] = useState({});

  const [learningAnalytics, setLearningAnalytics] = useState({
    weakTopics: [],
    weakConcepts: [],
    totalAttempts: 0,
    recommendedRevision: [],
    dailyChallenge: { id: null, question: '', answer: '', completed: false, lastDate: null }
  });
  const [quizHistory, setQuizHistory] = useState([]);

  // ---- Command Center Upgrade state (migration-v10) ----
  // Quota & difficulty & achievements
  // Per-course round quota (v13): { [courseKey]: { questions_used, rounds_completed,
  //   last_round_completed_at, window_expires_at, cooldown_remaining_seconds, is_ready } }
  const [courseQuota, setCourseQuota] = useState({});
  const [difficultyProgress, setDifficultyProgress] = useState(null); // { Easy:{...}, ... }
  const [userAchievements, setUserAchievements] = useState([]);
  // Today's daily goal state — driven by the Daily Challenge widget. Powers the
  // 'daily-goal' achievement and is reset with the rest on sign-out.
  const [dailyChallengeDone, setDailyChallengeDone] = useState(false);
  const markDailyChallengeDone = useCallback(() => setDailyChallengeDone(true), []);
  // Celebration toast for freshly-earned achievements: { emoji, title, subtitle, tone } | null.
  const [achievementToast, setAchievementToast] = useState(null);
  const dismissAchievementToast = useCallback(() => setAchievementToast(null), []);
  // Flashcards are ADMIN-GRANTED (not premium). Server-authoritative flag.
  const [flashcardAccess, setFlashcardAccess] = useState(false);
  // Smart Coins are LOCKED until 1v1 launches (per product spec): every new
  // user starts at 0 and the faucet/spend stays dormant.
  const SC_FEATURE_LOCKED = true;

  // Dark mode must be applied to <html> for Tailwind's class strategy to work.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const fetchUserData = useCallback(async () => {
    if (!supabase || !session) return;
    try {
      const userId = session.user.id;
      let { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (profileError) console.error('Profile load failed:', profileError.message);

      // Safety net: if the DB trigger missed (fresh user, upsert race, manual
      // signup), create the profile here with the same fields the trigger uses.
      // 23505 = the trigger won the race, so just re-fetch the existing row.
      if (!profile) {
        const meta = session.user.user_metadata || {};
        const { error: createError } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            full_name: meta.full_name || '',
            email: session.user.email || '',
            phone: meta.phone || '',
            level: meta.nursing_year || '',
            milestone: 'Auxibaby 👶',
            is_activated: false,
            role: 'student'
          });
        if (!createError || createError?.code === '23505') {
          const { data: fresh } = await supabase.from('profiles').select('*').eq('id', userId).single();
          profile = fresh || null;
        } else {
          console.warn('Profile creation failed — user should retry later:', createError?.message);
        }
      }

      const { data: subscription } = await supabase.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();

      let subStatus = 'none';
      if (subscription) {
        const now = new Date();
        if (new Date(subscription.expires_at) > now) subStatus = 'active';
        else if (new Date(subscription.grace_until) > now) subStatus = 'grace';
        else subStatus = 'expired';
      }

      if (profile) {
        const role = profile.role || 'student';
        setUserProfile({
          fullName: profile.full_name || '',
          email: profile.email || '',
          phone: profile.phone || '',
          department: profile.department || '',
          level: profile.level || '',
          matricNumber: profile.matric_number || '',
          isActivated: !!profile.is_activated || role === 'super_admin' || role === 'admin',
          isAdmin: role === 'super_admin' || role === 'admin',
          role: role,
          subscriptionStatus: subStatus,
          subscriptionExpiry: subscription?.expires_at || null,
          graceUntil: subscription?.grace_until || null
        });

        setStudyStats(prev => ({
          ...prev,
          streak: profile.streak || 0,
          cardsStudied: profile.cards_studied || 0,
          quizStreak: profile.quiz_streak || 0,
          maxQuizStreak: profile.max_quiz_streak || 0,
          milestone: profile.milestone || 'Auxibaby 👶',
          lastStudyDate: profile.last_active_date || null
        }));

        setSmartCoins(Number(profile.smart_coins) || 0);
        setScLastPayout(profile.sc_last_payout || null);
        setScLastFailDate(profile.sc_last_fail_date || null);
      }

      // Smart coin ledger history (recent, for wallet/history UI).
      const { data: ledger } = await supabase.from('smart_coin_ledger')
        .select('id, amount, balance_after, reason, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(30);
      if (ledger) setScLedger(ledger);

      // Claim the daily SC grant for activated accounts (idempotent per day).
      await claimDailySC();

      // Learning analytics (weak topics)
      const { data: analytics } = await supabase.from('learning_analytics').select('*').eq('user_id', userId).maybeSingle();
      if (analytics) {
         setLearningAnalytics(prev => ({ ...prev, weakTopics: analytics.weak_topics || [], weakConcepts: analytics.weak_concepts || [], totalAttempts: analytics.total_attempts || 0 }));
      }

      // Weakness Challenge milestone — all-time question-attempt count
      const { count } = await supabase
        .from('question_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (typeof count === 'number') {
        setLearningAnalytics(prev => ({ ...prev, totalAttempts: count }));
      }
      computeWeakConcepts(userId);

      // SRS progress for bundled cards
      const { data: userCards } = await supabase.from('user_flashcards').select('*').eq('user_id', userId);
      if (userCards && userCards.length > 0) {
         setFlashcards(prev => {
             const userCardMap = new Map(userCards.map(c => [c.flashcard_id, c]));
             return prev.map(c => {
                 if (userCardMap.has(c.id)) {
                     const uc = userCardMap.get(c.id);
                     return { ...c, srs: { reps: uc.reps, interval: uc.interval, efactor: uc.efactor, nextReview: uc.next_review }};
                 }
                 return c;
             });
         });
      }

      // Exams
      const { data: userExams } = await supabase.from('exams').select('*').eq('user_id', userId);
      if (userExams) {
         setExams(userExams.map(mapExamFromDb));
      }

      // Level completions (for difficulty unlocking)
      refreshLevelCompletions(userId);
      fetchQuizHistory(userId);
    } catch (e) {
      console.error("Fetch data error:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const fetchQuizHistory = async (userId) => {
    if (!supabase) return;
    const uid = userId || session?.user?.id;
    if (!uid) return;
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from('quiz_results')
      .select('subject, score, total, passed, difficulty, duration_seconds, created_at')
      .eq('user_id', uid)
      .gte('created_at', since)
      .order('created_at', { ascending: false });
    setQuizHistory(data || []);
  };

  const refreshLevelCompletions = async (userId) => {
    if (!supabase) return;
    const uid = userId || session?.user?.id;
    if (!uid) return;
    const { data } = await supabase
      .from('user_quiz_progress')
      .select('level_key, difficulty')
      .eq('user_id', uid)
      .eq('passed', true);
    const counts = {};
    (data || []).forEach(row => {
      counts[row.difficulty] = (counts[row.difficulty] || 0) + 1;
    });
    setLevelCompletions(counts);
  };

  // Load custom flashcards: global (admin) cards visible to everyone,
  // personal cards only for their owner.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      let query = supabase.from('custom_flashcards').select('*');
      if (session?.user?.id) {
        query = query.or(`user_id.is.null,user_id.eq.${session.user.id}`);
      } else {
        query = query.is('user_id', null);
      }
      const { data, error } = await query.order('created_at', { ascending: false }).limit(500);
      if (error || cancelled || !data) return;
      const mapped = data.map(mapCustomCardFromDb);
      setFlashcards(prev => {
        const withoutCustom = prev.filter(c => !String(c.id).startsWith('db_'));
        return [...withoutCustom, ...mapped];
      });
    })();
    return () => { cancelled = true; };
  }, [session]);

  // ---------- Exam CRUD (write-through) ----------
  const mapExamToDb = (data) => ({
    title: data.title,
    date: data.date,
    time: data.time || '',
    venue: data.venue || '',
    lecturer: data.lecturer || '',
    type: data.type || 'Written',
    priority: data.priority || 'Medium',
    notes: data.notes || '',
    study_materials: data.studyMaterials || '',
    reminders: data.reminders || ['1 day before'],
    topics: data.topics || [],
    readiness: data.readiness ?? 0,
    subject: data.subject || ''
  });

  const mapExamFromDb = (row) => ({
    id: row.id,
    title: row.title,
    date: row.date,
    time: row.time || '',
    venue: row.venue || '',
    lecturer: row.lecturer || '',
    type: row.type || 'Written',
    priority: row.priority || 'Medium',
    notes: row.notes || '',
    studyMaterials: row.study_materials || '',
    reminders: row.reminders || ['1 day before'],
    topics: row.topics || [],
    readiness: row.readiness || 0,
    subject: row.subject || ''
  });

  const addExam = async (data) => {
    if (supabase && session) {
      const { data: row, error } = await supabase
        .from('exams')
        .insert({ ...mapExamToDb(data), user_id: session.user.id })
        .select()
        .single();
      if (error) {
        console.error('Exam save failed:', error.message);
        setExams(prev => [...prev, { ...data, id: `local_${Date.now()}` }]);
        return;
      }
      setExams(prev => [...prev, mapExamFromDb(row)]);
    } else {
      setExams(prev => [...prev, { ...data, id: `local_${Date.now()}` }]);
    }
  };

  const updateExam = async (id, data) => {
    setExams(prev => prev.map(e => (e.id === id ? { ...data, id } : e)));
    if (supabase && session && !String(id).startsWith('local_')) {
      const { error } = await supabase
        .from('exams')
        .update(mapExamToDb(data))
        .eq('id', id)
        .eq('user_id', session.user.id);
      if (error) console.error('Exam update failed:', error.message);
    }
  };

  const deleteExam = async (id) => {
    setExams(prev => prev.filter(e => e.id !== id));
    if (supabase && session && !String(id).startsWith('local_')) {
      const { error } = await supabase
        .from('exams')
        .delete()
        .eq('id', id)
        .eq('user_id', session.user.id);
      if (error) console.error('Exam delete failed:', error.message);
    }
  };

  // ============ SMART COIN (SC) ============
  const scTodayStr = useCallback(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

  const scIsToday = useCallback((isoOrDate) => {
    if (!isoOrDate) return false;
    const d = new Date(isoOrDate);
    if (isNaN(d.getTime())) return String(isoOrDate) === scTodayStr();
    return scTodayStr() === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, [scTodayStr]);

  // Apply an SC delta locally + persist, with audit ledger row. amount is
  // signed (+ earn, - loss). Never lets the wallet go below 0.
  // Smart Coins are LOCKED until 1v1 launches — all mutations are no-ops.
  const applySC = useCallback(async (amount, reason, refId = null) => {
    if (SC_FEATURE_LOCKED) return smartCoins;
    if (!session) return;
    const delta = Number(amount) || 0;
    const next = Math.max(0, smartCoins + delta);
    if (delta !== 0) setSmartCoins(next);

    if (supabase) {
      await supabase.from('profiles')
        .update({ smart_coins: next })
        .eq('id', session.user.id);
      if (delta !== 0) {
        const { data } = await supabase.from('smart_coin_ledger')
          .insert({ user_id: session.user.id, amount: delta, balance_after: next, reason, ref_id: refId ?? null })
          .select('id, amount, balance_after, reason, created_at')
          .single();
        if (data) setScLedger(prev => [data, ...prev].slice(0, 30));
      }
    }
    return next;
  }, [session, smartCoins]);

  // Daily 9 SC for activated accounts (granted once per day, no rollover).
  // Smart Coins are LOCKED until 1v1 launches — the faucet stays dormant.
  const claimDailySC = useCallback(async () => {
    if (SC_FEATURE_LOCKED) return 0;
    if (!session) return 0;
    const activated = userProfile.isActivated;
    if (!activated) return smartCoins;

    if (scIsToday(scLastPayout)) return smartCoins; // already granted today
    return applySC(SC_DAILY_PAYOUT, 'daily_activated');
  }, [session, userProfile.isActivated, scIsToday, scLastPayout, applySC, smartCoins]);

  // Small capped bonus from study accomplishments (kept limited to stay rare).
  const earnSC = useCallback(async (amount, reason, refId = null) => {
    if (SC_FEATURE_LOCKED) return smartCoins;
    if (!session) return smartCoins;
    return applySC(Number(amount) || 0, reason || 'bonus', refId);
  }, [session, applySC, smartCoins]);

  // Spend SC on power-ups etc. Refuses if insufficient. Returns new balance.
  // Smart Coins locked — spending is disabled until 1v1 launches.
  const spendSC = useCallback(async (amount, reason, refId = null) => {
    if (SC_FEATURE_LOCKED) return smartCoins;
    if (!session) return smartCoins;
    const cost = Math.abs(Number(amount) || 0);
    if (cost > smartCoins) return smartCoins;
    return applySC(-cost, reason || 'spend', refId);
  }, [session, smartCoins, applySC]);

  // -5 SC when the daily activity streak is broken (gap of >= 1 day).
  // An active streak-freeze consumes itself instead, waiving the penalty.
  const recordStreakBreak = useCallback(async () => {
    if (SC_FEATURE_LOCKED) return;
    if (!session) return;
    if (streakFreezeActive) {
      setStreakFreezeActive(false);
      return; // freeze absorbed the break — no SC lost
    }
    await applySC(-SC_STREAK_BREAK_PENALTY, 'streak_break');
  }, [session, streakFreezeActive, applySC]);

  // -3 SC on a failed quiz, but only once per day (fair + keeps SC rare).
  const recordQuizFailPenalty = useCallback(async (refId = null) => {
    if (SC_FEATURE_LOCKED) return;
    if (!session) return;
    if (scIsToday(scLastFailDate)) return; // already penalized today
    setScLastFailDate(scTodayStr());
    if (supabase) {
      await supabase.from('profiles')
        .update({ sc_last_fail_date: scTodayStr() })
        .eq('id', session.user.id);
    }
    await applySC(-SC_QUIZ_FAIL_PENALTY, 'quiz_fail', refId);
  }, [session, scIsToday, scLastFailDate, scTodayStr, applySC]);

  // Advance the member's per-group quiz streak via the group member RPC.
  // Only meaningful when a quiz is launched from a study group.
  const bumpGroupQuizStreak = useCallback(async (groupId) => {
    if (!session || groupId == null || !supabase) return null;
    try {
      const { data, error } = await supabase
        .rpc('bump_group_quiz_streak', { p_group_id: Number(groupId), p_user_id: session.user.id });
      if (error) console.warn('Group streak bump failed:', error.message);
      return error ? null : data;
    } catch (err) {
      console.warn('Group streak bump failed:', err.message);
      return null;
    }
  }, [session]);

  // Global rank by Smart Coin balance: number of users with strictly more SC
  // than the current user, plus one. Uses the idx_profiles_smart_coins index.
  const fetchSCRank = useCallback(async () => {
    if (!session || !supabase) return null;
    try {
      const { count, error } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .gt('smart_coins', smartCoins);
      if (error) return null;
      return (count ?? 0) + 1;
    } catch {
      return null;
    }
  }, [session, smartCoins]);

  // ---------- Streaks & study activity ----------
  const touchActivity = useCallback(async () => {
    const now = new Date();
    const todayStr = now.toDateString();
    const last = studyStats.lastStudyDate ? new Date(studyStats.lastStudyDate) : null;

    let nextStreak = studyStats.streak || 0;
    let brokeStreak = false;
    if (!last) {
      nextStreak = Math.max(1, nextStreak);
    } else if (last.toDateString() !== todayStr) {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const wasYesterday = last.toDateString() === yesterday.toDateString();
      nextStreak = wasYesterday ? nextStreak + 1 : 1;
      // Streak was broken if the last activity was more than one day ago.
      brokeStreak = !wasYesterday;
    } else {
      return; // already counted today
    }

    setStudyStats(prev => ({ ...prev, streak: nextStreak, lastStudyDate: now.toISOString() }));
    if (supabase && session) {
      await supabase
        .from('profiles')
        .update({ streak: nextStreak, last_active_date: now.toISOString() })
        .eq('id', session.user.id);
    }
    // Penalize a broken streak with -5 SC (study loss mechanic).
    if (brokeStreak && nextStreak === 1) {
      await recordStreakBreak();
    }
  }, [studyStats.streak, studyStats.lastStudyDate, session, recordStreakBreak]);

  const persistStats = useCallback(async (fields) => {
    if (!supabase || !session || !fields || Object.keys(fields).length === 0) return;
    const { error } = await supabase.from('profiles').update(fields).eq('id', session.user.id);
    if (error) console.warn('Stats save failed:', error.message);
  }, [session]);

  const updateQuizStats = (data) => {
    setStudyStats(prev => {
      const next = {
        ...prev,
        ...data,
        quizStreak: data.quizStreak !== undefined ? data.quizStreak : prev.quizStreak,
        maxQuizStreak: (data.quizStreak !== undefined ? data.quizStreak : prev.quizStreak) > prev.maxQuizStreak
          ? (data.quizStreak !== undefined ? data.quizStreak : prev.quizStreak)
          : prev.maxQuizStreak
      };
      // Persist quiz streak fields server-side.
      persistStats({
        quiz_streak: next.quizStreak,
        max_quiz_streak: next.maxQuizStreak,
        milestone: next.milestone
      });
      return next;
    });
  };

  const incrementCardsStudied = () => {
    setStudyStats(prev => {
      const next = { ...prev, cardsStudied: prev.cardsStudied + 1 };
      persistStats({ cards_studied: next.cardsStudied });
      return next;
    });
    touchActivity();
  };

  // ---------- Quiz results & progression ----------
  const recordQuizResult = async ({ mode = 'standard', difficulty = 'Easy', subject = '', score = 0, total = 0, durationSeconds = 0, groupId = null }) => {
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const thresholds = { Easy: 50, Medium: 60, Hard: 70, Expert: 75, Master: 80, Extreme: 85 };
    const passed = pct >= (thresholds[difficulty] ?? 60);

    // Local stats/milestone feedback
    updateQuizStats({});
    // SC performance reward — flat, auto-credited to the wallet balance.
    // Correct answers pay base (0.1 SC) except on Hard/Expert difficulty,
    // which pay 0.5 SC per correct answer. The daily 9 SC faucet and the
    // -3 SC fail penalty remain separate.

    if (!supabase || !session) return passed;

    const levelKey = `${subject || 'Mixed Bank'}|${difficulty}`;

    let resultId = null;
    const { data: resData, error: resError } = await supabase.from('quiz_results').insert({
      user_id: session.user.id,
      mode,
      difficulty,
      subject,
      score,
      total,
      passed,
      duration_seconds: durationSeconds,
      group_id: groupId ?? null
    }).select('id').single();
    if (resError) console.error('Quiz result save failed:', resError.message);
    else resultId = resData?.id;

    // -3 SC on failed quiz, capped at once per day.
    if (!passed) {
      await recordQuizFailPenalty(resultId);
    }

    // Auto-credit the SC performance reward for this session. Hard/Expert
    // difficulty pays 0.5 per correct answer; all other difficulties pay 0.1.
    const lowTier = String(difficulty).toLowerCase();
    const rate = (lowTier === 'hard' || lowTier === 'expert' || lowTier === 'extreme') ? 0.5 : 0.1;
    const payout = Math.max(0, Number(score) || 0) * rate;
    if (payout > 0) {
      await applySC(payout, 'quiz_performance', resultId);
    }

    // Per-group "unique streak": advancing a member's streak inside a study
    // group when they pass a quiz launched from that group (reset on a gap).
    if (passed && groupId != null) {
      await bumpGroupQuizStreak(groupId);
    }

    // Upsert progression row for this level key
    const { error: progError } = await supabase.from('user_quiz_progress').upsert({
      user_id: session.user.id,
      level_key: levelKey,
      difficulty,
      score,
      total,
      passed,
      best_score: pct,
      attempts: 1,
      completed_at: passed ? new Date().toISOString() : null
    }, { onConflict: 'user_id,level_key' });
    // attempts/best_score need manual merge on conflict — do a follow-up read/update
    if (progError) {
      console.error('Progress save failed:', progError.message);
    } else {
      // merge attempts + best_score properly
      const { data: existing } = await supabase
        .from('user_quiz_progress')
        .select('attempts, best_score, passed')
        .match({ user_id: session.user.id, level_key: levelKey })
        .single();
      if (existing) {
        const shouldStayPassed = existing.passed || passed;
        await supabase
          .from('user_quiz_progress')
          .update({
            attempts: (existing.attempts || 1),
            best_score: Math.max(existing.best_score || 0, pct),
            passed: shouldStayPassed
          })
          .match({ user_id: session.user.id, level_key: levelKey });
      }
      refreshLevelCompletions(session.user.id);
    }

    fetchQuizHistory(session.user.id);
    touchActivity();
    return passed;
  };

  // Merge wrong answers into learning_analytics.weak_topics (top 10 by count)
  const recordWrongAnswers = async (wrongs) => {
    if (!wrongs || wrongs.length === 0) return;
    // Local merge for immediate dashboard feedback
    setLearningAnalytics(prev => {
      const merged = mergeWeakTopics(prev.weakTopics, wrongs);
      return { ...prev, weakTopics: merged };
    });

    if (!supabase || !session) return;
    const userId = session.user.id;
    const { data: existing } = await supabase
      .from('learning_analytics')
      .select('weak_topics')
      .eq('user_id', userId)
      .maybeSingle();

    const merged = mergeWeakTopics(existing?.weak_topics || [], wrongs);
    const { error } = await supabase
      .from('learning_analytics')
      .upsert({ user_id: userId, weak_topics: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) console.warn('Weak topics save failed:', error.message);
  };

  const mergeWeakTopics = (current, wrongs) => {
    const map = new Map();
    (current || []).forEach(t => {
      const key = `${t.name}|${t.subject}`;
      map.set(key, { name: t.name, subject: t.subject, count: Number(t.count) || 1 });
    });
    wrongs.forEach(w => {
      const name = w.name || w.topic || w.question?.slice(0, 40) || 'Unknown Topic';
      const subject = w.subject || 'General';
      const key = `${name}|${subject}`;
      map.set(key, { ...(map.get(key) || { name, subject, count: 0 }), count: ((map.get(key)?.count) || 0) + 1 });
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  };

  // ---------- Weakness Challenge ----------
  // Weak concept = topic with accuracy < 60% across >= 2 attempts
  // (rolling 90-day window). Top 14 by accuracy drive "Fix My Weak
  // Areas". Persisted to learning_analytics.weak_concepts.
  const computeWeakConcepts = async (userId) => {
    if (!supabase || !userId) return;
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('question_attempts')
      .select('topic, subject, correct')
      .eq('user_id', userId)
      .gte('created_at', since);
    if (error || !data) {
      if (error) console.warn('Weak concepts fetch failed:', error.message);
      return;
    }

    const groups = new Map();
    data.forEach(a => {
      const name = String(a.topic || 'General').trim() || 'General';
      const key = `${name}::${a.subject || 'General'}`;
      if (!groups.has(key)) {
        groups.set(key, { name, subject: a.subject || 'General', attempts: 0, correct: 0 });
      }
      const g = groups.get(key);
      g.attempts += 1;
      if (a.correct) g.correct += 1;
    });

    const weakConcepts = Array.from(groups.values())
      .filter(g => g.attempts >= 2)
      .map(g => ({ name: g.name, subject: g.subject, attempts: g.attempts, accuracy: +(g.correct / g.attempts).toFixed(3) }))
      .filter(g => g.accuracy < 0.6)
      .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)
      .slice(0, 14);

    const totalAttempts = data.length;
    setLearningAnalytics(prev => ({ ...prev, weakConcepts, totalAttempts }));

    const { error: upError } = await supabase
      .from('learning_analytics')
      .upsert({ user_id: userId, weak_concepts: weakConcepts, total_attempts: totalAttempts, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (upError) console.warn('Weak concepts save failed:', upError.message);
  };

  // Log one row per answered quiz question (correct/wrong/timed-out) so the
  // weakness engine has per-topic accuracy data. Call after a quiz completes.
  const recordAttempts = async (answers) => {
    if (!answers || answers.length === 0) return;
    if (!supabase || !session?.user) return;
    const userId = session.user.id;

    setLearningAnalytics(prev => ({ ...prev, totalAttempts: (prev.totalAttempts || 0) + answers.length }));

    const rows = answers.map(a => ({
      user_id: userId,
      question_id: String(a.questionId ?? a.id ?? ''),
      question: String(a.question || '').slice(0, 2000),
      topic: (String(a.topic || '').trim() || 'General'),
      subject: a.subject || 'General',
      correct: !!a.correct,
      timed_out: !!a.timedOut,
      mode: a.mode || 'standard',
      difficulty: a.difficulty || ''
    }));

    const { error } = await supabase
      .from('question_attempts')
      .insert(rows);
    if (error) {
      console.warn('Attempt log failed:', error.message);
      // Roll back the optimistic count so the milestone stays accurate.
      setLearningAnalytics(prev => ({ ...prev, totalAttempts: Math.max(0, (prev.totalAttempts || 0) - answers.length) }));
      return;
    }
    await computeWeakConcepts(userId);
  };

  // One feedback vote per (user, question): 👍 = true / 👎 = false, with an
  // optional report reason. Upserts so a learner can change their rating.
  // Feeds admin quality monitoring of the question bank.
  const submitQuestionFeedback = useCallback(async ({ questionId: qid, rating, reason = '' }) => {
    if (!session || !supabase) return;
    const qId = String(qid == null ? '' : qid).trim();
    if (!qId) return;
    try {
      await supabase.from('question_feedback').upsert(
        {
          user_id: session.user.id,
          question_id: qId,
          rating: !!rating,
          reason: String(reason || '').slice(0, 500),
          created_at: new Date().toISOString()
        },
        { onConflict: 'user_id,question_id' }
      );
    } catch (err) {
      // The table may not exist yet on environments where migration-v7 hasn't
      // been applied; never let a feedback write break the quiz flow.
      console.warn('Question feedback save failed:', err.message);
    }
  }, [session]);

  // Fetch the set of question ids the user has already answered (from
  // question_attempts). Drives the no-repetition + same-niche selection engine.
  const fetchAttemptedQuestionIds = useCallback(async () => {
    if (!session || !supabase) return new Set();
    try {
      const { data, error } = await supabase
        .from('question_attempts')
        .select('question_id')
        .eq('user_id', session.user.id);
      if (error) return new Set();
      return new Set((data || []).map(r => String(r.question_id)).filter(Boolean));
    } catch {
      return new Set();
    }
  }, [session]);

  // Full per-question history for the scored selection engine. Returns
  // { attemptedIds: Set, questionHistory: Map<qid, row>, nicheCounts: Map<key, count> }.
  // Exposed so Quiz.jsx can build its `userState` for selectQuestions().
  const fetchQuestionHistory = useCallback(async () => {
    if (!session || !supabase) {
      return { attemptedIds: new Set(), questionHistory: new Map(), nicheCounts: new Map() };
    }
    try {
      const { data, error } = await supabase
        .from('question_attempts')
        .select('question_id, question, topic, subject, created_at, correct')
        .eq('user_id', session.user.id);
      if (error) {
        console.warn('Question history fetch failed:', error.message);
        return { attemptedIds: new Set(), questionHistory: new Map(), nicheCounts: new Map() };
      }
      const attemptedIds = new Set();
      const questionHistory = new Map();
      const nicheCounts = new Map();
      (data || []).forEach(r => {
        const qid = String(r.question_id || '').trim();
        if (!qid) return;
        attemptedIds.add(qid);
        const existing = questionHistory.get(qid);
        if (!existing || new Date(r.created_at).getTime() > new Date(existing.last_seen).getTime()) {
          questionHistory.set(qid, {
            last_seen: r.created_at,
            last_result: !!r.correct,
            correct_count: existing?.correct_count ?? 0,
            attempt_count: existing?.attempt_count ?? 1
          });
        }
        // Same-niche-different-angle counting uses topic then subject.
        const key = String(r.topic || r.subject || 'General').trim() || 'General';
        nicheCounts.set(key, (nicheCounts.get(key) || 0) + 1);
      });
      return { attemptedIds, questionHistory, nicheCounts };
    } catch {
      return { attemptedIds: new Set(), questionHistory: new Map(), nicheCounts: new Map() };
    }
  }, [session]);

  // Real failed questions from the learner's answer log (most recent first).
  // Powers the Weakness Drill page — these are the actual wrong answers, not
  // abstract "topics".
  const fetchFailedQuestions = useCallback(async () => {
    if (!session || !supabase) return [];
    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('question_attempts')
        .select('question_id, question, topic, subject, difficulty, created_at')
        .eq('user_id', session.user.id)
        .eq('correct', false)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(40);
      if (error) {
        console.warn('Failed questions fetch failed:', error.message);
        return [];
      }
      return data || [];
    } catch {
      return [];
    }
  }, [session]);

  // ---------- Plans & transactions ----------
  useEffect(() => {
    // Fallback plans are always available so the payment page never renders
    // empty. IDs match the seeded subscription_plans table (Monthly=1,
    // Weekly=2, Yearly=3) so server-side plan resolution stays consistent
    // even if the live query fails or returns no rows.
    const FALLBACK_PLANS = [
      { id: 1, name: 'Monthly', price: 6999, duration_days: 30, is_active: true },
      { id: 2, name: 'Weekly', price: 1999.9, duration_days: 7, is_active: true },
      { id: 3, name: 'Yearly', price: 49999, duration_days: 365, is_active: true }
    ];
    if (!supabase) {
      setSubscriptionPlans(FALLBACK_PLANS);
      return;
    }
    supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          setSubscriptionPlans(data);
        } else {
          setSubscriptionPlans(FALLBACK_PLANS);
        }
      })
      .catch(() => setSubscriptionPlans(FALLBACK_PLANS));
  }, []);

  useEffect(() => {
    if (!supabase || !session) return;
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data, error }) => {
        if (!error && data) {
          setTransactions(data.map(t => ({
            ...t,
            type: t.metadata?.type || 'Subscription',
            date: t.paid_at || t.created_at,
            receiptNo: `RC-${String(t.id).padStart(5, '0')}`,
            releaseStatus: 'Released'
          })));
        }
      });
  }, [session]);

  useEffect(() => {
    if (!supabase) {
      setLoadingAuth(false);
      return;
    }

    const initAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) {
          setSession(currentSession);
          // Refresh the stored session so the access token is fresh on reload
          // (covers near-expiry tokens without waiting for an API 401).
          const refreshed = await supabase.auth.refreshSession();
          if (refreshed?.error) console.warn('Session refresh skipped:', refreshed.error.message);
          else if (refreshed?.data?.session) setSession(refreshed.data.session);
        }
      } catch (err) {
        console.error('Auth init error:', err);
      } finally {
        setLoadingAuth(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (event === 'SIGNED_IN') {
        setSession(currentSession);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUserProfile(ANONYMOUS_PROFILE);
        setExams([]);
        setTransactions([]);
        setLevelCompletions({});
        setQuizHistory([]);
        setCourseQuota({});
        setDifficultyProgress(null);
        setUserAchievements([]);
        setDailyChallengeDone(false);
        setAchievementToast(null);
      }
      setLoadingAuth(false);
    });

    return () => { if (subscription) subscription.unsubscribe(); };
  }, []);

  // ---------------- Command Center helpers ----------------

  // Builds the shared auth headers for Apex API routes.
  const apexHeaders = useCallback((sess) => authHeaders(sess), []);

  // Server-verified premium: derived from the fetched subscription status
  // (single source of truth from subscriptions table, not a client flag).
  const isPremium = useMemo(
    () => userProfile.subscriptionStatus === 'active' || userProfile.subscriptionStatus === 'grace',
    [userProfile.subscriptionStatus]
  );

  // ---- Per-course round quota (v13): free = 10 Q / 1h cooldown per course ----
  // Server-authoritative: we only mirror what the server RPCs return. No local
  // arithmetic, no optimistic updates, nothing a manipulated client could fake.
  const fetchCourseQuotaStatus = useCallback(async (sess = session) => {
    if (!sess?.access_token) return;
    try {
      const res = await fetch('/api/quota/course-status', {
        method: 'GET',
        headers: apexHeaders(sess)
      });
      const body = await res.json();
      if (res.ok) {
        setCourseQuota(body.subjects || {});
      }
    } catch (err) {
      console.warn('Course quota fetch skipped:', err.message);
    }
  }, [session?.access_token, apexHeaders]);

  // Reserve a round for a course. FREE users are charged exactly 10 questions +
  // a 1h cooldown server-side; PREMIUM users reserve 10-30 with no cooldown.
  // Returns the authoritative server state, or null if the call failed.
  const consumeCourseQuota = useCallback(async (courseKey, count = 10, sess = session) => {
    if (!sess?.access_token || !courseKey) return null;
    try {
      const headers = apexHeaders(sess);
      headers['Content-Type'] = 'application/json';
      const res = await fetch('/api/quota/course-consume', {
        method: 'POST',
        headers,
        body: JSON.stringify({ course_key: courseKey, count })
      });
      const body = await res.json();
      if (res.ok) {
        setCourseQuota(prev => ({
          ...prev,
          [courseKey]: {
            questions_used: body.questions_used,
            rounds_completed: body.rounds_completed,
            last_round_completed_at: body.last_round_completed_at,
            window_expires_at: body.window_expires_at,
            cooldown_remaining_seconds: body.cooldown_remaining_seconds ?? 0,
            is_ready: !!body.is_ready
          }
        }));
        return body;
      }
      return null;
    } catch (err) {
      console.warn('Course quota consume skipped:', err.message);
      return null;
    }
  }, [session?.access_token, apexHeaders]);

  // ---- Difficulty unlocks (server-side) ----
  const fetchDifficultyStatus = useCallback(async (sess = session) => {
    if (!sess?.access_token) return;
    try {
      const res = await fetch('/api/progress/difficulty', {
        method: 'GET',
        headers: apexHeaders(sess)
      });
      const body = await res.json();
      if (res.ok && body?.progress) {
        setDifficultyProgress(body.progress);
      }
    } catch (err) {
      console.warn('Difficulty fetch skipped:', err.message);
    }
  }, [session?.access_token, apexHeaders]);

  // Record a batch of answered questions for difficulty + history on server.
  const recordAnsweredBatch = useCallback(async ({ difficulty, answers }, sess = session) => {
    if (!sess?.access_token) return;
    try {
      const headers = apexHeaders(sess);
      headers['Content-Type'] = 'application/json';
      await fetch('/api/progress/difficulty', {
        method: 'POST',
        headers,
        body: JSON.stringify({ difficulty, answers })
      });
      fetchDifficultyStatus(sess);
    } catch (err) {
      console.warn('Progress record skipped:', err.message);
    }
  }, [session, fetchDifficultyStatus, apexHeaders]);

  // ---- Identity engine: derive current tier from real learning stats ----
  // Declared BEFORE the achievements helpers below (syncAchievements depends on
  // `identity`); keeping it here avoids a TDZ crash on app mount.
  const identityStats = useMemo(() => {
    const totalQ = quizHistory.reduce((sum, r) => sum + (r.total || 0), 0);
    const correctQ = quizHistory.reduce((sum, r) => sum + (r.score || 0), 0);
    const attempts = learningAnalytics.totalAttempts || 0;
    // Prefer live attempt log; fall back to quiz-history total when empty.
    const totalAttempts = attempts > 0 ? attempts : totalQ;
    return {
      totalAttempts,
      quizStreak: studyStats.quizStreak || 0,
      cardsStudied: studyStats.cardsStudied || 0,
      accuracy: totalQ > 0 ? Math.round((correctQ / totalQ) * 100) : 0,
      scEarned: smartCoins || 0,
      speedRuns: 0
    };
  }, [quizHistory, learningAnalytics.totalAttempts, studyStats.quizStreak, studyStats.cardsStudied, smartCoins]);

  const identity = useMemo(() => computeCurrentIdentity(identityStats), [identityStats]);

  // ---- Achievements ----
  const fetchAchievements = useCallback(async (sess = session) => {
    if (!sess?.access_token || !supabase) return;
    try {
      const { data } = await supabase
        .from('user_achievements')
        .select('achievement_id, unlocked_at');
      setUserAchievements(data || []);
    } catch (err) {
      console.warn('Achievements fetch skipped:', err.message);
    }
  }, [session, supabase]);

  // Persist newly-earned achievements (client-side deterministic evaluation —
  // same engine as the wall page). Idempotent: unique (user_id, achievement_id).
  // No server formula needed; the catalog is publicly readable.
  const syncAchievements = useCallback(async (sess = session) => {
    if (!sess?.user?.id || !supabase) return;
    try {
      const earned = evaluateAchievements({
        quizHistory,
        studyStats,
        levelCompletions,
        learningAnalytics,
        identity,
        dailyGoalDone: dailyChallengeDone
      });
      if (earned.length === 0) return;

      const [catalogRes, ownedRes] = await Promise.all([
        supabase.from('achievements').select('id, key'),
        supabase.from('user_achievements').select('achievement_id')
      ]);
      if (catalogRes.error || ownedRes.error) return;

      const keyToId = new Map((catalogRes.data || []).map(r => [r.key, r.id]));
      const owned = new Set((ownedRes.data || []).map(r => String(r.achievement_id)));
      const toInsert = [];
      const newly = [];

      for (const key of earned) {
        const id = keyToId.get(key);
        if (id == null || owned.has(String(id))) continue;
        toInsert.push({ user_id: sess.user.id, achievement_id: id });
        newly.push(ACHIEVEMENT_CATALOG.find(a => a.key === key) || { key, name: key, emoji: '🏆' });
      }
      if (toInsert.length === 0) return;

      const { error } = await supabase.from('user_achievements').insert(toInsert);
      if (error) {
        console.warn('Achievements sync skipped:', error.message);
        return;
      }
      setUserAchievements(prev => [
        ...prev,
        ...toInsert.map(r => ({ achievement_id: r.achievement_id, unlocked_at: new Date().toISOString() }))
      ]);
      if (newly.length > 0) {
        // Queue celebration toast (one per fresh unlock — pick the newest).
        setAchievementToast({
          id: Date.now(),
          emoji: newly[0].emoji || '🏆',
          title: newly[0].name || 'Achievement Unlocked',
          subtitle: newly.length > 1 ? `Plus ${newly.length - 1} more unlocked!` : 'New milestone reached.',
          tone: newly[0].tone || 'bg-apex-600'
        });
      }
      return newly;
    } catch (err) {
      console.warn('Achievements sync failed:', err.message);
      return;
    }
  }, [session, supabase, quizHistory, studyStats, levelCompletions, learningAnalytics, identity, dailyChallengeDone]);

  // Re-evaluate achievements whenever learning signals change (after a quiz,
  // a streak bump, a difficulty unlock, or completing the daily goal).
  const achievementTick = useMemo(
    () => `${quizHistory.length}|${studyStats?.streak || 0}|${studyStats?.quizStreak || 0}|${learningAnalytics?.totalAttempts || 0}|${Object.keys(levelCompletions || {}).length}|${dailyChallengeDone ? '1' : '0'}`,
    [quizHistory.length, studyStats?.streak, studyStats?.quizStreak, learningAnalytics?.totalAttempts, levelCompletions, dailyChallengeDone]
  );
  useEffect(() => {
    if (!session?.user) return;
    const t = setTimeout(() => syncAchievements(), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achievementTick, session?.user]);

  // ---- Flashcards: admin-granted access (server-authoritative RPC) ----
  // Not premium-gated. Re-runs on session/mount so revoked users revalidate
  // on refresh. SECURITY DEFINER `can_access_flashcards` bypasses profiles RLS.
  const fetchFlashcardAccess = useCallback(async (sess = session) => {
    if (!sess?.access_token || !supabase) return;
    try {
      const { data } = await supabase.rpc('can_access_flashcards');
      setFlashcardAccess(!!data);
    } catch (err) {
      console.warn('Flashcard access fetch skipped:', err.message);
    }
  }, [session, supabase]);

  // ---- Reset quota when logging out ----
  useEffect(() => {
    if (!supabase) setLoadingAuth(false);
  }, [supabase]);

  useEffect(() => {
    if (session) fetchUserData();
  }, [session, fetchUserData]);

  // Load Command Center state once a session is established (quota, difficulty,
  // achievements, flashcard access).
  useEffect(() => {
    if (!session?.access_token) return;
fetchCourseQuotaStatus();
  fetchDifficultyStatus();
    fetchAchievements();
    fetchFlashcardAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const updateProfile = (data) => setUserProfile(prev => ({ ...prev, ...data }));
  const toggleSound = () => {
    setSoundEnabled(s => {
      safeSet('soundEnabled', JSON.stringify(!s));
      return !s;
    });
  };
  const toggleDarkMode = () => {
    setDarkMode(d => {
      safeSet('darkMode', JSON.stringify(!d));
      return !d;
    });
  };

  // ---------- SRS card progress (persisted) ----------
  const updateCardProgress = (id, quality) => {
     setFlashcards(prev => prev.map(c => {
        if (c.id === id) {
           const prevReps = c.srs?.reps || 0;
           const prevInterval = c.srs?.interval || 0;
           const prevEF = c.srs?.efactor || 2.5;
           let reps = quality >= 3 ? prevReps + 1 : 0;
           let interval = quality >= 3 ? (reps === 1 ? 1 : (reps === 2 ? 6 : Math.round(prevInterval * prevEF))) : 1;
           let efactor = Math.max(1.3, prevEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
           return { ...c, srs: { reps, interval, efactor, nextReview: new Date(Date.now() + interval * 24 * 3600 * 1000).toISOString() } };
        }
        return c;
     }));

     if (supabase && session) {
       const card = flashcards.find(c => c.id === id);
       if (card?.srs) {
         const mastered = card.srs.reps >= 3 && card.srs.interval >= 21;
         const status = mastered ? 'mastered' : card.srs.reps > 0 ? 'review' : 'learning';
         supabase
           .from('user_flashcards')
           .upsert({
             user_id: session.user.id,
             flashcard_id: String(id),
             reps: card.srs.reps,
             interval: card.srs.interval,
             efactor: card.srs.efactor,
             next_review: card.srs.nextReview,
             status,
             review_count: (card.reviewCount || 0) + 1,
             times_seen: (card.timesSeen || 0) + 1,
             times_correct: (card.timesCorrect || 0) + (quality >= 3 ? 1 : 0),
             mastered,
             last_reviewed_at: new Date().toISOString()
           }, { onConflict: 'user_id,flashcard_id' })
           .then(({ error }) => { if (error) console.warn('SRS save failed:', error.message); });
       }
     }
     touchActivity();
  };

  // ---------- Custom flashcards (write-through) ----------
  const mapCustomCardFromDb = (row) => ({
    id: `db_${row.id}`,
    dbId: row.id,
    question: row.question,
    answer: row.correct_answer || row.answer,
    correctAnswer: row.correct_answer || row.answer,
    options: Array.isArray(row.options) && row.options.length > 0 ? row.options : null,
    subject: row.subject,
    topic: row.topic || '',
    unit: row.unit || '',
    difficulty: row.difficulty || 'Easy',
    level: row.level || 'Year 1',
    semester: row.semester || 'Semester 1',
    category: row.category || 'Custom',
    source: row.source || (row.user_id ? 'Personal Bank' : 'Apex Faculty Bank'),
    hint: row.hint || '',
    rationale: row.rationale || '',
    important: !!row.important,
    isPending: !!row.is_pending,
    isGlobal: row.user_id === null,
    srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() }
  });

  const mapCardToDb = (card) => ({
    question: card.question,
    answer: card.answer || card.correctAnswer,
    options: card.options && card.options.length > 0 ? card.options : null,
    correct_answer: card.correctAnswer || card.answer,
    subject: card.subject || 'General',
    topic: card.topic || '',
    unit: card.unit || '',
    difficulty: card.difficulty || 'Easy',
    level: card.level || 'Year 1',
    semester: card.semester || 'Semester 1',
    category: card.category || 'Custom',
    source: card.source || '',
    hint: card.hint || '',
    rationale: card.rationale || '',
    important: !!card.important,
    is_pending: !!card.isPending
  });

  const addFlashcard = async (card) => {
    // Admin-created cards are GLOBAL (visible to every student);
    // student-created cards stay personal.
    const isGlobal = userProfile.isAdmin && !card.personal;
    if (supabase) {
      const payload = { ...mapCardToDb(card), user_id: isGlobal ? null : session?.user?.id ?? null };
      const { data: row, error } = await supabase.from('custom_flashcards').insert(payload).select().single();
      if (!error && row) {
        setFlashcards(prev => [...prev, mapCustomCardFromDb(row)]);
        return;
      }
      if (error) console.error('Card save failed:', error.message);
    }
    setFlashcards(prev => [...prev, { ...card, id: `user_${Date.now()}`, createdAt: new Date().toISOString(), srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() } }]);
  };

  const updateFlashcard = async (id, updates) => {
    setFlashcards(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
    if (supabase && String(id).startsWith('db_')) {
      const dbId = String(id).slice(3);
      const { error } = await supabase
        .from('custom_flashcards')
        .update(mapCardToDb({ ...updates }))
        .eq('id', dbId);
      if (error) console.error('Card update failed:', error.message);
    }
  };

  const deleteFlashcard = async (id) => {
    setFlashcards(prev => prev.filter(c => c.id !== id));
    if (supabase && String(id).startsWith('db_')) {
      const dbId = String(id).slice(3);
      const { error } = await supabase.from('custom_flashcards').delete().eq('id', dbId);
      if (error) console.error('Card delete failed:', error.message);
    }
  };

  const importFlashcards = async (cards, opts = {}) => {
    const withIds = cards.map((c, i) => ({ ...c, id: `import_${Date.now()}_${i}`, srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() } }));
    if (supabase && cards.length > 0) {
      const isGlobal = userProfile.isAdmin && !opts.personal;
      const rows = cards.map(c => ({ ...mapCardToDb(c), user_id: isGlobal ? null : session?.user?.id ?? null }));
      const { data: inserted, error } = await supabase
        .from('custom_flashcards')
        .insert(rows)
        .select();
      if (!error && inserted) {
        setFlashcards(prev => [...prev, ...inserted.map(mapCustomCardFromDb)]);
        return inserted.length;
      }
      if (error) console.error('Import failed:', error.message);
    }
    setFlashcards(prev => [...prev, ...withIds]);
    return withIds.length;
  };

  const signOut = async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }
    setSession(null);
    setUserProfile(ANONYMOUS_PROFILE);
    setExams([]);
    setTransactions([]);
    setLevelCompletions({});
    setQuizHistory([]);
    setLearningAnalytics({ weakTopics: [], weakConcepts: [], totalAttempts: 0, recommendedRevision: [], dailyChallenge: { id: null, question: '', answer: '', completed: false, lastDate: null } });
    setCourseQuota({});
    setDifficultyProgress(null);
    setUserAchievements([]);
    setDailyChallengeDone(false);
    setAchievementToast(null);
  };

  const amountPaid = transactions.filter(t => t.status === 'success').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const totalFee = 150000;
  let feeStatus = 'Overdue';
  if (amountPaid > 0) feeStatus = amountPaid >= totalFee ? 'Paid' : 'Partial';
  const feeDetails = {
    totalFee,
    amountPaid,
    status: feeStatus,
    pendingItems: transactions.filter(t => t.status === 'pending').length,
    currency: '₦'
  };

  const curriculumSubjects = useMemo(() => {
    const bankSubjects = [...new Set(flashcards.map(c => c.subject).filter(Boolean))];
    return [...new Set([...CURRICULUM_INDEX.subjects, ...bankSubjects])];
  }, [flashcards]);

  const curriculumTopics = useMemo(() => CURRICULUM_INDEX.topics, []);

  const identityProgress = useMemo(() => computeProgressToNext(identityStats, identity), [identityStats, identity]);

  // Populated when the user crosses into a new tier after an activity, so the
  // dashboard can show the IdentityUnlockModal. Cleared via dismissIdentityUnlock.
  const [identityUnlock, setIdentityUnlock] = useState(null);
  const dismissIdentityUnlock = useCallback(() => setIdentityUnlock(null), []);

  const refreshIdentityUnlock = useCallback(() => {
    const current = computeCurrentIdentity(identityStats);
    if (current.tier > 0 && shouldCelebrate(current.tier)) {
      acknowledgeUnlock(current.tier);
      setIdentityUnlock(current);
    }
  }, [identityStats]);

  // Re-evaluate for a fresh tier unlock after any quiz activity (history or
  // attempt count changes), so the celebration fires right after a milestone.
  useEffect(() => {
    refreshIdentityUnlock();
    // Only re-run when the underlying stats change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityStats.totalAttempts, quizHistory.length]);

  return (
    <AppContext.Provider value={{
      session, loadingAuth, flashcards, setFlashcards, exams, setExams,
      addExam, updateExam, deleteExam,
      curriculumSubjects, curriculumTopics, levelCompletions, refreshLevelCompletions,
      quizHistory, fetchQuizHistory,
      studyStats, setStudyStats, userProfile, updateProfile,
      darkMode, toggleDarkMode, toggleSound, soundEnabled, setSoundEnabled,
      transactions, auditLogs, subscriptionPlans, paymentPurposes, learningAnalytics,
      updateSubscriptionPlan: () => {}, addSubscriptionPlan: () => {}, deleteSubscriptionPlan: () => {},
      updatePaymentPurpose: () => {}, addPaymentPurpose: () => {}, deletePaymentPurpose: () => {},
      addAuditLog: () => {}, updateCardProgress, incrementCardsStudied,
      updateQuizStats, fetchUserData, feeDetails,
      recordQuizResult, recordWrongAnswers, recordAttempts, computeWeakConcepts, touchActivity,
      submitQuestionFeedback, fetchAttemptedQuestionIds, fetchQuestionHistory, fetchFailedQuestions,
      addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards,
      smartCoins, scLedger, claimDailySC, earnSC, spendSC, recordStreakBreak, recordQuizFailPenalty,
      bumpGroupQuizStreak, fetchSCRank,
      streakFreezeActive, setStreakFreezeActive,
      identity, identityProgress, identityUnlock, dismissIdentityUnlock, refreshIdentityUnlock,
      // ---- Command Center exports ----
      SC_FEATURE_LOCKED, isPremium,
      courseQuota, fetchCourseQuotaStatus, consumeCourseQuota,
      difficultyProgress, fetchDifficultyStatus, recordAnsweredBatch,
      userAchievements, fetchAchievements, syncAchievements,
      dailyChallengeDone, markDailyChallengeDone,
      achievementToast, dismissAchievementToast,
      flashcardAccess, fetchFlashcardAccess,
      signOut
    }}>
      {children}
    </AppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAppContext = () => useContext(AppContext);
