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
import { motion, AnimatePresence } from 'framer-motion';

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

  const [expandedUnits, setExpandedUnits] = useState({});
  const toggleUnit = (key) => {
    setExpandedUnits(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Deep Link Subject Support
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

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const [isExamPriority, setIsExamPriority] = useState(false);
  const [studyIndex, setStudyIndex] = useState(0);
  const [shuffledCards, setShuffledCards] = useState([]);
  const [toast, setToast] = useState(null);
  const [visibleCount, setVisibleCount] = useState(12);

  const categoryCards = useMemo(() => {
    if (initialCategory !== 'Academic') {
      return flashcards.filter(c => c.category === initialCategory);
    }
    if (!currentProgram) return [];
    const programSlug = currentProgram.toLowerCase().replace(/\s+/g, '-');
    return flashcards.filter(c => {
      if (programSlug === 'nclex') return c.category === 'NCLEX';
      if (programSlug === 'nmcn') return c.category === 'NMCN';
      if (c.program) {
        return c.program === programSlug || (programSlug === 'general-nursing' && c.program === 'nd-nursing');
      }
      const subject = c.subject || '';
      if (currentProgram === 'Midwifery') return subject.toLowerCase().includes('midwifery');
      return !subject.toLowerCase().includes('midwifery');
    });
  }, [flashcards, initialCategory, currentProgram]);

  const levels = useMemo(() => {
    const defaultLevels = ['Year 1', 'Year 2', 'Year 3', 'Year 4'];
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
    const dataSubjects = [...new Set(categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester).map(c => c.subject))];
    return dataSubjects.sort();
  }, [categoryCards, currentLevel, currentSemester, currentProgram]);

  const upcomingExamSubjects = useMemo(() => {
    return exams
      .filter(e => {
        if (!e || !e.title) return false;
        const diff = new Date(e.date).getTime() - new Date().getTime();
        return diff > 0 && diff <= (7 * 24 * 3600 * 1000);
      })
      .map(e => (e.title || '').toLowerCase());
  }, [exams]);

  const filteredCards = useMemo(() => {
    const term = debouncedSearchTerm.toLowerCase();
    return categoryCards.filter(card => {
      const question = card.question || '';
      const topic = card.topic || '';
      const matchesSearch = !term || question.toLowerCase().includes(term) || topic.toLowerCase().includes(term);
      const matchesLevel = !currentLevel || card.level === currentLevel;
      const matchesSemester = !currentSemester || card.semester === currentSemester;
      const matchesSubject = !currentSubject || card.subject === currentSubject;
      const matchesDifficulty = filterDifficulty === 'All' || card.difficulty === filterDifficulty;
      const isPriority = !isExamPriority || upcomingExamSubjects.some(subj => (card.subject || '').toLowerCase().includes(subj));
      return matchesSearch && matchesLevel && matchesSemester && matchesSubject && matchesDifficulty && isPriority;
    });
  }, [categoryCards, debouncedSearchTerm, currentLevel, currentSemester, currentSubject, filterDifficulty, isExamPriority, upcomingExamSubjects]);

  useEffect(() => {
    setVisibleCount(12);
  }, [debouncedSearchTerm, currentLevel, currentSemester, currentSubject, filterDifficulty, isExamPriority]);

  const startStudyMode = (shuffle = false, srsOnly = false) => {
    let cardsToStudy = [...filteredCards];
    if (srsOnly) {
      cardsToStudy = cardsToStudy.filter(c => !c.srs?.nextReview || new Date(c.srs.nextReview) <= new Date());
    }
    if (shuffle) cardsToStudy.sort(() => Math.random() - 0.5);
    if (cardsToStudy.length === 0) {
      setToast({ message: "No cards due for review!", type: 'info' });
      return;
    }
    setShuffledCards(cardsToStudy);
    setStudyIndex(0);
    setViewMode('study');
  };

  const handleNext = (quality = null) => {
    if (quality !== null) setToast({ message: `Card Rated!`, type: 'success' });
    if (studyIndex < shuffledCards.length - 1) {
      setStudyIndex(studyIndex + 1);
      incrementCardsStudied();
    }
  };

  const handlePrev = () => { if (studyIndex > 0) setStudyIndex(studyIndex - 1); };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const text = await extractTextFromFile(file);
      const parsedCards = parseQuestionsAndAnswers(text);
      if (parsedCards.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const enhancedCards = parsedCards.map(card => ({
          ...card,
          category: 'User-Trained',
          level: currentLevel || 'Year 1',
          semester: currentSemester || 'Semester 1',
          subject: currentSubject || 'AI Imported',
          source: file.name
        }));
        const count = importFlashcards(enhancedCards);
        setToast({ message: `AI Training Complete! Generated ${count} high-yield cards.`, type: 'success' });
      } else {
        setToast({ message: "Analysis failed: No clear Q&A patterns detected.", type: 'error' });
      }
    } catch (error) {
      console.error(error);
      setToast({ message: "AI Error: " + error.message, type: 'error' });
    } finally {
      setIsUploading(false);
      e.target.value = null;
    }
  };

  const handleToggleImportant = (id) => {
    const card = flashcards.find(c => c.id === id);
    if (card) updateFlashcard(id, { important: !card.important });
  };

  const handleEdit = (card) => { setEditingCard(card); setIsFormOpen(true); };
  const handleShare = (card) => { setShareData(card); setIsShareModalOpen(true); };
  const handleFormSubmit = (data) => {
    if (editingCard) updateFlashcard(editingCard.id, data);
    else addFlashcard({ ...data, category: initialCategory, level: currentLevel, semester: currentSemester, subject: currentSubject });
    setIsFormOpen(false);
    setEditingCard(null);
  };

  // Render Directory View (Hierarchy)
  if (viewMode === 'list' && !currentSubject && initialCategory === 'Academic') {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20 px-4">
        <header className="relative py-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
            <div className="flex items-center gap-3">
              {currentProgram && (
                <button onClick={() => {
                  if (currentSemester) setCurrentSemester(null);
                  else if (currentLevel) setCurrentLevel(null);
                  else setCurrentProgram(null);
                }} className="p-2 bg-white dark:bg-slate-800 shadow-soft rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                  <ArrowLeft size={20} />
                </button>
              )}
              <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white uppercase">
                {currentProgram ? `${currentProgram}` : 'Academic Vault'}
              </h2>
            </div>

            <button
              onClick={() => {
                setCurrentProgram('General Nursing');
                setCurrentLevel(null);
                setCurrentSemester(null);
                setCurrentSubject(null);
                startStudyMode(true);
              }}
              className="px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-lg shadow-indigo-500/20 active:scale-95 transition-all flex items-center gap-2"
            >
              <Zap size={14} /> Study All Cards
            </button>
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-lg max-w-2xl">
            {currentSemester ? 'Select a course to begin your specialized training session.' :
             currentLevel ? 'Choose a semester to narrow down your study focus.' :
             currentProgram ? 'Select your current academic year.' :
             'Master your curriculum with precision-targeted clinical flashcards.'}
          </p>
        </header>

        {!currentProgram ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <button onClick={() => setCurrentProgram('General Nursing')} className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical hover:border-medical-500 border-2 border-transparent transition-all text-left group">
              <div className="w-20 h-20 bg-medical-100 dark:bg-medical-900/30 rounded-3xl flex items-center justify-center text-medical-600 mb-8 group-hover:scale-110 transition-transform">
                <Book size={40} />
              </div>
              <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">General Nursing</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-3 text-lg leading-relaxed font-medium">Foundation, Medical-Surgical, and Clinical Procedures.</p>
            </button>
            <button onClick={() => setCurrentProgram('Midwifery')} className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical hover:border-pink-500 border-2 border-transparent transition-all text-left group">
              <div className="w-20 h-20 bg-pink-100 dark:bg-pink-900/30 rounded-3xl flex items-center justify-center text-pink-600 mb-8 group-hover:scale-110 transition-transform">
                <Award size={40} />
              </div>
              <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Midwifery</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-3 text-lg leading-relaxed font-medium">Obstetrics, Neonatal Care, and Reproductive Health.</p>
            </button>
          </div>
        ) : !currentLevel ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
            {levels.map(level => (
              <button key={level} onClick={() => setCurrentLevel(level)} className="p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-clinical hover:border-medical-500 border-2 border-transparent transition-all text-left group">
                <Folder className="text-medical-600 mb-6 group-hover:translate-x-2 transition-transform" size={32} />
                <h3 className="text-2xl font-black text-slate-900 dark:text-white">{level}</h3>
              </button>
            ))}
          </div>
        ) : !currentSemester ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {semesters.map(sem => (
              <button key={sem} onClick={() => setCurrentSemester(sem)} className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical hover:border-medical-500 border-2 border-transparent transition-all text-left flex justify-between items-center group">
                <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase">{sem}</h3>
                <ChevronRight size={32} className="text-slate-300 group-hover:translate-x-2 transition-transform" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-6">
            {subjects.map(subject => {
              const cardCount = categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester && c.subject === subject).length;
              return (
                <div key={subject} className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 overflow-hidden">
                  <div className="p-6 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-2xl flex items-center justify-center"><Book size={24} /></div>
                      <div>
                        <h4 className="text-xl font-black text-slate-900 dark:text-white leading-tight">{subject}</h4>
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{cardCount} Specialized Cards</p>
                      </div>
                    </div>
                    <button onClick={() => setCurrentSubject(subject)} className="w-full sm:w-auto px-8 py-3 bg-medical-600 hover:bg-medical-700 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all">
                       Enter Module
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Study/List View
  return (
    <div className={`space-y-6 ${viewMode === 'study' ? 'pb-0' : 'pb-20'} px-4`}>
      {viewMode === 'study' && (
        <div className="fixed top-0 left-0 right-0 z-[100] p-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md flex items-center justify-between border-b border-slate-100 dark:border-slate-800 lg:static lg:bg-transparent lg:border-none lg:p-0">
          <button onClick={() => setViewMode('list')} className="flex items-center text-medical-600 text-sm font-bold bg-white dark:bg-slate-800 px-4 py-2 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform">
            <ArrowLeft size={16} className="mr-2" /> Exit
          </button>
          <div className="hidden sm:block lg:hidden text-[10px] font-black uppercase tracking-widest text-slate-400">Card {studyIndex + 1} of {shuffledCards.length}</div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {initialCategory === 'Academic' && currentSubject && (
              <button onClick={() => setCurrentSubject(null)} className="p-2 bg-white dark:bg-slate-800 shadow-soft rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-90"><ArrowLeft size={20} /></button>
            )}
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
              {currentSubject || (initialCategory === 'NCLEX' ? 'NCLEX-RN Prep' : initialCategory === 'NMCN' ? 'NMCN Prep' : 'Vault')}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider ml-1">
            <span className="text-medical-600">{currentLevel}</span>
            {currentSemester && <><div className="w-1 h-1 rounded-full bg-slate-300 mx-1" /><span>{currentSemester}</span></>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {viewMode === 'list' ? (
            <>
              <button onClick={() => startStudyMode(true, true)} className="px-4 py-2 bg-amber-500 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-amber-500/20 active:scale-95 transition-all">Smart Review</button>
              <button onClick={() => startStudyMode(false)} className="px-4 py-2 bg-medical-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-600/20 active:scale-95 transition-all">Study All</button>
              <button onClick={() => setIsFormOpen(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all">Add Card</button>
            </>
          ) : (
            <button onClick={() => setViewMode('list')} className="px-5 py-2 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-soft active:scale-95">Exit Study</button>
          )}
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white dark:bg-slate-800 p-4 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700">
            <div className="relative md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input type="text" placeholder="Search..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none font-bold text-xs" />
            </div>
            <div>
              <select value={filterDifficulty} onChange={(e) => setFilterDifficulty(e.target.value)} className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 outline-none font-bold text-xs">
                <option value="All">All Difficulties</option>
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
            <button onClick={() => setIsExamPriority(!isExamPriority)} className={`flex items-center justify-center gap-2 py-3 rounded-2xl border-2 transition-all font-black text-[10px] uppercase tracking-widest ${isExamPriority ? 'bg-red-50 border-red-500 text-red-600' : 'bg-slate-50 border-slate-200 text-slate-400'}`}>
              <AlertCircle size={16} /> Exam Priority
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCards.slice(0, visibleCount).map(card => (
              <FlashcardCard key={card.id} card={card} onEdit={handleEdit} onDelete={deleteFlashcard} onShare={handleShare} onToggleImportant={handleToggleImportant} />
            ))}
          </div>
          {filteredCards.length > visibleCount && (
            <div className="flex justify-center mt-8">
              <button onClick={() => setVisibleCount(v => v + 12)} className="px-8 py-3 bg-white dark:bg-slate-800 border rounded-2xl font-black uppercase tracking-widest text-[10px]">Load More ({filteredCards.length - visibleCount})</button>
            </div>
          )}
        </>
      ) : (
        <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 flex flex-col lg:relative lg:z-0 lg:bg-transparent lg:mt-10 lg:space-y-8 overflow-hidden">
          <div className="flex w-full max-w-2xl mx-auto justify-between items-center px-4 mt-20 lg:mt-0">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Card {studyIndex + 1} / {shuffledCards.length}</span>
            <div className="w-48 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-medical-500 transition-all" style={{ width: `${((studyIndex + 1) / shuffledCards.length) * 100}%` }}></div>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 lg:p-0">
            <div className="w-full max-w-2xl h-[65vh] lg:h-80 relative">
              {shuffledCards.length > 0 && (
                <FlashcardCard
                  key={shuffledCards[studyIndex].id}
                  card={shuffledCards[studyIndex]}
                  isStudyMode={true}
                  isFullscreen={true}
                  onSwipeLeft={() => { updateCardProgress(shuffledCards[studyIndex].id, 1); handleNext(1); }}
                  onSwipeRight={() => { updateCardProgress(shuffledCards[studyIndex].id, 5); handleNext(5); }}
                  onSwipeUp={() => handleToggleImportant(shuffledCards[studyIndex].id)}
                />
              )}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 border-t border-slate-100 dark:border-slate-800 lg:bg-transparent lg:border-none pb-24 lg:pb-0">
            <div className="max-w-lg mx-auto grid grid-cols-4 gap-3">
              <SRSButton label="Again" sublabel="<1m" color="bg-red-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 1); handleNext(1); }} />
              <SRSButton label="Hard" sublabel="1d" color="bg-orange-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 3); handleNext(3); }} />
              <SRSButton label="Good" sublabel="4d" color="bg-emerald-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 4); handleNext(4); }} />
              <SRSButton label="Easy" sublabel="7d+" color="bg-blue-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 5); handleNext(5); }} />
            </div>
          </div>
        </div>
      )}

      <FlashcardForm isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingCard(null); }} onSubmit={handleFormSubmit} initialData={editingCard} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default React.memo(FlashcardLibrary);
