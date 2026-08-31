import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import FlashcardCard from '../components/FlashcardCard';
import FlashcardForm from '../components/FlashcardForm';
import FlashcardStudySetup from '../components/FlashcardStudySetup';
import FlashcardStudySession from '../components/FlashcardStudySession';
import ShareModal from '../components/ShareModal';
import Toast from '../components/Toast';
import { Search, AlertCircle, ArrowLeft, ChevronRight, Award, Book, Folder, Lock, Zap } from './Icons';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';
import { useNavigate, useSearchParams } from 'react-router-dom';

const FlashcardLibrary = ({ initialCategory = 'Academic' }) => {
  const {
    flashcards, exams, session, flashcardAccess, fetchFlashcardAccess,
    addFlashcard, updateFlashcard,
    updateCardProgress, incrementCardsStudied, levelCompletions
  } = useAppContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Flashcards are ADMIN-GRANTED. Verify server-authoritative entitlement on
  // mount (and every refresh) so revoked users are re-checked on reload.
  useEffect(() => {
    fetchFlashcardAccess();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Difficulty progression -----
  const STUDY_TIERS = [
    { id: 'Easy', dot: 'bg-emerald-500', unlock: null },
    { id: 'Medium', dot: 'bg-blue-500', unlock: null },
    { id: 'Hard', dot: 'bg-orange-500', unlock: null },
    { id: 'Expert', dot: 'bg-red-500', unlock: { from: 'Hard', count: 3 } },
    { id: 'Master', dot: 'bg-purple-500', unlock: { from: 'Expert', count: 10 } },
    { id: 'Extreme', dot: 'bg-slate-900 dark:bg-white', unlock: { from: 'Master', count: 14 } }
  ];
  const isTierUnlocked = (tier) => !tier.unlock || ((levelCompletions?.[tier.unlock.from] || 0) >= tier.unlock.count);
  const cardMatchesTier = (card, tierId) => {
    if (!tierId) return true;
    const d = String(card.difficulty || '').toLowerCase();
    switch (tierId) {
      case 'Easy': return d === 'easy';
      case 'Medium': return d === 'medium' || d === 'moderate';
      case 'Hard': return d === 'hard';
      case 'Expert':
      case 'Master':
      case 'Extreme': return d === 'hard' || d === 'expert' || d === 'master' || d === 'extreme';
      default: return true;
    }
  };

  const DEV_MODE = (import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true');

  const [currentProgram, setCurrentProgram] = useState(null);
  const [currentLevel, setCurrentLevel] = useState(null);
  const [currentSemester, setCurrentSemester] = useState(null);
  const [currentSubject, setCurrentSubject] = useState(null);

  // ----- Study flow states: null | 'setup' | 'session' -----
  const [studyPool, setStudyPool] = useState([]);
  const [studyPhase, setStudyPhase] = useState(null);

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
  const [editingCard, setEditingCard] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('All');
  const [isExamPriority, setIsExamPriority] = useState(false);
  const [toast, setToast] = useState(null);
  const [visibleCount, setVisibleCount] = useState(12);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

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

  const beginStudySetup = (cardsOverride = null, srsOnly = false) => {
    let pool = cardsOverride || filteredCards;
    if (srsOnly) {
      pool = pool.filter(c => !c.srs?.nextReview || new Date(c.srs.nextReview) <= new Date());
    }
    if (pool.length === 0) {
      setToast({ message: "No cards due for review!", type: 'info' });
      return;
    }
    setStudyPool(pool);
    setStudyPhase('setup');
  };

  const handleToggleImportant = (id) => {
    const card = flashcards.find(c => c.id === id);
    if (card) updateFlashcard(id, { important: !card.important });
  };

  const handleFormSubmit = (data) => {
    if (editingCard) updateFlashcard(editingCard.id, data);
    else addFlashcard({ ...data, category: initialCategory, level: currentLevel, semester: currentSemester, subject: currentSubject });
    setIsFormOpen(false);
    setEditingCard(null);
  };

  const exitStudyFlow = () => { setStudyPhase(null); setStudyPool([]); };

  // Fullscreen study flow overlays
  // ---- ACCESS GATE: Flashcards are ADMIN-GRANTED (not premium) ----
  // Checked first so no study UI or card content ever renders before the
  // server-authoritative entitlement is verified.
  if (!session?.user) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 bg-slate-800 rounded-[2rem] flex items-center justify-center text-slate-400 mb-6"><Lock size={40} /></div>
        <h1 className="text-2xl font-black text-white uppercase tracking-tight">Sign in required</h1>
        <p className="text-slate-400 font-medium mt-2 max-w-sm">You must be signed in to access the Apex Flashcards vault.</p>
        <button onClick={() => navigate('/dashboard')} className="mt-8 px-6 py-3 bg-white text-slate-900 rounded-2xl font-bold text-sm">Back to Home</button>
      </div>
    );
  }
  if (!flashcardAccess) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 bg-red-600/20 border border-red-500/30 rounded-[2rem] flex items-center justify-center text-red-500 mb-6"><Lock size={40} /></div>
        <span className="text-[10px] font-black uppercase tracking-[0.4em] text-red-500 mb-4">HIGHLY CLASSIFIED</span>
        <h1 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-tight leading-tight max-w-md">
          This is highly classified.
        </h1>
        <p className="text-slate-400 font-semibold mt-4 max-w-md leading-relaxed">
          You are not authorised to access this area. Apex Flashcards access was not granted to this account.
        </p>
        <p className="text-slate-500 text-sm font-medium mt-3 max-w-sm leading-relaxed">
          If you believe this is a mistake, contact an administrator to request flashcard access.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-10 px-8 py-3.5 bg-red-600 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs shadow-lg shadow-red-600/20 active:scale-95 transition-all"
        >
          Return to Home
        </button>
      </div>
    );
  }

  if (studyPhase === 'session') {
    return (
      <FlashcardStudySession
        cards={studyPool}
        updateCardProgress={updateCardProgress}
        incrementCardsStudied={incrementCardsStudied}
        onComplete={() => navigate('/quiz')}
        onExit={exitStudyFlow}
      />
    );
  }
  if (studyPhase === 'setup') {
    return (
      <div className="min-h-screen bg-slate-900">
        <FlashcardStudySetup
          cards={studyPool}
          onStart={(selected) => { setStudyPool(selected); setStudyPhase('session'); }}
          onBack={exitStudyFlow}
        />
      </div>
    );
  }

  // Render Directory View (Hierarchy)
  if (!currentSubject && initialCategory === 'Academic') {
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
              onClick={() => beginStudySetup(categoryCards)}
              disabled={categoryCards.length === 0}
              className="px-6 py-3 bg-indigo-600 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] shadow-lg shadow-indigo-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <Zap size={14} /> Study All Cards
            </button>
          </div>
        </header>

        {!currentProgram ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <button onClick={() => setCurrentProgram('General Nursing')} className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical hover:border-medical-500 border-2 border-transparent transition-all text-left group">
              <div className="w-20 h-20 bg-medical-100 dark:bg-medical-900/30 rounded-3xl flex items-center justify-center text-medical-600 mb-8 group-hover:scale-110 transition-transform">
                <Book size={40} />
              </div>
              <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">General Nursing</h3>
            </button>
            <button onClick={() => setCurrentProgram('Midwifery')} className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical hover:border-pink-500 border-2 border-transparent transition-all text-left group">
              <div className="w-20 h-20 bg-pink-100 dark:bg-pink-900/30 rounded-3xl flex items-center justify-center text-pink-600 mb-8 group-hover:scale-110 transition-transform">
                <Award size={40} />
              </div>
              <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Midwifery</h3>
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
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{cardCount} Cards</p>
                      </div>
                    </div>
                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        onClick={() => {
                          const subjCards = categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester && c.subject === subject);
                          beginStudySetup(subjCards);
                        }}
                        disabled={cardCount === 0}
                        className="flex-1 sm:flex-none px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all disabled:opacity-50"
                      >
                        Study
                      </button>
                      <button onClick={() => setCurrentSubject(subject)} className="flex-1 sm:flex-none px-6 py-3 bg-medical-600 hover:bg-medical-700 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all">
                        Browse
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // List View
  return (
    <div className="space-y-6 pb-20 px-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {initialCategory === 'Academic' && currentSubject && (
              <button onClick={() => setCurrentSubject(null)} className="p-2 bg-white dark:bg-slate-800 shadow-soft rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-90"><ArrowLeft size={20} /></button>
            )}
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">
              {currentSubject || (initialCategory === 'NCLEX' ? 'NCLEX Prep' : initialCategory === 'NMCN' ? 'NMCN Prep' : 'Vault')}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-bold text-xs uppercase tracking-wider ml-1">
            <span className="text-medical-600">{currentLevel}</span>
            {currentSemester && <><div className="w-1 h-1 rounded-full bg-slate-300 mx-1" /><span>{currentSemester}</span></>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => beginStudySetup(null, true)} className="px-4 py-2 bg-amber-500 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-amber-500/20 active:scale-95 transition-all">Smart Review</button>
          <button onClick={() => beginStudySetup()} className="px-4 py-2 bg-medical-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-600/20 active:scale-95 transition-all">Study All</button>
          <button onClick={() => setIsFormOpen(true)} className="px-4 py-2 bg-emerald-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] active:scale-95 transition-all">Add Card</button>
        </div>
      </div>

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

      {/* Difficulty progression strip */}
      <div className="flex flex-wrap gap-2">
        {STUDY_TIERS.map(tier => {
          const unlocked = isTierUnlocked(tier);
          const count = categoryCards.filter(c => cardMatchesTier(c, tier.id)).length;
          return (
            <span
              key={tier.id}
              title={`${count} cards`}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[9px] font-black uppercase tracking-widest border-2
                ${!unlocked ? 'opacity-50 cursor-not-allowed border-slate-100 dark:border-slate-800 text-slate-400'
                  : 'border-slate-100 dark:border-slate-700 text-slate-500'}`}
            >
              {!unlocked ? <Lock size={11} /> : <span className={`w-2 h-2 rounded-full ${tier.dot}`} />}
              {tier.id}
              {count > 0 && <span className="opacity-60">{count}</span>}
            </span>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCards.slice(0, visibleCount).map(card => (
          <FlashcardCard key={card.id} card={card} onToggleImportant={handleToggleImportant} />
        ))}
      </div>
      {filteredCards.length > visibleCount && (
        <div className="flex justify-center mt-8">
          <button onClick={() => setVisibleCount(v => v + 12)} className="px-8 py-3 bg-white dark:bg-slate-800 border rounded-2xl font-black uppercase tracking-widest text-[10px]">Load More ({filteredCards.length - visibleCount})</button>
        </div>
      )}

      <FlashcardForm isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingCard(null); }} onSubmit={handleFormSubmit} initialData={editingCard} />
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default React.memo(FlashcardLibrary);
