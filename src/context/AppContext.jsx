import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { supabase } from '../utils/supabase';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [session, setSession] = useState({ user: { id: 'dev-user', email: 'dev@apexscholars.com' } });
  const [loadingAuth, setLoadingAuth] = useState(false);

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

  const [learningAnalytics, setLearningAnalytics] = useState({
    weakTopics: [],
    recommendedRevision: [],
    dailyChallenge: { id: null, question: '', answer: '', completed: false, lastDate: null }
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

  const updateQuizStats = useCallback((data) => {
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
  }, []);

  const addRichardsQuestions = useCallback((qs) => {
    setRichardsQuestions(prev => {
      const updated = [...prev, ...qs];
      localStorage.setItem('apex_richards_questions', JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateCardProgress = useCallback((id, quality) => {
     setFlashcards(prev => prev.map(c => c.id === id ? { ...c, srs: { ...c.srs, reps: (c.srs?.reps || 0) + 1 } } : c));
  }, []);

  const incrementCardsStudied = useCallback(() => {
    setStudyStats(prev => ({ ...prev, cardsStudied: (prev.cardsStudied || 0) + 1 }));
  }, []);

  const value = useMemo(() => ({
    session, loadingAuth, allFlashcards, exams, studyStats, userProfile, darkMode,
    transactions, auditLogs, feeDetails, subscriptionPlans, paymentPurposes,
    learningAnalytics, isOnline, updateQuizStats, addRichardsQuestions, curriculumSubjects,
    updateCardProgress, incrementCardsStudied,
    toggleDarkMode: () => setDarkMode(!darkMode)
  }), [session, loadingAuth, allFlashcards, exams, studyStats, userProfile, darkMode, transactions, auditLogs, feeDetails, subscriptionPlans, paymentPurposes, learningAnalytics, isOnline, updateQuizStats, addRichardsQuestions, curriculumSubjects, updateCardProgress, incrementCardsStudied]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() { return useContext(AppContext); }
