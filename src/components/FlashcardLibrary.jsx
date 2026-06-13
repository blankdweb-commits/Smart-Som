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
  const { flashcards, userProfile, addFlashcard, updateFlashcard, deleteFlashcard, updateCardProgress } = useAppContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const DEV_MODE =  (import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true');
  const isActivated = userProfile.isActivated || userProfile.subscriptionStatus === 'grace' || DEV_MODE;

  const [currentProgram, setCurrentProgram] = useState(null);
  const [currentLevel, setCurrentLevel] = useState(null);
  const [currentSemester, setCurrentSemester] = useState(null);
  const [currentSubject, setCurrentSubject] = useState(null);

  useEffect(() => {
    const subjectParam = searchParams.get('subject');
    if (subjectParam) {
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
  const [viewMode, setViewMode] = useState('list');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('All');
  const [studyIndex, setStudyIndex] = useState(0);
  const [shuffledCards, setShuffledCards] = useState([]);
  const [toast, setToast] = useState(null);
  const [visibleCount, setVisibleCount] = useState(12);

  const categoryCards = useMemo(() => {
    if (initialCategory !== 'Academic') return flashcards.filter(c => c.category === initialCategory);
    if (!currentProgram) return [];
    const programSlug = currentProgram.toLowerCase().replace(/\s+/g, '-');
    return flashcards.filter(c => {
      if (programSlug === 'nclex') return c.category === 'NCLEX';
      if (programSlug === 'nmcn') return c.category === 'NMCN';
      if (c.program) return c.program === programSlug || (programSlug === 'general-nursing' && c.program === 'nd-nursing');
      const subject = c.subject || '';
      if (currentProgram === 'Midwifery') return subject.toLowerCase().includes('midwifery');
      return !subject.toLowerCase().includes('midwifery');
    });
  }, [flashcards, initialCategory, currentProgram]);

  const levels = useMemo(() => {
    const defaultLevels = ['Year 1', 'Year 2', 'Year 3'];
    const dataLevels = [...new Set(categoryCards.map(c => c.level))];
    return defaultLevels.filter(l => dataLevels.includes(l));
  }, [categoryCards]);

  const semesters = useMemo(() => {
    if (!currentLevel) return [];
    const defaultSemesters = ['Semester 1', 'Semester 2'];
    const dataSemesters = [...new Set(categoryCards.filter(c => c.level === currentLevel).map(c => c.semester))];
    return defaultSemesters.filter(s => dataSemesters.includes(s));
  }, [categoryCards, currentLevel]);

  const subjects = useMemo(() => {
    if (!currentLevel || !currentSemester) return [];
    if (currentProgram === 'General Nursing') {
      const masterCourses = CURRICULUM_MASTER[currentLevel]?.[currentSemester] || [];
      return masterCourses.map(c => c.course.replace(/\s+and\s+/gi, ' & ').trim());
    }
    return [...new Set(categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester).map(c => c.subject))];
  }, [categoryCards, currentLevel, currentSemester, currentProgram]);

  const filteredCards = useMemo(() => {
    let result = categoryCards;
    if (currentLevel) result = result.filter(c => c.level === currentLevel);
    if (currentSemester) result = result.filter(c => c.semester === currentSemester);
    if (currentSubject) result = result.filter(c => c.subject === currentSubject);
    if (searchTerm) result = result.filter(c => c.question.toLowerCase().includes(searchTerm.toLowerCase()));
    if (filterDifficulty !== 'All') result = result.filter(c => c.difficulty === filterDifficulty);
    return result;
  }, [categoryCards, currentLevel, currentSemester, currentSubject, searchTerm, filterDifficulty]);

  const startStudyMode = (shuffle = false) => {
    let pool = [...filteredCards];
    if (shuffle) pool.sort(() => Math.random() - 0.5);
    setShuffledCards(pool);
    setStudyIndex(0);
    setViewMode('study');
  };

  const handleNext = (quality = 4) => {
    if (studyIndex < shuffledCards.length - 1) setStudyIndex(prev => prev + 1);
    else {
      setToast({ message: 'Study Session Complete!', type: 'success' });
      setViewMode('list');
    }
  };

  const handlePrev = () => { if (studyIndex > 0) setStudyIndex(prev => prev - 1); };

  const handleFormSubmit = (data) => {
    if (editingCard) updateFlashcard(editingCard.id, data);
    else addFlashcard(data);
    setIsFormOpen(false);
    setEditingCard(null);
  };

  if (!isActivated) return <div className="p-20 text-center"><h2 className="text-2xl font-bold">Access Restricted</h2><p>Please activate your account to use flashcards.</p></div>;

  return (
    <div className="space-y-6 pb-32">
      {viewMode === 'list' && !currentProgram && initialCategory === 'Academic' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-10 animate-in fade-in zoom-in duration-700">
           <button onClick={() => setCurrentProgram('General Nursing')} className="p-12 bg-white dark:bg-slate-800 rounded-[3rem] shadow-clinical border-2 border-transparent hover:border-medical-500 transition-all group active:scale-95 text-left">
              <div className="w-16 h-16 bg-medical-50 text-medical-600 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform"><Book size={32} /></div>
              <h3 className="text-3xl font-black text-slate-900 dark:text-white mb-2">General Nursing</h3>
              <p className="text-slate-500">Standard Nigerian Nursing curriculum (Years 1-3)</p>
           </button>
           <button onClick={() => setCurrentProgram('Midwifery')} className="p-12 bg-white dark:bg-slate-800 rounded-[3rem] shadow-clinical border-2 border-transparent hover:border-indigo-500 transition-all group active:scale-95 text-left">
              <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform"><Folder size={32} /></div>
              <h3 className="text-3xl font-black text-slate-900 dark:text-white mb-2">Basic Midwifery</h3>
              <p className="text-slate-500">Specialized curriculum for midwifery students</p>
           </button>
        </div>
      )}

      {(currentProgram || initialCategory !== 'Academic') && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <button onClick={() => { if(currentSubject) setCurrentSubject(null); else if(currentSemester) setCurrentSemester(null); else if(currentLevel) setCurrentLevel(null); else setCurrentProgram(null); }} className="p-2 bg-white dark:bg-slate-800 shadow-soft rounded-xl hover:bg-slate-50 active:scale-90"><ArrowLeft size={20} /></button>
              <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{currentSubject || currentSemester || currentLevel || currentProgram || 'Flashcards'}</h2>
            </div>
          </div>
          <div className="flex gap-2">
             {viewMode === 'list' ? (
               <>
                 <button onClick={() => startStudyMode(true)} className="flex items-center px-4 py-2 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 active:scale-95 text-sm"><Shuffle size={18} className="mr-2" /> Shuffle Study</button>
                 <button onClick={() => startStudyMode(false)} className="flex items-center px-4 py-2 bg-medical-600 text-white rounded-lg font-bold hover:bg-medical-700 active:scale-95 text-sm"><Play size={18} className="mr-2" /> Study All</button>
                 <button onClick={() => setIsFormOpen(true)} className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 active:scale-95 text-sm"><Plus size={18} className="mr-2" /> Add Card</button>
               </>
             ) : (
               <button onClick={() => setViewMode('list')} className="flex items-center px-5 py-2.5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold shadow-soft active:scale-95"><List size={18} className="mr-2" /> Exit Study</button>
             )}
          </div>
        </div>
      )}

      {viewMode === 'list' && (currentProgram || initialCategory !== 'Academic') && (
        <>
          {!currentLevel && (
             <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 animate-in slide-in-from-bottom-4 duration-500">
                {levels.map(l => (
                   <button key={l} onClick={() => setCurrentLevel(l)} className="p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border-2 border-transparent hover:border-medical-500 transition-all text-center">
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white">{l}</h4>
                   </button>
                ))}
             </div>
          )}

          {currentLevel && !currentSemester && (
             <div className="grid grid-cols-2 gap-6 animate-in slide-in-from-bottom-4 duration-500">
                {semesters.map(s => (
                   <button key={s} onClick={() => setCurrentSemester(s)} className="p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-sm border-2 border-transparent hover:border-medical-500 transition-all text-center">
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white">{s}</h4>
                   </button>
                ))}
             </div>
          )}

          {currentLevel && currentSemester && !currentSubject && (
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 animate-in slide-in-from-bottom-4 duration-500">
                {subjects.map(sub => (
                   <button key={sub} onClick={() => setCurrentSubject(sub)} className="p-6 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border-2 border-transparent hover:border-medical-500 transition-all text-left">
                      <h4 className="font-bold text-slate-900 dark:text-white">{sub}</h4>
                   </button>
                ))}
             </div>
          )}

          {currentSubject && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredCards.slice(0, visibleCount).map(card => (
                <FlashcardCard key={card.id} card={card} onEdit={(c) => { setEditingCard(c); setIsFormOpen(true); }} onDelete={deleteFlashcard} />
              ))}
            </div>
          )}
        </>
      )}

      {viewMode === 'study' && (
        <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4">
           <div className="w-full max-w-2xl flex justify-between items-center mb-8">
              <span className="text-sm font-bold text-slate-400">Card {studyIndex + 1} of {shuffledCards.length}</span>
              <button onClick={() => setViewMode('list')} className="text-slate-400 hover:text-slate-600 transition-colors"><List size={24} /></button>
           </div>
           <div className="w-full max-w-2xl h-[60vh] relative">
              <FlashcardCard
                card={shuffledCards[studyIndex]}
                isStudyMode={true}
                isFullscreen={true}
                onSwipeLeft={() => { updateCardProgress(shuffledCards[studyIndex].id, 1); handleNext(); }}
                onSwipeRight={() => { updateCardProgress(shuffledCards[studyIndex].id, 5); handleNext(); }}
                onSwipeUp={() => { /* bookmark logic if any */ }}
              />
           </div>
           <div className="mt-8 flex gap-4">
              <button onClick={handlePrev} disabled={studyIndex === 0} className="p-4 bg-white dark:bg-slate-800 rounded-full shadow-md disabled:opacity-20"><ChevronLeft size={24}/></button>
              <button onClick={handleNext} className="p-4 bg-medical-600 text-white rounded-full shadow-lg"><ChevronRight size={24}/></button>
           </div>
        </div>
      )}

      <FlashcardForm isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingCard(null); }} onSubmit={handleFormSubmit} initialData={editingCard} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default FlashcardLibrary;
