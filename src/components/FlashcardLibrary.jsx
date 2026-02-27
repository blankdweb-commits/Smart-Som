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
    className={`${color} text-white p-3 rounded-xl shadow-lg hover:opacity-90 active:scale-95 transition-all flex flex-col items-center justify-center`}
  >
    <span className="text-base font-bold">{label}</span>
    <span className="text-[10px] opacity-80 font-medium">{sublabel}</span>
  </button>
);

const FlashcardLibrary = ({ initialCategory = 'Academic' }) => {
  const { flashcards, addFlashcard, updateFlashcard, deleteFlashcard, importFlashcards, incrementCardsStudied, updateCardProgress } = useAppContext();

  // Navigation State
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
  const categoryCards = useMemo(() => flashcards.filter(c => c.category === initialCategory), [flashcards, initialCategory]);

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
    setCurrentLevel(null);
    setCurrentSemester(null);
    setCurrentSubject(null);
  };

  // Render Directory View
  if (viewMode === 'list' && !currentSubject && initialCategory === 'Academic') {
    return (
      <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500">
        <header>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-white">Nursing Curriculum</h2>
          <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">Select your level of study to browse courses.</p>
        </header>

        {!currentLevel ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
            {levels.map(level => (
              <button
                key={level}
                onClick={() => setCurrentLevel(level)}
                className="p-6 sm:p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:border-medical-500 dark:hover:border-medical-500 transition-all text-left group"
              >
                <Folder className="text-medical-600 mb-3 sm:mb-4 group-hover:scale-110 transition-transform" size={32} sm={40} />
                <h3 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white">{level}</h3>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  {categoryCards.filter(c => c.level === level).length} Flashcards
                </p>
              </button>
            ))}
          </div>
        ) : !currentSemester ? (
          <div className="space-y-6">
            <button onClick={() => setCurrentLevel(null)} className="flex items-center text-medical-600 text-sm font-medium hover:underline">
              <ArrowLeft size={14} className="mr-1" /> Back to Years
            </button>
            <h3 className="text-xl sm:text-2xl font-bold">{currentLevel}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6">
              {semesters.map(sem => (
                <button
                  key={sem}
                  onClick={() => setCurrentSemester(sem)}
                  className="p-6 sm:p-8 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 hover:border-medical-500 transition-all text-left group"
                >
                  <Book className="text-medical-600 mb-3 sm:mb-4 group-hover:scale-110 transition-transform" size={32} sm={40} />
                  <h4 className="text-base sm:text-lg font-bold">{sem}</h4>
                  <p className="text-xs sm:text-sm text-slate-500">
                    {categoryCards.filter(c => c.level === currentLevel && c.semester === sem).length} Flashcards
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <button onClick={() => setCurrentSemester(null)} className="flex items-center text-medical-600 text-sm font-medium hover:underline">
              <ArrowLeft size={14} className="mr-1" /> Back to Semesters
            </button>
            <h3 className="text-xl sm:text-2xl font-bold">{currentLevel} - {currentSemester}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
              {subjects.map(subject => {
                const isOSCE = subject === 'OSCE Procedures';
                const isQuickRef = subject === 'Quick Reference';
                return (
                  <button
                    key={subject}
                    onClick={() => setCurrentSubject(subject)}
                    className={`p-4 rounded-xl shadow-sm border transition-all text-left group
                      ${isOSCE ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-900/30 hover:bg-amber-100' :
                        isQuickRef ? 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-900/30 hover:bg-indigo-100' :
                        'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 hover:bg-medical-50 dark:hover:bg-medical-900/20'}
                    `}
                  >
                    <div className="flex justify-between items-start">
                      <h5 className={`font-bold truncate ${isOSCE ? 'text-amber-800 dark:text-amber-400' : isQuickRef ? 'text-indigo-800 dark:text-indigo-400' : 'text-slate-800 dark:text-white'}`}>
                        {subject}
                      </h5>
                      {(isOSCE || isQuickRef) && <Award size={16} className={isOSCE ? 'text-amber-500' : 'text-indigo-500'} />}
                    </div>
                    <span className="text-xs text-slate-500">
                      {categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester && c.subject === subject).length} cards
                    </span>
                    {isOSCE && <p className="text-[10px] mt-2 font-bold uppercase text-amber-600 dark:text-amber-500/70 tracking-tight">Essential Clinical Skills</p>}
                    {isQuickRef && <p className="text-[10px] mt-2 font-bold uppercase text-indigo-600 dark:text-indigo-500/70 tracking-tight">High-Yield Facts</p>}
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
              <button onClick={() => startStudyMode(true, true)} className="flex items-center px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition-colors shadow-sm">
                <Award size={18} className="mr-2" /> Smart Review
              </button>
              <button onClick={() => startStudyMode(false)} className="flex items-center px-4 py-2 bg-medical-600 text-white rounded-lg hover:bg-medical-700 transition-colors shadow-sm">
                <Play size={18} className="mr-2" /> Study All
              </button>
              <button onClick={() => setIsFormOpen(true)} className="flex items-center px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors shadow-sm">
                <Plus size={18} className="mr-2" /> Add Card
              </button>
            </>
          ) : (
            <button onClick={() => setViewMode('list')} className="flex items-center px-4 py-2 bg-slate-200 dark:bg-slate-700 rounded-lg">
              <List size={18} className="mr-2" /> Exit Study
            </button>
          )}
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text" placeholder="Search questions..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border dark:border-slate-700 dark:bg-slate-900 outline-none"
              />
            </div>
            <MobileFriendlySelect
              value={filterDifficulty}
              options={[
                { label: 'All Difficulties', value: 'All' },
                { label: 'Easy', value: 'Easy' },
                { label: 'Moderate', value: 'Moderate' },
                { label: 'Hard', value: 'Hard' }
              ]}
              onChange={(e) => setFilterDifficulty(e.target.value)}
            />
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
