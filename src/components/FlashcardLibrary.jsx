import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import FlashcardCard from '../components/FlashcardCard';
import FlashcardForm from '../components/FlashcardForm';
import ShareModal from '../components/ShareModal';
import Toast from '../components/Toast';
import MobileFriendlySelect from './MobileFriendlySelect';
import { Plus, Search, Filter, Play, Shuffle, List, ChevronLeft, ChevronRight, Award, Download, Upload, Share2, Folder, Book, ArrowLeft } from 'lucide-react';

const SRSButton = ({ label, sublabel, color, onClick }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    className={`${color} text-white p-4 rounded-2xl shadow-clinical hover:opacity-90 active:scale-95 transition-all flex flex-col items-center justify-center min-h-[80px]`}
  >
    <span className="text-lg font-bold">{label}</span>
    <span className="text-[11px] opacity-80 font-medium tracking-wide">{sublabel}</span>
  </button>
);

const FlashcardLibrary = ({ initialCategory = 'Academic' }) => {
  const { flashcards, addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards, incrementCardsStudied, updateCardProgress } = useAppContext();

  // Navigation State
  const [currentProgram, setCurrentProgram] = useState(null); // 'General Nursing' or 'Midwifery'
  const [currentLevel, setCurrentLevel] = useState(null); // 'Year 1', etc.
  const [currentSemester, setCurrentSemester] = useState(null); // 'Semester 1', etc.
  const [currentSubject, setCurrentSubject] = useState(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [editingCard, setEditingCard] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'study'
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('All');
  const [studyIndex, setStudyIndex] = useState(0);
  const [shuffledCards, setShuffledCards] = useState([]);
  const [toast, setToast] = useState(null);
  const [visibleCount, setVisibleCount] = useState(12);

  // Derive hierarchy options
  const categoryCards = useMemo(() => {
    if (!currentProgram) return [];

    const programSlug = currentProgram.toLowerCase().replace(/\s+/g, '-');

    // Core filtering logic for built-in vs user cards
    return flashcards.filter(c => {
      // Professional track specific filtering
      if (initialCategory === 'NCLEX') return c.category === 'NCLEX';
      if (initialCategory === 'NMCN') return c.category === 'NMCN';

      // Academic curriculum filtering
      if (c.program) {
        // Match specific program or general nursing foundation if applicable
        return c.program === programSlug || (programSlug === 'general-nursing' && c.program === 'nd-nursing');
      }

      // If it's a user card
      if (currentProgram === 'Midwifery') {
        return c.subject.toLowerCase().includes('midwifery') || c.category === initialCategory;
      }
      return !c.subject.toLowerCase().includes('midwifery') || c.category === initialCategory;
    });
  }, [flashcards, initialCategory, currentProgram]);

  const levels = useMemo(() => [...new Set(categoryCards.map(c => c.level))].sort(), [categoryCards]);

  const semesters = useMemo(() => {
    if (!currentLevel) return [];
    return [...new Set(categoryCards.filter(c => c.level === currentLevel).map(c => c.semester))].sort();
  }, [categoryCards, currentLevel]);

  const subjects = useMemo(() => {
    if (!currentLevel || !currentSemester) return [];
    return [...new Set(categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester).map(c => c.subject))].sort();
  }, [categoryCards, currentLevel, currentSemester]);

  // Main filter logic
  const filteredCards = useMemo(() => {
    return categoryCards.filter(card => {
      const matchesSearch = card.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            card.topic.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesLevel = !currentLevel || card.level === currentLevel;
      const matchesSemester = !currentSemester || card.semester === currentSemester;
      const matchesSubject = !currentSubject || card.subject === currentSubject;
      const matchesDifficulty = filterDifficulty === 'All' || card.difficulty === filterDifficulty;

      return matchesSearch && matchesLevel && matchesSemester && matchesSubject && matchesDifficulty;
    });
  }, [categoryCards, searchTerm, currentLevel, currentSemester, currentSubject, filterDifficulty]);

  useEffect(() => {
    setVisibleCount(12);
  }, [searchTerm, currentLevel, currentSemester, currentSubject, filterDifficulty]);

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
    incrementCardsStudied();
  };

  const handleNext = (quality = null) => {
    if (quality !== null) {
      setToast({ message: `Card Rated!`, type: 'success' });
    }
    if (studyIndex < shuffledCards.length - 1) {
      setStudyIndex(studyIndex + 1);
      incrementCardsStudied();
    }
  };

  const handlePrev = () => { if (studyIndex > 0) setStudyIndex(studyIndex - 1); };

  const handleEdit = (card) => { setEditingCard(card); setIsFormOpen(true); };

  const handleShare = (card) => {
    setShareData(card);
    setIsShareModalOpen(true);
  };

  const handleFormSubmit = (data) => {
    if (editingCard) updateFlashcard(editingCard.id, data);
    else addFlashcard({ ...data, category: initialCategory, level: currentLevel, semester: currentSemester });
    setEditingCard(null);
  };

  const resetNav = () => {
    setCurrentProgram(null);
    setCurrentLevel(null);
    setCurrentSemester(null);
    setCurrentSubject(null);
  };

  // Render Directory View
  if (viewMode === 'list' && !currentSubject && initialCategory === 'Academic') {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
        <header className="relative py-4">
          <div className="flex items-center gap-3 mb-3">
            {currentProgram && (
              <button onClick={() => {
                if (currentLevel) setCurrentLevel(null);
                else setCurrentProgram(null);
              }} className="p-2 bg-white dark:bg-slate-800 shadow-soft rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                <ArrowLeft size={20} />
              </button>
            )}
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              {currentProgram ? `${currentProgram}` : 'Your Curriculum'}
            </h2>
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-lg max-w-2xl">
            {currentProgram ? 'Select your current level of study to browse your specific courses and procedures.' : 'Choose your program to access high-yield nursing and midwifery materials.'}
          </p>
        </header>

        {!currentProgram ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            <button
              onClick={() => setCurrentProgram('General Nursing')}
              className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-soft hover:shadow-clinical border-2 border-transparent hover:border-medical-500 transition-all text-left group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-medical-50 dark:bg-medical-900/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
              <div className="w-20 h-20 bg-medical-100 dark:bg-medical-900/30 rounded-3xl flex items-center justify-center text-medical-600 mb-8 relative z-10">
                <Book size={40} />
              </div>
              <h3 className="text-3xl font-bold text-slate-900 dark:text-white relative z-10">General Nursing</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-3 text-lg relative z-10">Complete curriculum for RN training, covering all clinical and theoretical domains.</p>
              <div className="mt-8 flex items-center text-medical-600 font-bold relative z-10">
                Browse Levels <ChevronRight size={20} className="ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>

            <button
              onClick={() => setCurrentProgram('Midwifery')}
              className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-soft hover:shadow-clinical border-2 border-transparent hover:border-pink-500 transition-all text-left group relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 w-32 h-32 bg-pink-50 dark:bg-pink-900/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
              <div className="w-20 h-20 bg-pink-100 dark:bg-pink-900/30 rounded-3xl flex items-center justify-center text-pink-600 mb-8 relative z-10">
                <Award size={40} />
              </div>
              <h3 className="text-3xl font-bold text-slate-900 dark:text-white relative z-10">Midwifery</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-3 text-lg relative z-10">Specialized tracks focusing on reproductive health, neonatal care, and obstetric excellence.</p>
              <div className="mt-8 flex items-center text-pink-600 font-bold relative z-10">
                Browse Levels <ChevronRight size={20} className="ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          </div>
        ) : !currentLevel ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 sm:gap-8">
            {levels.map(level => (
              <button
                key={level}
                onClick={() => setCurrentLevel(level)}
                className="p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-soft hover:shadow-clinical border border-slate-100 dark:border-slate-700 hover:border-medical-500 dark:hover:border-medical-500 transition-all text-left group"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl text-medical-600 group-hover:scale-110 transition-transform">
                    <Folder size={32} />
                  </div>
                  <span className="bg-medical-50 dark:bg-medical-900/20 text-medical-700 dark:text-medical-400 text-xs font-bold px-3 py-1 rounded-full">
                    {categoryCards.filter(c => c.level === level).length} Cards
                  </span>
                </div>
                <h3 className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">{level}</h3>
                <p className="text-slate-500 mt-2 font-medium">Foundation and clinical practice for {level.toLowerCase()}.</p>
              </button>
            ))}
          </div>
        ) : !currentSemester ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold flex items-center gap-2">
                <span className="text-medical-600">{currentProgram}</span>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <span>{currentLevel}</span>
              </h3>
              <button onClick={() => setCurrentLevel(null)} className="text-medical-600 font-bold text-sm hover:bg-medical-50 dark:hover:bg-medical-900/20 px-4 py-2 rounded-xl transition-colors">
                Change Year
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 sm:gap-8">
              {semesters.map(sem => (
                <button
                  key={sem}
                  onClick={() => setCurrentSemester(sem)}
                className="p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:border-medical-500 transition-all text-left group"
                >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-medical-50 dark:bg-medical-900/20 rounded-xl text-medical-600">
                    <Book size={24} />
                    </div>
                    <div>
                    <h4 className="text-xl font-bold text-slate-800 dark:text-white">{sem}</h4>
                    <p className="text-slate-500 text-xs font-medium">{categoryCards.filter(c => c.level === currentLevel && c.semester === sem).length} Cards</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold">
                <span className="text-medical-600">{currentLevel}</span>
                <ChevronRight size={14} className="text-slate-400" />
                <span className="text-slate-900 dark:text-white">{currentSemester}</span>
              </div>
              <button onClick={() => setCurrentSemester(null)} className="text-medical-600 font-bold text-sm hover:bg-medical-50 px-4 py-2 rounded-xl transition-colors">
                Change Semester
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              {subjects.map(subject => {
                const cardCount = categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester && c.subject === subject).length;

                return (
                  <button
                    key={subject}
                    onClick={() => setCurrentSubject(subject)}
                    className="p-5 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:bg-medical-50 dark:hover:bg-medical-900/20 transition-all text-left group h-full flex flex-col justify-between"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-2">
                        <h5 className="text-lg font-bold text-slate-800 dark:text-white leading-tight">{subject}</h5>
                        <div className="p-2 bg-slate-50 dark:bg-slate-900/50 rounded-lg text-slate-400 group-hover:text-medical-600">
                          <Book size={18} />
                        </div>
                      </div>
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{cardCount} Flashcards</span>
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-50 dark:border-slate-700 flex justify-between items-center">
                      <span className="text-[10px] font-bold text-medical-600 uppercase">View Modules</span>
                      <ChevronRight size={14} className="text-slate-300 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Study/List View
  return (
    <div className="space-y-6 pb-20">
      {/* Mobile Breadcrumb/Back button for Study View */}
      {viewMode === 'study' && (
        <button onClick={() => setViewMode('list')} className="flex items-center text-medical-600 text-sm font-bold bg-white dark:bg-slate-800 px-4 py-2 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform">
          <ArrowLeft size={16} className="mr-2" /> Back to Decks
        </button>
      )}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            {initialCategory === 'Academic' && currentSubject && (
              <button onClick={() => setCurrentSubject(null)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">
                <ArrowLeft size={20} />
              </button>
            )}
            <h2 className="text-3xl font-bold text-slate-800 dark:text-white">
              {currentSubject || (initialCategory === 'NCLEX' ? 'NCLEX-RN Prep' : initialCategory === 'NMCN' ? 'NMCN Council Prep' : 'Flashcards')}
            </h2>
          </div>
          <p className="text-slate-600 dark:text-slate-400">
            {currentLevel} {currentSemester ? `• ${currentSemester}` : ''}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {viewMode === 'list' ? (
            <>
              <button onClick={() => startStudyMode(true, true)} className="flex items-center px-4 py-2 bg-amber-500 text-white rounded-lg font-bold hover:bg-amber-600 transition-all shadow-sm active:scale-95 text-sm">
                <Award size={18} className="mr-2" /> Smart Review
              </button>
              <button onClick={() => startStudyMode(false)} className="flex items-center px-4 py-2 bg-medical-600 text-white rounded-lg font-bold hover:bg-medical-700 transition-all shadow-sm active:scale-95 text-sm">
                <Play size={18} className="mr-2" /> Study All
              </button>
              <button onClick={() => setIsFormOpen(true)} className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700 transition-all shadow-sm active:scale-95 text-sm">
                <Plus size={18} className="mr-2" /> Add Card
              </button>
            </>
          ) : (
            <button onClick={() => setViewMode('list')} className="flex items-center px-5 py-2.5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl font-bold shadow-soft active:scale-95">
              <List size={18} className="mr-2" /> Exit Study
            </button>
          )}
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text" placeholder="Search questions..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:border-medical-500 transition-colors text-sm"
              />
            </div>
            <div>
              <select
                value={filterDifficulty}
                onChange={(e) => setFilterDifficulty(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:border-medical-500 transition-colors text-sm font-bold"
              >
                <option value="All">All Difficulties</option>
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCards.slice(0, visibleCount).map(card => (
              <FlashcardCard
                key={card.id} card={card}
                onEdit={handleEdit} onDelete={deleteFlashcard} onShare={handleShare}
                onToggleImportant={(id) => updateFlashcard(id, { important: !card.important })}
              />
            ))}
          </div>

          {filteredCards.length > visibleCount && (
            <div className="flex justify-center mt-8">
              <button onClick={() => setVisibleCount(v => v + 12)} className="px-6 py-2 bg-white dark:bg-slate-800 border rounded-xl font-bold">
                Load More ({filteredCards.length - visibleCount})
              </button>
            </div>
          )}
        </>
      ) : (
        /* Study Mode */
        <div className="flex flex-col items-center justify-center max-w-2xl mx-auto space-y-8 mt-10">
          <div className="w-full flex justify-between items-center px-4">
            <span className="text-sm font-medium text-slate-500">Card {studyIndex + 1} of {shuffledCards.length}</span>
            <div className="w-48 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-medical-500 transition-all" style={{ width: `${((studyIndex + 1) / shuffledCards.length) * 100}%` }}></div>
            </div>
          </div>

          <div className="w-full h-80">
            {shuffledCards.length > 0 && <FlashcardCard key={shuffledCards[studyIndex].id} card={shuffledCards[studyIndex]} isStudyMode={true} />}
          </div>

          <div className="w-full flex flex-col items-center gap-6">
            <div className="grid grid-cols-4 gap-3 w-full max-w-lg">
              <SRSButton label="Again" sublabel="< 1m" color="bg-red-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 1); handleNext(1); }} />
              <SRSButton label="Hard" sublabel="1d" color="bg-orange-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 3); handleNext(3); }} />
              <SRSButton label="Good" sublabel="4d" color="bg-green-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 4); handleNext(4); }} />
              <SRSButton label="Easy" sublabel="7d+" color="bg-blue-500" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 5); handleNext(5); }} />
            </div>
            <div className="flex items-center space-x-6">
              <button onClick={handlePrev} disabled={studyIndex === 0} className="p-3 rounded-full bg-white dark:bg-slate-800 shadow-md disabled:opacity-30"><ChevronLeft size={24} /></button>
              <button onClick={handleNext} disabled={studyIndex === shuffledCards.length - 1} className="p-3 rounded-full bg-medical-600 text-white shadow-lg disabled:opacity-30"><ChevronRight size={24} /></button>
            </div>
          </div>
        </div>
      )}

      <FlashcardForm isOpen={isFormOpen} onClose={() => { setIsFormOpen(false); setEditingCard(null); }} onSubmit={handleFormSubmit} initialData={editingCard} />
      {isShareModalOpen && <ShareModal isOpen={isShareModalOpen} onClose={() => setIsShareModalOpen(false)} card={shareData} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default FlashcardLibrary;
