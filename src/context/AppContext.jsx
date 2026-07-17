import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { supabase } from '../utils/supabase';

const AppContext = createContext();

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
  const [userProfile, setUserProfile] = useState({
    fullName: 'Demo Student',
    email: 'student@apexscholars.com',
    phone: '08012345678',
    department: 'Nursing Science',
    level: 'Year 3',
    isActivated: true,
    isAdmin: true,
    role: 'super_admin',
    subscriptionStatus: 'active'
  });
  const [paymentPurposes, setPaymentPurposes] = useState([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const [learningAnalytics, setLearningAnalytics] = useState({
    weakTopics: [],
    recommendedRevision: [],
    dailyChallenge: { id: null, question: '', answer: '', completed: false, lastDate: null }
  });

  const fetchUserData = useCallback(async () => {
    if (!supabase || !session) return;
    try {
      const userId = session.user.id;
      const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
      const { data: subscription } = await supabase.from('subscriptions').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();

      let subStatus = 'none';
      if (subscription) {
        const now = new Date();
        if (new Date(subscription.expires_at) > now) subStatus = 'active';
        else if (new Date(subscription.grace_until) > now) subStatus = 'grace';
        else subStatus = 'expired';
      }

      if (profile) {
        setUserProfile({
          fullName: profile.full_name || '',
          email: profile.email || '',
          phone: profile.phone || '',
          department: profile.department || '',
          level: profile.level || '',
          isActivated: true, // Always true for testing
          isAdmin: true, // Always true for testing
          role: 'super_admin',
          subscriptionStatus: subStatus,
          subscriptionExpiry: subscription?.expires_at || null,
          graceUntil: subscription?.grace_until || null
        });
      }
    } catch (e) {
      console.error("Fetch data error:", e);
    }
  }, [session]);

  const setupMockData = useCallback(() => {
    setTransactions([
      { id: 'TXN-001', type: 'Clinical Fee', amount: 25000, status: 'success', date: new Date().toISOString(), created_at: new Date().toISOString(), receiptNo: 'RC-99210', releaseStatus: 'Released' },
      { id: 'TXN-002', type: 'Exam Access', amount: 5000, status: 'success', date: new Date().toISOString(), created_at: new Date().toISOString(), receiptNo: 'RC-99211', releaseStatus: 'Held' }
    ]);
    setSubscriptionPlans([
      { id: 1, name: 'Standard Month', price: 1999.9, duration_days: 30, is_active: true },
      { id: 2, name: 'Professional Term', price: 4999.9, duration_days: 90, is_active: true }
    ]);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setupMockData();
      setLoadingAuth(false);
      return;
    }

    const initAuth = async () => {
      try {
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (currentSession) setSession(currentSession);
        else setupMockData();
      } catch (err) {
        setupMockData();
      } finally {
        setLoadingAuth(false);
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, currentSession) => {
      if (event === 'SIGNED_IN') setSession(currentSession);
      else if (event === 'SIGNED_OUT') {
        setSession(null);
        setupMockData();
      }
      setLoadingAuth(false);
    });

    return () => { if (subscription) subscription.unsubscribe(); };
  }, [setupMockData]);

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
  };

  const updateQuizStats = (data) => {
    setStudyStats(prev => ({
      ...prev,
      ...data,
      quizStreak: data.quizStreak !== undefined ? data.quizStreak : prev.quizStreak,
      maxQuizStreak: data.quizStreak > prev.maxQuizStreak ? data.quizStreak : prev.maxQuizStreak
    }));
  };

  const amountPaid = transactions.filter(t => t.status === 'success').reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const totalFee = 150000;
  let feeStatus = 'Overdue';
  if (amountPaid > 0) feeStatus = amountPaid >= totalFee ? 'Paid' : 'Partial';
  const feeDetails = {
    totalFee,
    amountPaid,
    status: feeStatus,
    pendingItems: transactions.filter(t => t.status === 'pending').length || 2,
    currency: '₦'
  };

  const addFlashcard = (card) => {
    setFlashcards(prev => [...prev, { ...card, id: `user_${Date.now()}`, createdAt: new Date().toISOString(), srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() } }]);
  };
  const updateFlashcard = (id, updates) => {
    setFlashcards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };
  const deleteFlashcard = (id) => {
    setFlashcards(prev => prev.filter(c => c.id !== id));
  };
  const importFlashcards = (cards) => {
    const withIds = cards.map((c, i) => ({ ...c, id: `import_${Date.now()}_${i}`, srs: { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() } }));
    setFlashcards(prev => [...prev, ...withIds]);
    return withIds.length;
  };

  return (
    <AppContext.Provider value={{
      session, loadingAuth, flashcards, setFlashcards, exams, setExams,
      studyStats, setStudyStats, userProfile, updateProfile,
      darkMode, toggleDarkMode, toggleSound, soundEnabled, setSoundEnabled,
      transactions, auditLogs, subscriptionPlans, paymentPurposes, learningAnalytics,
      updateSubscriptionPlan: () => {}, addSubscriptionPlan: () => {}, deleteSubscriptionPlan: () => {},
      updatePaymentPurpose: () => {}, addPaymentPurpose: () => {}, deletePaymentPurpose: () => {},
      addAuditLog: () => {}, updateCardProgress, incrementCardsStudied: () => {},
      updateQuizStats, fetchUserData, feeDetails,
      addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useAppContext = () => useContext(AppContext);
