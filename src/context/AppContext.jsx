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
    subscriptionExpiry: null, graceUntil: null,
    subscriptionTier: 'none' // 'weekly' or 'monthly'
  });
  const [paymentPurposes, setPaymentPurposes] = useState([
    { id: '1', title: 'Tuition Fee', amount: 150000, currency: 'NGN', active: true, targetDept: 'All', targetLevel: 'All', targetProgram: 'All', description: 'Institutional tuition for 2024/2025 session.' },
    { id: '2', title: 'Portal Access', amount: 5000, currency: 'NGN', active: true, targetDept: 'All', targetLevel: 'All', targetProgram: 'All', description: 'Online resource and result portal maintenance.' }
  ]);
  const [transactions, setTransactions] = useState([]);
  const [feeDetails, setFeeDetails] = useState({ totalFee: 155000, amountPaid: 0, currency: 'NGN', status: 'Unpaid', dueDate: '2025-12-31' });

  const fetchUserData = React.useCallback(async () => {
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
        graceUntil: subscription?.grace_until || null,
        subscriptionTier: subscription?.tier || (subStatus !== 'none' ? 'weekly' : 'none')
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
  }, [session]);

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

    return () => subscription.unsubscribe();
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

  const addFlashcard = async (card) => {
    if (!supabase) return;
    const newCard = { ...card, user_id: session.user.id, created_at: new Date() };
    const { data, error } = await supabase.from('flashcards').insert([newCard]).select();
    if (!error && data) setFlashcards(prev => [...prev, data[0]]);
  };

  const updateFlashcard = async (id, updates) => {
    if (!supabase) return;
    const { error } = await supabase.from('flashcards').update(updates).eq('id', id);
    if (!error) setFlashcards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
  };

  const deleteFlashcard = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from('flashcards').delete().eq('id', id);
    if (!error) setFlashcards(prev => prev.filter(c => c.id !== id));
  };

  const importFlashcards = (cards) => {
    const newCards = cards.map(c => ({ ...c, id: Math.random().toString(36).substr(2, 9) }));
    setFlashcards(prev => [...prev, ...newCards]);
    return newCards.length;
  };

  const updateCardProgress = async (id, quality) => {
    if (!supabase || !session) return;
    // Basic SRS logic simulation or Supabase update
    const { error } = await supabase.from('flashcard_progress').upsert({
      user_id: session.user.id,
      card_id: id,
      score: quality,
      last_reviewed: new Date()
    });
    if (!error) {
       setFlashcards(prev => prev.map(c => c.id === id ? { ...c, srs: { ...c.srs, reps: (c.srs?.reps || 0) + 1 } } : c));
    }
  };

  const addExam = async (exam) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('exams').insert([{ ...exam, user_id: session.user.id }]).select();
    if (!error && data) setExams(prev => [...prev, data[0]]);
  };

  const updateExam = async (id, updates) => {
    if (!supabase) return;
    const { error } = await supabase.from('exams').update(updates).eq('id', id);
    if (!error) setExams(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  };

  const deleteExam = async (id) => {
    if (!supabase) return;
    const { error } = await supabase.from('exams').delete().eq('id', id);
    if (!error) setExams(prev => prev.filter(e => e.id !== id));
  };

  const addTransaction = async (txn) => {
    if (!supabase) return;
    const { data, error } = await supabase.from('payments').insert([{ ...txn, user_id: session.user.id }]).select();
    if (!error && data) {
      setTransactions(prev => [data[0], ...prev]);
      setFeeDetails(prev => ({ ...prev, amountPaid: prev.amountPaid + txn.amount }));
    }
  };

  const incrementCardsStudied = () => {
    setStudyStats(prev => ({ ...prev, cardsStudied: prev.cardsStudied + 1 }));
  };

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
    localStorage.setItem('darkMode', JSON.stringify(!darkMode));
  };

  return (
    <AppContext.Provider value={{
      session, loadingAuth,
      flashcards, addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards, updateCardProgress,
      exams, addExam, updateExam, deleteExam,
      studyStats, incrementCardsStudied,
      userProfile, updateProfile,
      darkMode, toggleDarkMode,
      transactions, feeDetails, paymentPurposes,
      addTransaction, fetchUserData
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
