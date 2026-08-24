import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { supabase } from '../utils/supabase';

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
    const saved = localStorage.getItem('soundEnabled');
    return saved ? JSON.parse(saved) : true;
  });
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [studyStats, setStudyStats] = useState({
    streak: 0,
    lastStudyDate: null,
    cardsStudied: 0,
    quizStreak: 0,
    maxQuizStreak: 0,
    milestone: 'Clinical Beginner'
  });
  const [userProfile, setUserProfile] = useState(ANONYMOUS_PROFILE);
  const [paymentPurposes] = useState([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs] = useState([]);
  // Passed-level completions per difficulty: { Easy: n, Medium: n, Hard: n, ... }
  const [levelCompletions, setLevelCompletions] = useState({});

  const [learningAnalytics, setLearningAnalytics] = useState({
    weakTopics: [],
    recommendedRevision: [],
    dailyChallenge: { id: null, question: '', answer: '', completed: false, lastDate: null }
  });

  // Dark mode must be applied to <html> for Tailwind's class strategy to work.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);

  const fetchUserData = useCallback(async () => {
    if (!supabase || !session) return;
    try {
      const userId = session.user.id;
      const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('id', userId).single();
      if (profileError) console.error('Profile load failed:', profileError.message);

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
          milestone: profile.milestone || 'Clinical Beginner',
          lastStudyDate: profile.last_active_date || null
        }));
      }

      // Learning analytics (weak topics)
      const { data: analytics } = await supabase.from('learning_analytics').select('*').eq('user_id', userId).maybeSingle();
      if (analytics) {
         setLearningAnalytics(prev => ({ ...prev, weakTopics: analytics.weak_topics || [] }));
      }

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
    } catch (e) {
      console.error("Fetch data error:", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

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

  // ---------- Streaks & study activity ----------
  const touchActivity = useCallback(async () => {
    const now = new Date();
    const todayStr = now.toDateString();
    const last = studyStats.lastStudyDate ? new Date(studyStats.lastStudyDate) : null;

    let nextStreak = studyStats.streak || 0;
    if (!last) {
      nextStreak = Math.max(1, nextStreak);
    } else if (last.toDateString() !== todayStr) {
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      nextStreak = last.toDateString() === yesterday.toDateString() ? nextStreak + 1 : 1;
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
  }, [studyStats.streak, studyStats.lastStudyDate, session]);

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
  const recordQuizResult = async ({ mode = 'standard', difficulty = 'Easy', subject = '', score = 0, total = 0, durationSeconds = 0 }) => {
    const pct = total > 0 ? Math.round((score / total) * 100) : 0;
    const thresholds = { Easy: 50, Medium: 60, Hard: 70, Expert: 75, Master: 80, Extreme: 85 };
    const passed = pct >= (thresholds[difficulty] ?? 60);

    // Local XP/milestone feedback
    updateQuizStats({});

    if (!supabase || !session) return passed;

    const levelKey = `${subject || 'Mixed Bank'}|${difficulty}`;

    const { error: resError } = await supabase.from('quiz_results').insert({
      user_id: session.user.id,
      mode,
      difficulty,
      subject,
      score,
      total,
      passed,
      duration_seconds: durationSeconds
    });
    if (resError) console.error('Quiz result save failed:', resError.message);

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

  // ---------- Plans & transactions ----------
  useEffect(() => {
    if (!supabase) {
      setSubscriptionPlans([
        { id: 1, name: 'Weekly', price: 1999.9, duration_days: 7, is_active: true },
        { id: 2, name: 'Monthly', price: 6999, duration_days: 30, is_active: true },
        { id: 3, name: 'Yearly', price: 49999, duration_days: 365, is_active: true }
      ]);
      return;
    }
    supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price', { ascending: true })
      .then(({ data }) => {
        if (data && data.length > 0) setSubscriptionPlans(data);
      });
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
        if (currentSession) setSession(currentSession);
      } catch (err) {
        console.error('Auth init error:', err);
      } finally {
        setLoadingAuth(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (event === 'SIGNED_IN') setSession(currentSession);
      else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUserProfile(ANONYMOUS_PROFILE);
        setExams([]);
        setTransactions([]);
        setLevelCompletions({});
      }
      setLoadingAuth(false);
    });

    return () => { if (subscription) subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (session) fetchUserData();
  }, [session, fetchUserData]);

  const updateProfile = (data) => setUserProfile(prev => ({ ...prev, ...data }));
  const toggleSound = () => {
    setSoundEnabled(s => {
      localStorage.setItem('soundEnabled', JSON.stringify(!s));
      return !s;
    });
  };
  const toggleDarkMode = () => {
    setDarkMode(d => {
      localStorage.setItem('darkMode', JSON.stringify(!d));
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

  return (
    <AppContext.Provider value={{
      session, loadingAuth, flashcards, setFlashcards, exams, setExams,
      addExam, updateExam, deleteExam,
      curriculumSubjects, curriculumTopics, levelCompletions, refreshLevelCompletions,
      studyStats, setStudyStats, userProfile, updateProfile,
      darkMode, toggleDarkMode, toggleSound, soundEnabled, setSoundEnabled,
      transactions, auditLogs, subscriptionPlans, paymentPurposes, learningAnalytics,
      updateSubscriptionPlan: () => {}, addSubscriptionPlan: () => {}, deleteSubscriptionPlan: () => {},
      updatePaymentPurpose: () => {}, addPaymentPurpose: () => {}, deletePaymentPurpose: () => {},
      addAuditLog: () => {}, updateCardProgress, incrementCardsStudied,
      updateQuizStats, fetchUserData, feeDetails,
      recordQuizResult, recordWrongAnswers, touchActivity,
      addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards,
      signOut
    }}>
      {children}
    </AppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAppContext = () => useContext(AppContext);
