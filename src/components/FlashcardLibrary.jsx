import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import FlashcardCard from '../components/FlashcardCard';
import Toast from '../components/Toast';
import { Play, ArrowLeft, AlertCircle, ChevronLeft, ChevronRight } from './Icons';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { useSearchParams } from 'react-router-dom';

const SRSButton = ({ label, sublabel, color, onClick }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`${color} text-white p-4 rounded-2xl shadow-clinical hover:opacity-90 transition-all flex flex-col items-center justify-center min-h-[80px] active:scale-95`}
  >
    <span className="text-lg font-bold">{label}</span>
    <span className="text-[11px] opacity-80 font-medium tracking-wide">{sublabel}</span>
  </button>
);

const FlashcardLibrary = ({ initialCategory = 'Academic' }) => {
  const { allFlashcards = [], updateCardProgress } = useAppContext();
  const [searchParams] = useSearchParams();

  const [currentLevel, setCurrentLevel] = useState(null);
  const [currentSemester, setCurrentSemester] = useState(null);
  const [currentSubject, setCurrentSubject] = useState(null);

  useEffect(() => {
    const subjectParam = searchParams.get('subject');
    if (subjectParam && allFlashcards.length > 0) {
      const card = allFlashcards.find(c => c && c.subject === subjectParam);
      if (card) {
        setCurrentLevel(card.level);
        setCurrentSemester(card.semester);
        setCurrentSubject(subjectParam);
      } else {
         setCurrentSubject(subjectParam);
      }
    }
  }, [searchParams, allFlashcards]);

  const [viewMode, setViewMode] = useState("list");
  const [studyIndex, setStudyIndex] = useState(0);
  const [shuffledCards, setShuffledCards] = useState([]);
  const [toast, setToast] = useState(null);
  const [visibleCount, setVisibleCount] = useState(12);

  const categoryCards = useMemo(() => {
    const pool = Array.isArray(allFlashcards) ? allFlashcards : [];
    if (initialCategory !== 'Academic') {
      return pool.filter(c => c && c.category === initialCategory);
    }
    return pool;
  }, [allFlashcards, initialCategory]);

  const filteredCards = useMemo(() => {
    return categoryCards.filter(card => {
      if (!card) return false;
      const matchesLevel = !currentLevel || card.level === currentLevel;
      const matchesSemester = !currentSemester || card.semester === currentSemester;
      const matchesSubject = !currentSubject || card.subject === currentSubject;
      return matchesLevel && matchesSemester && matchesSubject;
    });
  }, [categoryCards, currentLevel, currentSemester, currentSubject]);

  const handleNext = () => {
    if (studyIndex < shuffledCards.length - 1) {
      setStudyIndex(prev => prev + 1);
    } else {
      setToast({ message: "Session complete!", type: 'success' });
      setViewMode('list');
    }
  };

  const startStudyMode = (shuffle = false) => {
    let cardsToStudy = [...filteredCards];
    if (shuffle) cardsToStudy.sort(() => Math.random() - 0.5);
    if (cardsToStudy.length === 0) {
      setToast({ message: "No cards available!", type: 'info' });
      return;
    }
    setShuffledCards(cardsToStudy);
    setStudyIndex(0);
    setViewMode('study');
  };

  if (viewMode === 'study') {
    const currentCard = shuffledCards[studyIndex];
    if (!currentCard) {
      setViewMode('list');
      return null;
    }

    return (
      <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 flex flex-col overflow-hidden">
        <header className="p-4 flex justify-between items-center bg-white dark:bg-slate-800 border-b border-slate-100 dark:border-slate-800">
           <button onClick={() => setViewMode('list')} className="p-2 text-slate-500 hover:text-slate-900"><ArrowLeft size={24} /></button>
           <span className="font-black text-xs uppercase tracking-widest text-slate-400">Card {studyIndex + 1} of {shuffledCards.length}</span>
           <div className="w-10" />
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
           <FlashcardCard card={currentCard} isStudyMode={true} isFullscreen={true} onSwipeLeft={() => handleNext()} onSwipeRight={() => handleNext()} />
        </div>
        <footer className="p-6 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-800">
           <div className="max-w-lg mx-auto grid grid-cols-4 gap-3">
              <SRSButton label="Again" sublabel="<1m" color="bg-red-500" onClick={() => { updateCardProgress(currentCard.id, 1); handleNext(); }} />
              <SRSButton label="Hard" sublabel="1d" color="bg-orange-500" onClick={() => { updateCardProgress(currentCard.id, 3); handleNext(); }} />
              <SRSButton label="Good" sublabel="4d" color="bg-green-500" onClick={() => { updateCardProgress(currentCard.id, 4); handleNext(); }} />
              <SRSButton label="Easy" sublabel="7d+" color="bg-blue-500" onClick={() => { updateCardProgress(currentCard.id, 5); handleNext(); }} />
           </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-20">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">{currentSubject || initialCategory}</h2>
          <p className="text-slate-500 font-bold text-sm uppercase tracking-widest mt-1">Study Repository</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => startStudyMode(true)} className="flex items-center px-6 py-3 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg active:scale-95 transition-all"><Play size={18} className="mr-2" /> Start Study Session</button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCards.slice(0, visibleCount).map(card => (
          <FlashcardCard key={card.id} card={card} onToggleImportant={() => {}} />
        ))}
      </div>
      {filteredCards.length === 0 && (
        <div className="text-center py-20 bg-white dark:bg-slate-800 rounded-[3rem] border-2 border-dashed border-slate-100 dark:border-slate-700">
           <AlertCircle size={48} className="mx-auto text-slate-300 mb-4" />
           <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase">No Cards Available</h3>
           <p className="text-slate-500 mt-2">No flashcards found for this selection.</p>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default FlashcardLibrary;
