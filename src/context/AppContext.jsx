import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { supabase } from '../utils/supabase';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const DEV_MODE = import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true';

  const [flashcards, setFlashcards] = useState([...initialFlashcards, ...allBuiltInFlashcards]);
  const [exams, setExams] = useState([]);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });
  const [studyStats, setStudyStats] = useState({ streak: 0, lastStudyDate: null, cardsStudied: 0 });
  const [userProfile, setUserProfile] = useState({
    fullName: '', email: '', phone: '', department: '', level: '',
    isActivated: false, isAdmin: false, subscriptionStatus: 'none',
    subscriptionExpiry: null, graceUntil: null
  });
  const [paymentPurposes, setPaymentPurposes] = useState([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [feeDetails] = useState({ totalFee: 0, amountPaid: 0, currency: 'NGN', status: 'Unpaid' });

  const [learningAnalytics, setLearningAnalytics] = useState({
    weakTopics: [],
    recommendedRevision: [],
    dailyChallenge: { id: null, question: '', answer: '', completed: false, lastDate: null }
  });

  const fetchUserData = useCallback(async () => {
    if (!supabase || !session) return;
    const userId = session.user.id;

    // Profile & Subscription
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

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
        isActivated: subStatus === 'active' || subStatus === 'grace',
        isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
        role: profile.role,
        subscriptionStatus: subStatus,
        subscriptionExpiry: subscription?.expires_at || null,
        graceUntil: subscription?.grace_until || null
      });
    }

    // Exams
    const { data: userExams } = await supabase.from('exams').select('*').eq('user_id', userId);
    if (userExams) setExams(userExams.map(e => ({
      ...e,
      topics: e.topics || [],
      reminders: e.reminders || []
    })));

    // Flashcard Progress
    const { data: progress } = await supabase.from('flashcard_progress').select('*').eq('user_id', userId);
    if (progress) {
      const progressMap = new Map(progress.map(p => [p.card_id, p]));
      setFlashcards(prev => prev.map(card => {
        const p = progressMap.get(card.id);
        if (p) return { ...card, score: p.score, srs: { interval: p.interval, reps: p.reps, efactor: p.efactor, nextReview: p.next_review } };
        return card;
      }));
    }

    // Transactions/Payments
    const { data: pyts } = await supabase.from('payments').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (pyts) setTransactions(pyts);

    // Subscription Plans (Global)
    const { data: plans } = await supabase.from('subscription_plans').select('*').eq('is_active', true);
    if (plans) setSubscriptionPlans(plans);

    // Payment Charges (Institutional)
    const { data: charges } = await supabase.from('payment_charges').select('*').eq('active', true);
    if (charges) setPaymentPurposes(charges);

    // Audit Logs (Admins only)
    if (profile?.role === 'admin' || profile?.role === 'super_admin') {
      const { data: logs } = await supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (logs) setAuditLogs(logs);
    }
  }, [session]);

  // 1. Auth Listener
  useEffect(() => {
    // ALWAYS provide mock data if session is missing, to ensure "Dashboard First" experience
    const setupMockData = () => {
      setUserProfile({
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
      setTransactions([
        { id: 'TXN-001', type: 'Clinical Fee', amount: 25000, status: 'success', date: new Date().toISOString(), created_at: new Date().toISOString(), receiptNo: 'RC-99210', releaseStatus: 'Released' },
        { id: 'TXN-002', type: 'Exam Access', amount: 5000, status: 'success', date: new Date().toISOString(), created_at: new Date().toISOString(), receiptNo: 'RC-99211', releaseStatus: 'Held' },
        { id: 'TXN-003', type: 'Portal Levy', amount: 2500, status: 'pending', date: new Date().toISOString(), created_at: new Date().toISOString(), receiptNo: 'RC-99212', releaseStatus: 'Held' }
      ]);
      setPaymentPurposes([
        { id: 1, title: 'Tuition Fee', amount: 150000, currency: 'NGN', targetDept: 'All', targetLevel: 'All', active: true, description: 'Mandatory annual tuition' },
        { id: 2, title: 'Library Resource', amount: 15000, currency: 'NGN', targetDept: 'Nursing Science', targetLevel: 'Year 3', active: true, description: 'Access to digital journals' }
      ]);
      setSubscriptionPlans([
        { id: 1, name: 'Standard Month', price: 1999.9, duration_days: 30, is_active: true },
        { id: 2, name: 'Professional Term', price: 4999.9, duration_days: 90, is_active: true }
      ]);
    };

    if (!supabase) {
      setupMockData();
      setLoadingAuth(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      if (!currentSession) {
        setupMockData();
      }
      setSession(currentSession);
      setLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      if (!currentSession) {
        setupMockData();
      }
      setSession(currentSession);
      setLoadingAuth(false);
    });

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, [DEV_MODE]);

  // 2. Fetch Data from Supabase
  useEffect(() => {
    if (session) {
      fetchUserData();
    } else {
      setExams([]);
      setTransactions([]);
      setFlashcards([...initialFlashcards, ...allBuiltInFlashcards]);
      setUserProfile({
        fullName: '', email: '', phone: '', department: '', level: '',
        isActivated: false, isAdmin: false, subscriptionStatus: 'none'
      });
    }
  }, [session, fetchUserData]);

  const updateProfile = async (data) => {
    if (!supabase) return;
    const { error } = await supabase.from('profiles').update({
      full_name: data.fullName,
      phone: data.phone,
      department: data.department,
      level: data.level
    }).eq('id', session.user.id);
    if (!error) setUserProfile(prev => ({ ...prev, ...data }));
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    localStorage.setItem('darkMode', JSON.stringify(!darkMode));
  };

  const updateSubscriptionPlan = async (id, data) => {
    if (!supabase) return;
    const { error } = await supabase.from('subscription_plans').update(data).eq('id', id);
    if (!error) fetchUserData();
  };

  const addSubscriptionPlan = async (data) => {
    if (!supabase) return;
    const { error } = await supabase.from('subscription_plans').insert(data);
    if (!error) fetchUserData();
  };

  const deleteSubscriptionPlan = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from('subscription_plans').delete().eq('id', id);
    if (!error) fetchUserData();
  };

  const updatePaymentPurpose = async (id, data) => {
    if (!supabase) return;
    const { error } = await supabase.from('payment_charges').update(data).eq('id', id);
    if (!error) fetchUserData();
  };

  const addPaymentPurpose = async (data) => {
    if (!supabase) return;
    const { error } = await supabase.from('payment_charges').insert(data);
    if (!error) fetchUserData();
  };

  const deletePaymentPurpose = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from('payment_charges').delete().eq('id', id);
    if (!error) fetchUserData();
  };

  const addAuditLog = async (action, details) => {
    if (!supabase || !session) return;
    const { error } = await supabase.from('audit_logs').insert({
      user_id: session.user.id,
      action,
      details
    });
    if (!error) fetchUserData();
  };

  const updateCardProgress = async (id, quality) => {
     setFlashcards(prev => prev.map(c => {
        if (c.id === id) {
           const reps = (c.srs?.reps || 0) + 1;
           const interval = quality >= 3 ? (reps === 1 ? 1 : reps === 2 ? 6 : Math.round((c.srs?.interval || 1) * 2.5)) : 1;
           return { ...c, srs: { ...c.srs, reps, interval, nextReview: new Date(Date.now() + interval * 24 * 3600 * 1000).toISOString() } };
        }
        return c;
     }));

     if (quality < 3) {
        setLearningAnalytics(prev => {
           const card = flashcards.find(c => c.id === id);
           if (!card) return prev;
           const topic = card.topic || 'General';
           const weakTopics = [...prev.weakTopics];
           const existing = weakTopics.find(t => t.name === topic);
           if (existing) {
              existing.count += 1;
           } else {
              weakTopics.push({ name: topic, count: 1, subject: card.subject });
           }
           return { ...prev, weakTopics: weakTopics.sort((a,b) => b.count - a.count).slice(0, 5) };
        });
     }
  };

  const incrementCardsStudied = () => {
    setStudyStats(prev => ({ ...prev, cardsStudied: (prev.cardsStudied || 0) + 1 }));
  };

  return (
    <AppContext.Provider value={{
      session, loadingAuth,
      flashcards,
      exams,
      studyStats,
      userProfile, updateProfile,
      darkMode, toggleDarkMode,
      transactions, auditLogs, feeDetails,
      subscriptionPlans, paymentPurposes,
      learningAnalytics,
      updateSubscriptionPlan, addSubscriptionPlan, deleteSubscriptionPlan,
      updatePaymentPurpose, addPaymentPurpose, deletePaymentPurpose,
      addAuditLog,
      updateCardProgress,
      incrementCardsStudied,
      fetchUserData
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
