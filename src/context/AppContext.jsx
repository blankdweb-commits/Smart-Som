import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { supabase } from '../utils/supabase';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [session, setSession] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const saved = localStorage.getItem('darkMode');
      return saved ? JSON.parse(saved) : false;
    } catch (e) { return false; }
  });

  // --- DATA HYDRATION UTILITIES ---
  const [flashcards, setFlashcards] = useState(() => {
    return (Array.isArray(initialFlashcards) && Array.isArray(allBuiltInFlashcards))
      ? [...initialFlashcards, ...allBuiltInFlashcards]
      : [];
  });

  const [richardsQuestions, setRichardsQuestions] = useState(() => {
    try {
      const saved = localStorage.getItem('apex_richards_questions');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  // Combine and deduplicate flashcards
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

  const [studyStats, setStudyStats] = useState(() => {
    try {
      const saved = localStorage.getItem('apex_study_stats');
      return saved ? JSON.parse(saved) : {
        streak: 0, lastStudyDate: null, cardsStudied: 0, quizStreak: 0, maxQuizStreak: 0, milestone: 'Clinical Beginner', xp: 0, xpHistory: {}
      };
    } catch (e) { return { streak: 0, xp: 0 }; }
  });

  // --- ROLE HELPERS ---
  const rolePermissions = useMemo(() => {
    const role = userProfile?.role || 'student';
    return {
      isStudent: true, // Everyone is a student basically
      isAdministrator: ['administrator', 'super_admin'].includes(role),
      isFinancialAdmin: ['financial_admin', 'super_admin'].includes(role),
      isSuperAdmin: role === 'super_admin',
      role
    };
  }, [userProfile]);

  // --- AUTH & PROFILE SYNC ---
  useEffect(() => {
    const initAuth = async () => {
      if (!supabase) {
        // Fallback for dev/missing keys
        setUserProfile({
          fullName: 'Development User',
          email: 'dev@apexscholars.com',
          role: 'super_admin',
          isActivated: true,
          subscriptionStatus: 'active'
        });
        setLoadingAuth(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);

      if (session?.user) {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          setUserProfile(profile);
          // Session protection check
          const currentFingerprint = localStorage.getItem('apex_device_id') || 'unknown';
          if (profile.device_fingerprint && profile.device_fingerprint !== currentFingerprint) {
             console.warn("Session active on another device");
             // Here we could trigger a logout or show a modal
          }
        }
      }
      setLoadingAuth(false);
    };

    initAuth();

    const { data: { subscription } } = supabase?.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) setUserProfile(null);
    }) || { data: { subscription: null } };

    return () => subscription?.unsubscribe();
  }, []);

  // --- PERSISTENCE ---
  useEffect(() => {
    localStorage.setItem('apex_study_stats', JSON.stringify(studyStats));
  }, [studyStats]);

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

  const value = useMemo(() => ({
    session, userProfile, loadingAuth, ...rolePermissions,
    allFlashcards, flashcards: allFlashcards,
    studyStats, setStudyStats,
    darkMode, toggleDarkMode: () => setDarkMode(!darkMode),
    isOnline,
    updateProfile: async (updates) => {
       if (!supabase || !userProfile) return;
       const { error } = await supabase.from('profiles').update(updates).eq('id', userProfile.id);
       if (!error) setUserProfile(prev => ({ ...prev, ...updates }));
    }
  }), [session, userProfile, loadingAuth, rolePermissions, allFlashcards, studyStats, darkMode, isOnline]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() { return useContext(AppContext); }
