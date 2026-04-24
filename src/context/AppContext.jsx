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
    }}>
      {children}
    </AppContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAppContext() {
  return useContext(AppContext);
}
