import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { Brain, CheckCircle2, XCircle, RefreshCw, ChevronRight, Trophy, AlertCircle, Award, Shield, Target, Zap, Clock, Users, ArrowRight, Timer, Volume2, Settings, HelpCircle, Triangle, Diamond, Circle, Square, Sparkles, BookOpen } from '../components/Icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const Quiz = () => {
  const { allFlashcards = [], studyStats = {}, updateQuizStats, curriculumSubjects = [] } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();

  // --- SESSION STATE ---
  const [quizMode, setQuizMode] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [noQuestions, setNoQuestions] = useState(false);

  // --- CONFIG STATE ---
  const [config, setConfig] = useState({
    count: 10,
    timerEnabled: true,
    randomized: true,
    timerStyle: localStorage.getItem('apex_quiz_timer_style') || 'pill'
  });

  // --- RUNTIME STATE ---
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [selectedOption, setSelectedOption] = useState(null);
  const [timeLeft, setTimeLeft] = useState(45);
  const [streak, setStreak] = useState(0);
  const [volumeOn, setVolumeOn] = useState(true);
  const [lifelines, setLifelines] = useState({ hint: 1, fifty_fifty: 1, askClass: 1, mentor: 1 });
  const [lifelineRecoveryStreak, setLifelineRecoveryStreak] = useState(0);
  const [lifelineRecoveredMsg, setLifelineRecoveredMsg] = useState(null);

  const [hintActive, setHintActive] = useState(false);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [mentorAdvice, setMentorAdvice] = useState(null);

  // --- HELPER ---
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // --- EFFECTS ---
  useEffect(() => {
    if (location.pathname.includes("subject-mastery")) setQuizMode("mastery_select");
  }, [location.pathname]);

  useEffect(() => {
    let timer;
    if (quizStarted && config.timerEnabled && !showResults && !showRationale && timeLeft > 0) {
      timer = setInterval(() => setTimeLeft(prev => prev - 1), 1000);
    } else if (timeLeft === 0 && quizStarted && !showResults && !showRationale) {
      handleAnswer(null);
    }
    return () => clearInterval(timer);
  }, [quizStarted, config.timerEnabled, showResults, showRationale, timeLeft]);

  // --- LOGIC ---
  const openConfig = (mode, subject = null) => {
    setQuizMode(mode);
    setSelectedSubject(subject);
    setShowConfig(true);
  };

  const startQuiz = () => {
    console.log("Starting quiz with total cards available:", allFlashcards.length);
    setIsLoading(true);
    setShowConfig(false);
    setNoQuestions(false);

    // Safety check for pool construction
    const sourcePool = Array.isArray(allFlashcards) ? allFlashcards : [];

    const pool = sourcePool.map(q => {
        if (q && q.question && (!q.options || q.options.length < 2)) {
            // Find distractors
            const distractors = sourcePool
                .filter(other => other && other.id !== q.id && other.answer !== q.answer)
                .sort(() => 0.5 - Math.random())
                .slice(0, 3)
                .map(other => other.answer);
            return { ...q, options: [q.answer, ...distractors].sort(() => 0.5 - Math.random()) };
        }
        return q;
    }).filter(q => q && q.question && Array.isArray(q.options) && q.options.length >= 2);

    console.log("Processed pool size:", pool.length);

    let filteredPool = pool;
    if (selectedSubject) {
      const target = (selectedSubject || "").toLowerCase().trim();
      filteredPool = pool.filter(q => {
          const qSub = (q.subject || "").toLowerCase().trim();
          return qSub === target;
      });
      console.log(`Filtered pool for ${selectedSubject}:`, filteredPool.length);
    }

    if (filteredPool.length === 0) {
      console.warn("No questions found after filtering!");
      setNoQuestions(true);
      setIsLoading(false);
      return;
    }

    const count = Math.min(config.count, filteredPool.length);
    const shuffled = config.randomized ? [...filteredPool].sort(() => 0.5 - Math.random()) : filteredPool;
    setQuizQuestions(shuffled.slice(0, count));
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setStreak(0);
    setLifelineRecoveryStreak(0);
    setLifelines({ hint: 1, fifty_fifty: 1, askClass: 1, mentor: 1 });
    setEliminatedOptions([]);
    setHintActive(false);
    setMentorAdvice(null);
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
      const newStreak = streak + 1;
      setStreak(newStreak);
      const newRecoveryStreak = lifelineRecoveryStreak + 1;
      if (newRecoveryStreak === 5) {
        recoverLifeline();
        setLifelineRecoveryStreak(0);
      } else {
        setLifelineRecoveryStreak(newRecoveryStreak);
      }
      updateQuizStats({ quizStreak: (studyStats?.quizStreak || 0) + 1, correctQuestionId: currentQ.id });
    } else {
      setStreak(0);
      setLifelineRecoveryStreak(0);
      updateQuizStats({ quizStreak: 0 });
    }
    setShowRationale(true);
  };

  const recoverLifeline = () => {
    const depleted = Object.keys(lifelines).filter(k => lifelines[k] === 0);
    if (depleted.length > 0) {
      const randomKey = depleted[Math.floor(Math.random() * depleted.length)];
      setLifelines(prev => ({ ...prev, [randomKey]: 1 }));
      setLifelineRecoveredMsg(`Lifeline Recovered: ${randomKey.replace('_', ' ').toUpperCase()}!`);
      setTimeout(() => setLifelineRecoveredMsg(null), 3000);
    }
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setShowRationale(false);
      setIsCorrect(null);
      setSelectedOption(null);
      setEliminatedOptions([]);
      setHintActive(false);
      setMentorAdvice(null);
      setTimeLeft(45);
    } else {
      setShowResults(true);
    }
  };

  // --- LIFELINES ---
  const useHint = () => {
    if (lifelines.hint > 0 && !showRationale) {
      setLifelines(prev => ({ ...prev, hint: 0 }));
      setHintActive(true);
    }
  };

  const use5050 = () => {
    if (lifelines.fifty_fifty > 0 && !showRationale) {
      const currentQ = quizQuestions[currentQuestionIndex];
      const incorrect = currentQ.options.filter(o => o !== currentQ.answer && o !== currentQ.correctAnswer);
      const toRemove = incorrect.sort(() => 0.5 - Math.random()).slice(0, 2);
      setEliminatedOptions(toRemove);
      setLifelines(prev => ({ ...prev, fifty_fifty: 0 }));
    }
  };

  const useMentor = () => {
    if (lifelines.mentor > 0 && !showRationale) {
      const currentQ = quizQuestions[currentQuestionIndex];
      setMentorAdvice(`Clinical Tip: ${currentQ.hint || "Focus on the primary nursing priority in this scenario."}`);
      setLifelines(prev => ({ ...prev, mentor: 0 }));
    }
  };

  // --- RENDERING ---
  const currentQ = quizQuestions[currentQuestionIndex];

  if (noQuestions) {
    return (
      <div className="max-w-2xl mx-auto mt-20 p-12 bg-white dark:bg-slate-800 rounded-[3rem] text-center shadow-xl border border-slate-100 dark:border-slate-700">
        <AlertCircle size={64} className="mx-auto text-slate-300 mb-6" />
        <h2 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">No Questions Available</h2>
        <p className="text-slate-500 mt-4 text-lg">We couldn't find any questions for <span className="text-medical-600 font-bold">{selectedSubject || "this selection"}</span>.</p>
        <button onClick={() => { setNoQuestions(false); setQuizMode(null); }} className="w-full mt-10 py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest active:scale-95 transition-all">Back to Menu</button>
      </div>
    );
  }

  if (quizMode === 'mastery_select') {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <button onClick={() => setQuizMode(null)} className="mb-8 flex items-center text-slate-400 font-black uppercase tracking-widest text-[10px] hover:text-medical-600 transition-colors">
          <ChevronRight size={16} className="rotate-180 mr-2" /> Back to Menu
        </button>
        <div className="mb-12">
           <h2 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Subject Mastery</h2>
           <p className="text-slate-500 mt-2">Select a course to begin targeted training.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(curriculumSubjects.length > 0 ? curriculumSubjects : ['Anatomy & Physiology I', 'Medical Surgical', 'Pediatrics', 'Obstetrics', 'Mental Health', 'Community Health', 'Pharmacology']).map(sub => (
            <button key={sub} onClick={() => openConfig('mastery', sub)} className="p-6 bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 text-left hover:border-medical-500 transition-all group flex items-center justify-between">
              <div className="flex items-center gap-4">
                 <div className="w-12 h-12 bg-slate-50 dark:bg-slate-900 rounded-xl flex items-center justify-center text-medical-600"><BookOpen size={24} /></div>
                 <span className="font-bold text-slate-700 dark:text-slate-200">{sub}</span>
              </div>
              <ChevronRight size={20} className="text-slate-300 group-hover:text-medical-500 transform group-hover:translate-x-1 transition-all" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (showConfig) {
    return (
      <div className="max-w-xl mx-auto mt-12 p-8 sm:p-12 bg-white dark:bg-slate-800 rounded-[3rem] shadow-clinical border border-slate-100 dark:border-slate-700 text-center">
         <div className="w-20 h-20 bg-medical-50 dark:bg-medical-900/20 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8">
            <Settings size={40} />
         </div>
         <h2 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Session Settings</h2>
         <p className="text-slate-500 mt-2 mb-10">Choose your challenge parameters.</p>

         <div className="space-y-8 text-left mb-12">
            <div>
               <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 ml-2">Question Count</p>
               <div className="grid grid-cols-3 gap-2">
                  {[5, 10, 20, 50, 100].map(v => (
                    <button key={v} onClick={() => setConfig({...config, count: v})} className={`py-4 rounded-2xl font-black transition-all ${config.count === v ? 'bg-medical-600 text-white shadow-lg' : 'bg-slate-50 dark:bg-slate-900 text-slate-400'}`}>{v}</button>
                  ))}
               </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900 rounded-2xl">
               <span className="font-bold text-sm text-slate-600 dark:text-slate-300">Timer System</span>
               <button onClick={() => setConfig({...config, timerEnabled: !config.timerEnabled})} className={`w-14 h-8 rounded-full transition-all relative ${config.timerEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                  <div className={`absolute top-1 w-6 h-6 bg-white rounded-full transition-all ${config.timerEnabled ? 'right-1' : 'left-1'}`} />
               </button>
            </div>
         </div>

         <div className="flex gap-3">
            <button onClick={() => setShowConfig(false)} className="flex-1 py-5 bg-slate-100 dark:bg-slate-900 text-slate-500 rounded-2xl font-black uppercase tracking-widest text-xs">Cancel</button>
            <button onClick={startQuiz} className="flex-[2] py-5 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all">Start Quiz</button>
         </div>
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 p-12 bg-white dark:bg-slate-800 rounded-[3rem] text-center shadow-xl border border-slate-100 dark:border-slate-700">
        <Trophy size={80} className="mx-auto text-amber-500 mb-6" />
        <h2 className="text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tight italic">Session Complete</h2>
        <div className="mt-12 grid grid-cols-2 gap-4">
           <div className="p-8 bg-slate-50 dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Accuracy</p>
              <p className="text-5xl font-black text-medical-600">{Math.round((score/quizQuestions.length)*100)}%</p>
           </div>
           <div className="p-8 bg-slate-50 dark:bg-slate-900 rounded-[2rem] border border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">XP Earned</p>
              <p className="text-5xl font-black text-indigo-600">{score * 10}</p>
           </div>
        </div>
        <button onClick={() => setQuizStarted(false)} className="w-full mt-10 py-6 bg-slate-900 text-white rounded-3xl font-black uppercase tracking-widest active:scale-95 transition-all">Return to Hub</button>
      </div>
    );
  }

  if (quizStarted && currentQ) {
    const progress = ((currentQuestionIndex + 1) / quizQuestions.length) * 100;
    const timerColor = timeLeft > 30 ? 'text-emerald-500 border-emerald-500' : timeLeft > 10 ? 'text-amber-500 border-amber-500' : 'text-red-500 border-red-500';

    return (
      <div className="fixed inset-0 z-50 bg-slate-900 text-white flex flex-col overflow-hidden">
        <div className="h-1.5 w-full bg-white/5 relative">
           <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} className="h-full bg-medical-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]" />
        </div>

        <header className="p-4 sm:p-6 flex justify-between items-center bg-slate-900/80 backdrop-blur-md">
           <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-apex-600 rounded-xl flex items-center justify-center font-black text-xl">A</div>
              <div>
                 <span className="text-[10px] font-black uppercase tracking-widest text-medical-400 block leading-none">Question {currentQuestionIndex + 1} of {quizQuestions.length}</span>
                 <span className="font-bold text-xs truncate max-w-[150px] block mt-1">{selectedSubject || 'Clinical Challenge'}</span>
              </div>
           </div>

           <div className="flex items-center gap-2">
              {config.timerEnabled && (
                <div className={`px-4 py-2 rounded-2xl border-2 flex items-center gap-2 font-black text-sm ${timerColor}`}>
                   <Timer size={16} />
                   {formatTime(timeLeft)}
                </div>
              )}
              <button onClick={() => setVolumeOn(!volumeOn)} className="p-3 bg-white/5 hover:bg-white/10 rounded-2xl transition-all">
                 <Volume2 size={20} className={volumeOn ? 'text-white' : 'text-white/20'} />
              </button>
           </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 sm:p-8 space-y-8 flex flex-col items-center">
           <div className="w-full max-w-4xl space-y-8">
              <AnimatePresence>
                 {lifelineRecoveredMsg && (
                    <motion.div initial={{ opacity: 0, y: -50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="bg-emerald-500 text-white px-8 py-3 rounded-full font-black text-sm uppercase tracking-widest shadow-2xl mx-auto flex items-center gap-3">
                       <Sparkles size={20} /> {lifelineRecoveredMsg}
                    </motion.div>
                 )}
              </AnimatePresence>

              {currentQ.image && (
                 <div className="w-full h-48 sm:h-64 bg-slate-800 rounded-[2.5rem] overflow-hidden border border-white/10 relative shadow-2xl">
                    <img src={currentQ.image} alt="Clinical Scenario" className="w-full h-full object-cover" />
                 </div>
              )}

              <div className="text-center space-y-6">
                 {currentQ.type === 'imported' && (
                    <div className="inline-flex items-center px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/30">
                       <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse mr-2 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                       <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">✓ Verified: {currentQ.source || "Clinical Board"}</span>
                    </div>
                 )}
                 <h2 className="text-2xl sm:text-4xl font-black leading-tight tracking-tight px-4">{currentQ.question}</h2>

                 {hintActive && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl inline-block mx-auto">
                       <p className="text-sm font-bold text-amber-500 italic">Hint: {currentQ.hint || "Analyze the clinical priority."}</p>
                    </motion.div>
                 )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                 {(currentQ.options || []).map((option, idx) => {
                    const shapes = [<Triangle size={24} />, <Diamond size={24} />, <Circle size={24} />, <Square size={24} />];
                    const colors = ['bg-red-500 hover:bg-red-600', 'bg-blue-500 hover:bg-blue-600', 'bg-amber-500 hover:bg-amber-600', 'bg-emerald-500 hover:bg-emerald-600'];
                    const isAnswered = showRationale;
                    const isCorrectChoice = option === currentQ.answer || option === currentQ.correctAnswer;
                    const isSelected = selectedOption === option;
                    const isEliminated = eliminatedOptions.includes(option);

                    return (
                      <button key={idx} onClick={() => handleAnswer(option)} disabled={isAnswered || isEliminated}
                        className={`relative p-6 rounded-[2rem] text-left transition-all duration-300 flex items-center gap-6 group active:scale-95 shadow-xl ${
                          isAnswered
                            ? isCorrectChoice ? 'ring-4 ring-emerald-400 bg-emerald-500 z-10' : isSelected ? 'opacity-40 ring-4 ring-red-500' : 'opacity-20 grayscale'
                            : isEliminated ? 'opacity-10 grayscale cursor-not-allowed' : `${colors[idx]} hover:translate-y-[-4px]`
                        }`}
                      >
                         <div className="w-14 h-14 rounded-2xl bg-black/20 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">{shapes[idx % 4]}</div>
                         <span className="text-lg font-black leading-tight">{option}</span>
                         {isAnswered && isCorrectChoice && <div className="ml-auto bg-white/20 p-2 rounded-full"><CheckCircle2 size={24} /></div>}
                         {isAnswered && isSelected && !isCorrectChoice && <div className="ml-auto bg-white/20 p-2 rounded-full"><XCircle size={24} /></div>}
                      </button>
                    );
                 })}
              </div>
           </div>
        </main>

        <footer className="p-4 sm:p-8 bg-slate-800/50 backdrop-blur-xl border-t border-white/5">
           <AnimatePresence mode="wait">
              {showRationale ? (
                <motion.div key="rationale" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto space-y-6">
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-slate-900/50 p-6 rounded-[2rem] border border-white/10 space-y-4">
                         <div className="flex items-center gap-2">
                            <Target size={18} className="text-medical-400" />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Clinical Insight</span>
                         </div>
                         <p className="text-slate-300 italic font-medium leading-relaxed">{currentQ.clinicalInsight || currentQ.rationale || "Focus on physiological stability and safety."}</p>
                      </div>
                      <div className="space-y-4">
                         <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-4">
                            <Sparkles className="text-amber-500" size={24} />
                            <div>
                               <p className="text-[9px] font-black uppercase text-amber-500">Exam Tip</p>
                               <p className="text-xs font-bold text-amber-200">{currentQ.examTip || "Always prioritize the ABCs (Airway, Breathing, Circulation)."}</p>
                            </div>
                         </div>
                         <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-center gap-4">
                            <AlertCircle className="text-red-500" size={24} />
                            <div>
                               <p className="text-[9px] font-black uppercase text-red-500">Common Mistake</p>
                               <p className="text-xs font-bold text-red-200">{currentQ.commonMistake || "Avoid diagnostic steps when immediate intervention is needed."}</p>
                            </div>
                         </div>
                      </div>
                   </div>
                   <button onClick={nextQuestion} className="w-full py-6 bg-white text-slate-900 rounded-[2rem] font-black uppercase tracking-widest text-lg shadow-2xl active:scale-95 transition-all">Next Scenario</button>
                </motion.div>
              ) : (
                <div className="max-w-4xl mx-auto flex justify-around items-center gap-4">
                   <LifelineButton icon={<HelpCircle size={24} />} label="Hint" count={lifelines.hint} onClick={useHint} />
                   <LifelineButton icon={<Shield size={24} />} label="50/50" count={lifelines.fifty_fifty} onClick={use5050} />
                   <LifelineButton icon={<Users size={24} />} label="Class" count={lifelines.askClass} onClick={() => {}} />
                   <LifelineButton icon={<Brain size={24} />} label="Mentor" count={lifelines.mentor} onClick={useMentor} />
                </div>
              )}
           </AnimatePresence>
        </footer>
      </div>
    );
  }

  // --- MENU ---
  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="text-center mb-16">
         <div className="inline-flex p-4 bg-medical-50 dark:bg-medical-900/20 rounded-[2rem] text-medical-600 mb-6"><Brain size={40} /></div>
         <h2 className="text-4xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tighter uppercase italic leading-none">Clinical Quiz Hub</h2>
         <p className="text-slate-500 mt-4 font-medium text-lg">Choose your training methodology.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <ModeCard title="Clinical Challenge" description="NMCN-style exam simulation with score tracking." icon={<Award size={32} />} onClick={() => openConfig('clinical')} />
        <ModeCard title="Quick Quiz" description="Fast revision (10 random questions) with immediate rationale." icon={<Zap size={32} />} onClick={() => openConfig('quick')} />
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

const LifelineButton = ({ icon, label, count, onClick }) => (
  <button onClick={onClick} disabled={count === 0} className={`flex flex-col items-center gap-1 transition-all ${count === 0 ? 'opacity-20 grayscale cursor-not-allowed' : 'hover:scale-110 active:scale-90'}`}>
     <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-white border border-white/10">{icon}</div>
     <span className="text-[8px] font-black uppercase tracking-widest text-slate-400">{label}</span>
  </button>
);

export default Quiz;
