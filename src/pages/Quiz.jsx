import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { Brain, CheckCircle2, XCircle, RefreshCw, ChevronRight, Trophy, AlertCircle, Award, Shield, Target, Zap, Clock, Users, ArrowRight, Timer } from '../components/Icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const Quiz = () => {
  const { allFlashcards = [], studyStats = {}, updateQuizStats, curriculumSubjects = [] } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();

  const [quizMode, setQuizMode] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [timeLeft, setTimeLeft] = useState(45);
  const [isLoading, setIsLoading] = useState(false);
  const [noQuestions, setNoQuestions] = useState(false);

  useEffect(() => {
    if (location.pathname.includes("subject-mastery")) {
      setQuizMode("mastery_select");
    }
  }, [location.pathname]);

  useEffect(() => {
    let timer;
    if (quizStarted && !showResults && !showRationale && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft(prev => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && quizStarted && !showResults && !showRationale) {
      handleAnswer(null);
    }
    return () => clearInterval(timer);
  }, [quizStarted, showResults, showRationale, timeLeft]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startQuiz = (mode, subject = null) => {
    setIsLoading(true);
    setNoQuestions(false);

    const pool = (Array.isArray(allFlashcards) ? allFlashcards : []).filter(q => q && q.question && Array.isArray(q.options));

    let filteredPool = pool;
    if (subject) {
      const target = (subject || "").toLowerCase().trim();
      filteredPool = pool.filter(q => (q.subject || "").toLowerCase().trim() === target);
    }

    if (filteredPool.length === 0) {
      setNoQuestions(true);
      setIsLoading(false);
      setQuizMode(mode);
      setSelectedSubject(subject);
      return;
    }

    const shuffled = [...filteredPool].sort(() => 0.5 - Math.random());
    const count = mode === 'quick' ? 10 : 20;

    setQuizQuestions(shuffled.slice(0, count));
    setQuizMode(mode);
    setSelectedSubject(subject);
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setShowRationale(false);
    setIsCorrect(null);
    setSelectedOption(null);
    setTimeLeft(45);
    setIsLoading(false);
  };

  const handleAnswer = (option) => {
    if (showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    if (!currentQ) return;

    const correct = option !== null && (option === currentQ.answer || option === currentQ.correctAnswer);

    setIsCorrect(correct);
    setSelectedOption(option);
    if (correct) {
      setScore(prev => prev + 1);
      if (updateQuizStats) updateQuizStats({ quizStreak: (studyStats?.quizStreak || 0) + 1, correctQuestionId: currentQ.id });
    } else {
      if (updateQuizStats) updateQuizStats({ quizStreak: 0 });
    }
    setShowRationale(true);
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setShowRationale(false);
      setIsCorrect(null);
      setSelectedOption(null);
      setTimeLeft(45);
    } else {
      setShowResults(true);
    }
  };

  const currentQ = quizQuestions[currentQuestionIndex];

  if (noQuestions) {
    return (
      <div className="max-w-2xl mx-auto mt-20 p-12 bg-white dark:bg-slate-800 rounded-[3rem] text-center shadow-xl border border-slate-100 dark:border-slate-700">
        <AlertCircle size={64} className="mx-auto text-slate-300 mb-6" />
        <h2 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">No Questions Available</h2>
        <p className="text-slate-500 mt-4 text-lg">No questions available for <span className="text-medical-600 font-bold">{selectedSubject || "this field"}</span> yet.</p>
        <button onClick={() => { setNoQuestions(false); setQuizMode(null); }} className="w-full mt-10 py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all">Back to Menu</button>
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-12 bg-white dark:bg-slate-800 rounded-[3rem] text-center shadow-xl border border-slate-100 dark:border-slate-700">
        <Trophy size={80} className="mx-auto text-amber-500 mb-6" />
        <h2 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Session Complete</h2>
        <div className="mt-8 grid grid-cols-2 gap-4">
           <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-3xl">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Score</p>
              <p className="text-3xl font-black text-medical-600">{score}/{quizQuestions.length}</p>
           </div>
           <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-3xl">
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Accuracy</p>
              <p className="text-3xl font-black text-indigo-600">{Math.round((score/quizQuestions.length)*100)}%</p>
           </div>
        </div>
        <button onClick={() => setQuizStarted(false)} className="w-full mt-8 py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all">Return to Hub</button>
      </div>
    );
  }

  if (quizStarted && currentQ) {
    const timerColor = timeLeft > 30 ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : timeLeft > 10 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-red-50 text-red-600 border-red-100';
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex justify-between items-center mb-8">
           <div className="flex items-center gap-4">
              <div className={`px-4 py-2 rounded-2xl border-2 flex items-center gap-2 font-black text-sm ${timerColor}`}>
                 <Timer size={16} />
                 {formatTime(timeLeft)}
              </div>
              <div className="hidden sm:block">
                 <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scenario {currentQuestionIndex + 1} of {quizQuestions.length}</p>
              </div>
           </div>
           <div className="text-right">
              <h4 className="font-black text-medical-600">{score * 10} XP</h4>
           </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-[3rem] p-8 sm:p-12 shadow-clinical border border-slate-100 dark:border-slate-700">
           {currentQ.isImported && (
              <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 mb-6">
                 <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-2" />
                 <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Verified Source: {currentQ.source}</span>
              </div>
           )}
           <h2 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white leading-tight tracking-tight">{currentQ.question}</h2>
           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-12">
              {(currentQ.options || []).map((option, idx) => (
                <button key={idx} onClick={() => handleAnswer(option)} disabled={showRationale}
                  className={`p-6 rounded-[1.5rem] border-2 text-left font-bold transition-all ${
                    showRationale
                      ? (option === currentQ.answer || option === currentQ.correctAnswer)
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : selectedOption === option ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-100 opacity-50'
                      : 'border-slate-100 hover:border-medical-500 hover:bg-medical-50'
                  }`}
                >
                  {option}
                </button>
              ))}
           </div>

           <AnimatePresence>
             {showRationale && (
               <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-8 p-8 bg-slate-50 dark:bg-slate-900 rounded-3xl border border-slate-100">
                  <div className="flex items-center gap-2 mb-4">
                     <Target size={20} className="text-medical-600" />
                     <p className="text-xs font-black uppercase tracking-widest text-slate-400">Clinical Rationale</p>
                  </div>
                  <p className="text-lg font-medium text-slate-700 dark:text-slate-300 italic">{currentQ.rationale || "Rationale provided by Apex Scholars."}</p>
                  <button onClick={nextQuestion} className="w-full mt-8 py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2">
                    {currentQuestionIndex < quizQuestions.length - 1 ? 'Next Scenario' : 'View Results'}
                    <ArrowRight size={18} />
                  </button>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </div>
    );
  }

  if (quizMode === 'mastery_select') {
    const pool = Array.isArray(allFlashcards) ? allFlashcards : [];
    const subjectsWithQs = [...new Set(pool.map(q => q.subject).filter(Boolean))];
    const subjects = (curriculumSubjects && curriculumSubjects.length > 0) ? curriculumSubjects : subjectsWithQs;

    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <header className="mb-12 flex items-center gap-4">
           <button onClick={() => setQuizMode(null)} className="p-3 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 hover:text-medical-600 transition-colors"><ArrowRight size={20} className="rotate-180" /></button>
           <div>
              <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Subject Mastery</h2>
              <p className="text-slate-500 mt-1">Select a specialized field to begin mastery.</p>
           </div>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
           {subjects.map(sub => {
             const count = pool.filter(q => (q.subject || "").toLowerCase().trim() === sub.toLowerCase().trim()).length;
             return (
               <button key={sub} onClick={() => startQuiz('mastery', sub)} className="p-8 bg-white dark:bg-slate-800 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-xl hover:border-medical-500 transition-all text-left group relative overflow-hidden">
                  <div className="relative z-10">
                    <h4 className="text-lg font-black text-slate-900 dark:text-white group-hover:text-medical-600 transition-colors">{sub}</h4>
                    <p className="mt-4 text-xs font-bold text-slate-400 uppercase tracking-widest">{count} Items Available</p>
                  </div>
                  <div className="absolute right-[-10px] bottom-[-10px] opacity-5 group-hover:opacity-10 transition-opacity">
                    <Target size={80} />
                  </div>
               </button>
             );
           })}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-16">
         <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic">Clinical Quiz Hub</h2>
         <p className="text-slate-500 mt-2 font-medium">Select a mode to begin your mastery session.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ModeCard title="Clinical Challenge" description="NMCN-style exam simulation with score tracking." icon={<Award size={32} />} onClick={() => startQuiz('clinical')} />
        <ModeCard title="Quick Quiz" description="Fast revision (10 random questions) with immediate rationale." icon={<Zap size={32} />} onClick={() => startQuiz('quick')} />
        <ModeCard title="Subject Mastery" description="Master one course with progress tracked by subject." icon={<Target size={32} />} onClick={() => setQuizMode('mastery_select')} />
      </div>
    </div>
  );
};

const ModeCard = ({ title, description, icon, onClick }) => (
  <button onClick={onClick} className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-100 dark:border-slate-700 shadow-clinical hover:shadow-xl transition-all text-left flex flex-col justify-between h-full group">
    <div>
      <div className="w-16 h-16 bg-medical-50 dark:bg-medical-900/20 text-medical-600 rounded-[1.5rem] flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">{icon}</div>
      <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">{title}</h3>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-3 font-medium leading-relaxed">{description}</p>
    </div>
    <div className="mt-10 flex items-center text-xs font-black text-medical-600 uppercase tracking-widest">Begin Session <ChevronRight size={16} className="ml-1" /></div>
  </button>
);

export default Quiz;
