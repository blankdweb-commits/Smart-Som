import React, { createContext, useContext, useState, useEffect } from 'react';
import { initialFlashcards } from '../data/initialData';
import { allBuiltInFlashcards } from '../data/loadFlashcards';

const AppContext = createContext();

export function AppProvider({ children }) {
  const [flashcards, setFlashcards] = useState(() => {
    const saved = localStorage.getItem('flashcards');
    const builtIn = [...initialFlashcards, ...allBuiltInFlashcards];

    if (!saved) return builtIn;

    const existing = JSON.parse(saved);
    // Merge built-in cards that don't exist in saved state
    const existingIds = new Set(existing.map(c => c.id));
    const newBuiltIn = builtIn.filter(c => !existingIds.has(c.id));

    return [...existing, ...newBuiltIn];
  });

  const [exams, setExams] = useState(() => {
    const saved = localStorage.getItem('exams');
    const parsedExams = saved ? JSON.parse(saved) : [];

    // Data Migration / Initialization for new fields
    return parsedExams.map(exam => ({
      ...exam,
      lecturer: exam.lecturer || '',
      type: exam.type || 'Written', // CBT, Written, Practical, Oral
      priority: exam.priority || 'Medium', // High, Medium, Low
      notes: exam.notes || '',
      readiness: exam.readiness ?? 0,
      topics: exam.topics || [],
      reminders: exam.reminders || ['1 day before'],
      studyMaterials: exam.studyMaterials || '',
      acknowledgedReminders: exam.acknowledgedReminders || []
    }));
  });

  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : false;
  });

  const [studyStats, setStudyStats] = useState(() => {
    const saved = localStorage.getItem('studyStats');
    return saved ? JSON.parse(saved) : { streak: 0, lastStudyDate: null, cardsStudied: 0 };
  });

  const [userProfile, setUserProfile] = useState(() => {
    const saved = localStorage.getItem('userProfile');
    return saved ? JSON.parse(saved) : {
      fullName: '',
      matricNumber: '',
      department: '',
      level: '',
      session: '2024/2025',
      email: '',
      phone: '',
      programType: 'Full-Time',
      isVerified: false,
      isAdmin: false,
      isActivated: false
    };
  });

  const [paymentPurposes, setPaymentPurposes] = useState(() => {
    const saved = localStorage.getItem('paymentPurposes');
    return saved ? JSON.parse(saved) : [
      {
        id: 'p1',
        title: 'Tuition Fee',
        description: 'Standard academic tuition for the current session.',
        amount: 450000,
        currency: 'NGN',
        targetDept: 'All',
        targetLevel: 'All',
        targetProgram: 'All',
        session: '2024/2025',
        oneTime: true,
        dueDate: '2025-06-30',
        latePenalty: 5000,
        installmentEnabled: true,
        active: true,
        code: 'TUI-2024'
      },
      {
        id: 'p2',
        title: 'Acceptance Fee',
        description: 'Mandatory fee for new students.',
        amount: 50000,
        currency: 'NGN',
        targetDept: 'All',
        targetLevel: 'Year 1',
        oneTime: true,
        dueDate: '2025-01-15',
        active: true,
        code: 'ACC-2024'
      },
      {
        id: 'p3',
        title: 'ID Card Fee',
        description: 'Biometric student identification card.',
        amount: 5000,
        currency: 'NGN',
        targetDept: 'All',
        targetLevel: 'All',
        oneTime: true,
        dueDate: '2025-02-28',
        active: true,
        code: 'IDC-2024'
      },
      {
        id: 'p4',
        title: 'Departmental Levy',
        description: 'Annual faculty and department maintenance levy.',
        amount: 15000,
        currency: 'NGN',
        targetDept: 'Nursing Science',
        targetLevel: 'All',
        oneTime: true,
        dueDate: '2025-03-30',
        active: true,
        code: 'DPT-2024'
      }
    ];
  });

  const [feeDetails, setFeeDetails] = useState({
    totalFee: 0,
    amountPaid: 0,
    currency: 'NGN',
    status: 'Unpaid'
  });

  const [transactions, setTransactions] = useState(() => {
    const saved = localStorage.getItem('transactions');
    return saved ? JSON.parse(saved) : [];
  });

  const [auditLogs, setAuditLogs] = useState(() => {
    const saved = localStorage.getItem('auditLogs');
    return saved ? JSON.parse(saved) : [];
  });

  const [curriculumSubjects] = useState(() => {
    const subjects = new Set();
    allBuiltInFlashcards.forEach(card => {
      if (card.subject) subjects.add(card.subject);
    });

    // Add common nursing subjects if not present
    [
      'Anatomy', 'Physiology', 'Pharmacology', 'Community Health Nursing',
      'Medical Surgical Nursing', 'Midwifery', 'Pediatrics', 'Nutrition',
      'Biochemistry', 'Medical Microbiology'
    ].forEach(s => subjects.add(s));

    return Array.from(subjects).sort();
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('flashcards', JSON.stringify(flashcards));
    }, 1000);
    return () => clearTimeout(timer);
  }, [flashcards]);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem('exams', JSON.stringify(exams));
    }, 1000);
    return () => clearTimeout(timer);
  }, [exams]);

  useEffect(() => {
    localStorage.setItem('darkMode', JSON.stringify(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('studyStats', JSON.stringify(studyStats));
  }, [studyStats]);

  useEffect(() => {
    localStorage.setItem('userProfile', JSON.stringify(userProfile));
  }, [userProfile]);

  useEffect(() => {
    localStorage.setItem('paymentPurposes', JSON.stringify(paymentPurposes));
  }, [paymentPurposes]);

  useEffect(() => {
    localStorage.setItem('transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('auditLogs', JSON.stringify(auditLogs));
  }, [auditLogs]);

  // Derived state for fees
  useEffect(() => {
    const relevantPurposes = paymentPurposes.filter(p =>
      p.active &&
      (p.targetDept === 'All' || p.targetDept === userProfile.department) &&
      (p.targetLevel === 'All' || p.targetLevel === userProfile.level)
    );

    const total = relevantPurposes.reduce((acc, p) => acc + p.amount, 0);
    const paid = transactions
      .filter(t => t.status === 'Success')
      .reduce((acc, t) => acc + t.amount, 0);

    setFeeDetails({
      totalFee: total,
      amountPaid: paid,
      currency: 'NGN',
      status: paid >= total ? 'Paid' : (paid > 0 ? 'Partial' : 'Unpaid'),
      pendingItems: relevantPurposes.length
    });
  }, [paymentPurposes, transactions, userProfile]);

  const addFlashcard = (card) => {
    setFlashcards([...flashcards, {
      ...card,
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      category: card.category || 'Academic',
      level: card.level || 'Year 1',
      semester: card.semester || 'Semester 1',
      srs: {
        interval: 0,
        reps: 0,
        efactor: 2.5,
        nextReview: new Date().toISOString()
      }
    }]);
  };

  const updateFlashcard = (id, updatedCard) => {
    setFlashcards(flashcards.map(card => card.id === id ? { ...card, ...updatedCard } : card));
  };

  const updateCardProgress = (id, quality) => {
    setFlashcards(flashcards.map(card => {
      if (card.id !== id) return card;

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

      efactor = efactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      if (efactor < 1.3) efactor = 1.3;

      const nextReview = new Date();
      nextReview.setDate(nextReview.getDate() + interval);

      return {
        ...card,
        srs: { interval, reps, efactor, nextReview: nextReview.toISOString() }
      };
    }));
  };

  const deleteFlashcard = (id) => {
    setFlashcards(flashcards.filter(card => card.id !== id));
  };

  const importFlashcards = (importedCards) => {
    const existingIds = new Set(flashcards.map(c => c.id));
    const newCards = importedCards.filter(c => !existingIds.has(c.id)).map(c => ({
      ...c,
      id: c.id || Date.now().toString() + Math.random().toString(36).substr(2, 9),
      category: c.category || 'Academic',
      level: c.level || 'Year 1',
      semester: c.semester || 'Semester 1',
      srs: c.srs || { interval: 0, reps: 0, efactor: 2.5, nextReview: new Date().toISOString() }
    }));
    setFlashcards([...flashcards, ...newCards]);
    return newCards.length;
  };

  const addExam = (exam) => {
    setExams([...exams, { ...exam, id: Date.now().toString() }]);
  };

  const updateExam = (id, updatedExam) => {
    setExams(exams.map(exam => exam.id === id ? { ...exam, ...updatedExam } : exam));
  };

  const deleteExam = (id) => {
    setExams(exams.filter(exam => exam.id !== id));
  };

  const toggleDarkMode = () => setDarkMode(!darkMode);

  const updateProfile = (data) => {
    setUserProfile(prev => ({ ...prev, ...data, isVerified: true }));
  };

  const addTransaction = (transaction) => {
    const txnId = 'TXN-' + Math.random().toString(36).substr(2, 9).toUpperCase();
    const newTransactions = [
      {
        ...transaction,
        id: txnId,
        receiptNo: 'RCP-' + Date.now().toString().slice(-6),
        date: new Date().toISOString(),
        releaseStatus: 'Held', // Held, Released
        disputeStatus: 'None', // None, Open, Investigating, Resolved
        adminNotes: [],
        verified: false,
        isRefunded: false
      },
      ...transactions
    ];
    setTransactions(newTransactions);
    return newTransactions[0];
  };

  const updateTransaction = (id, updates) => {
    setTransactions(transactions.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const refundTransaction = (id) => {
    setTransactions(transactions.map(t => t.id === id ? { ...t, isRefunded: true, status: 'Refunded' } : t));
  };

  const addAuditLog = (action, details) => {
    setAuditLogs([{
      id: 'LOG-' + Date.now(),
      action,
      details,
      timestamp: new Date().toISOString(),
      admin: userProfile.fullName || 'Admin'
    }, ...auditLogs]);
  };

  const addPaymentPurpose = (purpose) => {
    setPaymentPurposes([...paymentPurposes, { ...purpose, id: 'PURP-' + Date.now() }]);
  };

  const updatePaymentPurpose = (id, updated) => {
    setPaymentPurposes(paymentPurposes.map(p => p.id === id ? { ...p, ...updated } : p));
  };

  const deletePaymentPurpose = (id) => {
    setPaymentPurposes(paymentPurposes.filter(p => p.id !== id));
  };

  const incrementCardsStudied = () => {
    const today = new Date().toDateString();
    setStudyStats(prev => {
      const newStats = { ...prev, cardsStudied: prev.cardsStudied + 1 };
      if (prev.lastStudyDate !== today) {
        newStats.streak = prev.streak + 1;
        newStats.lastStudyDate = today;
      }
      return newStats;
    });
  };

  return (
    <AppContext.Provider value={{
      flashcards, addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards,
      exams, addExam, updateExam, deleteExam,
      darkMode, toggleDarkMode,
      studyStats, incrementCardsStudied,
      updateCardProgress,
      userProfile, updateProfile,
      paymentPurposes, addPaymentPurpose, updatePaymentPurpose, deletePaymentPurpose,
      feeDetails, transactions, addTransaction, updateTransaction, refundTransaction,
      auditLogs, addAuditLog,
      curriculumSubjects
    }}>
      {children}
    </AppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppContext() {
  return useContext(AppContext);
}
