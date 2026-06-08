import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { supabase } from '../utils/supabase';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const DEV_MODE = import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true';

  const [flashcards, setFlashcards] = useState([...initialFlashcards, ...allBuiltInFlashcards]);
  const [richardsQuestions, setRichardsQuestions] = useState(() => {
    const saved = localStorage.getItem('apex_richards_questions');
    return saved ? JSON.parse(saved) : [];
  });

  const allFlashcards = useMemo(() => {
    const mappedRichards = richardsQuestions.map(q => ({
      ...q,
      answer: q.correctAnswer || q.answer,
      type: 'imported'
    }));
    const combined = [...flashcards, ...mappedRichards];
    const seen = new Set();
    return combined.filter(c => {
      if (!c.id) return true;
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  }, [flashcards, richardsQuestions]);

  const [exams, setExams] = useState([]);
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
    milestone: 'Clinical Beginner',
    xp: 0,
    xpHistory: {}
  });
  const [userProfile, setUserProfile] = useState({
    fullName: 'Scholar', email: '', phone: '', department: '', level: 'Year 3',
    isActivated: true, isAdmin: false, role: 'student',
    subscriptionStatus: 'none', subscriptionExpiry: null
  });
  const [paymentPurposes, setPaymentPurposes] = useState([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [feeDetails, setFeeDetails] = useState({
    totalFee: 150000, amountPaid: 0, currency: 'NGN', status: 'Unpaid'
  });

  const [isOnline, setIsOnline] = useState(navigator.onLine);

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
    Object.values(CURRICULUM_MASTER).forEach(year => {
      Object.values(year).forEach(semester => {
        semester.forEach(course => {
          if (course.course) subjects.add(course.course);
        });
      });
    });
    return Array.from(subjects).sort();
  }, []);

  const setupMockData = useCallback(() => {
    console.log("Injecting Enhanced Mock User for Development Mode");
    setUserProfile({
      fullName: 'Development User',
      email: 'dev@apexscholars.com',
      phone: '0800-DEV-MODE',
      department: 'Nursing Science',
      level: 'Year 3',
      isActivated: true,
      isAdmin: true,
      role: 'super_admin',
      subscriptionStatus: 'active',
      subscriptionExpiry: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    });
  }, []);

  const fetchUserData = useCallback(async () => {
    if (!supabase || !session) {
      if (DEV_MODE) setupMockData();
      return;
    }
    const userId = session.user.id;
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    if (profile) {
      setUserProfile(prev => ({
        ...prev,
        fullName: profile.full_name || prev.fullName,
        email: profile.email || prev.email,
        isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
        role: profile.role,
        isActivated: true
      }));
    }
  }, [session, DEV_MODE, setupMockData]);

  useEffect(() => {
    if (!supabase) {
      if (DEV_MODE) setupMockData();
      setLoadingAuth(false);
      return;
    }
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (s) {
        setSession(s);
      } else if (DEV_MODE) {
        setupMockData();
      }
      setLoadingAuth(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      if (s) {
        setSession(s);
      } else if (DEV_MODE) {
        setupMockData();
      }
    });
    return () => subscription.unsubscribe();
  }, [DEV_MODE, setupMockData]);

  useEffect(() => {
    if (session) fetchUserData();
  }, [session, fetchUserData]);

  const updateQuizStats = (data) => {
    setStudyStats(prev => {
      const now = Date.now();
      let xpToAdd = 0;
      const newXpHistory = { ...prev.xpHistory };

      if (data.correctQuestionId) {
        const lastEarned = prev.xpHistory[data.correctQuestionId] || 0;
        if (now - lastEarned > 10 * 60 * 1000) {
          xpToAdd = 10;
          newXpHistory[data.correctQuestionId] = now;
        }
      }

      return {
        ...prev,
        ...data,
        xp: (prev.xp || 0) + xpToAdd,
        xpHistory: newXpHistory,
        quizStreak: data.quizStreak !== undefined ? data.quizStreak : prev.quizStreak,
        maxQuizStreak: (data.quizStreak > (prev.maxQuizStreak || 0)) ? data.quizStreak : prev.maxQuizStreak
      };
    });
  };

  const addRichardsQuestions = (qs) => {
    setRichardsQuestions(prev => {
      const updated = [...prev, ...qs];
      localStorage.setItem('apex_richards_questions', JSON.stringify(updated));
      return updated;
    });
  };

  const value = useMemo(() => ({
    session, loadingAuth, allFlashcards, exams, studyStats, userProfile, darkMode,
    transactions, auditLogs, feeDetails, subscriptionPlans, paymentPurposes,
    isOnline, updateQuizStats, addRichardsQuestions, curriculumSubjects,
    toggleDarkMode: () => setDarkMode(!darkMode)
  }), [session, loadingAuth, allFlashcards, exams, studyStats, userProfile, darkMode, transactions, auditLogs, feeDetails, subscriptionPlans, paymentPurposes, isOnline, curriculumSubjects]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() { return useContext(AppContext); }
