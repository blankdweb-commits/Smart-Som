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
    fullName: '', matricNumber: '', department: '', level: '', session: '2024/2025',
    email: '', phone: '', programType: 'Full-Time', isVerified: false, isAdmin: false, isActivated: false,
    subscriptionExpiry: null
  });
  const [paymentPurposes, setPaymentPurposes] = useState([]);
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

    return () => subscription.unsubscribe();
  }, []);

  // 2. Fetch Data from Supabase when session changes
  useEffect(() => {
    if (session) {
      fetchUserData();
    } else {
      // Clear data on logout
      setExams([]);
      setTransactions([]);
      // Keep flashcards built-in only
      setFlashcards([...initialFlashcards, ...allBuiltInFlashcards]);
    }
  }, [session]);

  const fetchUserData = async () => {
    if (!supabase || !session) return;
    const userId = session.user.id;

    // Profile
    const { data: profile } = await supabase.from('profiles').select('*').eq('id', userId).single();
    const { data: subscription } = await supabase.from('subscriptions').select('*').eq('user_id', userId).eq('status', 'active').order('expires_at', { ascending: false }).limit(1).maybeSingle();

    if (profile) {
      const isActivated = profile.is_activated || (subscription && new Date(subscription.expires_at) > new Date());
      setUserProfile({
        fullName: profile.full_name || '',
        email: profile.email || '',
        phone: profile.phone || '',
        department: profile.department || '',
        level: profile.level || '',
        isActivated: isActivated,
        subscriptionExpiry: subscription?.expires_at || null,
        isAdmin: profile.role === 'admin' || profile.role === 'super_admin',
        role: profile.role
      });
    }

    // Exams
    const { data: userExams } = await supabase.from('exams').select('*').eq('user_id', userId);
    if (userExams) setExams(userExams.map(e => ({
      ...e,
      reminder_enabled: e.reminder_enabled,
      topics: e.topics || [],
      reminders: e.reminders || [],
      studyMaterials: e.study_materials
    })));

    // Flashcard Progress
    const { data: progress } = await supabase.from('flashcard_progress').select('*').eq('user_id', userId);
    if (progress) {
      const progressMap = new Map(progress.map(p => [p.card_id, p]));
      setFlashcards(prev => prev.map(card => {
        const p = progressMap.get(card.id);
        if (p) {
          return {
            ...card,
            score: p.score,
            srs: {
              interval: p.interval,
              reps: p.reps,
              efactor: p.efactor,
              nextReview: p.next_review
            }
          };
        }
        return card;
      }));
    }

    // Transactions
    const { data: txns } = await supabase.from('transactions').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    if (txns) setTransactions(txns);

    // Charges
    const { data: charges } = await supabase.from('payment_charges').select('*').eq('active', true);
    if (charges) {
      setPaymentPurposes(charges);

      // Calculate Fee Details
      const total = charges.reduce((acc, c) => acc + (c.amount || 0), 0);
      const paid = txns ? txns.filter(t => t.status === 'success').reduce((acc, t) => acc + (t.amount || 0), 0) : 0;
      setFeeDetails({
        totalFee: total,
        amountPaid: paid,
        currency: charges[0]?.currency || 'NGN',
        status: paid >= total ? 'Fully Paid' : (paid > 0 ? 'Partially Paid' : 'Unpaid')
      });
    }

    // Check for migration
    const hasMigrated = localStorage.getItem(`migrated_${userId}`);
    if (!hasMigrated) {
      migrateLocalStorage(userId);
    }
  };

  const migrateLocalStorage = async (userId) => {
    const localExams = JSON.parse(localStorage.getItem('exams') || '[]');
    const localFlashcards = JSON.parse(localStorage.getItem('flashcards') || '[]');

    if (localExams.length > 0) {
      await supabase.from('exams').insert(localExams.map(e => ({
        user_id: userId,
        subject: e.subject,
        exam_date: e.date,
        lecturer: e.lecturer,
        type: e.type,
        priority: e.priority,
        notes: e.notes,
        readiness: e.readiness,
        topics: e.topics,
        reminders: e.reminders
      })));
    }

    // Progress migration is more complex, skipping for brevity but in real world would map card IDs

    localStorage.setItem(`migrated_${userId}`, 'true');
    fetchUserData(); // Refresh
  };

  // 3. Actions
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

  const addExam = async (exam) => {
    if (!supabase) return;
    const { error, data } = await supabase.from('exams').insert({
      user_id: session.user.id,
      subject: exam.subject,
      exam_date: exam.date,
      lecturer: exam.lecturer,
      type: exam.type,
      priority: exam.priority,
      notes: exam.notes,
      readiness: exam.readiness,
      topics: exam.topics,
      reminders: exam.reminders
    }).select().single();

    if (!error) setExams([...exams, data]);
  };

  const updateCardProgress = async (id, quality) => {
    if (!supabase) {
      // Fallback to local state update if supabase is missing
      setFlashcards(prev => prev.map(c => c.id === id ? { ...c, score: quality } : c));
      return;
    }
    const card = flashcards.find(c => c.id === id);
    const srs = card.srs || { interval: 0, reps: 0, efactor: 2.5 };
    let { interval, reps, efactor } = srs;

    if (quality >= 3) {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.round(interval * efactor);
      reps += 1;
    } else {
      reps = 0;
      interval = 1;
    }

    efactor = Number(efactor) + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (efactor < 1.3) efactor = 1.3;

    const nextReview = new Date();
    nextReview.setDate(nextReview.getDate() + interval);

    const { error } = await supabase.from('flashcard_progress').upsert({
      user_id: session.user.id,
      card_id: id,
      score: quality,
      interval,
      reps,
      efactor,
      next_review: nextReview.toISOString(),
      last_seen: new Date().toISOString()
    }, { onConflict: 'user_id,card_id' });

    if (!error) {
      setFlashcards(prev => prev.map(c => c.id === id ? { ...c, score: quality, srs: { interval, reps, efactor, nextReview: nextReview.toISOString() } } : c));
    }
  };

  const activateWithKey = async (key) => {
    try {
      const response = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_key: key, user_id: session.user.id })
      });
      const result = await response.json();
      if (result.success) {
        setUserProfile(prev => ({ ...prev, isActivated: true }));
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  };

  const toggleDarkMode = () => setDarkMode(!darkMode);

  return (
    <AppContext.Provider value={{
      session, loadingAuth,
      flashcards, updateCardProgress,
      exams, addExam,
      studyStats,
      userProfile, updateProfile, activateWithKey,
      darkMode, toggleDarkMode,
      paymentPurposes, transactions, feeDetails,
      curriculumSubjects: [] // Placeholder or derived
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  return useContext(AppContext);
}
