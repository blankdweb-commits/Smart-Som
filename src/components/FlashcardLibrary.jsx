import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import FlashcardCard from '../components/FlashcardCard';
import FlashcardForm from '../components/FlashcardForm';
import ShareModal from '../components/ShareModal';
import Toast from '../components/Toast';
import { Plus, Search, Filter, Play, Shuffle, List, ChevronLeft, ChevronRight, Award, Download, Upload, Share2, Folder, Book, ArrowLeft, AlertCircle, CheckCircle2, FileUp, Loader2, ChevronDown, ChevronUp, Lock } from './Icons';
import { extractTextFromFile, parseQuestionsAndAnswers } from '../utils/fileParser';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
  const { allFlashcards, exams, userProfile, addFlashcard, updateFlashcard, deleteFlashcard, incrementCardsStudied, updateCardProgress } = useAppContext();
  const flashcards = allFlashcards || [];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const isActivated = userProfile?.isActivated || true;

  const [currentProgram, setCurrentProgram] = useState(null);
  const [currentLevel, setCurrentLevel] = useState(null);
  const [currentSemester, setCurrentSemester] = useState(null);
  const [currentSubject, setCurrentSubject] = useState(null);

  useEffect(() => {
    const subjectParam = searchParams.get('subject');
    if (subjectParam && flashcards.length > 0) {
      const card = flashcards.find(c => c.subject === subjectParam);
      if (card) {
        setCurrentProgram(card.program === 'midwifery' ? 'Midwifery' : 'General Nursing');
        setCurrentLevel(card.level);
        setCurrentSemester(card.semester);
        setCurrentSubject(subjectParam);
      } else {
         setCurrentSubject(subjectParam);
      }
    }
  }, [searchParams, flashcards]);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [viewMode, setViewMode] = useState(() => localStorage.getItem("apex_flashcard_view_mode") || "list");
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('All');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const [isExamPriority, setIsExamPriority] = useState(false);
  const [studyIndex, setStudyIndex] = useState(() => parseInt(localStorage.getItem("apex_flashcard_study_index") || "0", 10));
  const [shuffledCards, setShuffledCards] = useState(() => JSON.parse(localStorage.getItem("apex_flashcard_shuffled_cards") || "[]"));
  const [toast, setToast] = useState(null);
  const [visibleCount, setVisibleCount] = useState(12);
  const [isUploading, setIsUploading] = useState(false);

  useEffect(() => {
    localStorage.setItem("apex_flashcard_study_index", studyIndex);
    localStorage.setItem("apex_flashcard_shuffled_cards", JSON.stringify(shuffledCards));
    localStorage.setItem("apex_flashcard_view_mode", viewMode);
  }, [studyIndex, shuffledCards, viewMode]);

  const categoryCards = useMemo(() => {
    if (initialCategory !== 'Academic') {
      return flashcards.filter(c => c && c.category === initialCategory);
    }
    if (!currentProgram) return [];
    const programSlug = currentProgram.toLowerCase().replace(/\s+/g, '-');
    return flashcards.filter(c => {
      if (!c) return false;
      if (programSlug === 'nclex') return c.category === 'NCLEX';
      if (programSlug === 'nmcn') return c.category === 'NMCN';
      if (c.program) return c.program === programSlug || (programSlug === 'general-nursing' && c.program === 'nd-nursing');
      const subject = c.subject || '';
      if (currentProgram === 'Midwifery') return subject.toLowerCase().includes('midwifery') || c.category === initialCategory;
      return !subject.toLowerCase().includes('midwifery') || c.category === initialCategory;
    });
  }, [flashcards, initialCategory, currentProgram]);

  const subjects = useMemo(() => {
    if (!currentLevel || !currentSemester) return [];
    if (currentProgram === 'General Nursing') {
      const masterCourses = (CURRICULUM_MASTER && CURRICULUM_MASTER[currentLevel]?.[currentSemester]) || [];
      return masterCourses.map(c => c.course.replace(/\s+and\s+/gi, ' & ').trim());
    }
    const dataSubjects = [...new Set(categoryCards.filter(c => c && c.level === currentLevel && c.semester === currentSemester).map(c => c.subject))];
    return dataSubjects.sort();
  }, [categoryCards, currentLevel, currentSemester, currentProgram]);

  const filteredCards = useMemo(() => {
    const term = debouncedSearchTerm.toLowerCase();
    return categoryCards.filter(card => {
      if (!card) return false;
      const matchesSearch = !term || (card.question || '').toLowerCase().includes(term) || (card.topic || '').toLowerCase().includes(term);
      const matchesLevel = !currentLevel || card.level === currentLevel;
      const matchesSemester = !currentSemester || card.semester === currentSemester;
      const matchesSubject = !currentSubject || card.subject === currentSubject;
      const matchesDifficulty = filterDifficulty === 'All' || card.difficulty === filterDifficulty;
      return matchesSearch && matchesLevel && matchesSemester && matchesSubject && matchesDifficulty;
    });
  }, [categoryCards, debouncedSearchTerm, currentLevel, currentSemester, currentSubject, filterDifficulty]);

  const handleNext = (quality = 0) => {
    if (studyIndex < shuffledCards.length - 1) {
      setStudyIndex(prev => prev + 1);
    } else {
      setToast({ message: "Session complete!", type: 'success' });
      setViewMode('list');
    }
  };

  const handlePrev = () => {
    if (studyIndex > 0) setStudyIndex(prev => prev - 1);
  };

  const startStudyMode = (shuffle = false, srsOnly = false) => {
    let cardsToStudy = [...filteredCards];
    if (srsOnly) {
      cardsToStudy = cardsToStudy.filter(c => !c.srs?.nextReview || new Date(c.srs.nextReview) <= new Date());
    }
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
           <FlashcardCard card={currentCard} isStudyMode={true} isFullscreen={true} onSwipeLeft={() => handleNext()} onSwipeRight={() => handlePrev()} />
        </div>
        <footer className="p-6 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-800">
           <div className="max-w-lg mx-auto grid grid-cols-4 gap-3">
              <SRSButton label="Again" sublabel="<1m" color="bg-red-500" onClick={() => { updateCardProgress(currentCard.id, 1); handleNext(1); }} />
              <SRSButton label="Hard" sublabel="1d" color="bg-orange-500" onClick={() => { updateCardProgress(currentCard.id, 3); handleNext(3); }} />
              <SRSButton label="Good" sublabel="4d" color="bg-green-500" onClick={() => { updateCardProgress(currentCard.id, 4); handleNext(4); }} />
              <SRSButton label="Easy" sublabel="7d+" color="bg-blue-500" onClick={() => { updateCardProgress(currentCard.id, 5); handleNext(5); }} />
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
          <p className="text-slate-500 font-bold text-sm uppercase tracking-widest mt-1">{currentProgram || 'All Programs'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => startStudyMode(true)} className="flex items-center px-6 py-3 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg active:scale-95 transition-all"><Play size={18} className="mr-2" /> Study Session</button>
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
           <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase">No Questions Available</h3>
           <p className="text-slate-500 mt-2">No questions available for this course yet.</p>
        </div>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default FlashcardLibrary;
