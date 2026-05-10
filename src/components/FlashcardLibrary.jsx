import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import FlashcardCard from '../components/FlashcardCard';
import FlashcardForm from '../components/FlashcardForm';
import ShareModal from '../components/ShareModal';
import Toast from '../components/Toast';
import { Plus, Search, Filter, Play, Shuffle, List, ChevronLeft, ChevronRight, Award, Download, Upload, Share2, Folder, Book, ArrowLeft, AlertCircle, CheckCircle2, FileUp, Loader2, ChevronDown, ChevronUp } from './Icons';
import { extractTextFromFile, parseQuestionsAndAnswers } from '../utils/fileParser';
import { CURRICULUM_MASTER } from '../data/curriculumMaster';

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
  const { flashcards, exams, addFlashcard, updateFlashcard, deleteFlashcard, incrementCardsStudied, updateCardProgress, importFlashcards } = useAppContext();

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
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
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
  const [isUploading, setIsUploading] = useState(false);

  // Derive hierarchy options
  const categoryCards = useMemo(() => {
    // Professional tracks (NCLEX/NMCN) don't depend on Academic Program selection
    if (initialCategory !== 'Academic') {
      return flashcards.filter(c => c.category === initialCategory);
    }

    if (!currentProgram) return [];

    const programSlug = currentProgram.toLowerCase().replace(/\s+/g, '-');

    // Core filtering logic for built-in vs user cards
    return flashcards.filter(c => {
      // Special Handling for Professional Tracks
      if (programSlug === 'nclex') return c.category === 'NCLEX';
      if (programSlug === 'nmcn') return c.category === 'NMCN';

      // Academic curriculum filtering
      if (c.program) {
        // Match specific program or general nursing foundation if applicable
        return c.program === programSlug || (programSlug === 'general-nursing' && c.program === 'nd-nursing');
      }

      // If it's a user card
      const subject = c.subject || '';
      if (currentProgram === 'Midwifery') {
        return subject.toLowerCase().includes('midwifery') || c.category === initialCategory;
      }
      return !subject.toLowerCase().includes('midwifery') || c.category === initialCategory;
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

    // For general nursing, use the strict order from CURRICULUM_MASTER
    if (currentProgram === 'General Nursing') {
      const masterCourses = CURRICULUM_MASTER[currentLevel]?.[currentSemester] || [];
      return masterCourses.map(c => c.course.replace(/\s+and\s+/gi, ' & ').trim());
    }

    const dataSubjects = [...new Set(categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester).map(c => c.subject))];
    return dataSubjects.sort();
  }, [categoryCards, currentLevel, currentSemester, currentProgram]);

  // Main filter logic
  const upcomingExamSubjects = useMemo(() => {
    return exams
      .filter(e => {
        if (!e || !e.title) return false;
        const diff = new Date(e.date).getTime() - new Date().getTime();
        return diff > 0 && diff <= (7 * 24 * 3600 * 1000); // Next 7 days
      })
      .map(e => (e.title || '').toLowerCase());
  }, [exams]);

  const filteredCards = useMemo(() => {
    const term = debouncedSearchTerm.toLowerCase();
    return categoryCards.filter(card => {
      const question = card.question || '';
      const topic = card.topic || '';
      const matchesSearch = !term || question.toLowerCase().includes(term) ||
                            topic.toLowerCase().includes(term);
      const matchesLevel = !currentLevel || card.level === currentLevel;
      const matchesSemester = !currentSemester || card.semester === currentSemester;
      const matchesSubject = !currentSubject || card.subject === currentSubject;
      const matchesDifficulty = filterDifficulty === 'All' || card.difficulty === filterDifficulty;

      const isPriority = !isExamPriority || upcomingExamSubjects.some(subj => (card.subject || '').toLowerCase().includes(subj) || subj.includes((card.subject || '').toLowerCase()));

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

  const handleEdit = useCallback((card) => { setEditingCard(card); setIsFormOpen(true); }, []);

  const handleShare = useCallback((card) => {
    setShareData(card);
    setIsShareModalOpen(true);
  }, []);

  const handleToggleImportant = useCallback((id) => {
    const card = flashcards.find(c => c.id === id);
    if (card) updateFlashcard(id, { important: !card.important });
  }, [flashcards, updateFlashcard]);

  const [expandedUnits, setExpandedUnits] = useState({});

  const toggleUnit = (unitName) => {
    setExpandedUnits(prev => ({
      ...prev,
      [unitName]: !prev[unitName]
    }));
  };

  const handleFormSubmit = (data) => {
    if (editingCard) updateFlashcard(editingCard.id, data);
    else addFlashcard({ ...data, category: initialCategory, level: currentLevel, semester: currentSemester });
    setEditingCard(null);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsUploading(true);
    setToast({ message: "Starting AI Training...", type: 'info' });

    try {
      // Step 1: Scan and Analyze
      const text = await extractTextFromFile(file);

      setToast({ message: "Identifying key medical concepts...", type: 'info' });
      await new Promise(resolve => setTimeout(resolve, 1500)); // Simulate AI analysis

      const parsedCards = parseQuestionsAndAnswers(text);

      if (parsedCards.length > 0) {
        setToast({ message: `Simulating model training on ${parsedCards.length} samples...`, type: 'info' });
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
      e.target.value = null; // Reset input
    }
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
          <div className="space-y-12">
            <section>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-6 flex items-center gap-3">
                <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
                Academic Curriculum
                <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
              </h3>
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
            </section>

            <section>
              <h3 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400 mb-6 flex items-center gap-3">
                <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
                Professional Licensing
                <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
                <button
                  onClick={() => {
                    setCurrentProgram('NCLEX');
                    setCurrentLevel('Professional');
                    setCurrentSemester('Exam Prep');
                  }}
                  className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-soft hover:shadow-clinical border-2 border-transparent hover:border-blue-500 transition-all text-left group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-50 dark:bg-blue-900/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
                  <div className="w-20 h-20 bg-blue-100 dark:bg-blue-900/30 rounded-3xl flex items-center justify-center text-blue-600 mb-8 relative z-10">
                    <Award size={40} />
                  </div>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white relative z-10">NCLEX-RN</h3>
                  <p className="text-slate-500 dark:text-slate-400 mt-3 text-lg relative z-10">Intensive preparation for the National Council Licensure Examination.</p>
                  <div className="mt-8 flex items-center text-blue-600 font-bold relative z-10">
                    Start Prep <ChevronRight size={20} className="ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>

                <button
                  onClick={() => {
                    setCurrentProgram('NMCN');
                    setCurrentLevel('Professional');
                    setCurrentSemester('Exam Prep');
                  }}
                  className="p-10 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-soft hover:shadow-clinical border-2 border-transparent hover:border-emerald-500 transition-all text-left group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 dark:bg-emerald-900/10 rounded-full -mr-16 -mt-16 transition-transform group-hover:scale-110" />
                  <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 rounded-3xl flex items-center justify-center text-emerald-600 mb-8 relative z-10">
                    <CheckCircle2 size={40} />
                  </div>
                  <h3 className="text-3xl font-bold text-slate-900 dark:text-white relative z-10">NMCN Council</h3>
                  <p className="text-slate-500 dark:text-slate-400 mt-3 text-lg relative z-10">Nursing and Midwifery Council of Nigeria professional exam preparation.</p>
                  <div className="mt-8 flex items-center text-emerald-600 font-bold relative z-10">
                    Start Prep <ChevronRight size={20} className="ml-1 group-hover:translate-x-1 transition-transform" />
                  </div>
                </button>
              </div>
            </section>
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
                <p className="text-slate-500 mt-2 font-medium">Foundation and clinical practice for {(level || '').toLowerCase()}.</p>
              </button>
            ))}
          </div>
        ) : !currentSemester ? (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h3 className="text-2xl font-bold flex items-center gap-2">
                <span className="text-medical-600">{currentProgram}</span>
                <span className="text-slate-300 dark:text-slate-600">/</span>
                <span className="dark:text-white">{currentLevel}</span>
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

            <div className="grid grid-cols-1 gap-6">
              {subjects.map(subject => {
                const cardCount = categoryCards.filter(c => c.level === currentLevel && c.semester === currentSemester && c.subject === subject).length;

                // Get matching course from master curriculum to show units/topics
                const masterCourse = CURRICULUM_MASTER[currentLevel]?.[currentSemester]?.find(c =>
                  c.course.replace(/\s+and\s+/gi, ' & ').toLowerCase() === subject.toLowerCase()
                );

                return (
                  <div key={subject} className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-soft border border-slate-100 dark:border-slate-700 overflow-hidden">
                    <div className="p-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-50 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-900/20">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-medical-100 dark:bg-medical-900/40 text-medical-600 rounded-2xl flex items-center justify-center">
                          <Book size={24} />
                        </div>
                        <div>
                          <h4 className="text-xl font-black text-slate-900 dark:text-white leading-tight">{subject}</h4>
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{cardCount} Flashcards Available</p>
                        </div>
                      </div>
                      <button
                        onClick={() => setCurrentSubject(subject)}
                        className="w-full sm:w-auto px-6 py-3 bg-medical-600 hover:bg-medical-700 text-white rounded-xl font-black uppercase tracking-widest text-xs shadow-lg shadow-medical-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        <Play size={14} /> Start Study
                      </button>
                    </div>

                    {masterCourse && (
                      <div className="p-6 space-y-3">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Course Syllabus & Units</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {masterCourse.units.map((unit, uIdx) => (
                            <div key={uIdx} className="border border-slate-100 dark:border-slate-700 rounded-2xl overflow-hidden">
                              <button
                                onClick={() => toggleUnit(`${subject}-${unit.unit}`)}
                                className="w-full p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors text-left"
                              >
                                <div className="flex items-center gap-3">
                                  <div className="w-6 h-6 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 flex items-center justify-center text-[10px] font-black">
                                    {uIdx + 1}
                                  </div>
                                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate max-w-[200px]">{unit.unit}</span>
                                </div>
                                {expandedUnits[`${subject}-${unit.unit}`] ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                              </button>

                              {expandedUnits[`${subject}-${unit.unit}`] && (
                                <div className="p-4 bg-slate-50/50 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-700 animate-in slide-in-from-top-2 duration-300">
                                  <ul className="space-y-2">
                                    {unit.topics.map((topic, tIdx) => (
                                      <li key={tIdx} className="flex items-start gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                                        <div className="w-1 h-1 rounded-full bg-medical-400 mt-1.5 shrink-0" />
                                        {topic}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
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
    <div className={`space-y-6 ${viewMode === 'study' ? 'pb-0' : 'pb-20'}`}>
      {/* Mobile Breadcrumb/Back button for Study View */}
      {viewMode === 'study' && (
        <div className="fixed top-0 left-0 right-0 z-[100] p-4 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md flex items-center justify-between border-b border-slate-100 dark:border-slate-800 lg:static lg:bg-transparent lg:border-none lg:p-0">
          <button onClick={() => setViewMode('list')} className="flex items-center text-medical-600 text-sm font-bold bg-white dark:bg-slate-800 px-4 py-2 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 active:scale-95 transition-transform">
            <ArrowLeft size={16} className="mr-2" /> Exit
          </button>
          <div className="hidden sm:block lg:hidden text-[10px] font-black uppercase tracking-widest text-slate-400">
            Card {studyIndex + 1} of {shuffledCards.length}
          </div>
          <div className="w-10 lg:hidden" /> {/* Spacer */}
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="animate-in slide-in-from-left-4 duration-500">
          <div className="flex items-center gap-3 mb-1">
            {initialCategory === 'Academic' && currentSubject && (
              <button onClick={() => setCurrentSubject(null)} className="p-2 bg-white dark:bg-slate-800 shadow-soft rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-90">
                <ArrowLeft size={20} />
              </button>
            )}
            <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight">
              {currentSubject || (initialCategory === 'NCLEX' ? 'NCLEX-RN Prep' : initialCategory === 'NMCN' ? 'NMCN Council Prep' : 'Flashcards')}
            </h2>
          </div>
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-bold text-sm uppercase tracking-wider ml-1">
            <span className="text-medical-600">{currentLevel}</span>
            {currentSemester && (
              <>
                <div className="w-1 h-1 rounded-full bg-slate-300 mx-1" />
                <span>{currentSemester}</span>
              </>
            )}
          </div>
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
              <label className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-all shadow-sm active:scale-95 text-sm cursor-pointer">
                {isUploading ? <Loader2 size={18} className="mr-2 animate-spin" /> : <FileUp size={18} className="mr-2" />}
                {isUploading ? 'Parsing...' : 'Upload PQ'}
                <input type="file" className="hidden" onChange={handleFileUpload} accept=".pdf,.docx,.txt,image/*" disabled={isUploading} />
              </label>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-white dark:bg-slate-800 p-4 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700">
            <div className="relative md:col-span-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text" placeholder="Search questions..."
                value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:border-medical-500 transition-colors text-sm font-bold"
              />
            </div>
            <div>
              <select
                value={filterDifficulty}
                onChange={(e) => setFilterDifficulty(e.target.value)}
                className="w-full px-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 outline-none focus:border-medical-500 transition-colors text-sm font-bold"
              >
                <option value="All">All Difficulties</option>
                <option value="Easy">Easy</option>
                <option value="Moderate">Moderate</option>
                <option value="Hard">Hard</option>
              </select>
            </div>
            <div className="flex items-center gap-2 px-2">
              <button
                onClick={() => setIsExamPriority(!isExamPriority)}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border-2 transition-all font-bold text-xs uppercase tracking-widest ${isExamPriority ? 'bg-red-50 border-red-500 text-red-600 dark:bg-red-900/20' : 'bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-700'}`}
              >
                <AlertCircle size={16} />
                Exam Priority
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredCards.slice(0, visibleCount).map(card => (
              <FlashcardCard
                key={card.id} card={card}
                onEdit={handleEdit} onDelete={deleteFlashcard} onShare={handleShare}
                onToggleImportant={handleToggleImportant}
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
        /* Study Mode - Fullscreen on Mobile */
        <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-slate-900 flex flex-col lg:relative lg:z-0 lg:bg-transparent lg:mt-10 lg:space-y-8 overflow-hidden">
          <div className="flex w-full max-w-2xl mx-auto justify-between items-center px-4 mt-20 lg:mt-0">
            <span className="text-xs sm:text-sm font-medium text-slate-500">Card {studyIndex + 1} of {shuffledCards.length}</span>
            <div className="w-24 sm:w-48 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div className="h-full bg-medical-500 transition-all" style={{ width: `${((studyIndex + 1) / shuffledCards.length) * 100}%` }}></div>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-4 lg:p-0">
            <div className="w-full max-w-2xl h-[70vh] lg:h-80 relative">
              {shuffledCards.length > 0 && (
                <FlashcardCard
                  key={shuffledCards[studyIndex].id}
                  card={shuffledCards[studyIndex]}
                  isStudyMode={true}
                  isFullscreen={true}
                  onSwipeLeft={() => handleNext()}
                  onSwipeRight={() => handlePrev()}
                />
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 p-6 border-t border-slate-100 dark:border-slate-800 lg:bg-transparent lg:border-none lg:p-0">
            <div className="max-w-lg mx-auto space-y-6">
              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                <SRSButton label="Again" sublabel="< 1m" color="bg-red-500/90 dark:bg-red-600/80" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 1); handleNext(1); }} />
                <SRSButton label="Hard" sublabel="1d" color="bg-orange-500/90 dark:bg-orange-600/80" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 3); handleNext(3); }} />
                <SRSButton label="Good" sublabel="4d" color="bg-green-500/90 dark:bg-green-600/80" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 4); handleNext(4); }} />
                <SRSButton label="Easy" sublabel="7d+" color="bg-blue-500/90 dark:bg-blue-600/80" onClick={() => { updateCardProgress(shuffledCards[studyIndex].id, 5); handleNext(5); }} />
              </div>
              <div className="flex items-center justify-center space-x-8">
                <button onClick={handlePrev} disabled={studyIndex === 0} className="p-4 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-30"><ChevronLeft size={28} /></button>
                <button onClick={handleNext} disabled={studyIndex === shuffledCards.length - 1} className="p-4 rounded-full bg-medical-600 text-white shadow-xl shadow-medical-600/20 disabled:opacity-30"><ChevronRight size={28} /></button>
              </div>
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
