import React, { createContext, useContext, useState, useEffect } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { supabase } from '../utils/supabase';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

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
  const [feeDetails, setFeeDetails] = useState({ totalFee: 0, amountPaid: 0, currency: 'NGN', status: 'Unpaid' });

  // 1. Auth Listener
  useEffect(() => {
    if (!supabase) {
      setLoadingAuth(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoadingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setLoadingAuth(false);
    });

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, []);

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
  }, [session]);

  const fetchUserData = async () => {
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
  };

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
      updateSubscriptionPlan, addSubscriptionPlan, deleteSubscriptionPlan,
      updatePaymentPurpose, addPaymentPurpose, deletePaymentPurpose,
      addAuditLog,
      fetchUserData
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
