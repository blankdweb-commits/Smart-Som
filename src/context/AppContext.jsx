import React, { createContext, useContext, useState, useEffect } from 'react';
import { initialFlashcards } from '../data/initialData';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [flashcards, setFlashcards] = useState(() => {
    const saved = localStorage.getItem('flashcards');
    return saved ? JSON.parse(saved) : initialFlashcards;
  });

  const [exams, setExams] = useState(() => {
    const saved = localStorage.getItem('exams');
    return saved ? JSON.parse(saved) : [];
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
    localStorage.setItem('flashcards', JSON.stringify(flashcards));
  }, [flashcards]);

  useEffect(() => {
    localStorage.setItem('exams', JSON.stringify(exams));
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
    setFlashcards([...flashcards, { ...card, id: Date.now().toString(), createdAt: new Date().toISOString() }]);
  };

  const updateFlashcard = (id, updatedCard) => {
    setFlashcards(flashcards.map(card => card.id === id ? { ...card, ...updatedCard } : card));
  };

  const deleteFlashcard = (id) => {
    setFlashcards(flashcards.filter(card => card.id !== id));
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
      flashcards, addFlashcard, updateFlashcard, deleteFlashcard,
      exams, addExam, updateExam, deleteExam,
      darkMode, toggleDarkMode,
      studyStats, incrementCardsStudied
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useAppContext = () => useContext(AppContext);
