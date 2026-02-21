import React, { useState, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import FlashcardCard from '../components/FlashcardCard';
import FlashcardForm from '../components/FlashcardForm';
import { Plus, Search, Filter, Play, Shuffle, List, ChevronLeft, ChevronRight, Award } from 'lucide-react';

const Flashcards = () => {
  const { flashcards, addFlashcard, updateFlashcard, deleteFlashcard, incrementCardsStudied } = useAppContext();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingCard, setEditingCard] = useState(null);
  const [viewMode, setViewMode] = useState('list'); // 'list' or 'study'
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSubject, setFilterSubject] = useState('All');
  const [filterDifficulty, setFilterDifficulty] = useState('All');
  const [studyIndex, setStudyIndex] = useState(0);
  const [shuffledCards, setShuffledCards] = useState([]);

  const subjects = ['All', ...new Set(flashcards.map(c => c.subject))];

  const filteredCards = useMemo(() => {
    return flashcards.filter(card => {
      const matchesSearch = card.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
                            card.topic.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesSubject = filterSubject === 'All' || card.subject === filterSubject;
      const matchesDifficulty = filterDifficulty === 'All' || card.difficulty === filterDifficulty;
      return matchesSearch && matchesSubject && matchesDifficulty;
    });
  }, [flashcards, searchTerm, filterSubject, filterDifficulty]);

  const startStudyMode = (shuffle = false) => {
    let cardsToStudy = [...filteredCards];
    if (shuffle) {
      cardsToStudy = cardsToStudy.sort(() => Math.random() - 0.5);
    }
    setShuffledCards(cardsToStudy);
    setStudyIndex(0);
    setViewMode('study');
    if (cardsToStudy.length > 0) {
      incrementCardsStudied();
    }
  };

  const handleNext = () => {
    if (studyIndex < shuffledCards.length - 1) {
      setStudyIndex(studyIndex + 1);
      incrementCardsStudied();
    }
  };

  const handlePrev = () => {
    if (studyIndex > 0) {
      setStudyIndex(studyIndex - 1);
    }
  };

  const handleEdit = (card) => {
    setEditingCard(card);
    setIsFormOpen(true);
  };

  const handleFormSubmit = (data) => {
    if (editingCard) {
      updateFlashcard(editingCard.id, data);
    } else {
      addFlashcard(data);
    }
    setEditingCard(null);
  };

  const highYieldCards = flashcards.filter(c => c.important);

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Flashcards</h2>
          <p className="text-slate-600 dark:text-slate-400">Master your nursing concepts through active recall.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {viewMode === 'list' ? (
            <>
              <button
                onClick={() => startStudyMode(false)}
                className="flex items-center px-4 py-2 bg-medical-600 hover:bg-medical-700 text-white rounded-lg transition-colors"
                disabled={filteredCards.length === 0}
              >
                <Play size={18} className="mr-2" /> Study
              </button>
              <button
                onClick={() => startStudyMode(true)}
                className="flex items-center px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors"
                disabled={filteredCards.length === 0}
              >
                <Shuffle size={18} className="mr-2" /> Shuffle
              </button>
              <button
                onClick={() => { setEditingCard(null); setIsFormOpen(true); }}
                className="flex items-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
              >
                <Plus size={18} className="mr-2" /> Add Card
              </button>
            </>
          ) : (
            <button
              onClick={() => setViewMode('list')}
              className="flex items-center px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg transition-colors"
            >
              <List size={18} className="mr-2" /> Exit Study
            </button>
          )}
        </div>
      </div>

      {viewMode === 'list' ? (
        <>
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white dark:bg-slate-800 p-4 rounded-xl shadow-sm">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Search questions or topics..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-medical-500"
              />
            </div>
            <div className="flex items-center">
              <Filter className="mr-2 text-slate-400" size={18} />
              <select
                value={filterSubject}
                onChange={(e) => setFilterSubject(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-medical-500"
              >
                {subjects.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex items-center">
              <Award className="mr-2 text-slate-400" size={18} />
              <select
                value={filterDifficulty}
                onChange={(e) => setFilterDifficulty(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-900 outline-none focus:ring-2 focus:ring-medical-500"
              >
                <option value="All">All Difficulties</option>
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
          </div>

          {/* High Yield Section */}
          {highYieldCards.length > 0 && searchTerm === '' && filterSubject === 'All' && (
            <section>
              <h3 className="text-lg font-bold mb-3 flex items-center text-orange-600 dark:text-orange-400">
                <Award size={20} className="mr-2" /> High-Yield Topics
              </h3>
              <div className="flex overflow-x-auto pb-4 gap-4 scrollbar-hide">
                {highYieldCards.map(card => (
                  <div key={card.id} className="min-w-[280px] bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/10 dark:to-amber-900/10 p-4 rounded-xl border border-orange-100 dark:border-orange-900/30">
                    <span className="text-[10px] font-bold uppercase text-orange-600">{card.subject}</span>
                    <h4 className="font-bold mt-1 mb-2 line-clamp-1">{card.topic}</h4>
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">{card.question}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCards.length > 0 ? (
              filteredCards.map(card => (
                <FlashcardCard
                  key={card.id}
                  card={card}
                  onEdit={handleEdit}
                  onDelete={deleteFlashcard}
                  onToggleImportant={(id) => updateFlashcard(id, { important: !card.important })}
                />
              ))
            ) : (
              <div className="col-span-full py-20 text-center">
                <p className="text-slate-500 text-lg">No flashcards found matching your filters.</p>
                <button
                  onClick={() => { setEditingCard(null); setIsFormOpen(true); }}
                  className="mt-4 text-medical-600 font-semibold hover:underline"
                >
                  Create your first card
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Study Mode */
        <div className="flex flex-col items-center justify-center max-w-2xl mx-auto space-y-8 mt-10">
          <div className="w-full flex justify-between items-center px-4">
            <span className="text-sm font-medium text-slate-500">
              Card {studyIndex + 1} of {shuffledCards.length}
            </span>
            <div className="w-48 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-medical-500 transition-all duration-300"
                style={{ width: `${((studyIndex + 1) / shuffledCards.length) * 100}%` }}
              ></div>
            </div>
          </div>

          <div className="w-full h-80">
            {shuffledCards.length > 0 && (
              <FlashcardCard
                key={shuffledCards[studyIndex].id}
                card={shuffledCards[studyIndex]}
                isStudyMode={true}
              />
            )}
          </div>

          <div className="flex items-center space-x-6">
            <button
              onClick={handlePrev}
              disabled={studyIndex === 0}
              className="p-4 rounded-full bg-white dark:bg-slate-800 shadow-md disabled:opacity-30 transition-all active:scale-95"
            >
              <ChevronLeft size={32} />
            </button>
            <button
              onClick={handleNext}
              disabled={studyIndex === shuffledCards.length - 1}
              className="p-4 rounded-full bg-medical-600 text-white shadow-lg disabled:opacity-30 transition-all active:scale-95"
            >
              <ChevronRight size={32} />
            </button>
          </div>

          {studyIndex === shuffledCards.length - 1 && (
            <div className="text-center p-6 bg-green-50 dark:bg-green-900/20 rounded-2xl border border-green-100 dark:border-green-900/30">
              <h4 className="text-xl font-bold text-green-700 dark:text-green-400 mb-2">Session Complete!</h4>
              <p className="text-slate-600 dark:text-slate-400">You've reached the end of this set. Great job!</p>
              <button
                onClick={() => setViewMode('list')}
                className="mt-4 px-6 py-2 bg-green-600 text-white rounded-lg font-medium"
              >
                Back to List
              </button>
            </div>
          )}
        </div>
      )}

      <FlashcardForm
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingCard(null); }}
        onSubmit={handleFormSubmit}
        initialData={editingCard}
      />
    </div>
  );
};

export default Flashcards;
