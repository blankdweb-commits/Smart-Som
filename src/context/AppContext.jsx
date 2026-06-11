import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { supabase } from '../utils/supabase';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [session, setSession] = useState({ user: { id: 'dev-user', email: 'dev@apexscholars.com' } });
  const [loadingAuth, setLoadingAuth] = useState(false);

  // --- DATA HYDRATION UTILITIES ---
  const safeGetItem = (key, fallback) => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? JSON.parse(saved) : fallback;
    } catch (e) {
      console.warn(`localStorage hydration failed for ${key}`, e);
      return fallback;
    }
  };

  const [flashcards, setFlashcards] = useState(() => {
    return (Array.isArray(initialFlashcards) && Array.isArray(allBuiltInFlashcards))
      ? [...initialFlashcards, ...allBuiltInFlashcards]
      : [];
  });

  const [richardsQuestions, setRichardsQuestions] = useState(() => safeGetItem('apex_richards_questions', []));

  const allFlashcards = useMemo(() => {
    const safeRichards = Array.isArray(richardsQuestions) ? richardsQuestions : [];
    const mappedRichards = safeRichards.map(q => ({
      ...q,
      answer: q.correctAnswer || q.answer || "No answer provided",
      type: 'imported'
    }));

    const combined = [...(Array.isArray(flashcards) ? flashcards : []), ...mappedRichards];
    const seen = new Set();
    return combined.filter(c => {
      if (!c || !c.id || !c.question) return false;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [flashcards, richardsQuestions]);

  // Data Integrity Report
  useEffect(() => {
    const subjects = {};
    allFlashcards.forEach(q => {
      const s = q.subject || 'Unknown';
      subjects[s] = (subjects[s] || 0) + 1;
    });
    console.log("--- APEX DATA INTEGRITY REPORT ---");
    console.log("Total Valid Questions:", allFlashcards.length);
    console.log("Questions By Subject:", subjects);
    console.log("----------------------------------");
  }, [allFlashcards]);

  const [exams, setExams] = useState([]);
  const [darkMode, setDarkMode] = useState(() => safeGetItem('darkMode', false));

  const [studyStats, setStudyStats] = useState(() => safeGetItem('apex_study_stats', {
    streak: 0, lastStudyDate: null, cardsStudied: 0, quizStreak: 0, maxQuizStreak: 0, milestone: 'Clinical Beginner', xp: 0, xpHistory: {}
  }));

  const [userProfile, setUserProfile] = useState({
    fullName: 'Development User', email: 'dev@apexscholars.com', phone: '0800-DEV-MODE', department: 'Nursing Science', level: 'Year 3', isActivated: true, isAdmin: true, role: 'super_admin', subscriptionStatus: 'active', subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
  });

  const [learningAnalytics, setLearningAnalytics] = useState(() => safeGetItem('apex_learning_analytics', {
    weakTopics: [], recommendedRevision: [], dailyChallenge: { id: null, question: '', answer: '', completed: false, lastDate: null }
  }));

  const [feeDetails, setFeeDetails] = useState({ totalFee: 150000, amountPaid: 0, currency: 'NGN', status: 'Unpaid' });
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // --- QUIZ PERSISTENCE & GLOBAL STATE ---
  const [isQuizActive, setIsQuizActive] = useState(false);
  const [quizPreferences, setQuizPreferences] = useState(() => safeGetItem('apex_quiz_prefs', {
    defaultCount: 10,
    defaultTimer: 'OFF'
  }));

  const [recoveredSession, setRecoveredSession] = useState(() => {
    try {
      const saved = localStorage.getItem('apex_quiz_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        const now = Date.now();
        // 4 hour window
        if (now - parsed.timestamp < 4 * 60 * 60 * 1000) {
          return parsed.data;
        }
      }
      return null;
    } catch (e) { return null; }
  });

  useEffect(() => {
    localStorage.setItem('apex_study_stats', JSON.stringify(studyStats));
  }, [studyStats]);

  useEffect(() => {
    localStorage.setItem('apex_learning_analytics', JSON.stringify(learningAnalytics));
  }, [learningAnalytics]);

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
  }, [darkMode]);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const curriculumSubjects = useMemo(() => {
    const subjects = new Set();
    Object.values(CURRICULUM_MASTER || {}).forEach(year => {
      Object.values(year || {}).forEach(semester => {
        (semester || []).forEach(course => {
          if (course && course.course) subjects.add(course.course);
        });
      });
    });
    return Array.from(subjects).sort();
  }, []);

  const saveQuizSession = useCallback((data) => {
    if (data) {
      localStorage.setItem('apex_quiz_session', JSON.stringify({
        timestamp: Date.now(),
        data
      }));
    } else {
      localStorage.removeItem('apex_quiz_session');
    }
  }, []);

  const clearRecoveredSession = useCallback(() => {
    setRecoveredSession(null);
    localStorage.removeItem('apex_quiz_session');
  }, []);

  const updateQuizPreferences = useCallback((prefs) => {
    setQuizPreferences(prev => {
      const updated = { ...prev, ...prefs };
      localStorage.setItem('apex_quiz_prefs', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const value = useMemo(() => ({
    session, loadingAuth,
    allFlashcards, flashcards: allFlashcards,
    exams: exams || [],
    studyStats: studyStats || {},
    userProfile: userProfile || {},
    darkMode,
    feeDetails: feeDetails || {},
    learningAnalytics: learningAnalytics || {},
    isOnline,
    curriculumSubjects: curriculumSubjects || [],
    isQuizActive,
    setIsQuizActive,
    quizPreferences,
    updateQuizPreferences,
    recoveredSession,
    saveQuizSession,
    clearRecoveredSession,
    updateQuizStats: (data) => {
      if (!data) return;
      setStudyStats(prev => {
        const newStreak = data.quizStreak !== undefined ? data.quizStreak : prev.quizStreak;
        const addedXp = data.xpAwarded || (data.correctQuestionId ? 10 : 0);
        return {
          ...prev,
          xp: (prev.xp || 0) + addedXp,
          quizStreak: newStreak,
          maxQuizStreak: Math.max(prev.maxQuizStreak || 0, newStreak || 0),
          milestone: data.milestone || prev.milestone
        };
      });
    },
    addRichardsQuestions: (qs) => {
      if (!Array.isArray(qs)) return;
      setRichardsQuestions(prev => {
        const updated = [...prev, ...qs];
        localStorage.setItem('apex_richards_questions', JSON.stringify(updated));
        return updated;
      });
    },
    updateCardProgress: (id) => {
       if (!id) return;
       setStudyStats(prev => ({ ...prev, cardsStudied: (prev.cardsStudied || 0) + 1 }));
    },
    incrementCardsStudied: () => {
      setStudyStats(prev => ({ ...prev, cardsStudied: (prev.cardsStudied || 0) + 1 }));
    },
    toggleDarkMode: () => setDarkMode(!darkMode)
  }), [session, loadingAuth, allFlashcards, exams, studyStats, userProfile, darkMode, feeDetails, learningAnalytics, isOnline, curriculumSubjects, isQuizActive, quizPreferences, recoveredSession, saveQuizSession, clearRecoveredSession, updateQuizPreferences]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() { return useContext(AppContext); }
