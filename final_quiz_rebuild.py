import re

file_path = 'src/pages/Quiz.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# Define the new constants
new_constants = """const QUIZ_STATES = {
  SELECTION: 'SELECTION',
  RESUME_PROMPT: 'RESUME_PROMPT',
  LOADING: 'LOADING',
  ANSWERING: 'ANSWERING',
  CONFIRMING: 'CONFIRMING',
  REVIEWING: 'REVIEWING',
  RESULTS: 'RESULTS'
};

const getSpeedTimerValue = (index) => {
  if (index < 5) return 30;
  if (index < 10) return 20;
  if (index < 20) return 15;
  return 10;
};"""

# Replace existing constants
content = re.sub(r'const MILESTONES = \[.*?\];', '', content, flags=re.DOTALL)
content = re.sub(r'const getSpeedTimerValue = .*?};', new_constants, content, flags=re.DOTALL)

# Rebuild the whole component
quiz_component = """const Quiz = () => {
  const navigate = useNavigate();
  const { flashcards, studyStats, updateQuizStats, setIsQuizActive } = useAppContext();

  // 1. Core State Machine
  const [quizStatus, setQuizStatus] = useState(QUIZ_STATES.SELECTION);
  const [quizMode, setQuizMode] = useState(null);

  // 2. Data State
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [sessionXP, setSessionXP] = useState(0);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);

  // 3. Interaction State
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [currentMilestone, setCurrentMilestone] = useState("Clinical Beginner");
  const [hintLevel, setHintLevel] = useState(0);

  // 4. UI Helpers
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [exitPrompt, setExitPrompt] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [mentorAdvice, setMentorAdvice] = useState(null);
  const [restoredThisTurn, setRestoredThisTurn] = useState(false);
  const [questionLimit, setQuestionLimit] = useState(10);
  const [useTimer, setUseTimer] = useState(true);
  const [isLowPowerMode, setIsLowPowerMode] = useState(false);
  const [pendingSession, setPendingSession] = useState(null);

  // Performance Detection
  useEffect(() => {
    if (navigator.deviceMemory && navigator.deviceMemory <= 4) setIsLowPowerMode(true);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) setIsLowPowerMode(true);
  }, []);

  // Session Persistence Logic
  useEffect(() => {
    const saved = localStorage.getItem('APEX_QUIZ_SESSION');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.questions?.length > 0) {
          setPendingSession(parsed);
          setQuizStatus(QUIZ_STATES.RESUME_PROMPT);
        }
      } catch (e) {
        localStorage.removeItem('APEX_QUIZ_SESSION');
      }
    }
  }, []);

  useEffect(() => {
    if (quizStatus !== QUIZ_STATES.SELECTION && quizStatus !== QUIZ_STATES.RESULTS && quizStatus !== QUIZ_STATES.RESUME_PROMPT) {
      const session = {
        quizMode,
        questions: quizQuestions,
        currentIndex: currentQuestionIndex,
        score,
        sessionXP,
        consecutiveCorrect,
        lifelinesUsed,
        currentMilestone,
        timeLeft,
        useTimer,
        questionLimit
      };
      localStorage.setItem('APEX_QUIZ_SESSION', JSON.stringify(session));
    } else if (quizStatus === QUIZ_STATES.RESULTS) {
      localStorage.removeItem('APEX_QUIZ_SESSION');
    }
  }, [quizStatus, currentQuestionIndex, score, sessionXP, consecutiveCorrect, lifelinesUsed]);

  // Timer Logic
  useEffect(() => {
    let timer;
    if (quizStatus === QUIZ_STATES.ANSWERING && (quizMode === 'speed' || useTimer)) {
      timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            handleConfirmAnswer(null); // Time out
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [quizStatus, quizMode, useTimer, currentQuestionIndex]);

  const handleResumeSession = () => {
    if (!pendingSession) return;
    setQuizMode(pendingSession.quizMode);
    setQuizQuestions(pendingSession.questions);
    setCurrentQuestionIndex(pendingSession.currentIndex);
    setScore(pendingSession.score);
    setSessionXP(pendingSession.sessionXP);
    setConsecutiveCorrect(pendingSession.consecutiveCorrect);
    setLifelinesUsed(pendingSession.lifelinesUsed);
    setCurrentMilestone(pendingSession.currentMilestone);
    setTimeLeft(pendingSession.timeLeft);
    setUseTimer(pendingSession.useTimer);
    setQuestionLimit(pendingSession.questionLimit);
    setQuizStatus(QUIZ_STATES.ANSWERING);
    setIsQuizActive(true);
    setPendingSession(null);
  };

  const handleStartFresh = () => {
    localStorage.removeItem('APEX_QUIZ_SESSION');
    setPendingSession(null);
    setQuizStatus(QUIZ_STATES.SELECTION);
  };

  const initQuiz = (mode, subjectFilter = null) => {
    let pool = [...flashcards];
    if (subjectFilter) pool = pool.filter(c => c.subject === subjectFilter);

    if (pool.length === 0) {
      setQuizStatus(QUIZ_STATES.SELECTION);
      return;
    }

    // Question Sourcing
    const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
    const nmcn = pool.filter(c => !c.source?.toLowerCase().includes('richard'));

    let combined = [];
    const limit = (mode === 'speed' || mode === 'quick') ? 10 : (mode === 'subject' ? Math.min(pool.length, questionLimit) : questionLimit);

    if (mode === 'speed') {
      const shuffledRichard = [...richard].sort(() => 0.5 - Math.random());
      const shuffledNmcn = [...nmcn].sort(() => 0.5 - Math.random());
      const rCount = Math.min(Math.ceil(limit * 0.7), shuffledRichard.length);
      combined = [...shuffledRichard.slice(0, rCount), ...shuffledNmcn.slice(0, Math.max(0, limit - rCount))];
    } else {
      combined = [...pool].sort(() => 0.5 - Math.random()).slice(0, limit);
    }

    const questions = combined.map(q => {
      const n = normalizeQuestion(q);
      return { ...n, options: [...n.options].sort(() => 0.5 - Math.random()) };
    });

    setQuizQuestions(questions);
    setQuizMode(mode);
    setCurrentQuestionIndex(0);
    setScore(0);
    setSessionXP(0);
    setConsecutiveCorrect(0);
    setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
    setCurrentMilestone("Clinical Beginner");
    setTimeLeft(mode === 'speed' ? getSpeedTimerValue(0) : 30);
    setQuizStatus(QUIZ_STATES.ANSWERING);
    setIsQuizActive(true);
  };

  const handleOptionSelect = (option) => {
    if (quizStatus !== QUIZ_STATES.ANSWERING) return;
    setSelectedOption(option);
    setQuizStatus(QUIZ_STATES.CONFIRMING);
  };

  const handleConfirmAnswer = (opt = selectedOption) => {
    const currentQ = quizQuestions[currentQuestionIndex];
    const correct = opt === currentQ?.correctAnswer;
    setIsCorrect(correct);

    if (correct) {
      setScore(s => s + 1);
      const newCombo = consecutiveCorrect + 1;
      setConsecutiveCorrect(newCombo);

      const ach = ACHIEVEMENTS.slice().reverse().find(a => (score + 1) >= a.q);
      if (ach) setCurrentMilestone(ach.label);

      const multiplier = newCombo >= 10 ? 5 : (newCombo >= 5 ? 3 : (newCombo >= 3 ? 2 : 1));
      setSessionXP(p => p + (10 * multiplier));

      if (newCombo % 5 === 0) {
        setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });
        setRestoredThisTurn(true);
      }
    } else {
      setConsecutiveCorrect(0);
    }

    setQuizStatus(QUIZ_STATES.REVIEWING);
  };

  const handleNextQuestion = () => {
    setRestoredThisTurn(false);
    if (!isCorrect && quizMode === 'speed') {
      setQuizStatus(QUIZ_STATES.RESULTS);
      setIsQuizActive(false);
      return;
    }

    if (currentQuestionIndex < quizQuestions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      setSelectedOption(null);
      setIsCorrect(null);
      setEliminatedOptions([]);
      setClassPoll(null);
      setHintLevel(0);
      setTimeLeft(quizMode === 'speed' ? getSpeedTimerValue(nextIdx) : 30);
      setQuizStatus(QUIZ_STATES.ANSWERING);
    } else {
      setQuizStatus(QUIZ_STATES.RESULTS);
      setIsQuizActive(false);
    }
  };

  const handleEliminateTwo = () => {
    if (lifelinesUsed.fiftyFifty || quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrect = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    const toRemove = incorrect.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toRemove);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const handleAskClass = () => {
    if (lifelinesUsed.askClass || quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const results = {};
    const visible = currentQ.options.filter(o => !eliminatedOptions.includes(o));
    const correctShare = Math.floor(Math.random() * 30 + 60);
    results[currentQ.correctAnswer] = correctShare;
    let remaining = 100 - correctShare;
    const others = visible.filter(o => o !== currentQ.correctAnswer);
    others.forEach((opt, i) => {
       if (i === others.length - 1) results[opt] = remaining;
       else { const s = Math.floor(Math.random() * (remaining / 1.5)); results[opt] = s; remaining -= s; }
    });
    currentQ.options.forEach(o => { if(!(o in results)) results[o] = 0; });
    setClassPoll(results);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  const handleUseHint = () => {
    if (quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const h = currentQ.hints[hintLevel] || currentQ.simplification;
    setMentorAdvice({ type: 'Progressive Hint', text: h });
    setShowHint(true);
    setHintLevel(prev => prev + 1);
    setLifelinesUsed(prev => ({ ...prev, hint: true }));
  };

  const handleUseMentor = () => {
    if (lifelinesUsed.mentor || quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const text = `Nurse Mentor: Based on clinical priorities (ABC), "${currentQ.correctAnswerText}" is the most stable intervention because ${currentQ.simplification.toLowerCase()}.`;
    setMentorAdvice({ type: 'Clinical Mentor', text, confidence: 98 });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, mentor: true }));
  };

  const handleWalkAway = () => {
    setExitPrompt(EXIT_PROMPTS[Math.floor(Math.random() * EXIT_PROMPTS.length)]);
    setShowExitConfirm(true);
  };

  const currentQ = quizQuestions[currentQuestionIndex];

  if (quizStatus === QUIZ_STATES.SELECTION) {
    return (
      <div className="max-w-4xl mx-auto mt-8 px-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header className="text-center mb-12">
          <div className={`w-20 h-20 bg-slate-900 rounded-[2rem] flex items-center justify-center text-medical-400 mx-auto mb-6 ${isLowPowerMode ? "" : "shadow-2xl"} border-2 border-medical-500/20`}><Brain size={40} className="animate-pulse" /></div>
          <h2 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tighter mb-2 uppercase">Clinical Training Hub</h2>
          <p className="text-slate-500 font-medium tracking-tight">Select your specialization protocol</p>
        </header>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ModeCard title="Clinical Challenge" desc="Full exam simulation." icon={<Shield size={24} />} duration="10-20 min" timer="Optional" color="medical" onClick={() => setQuizMode('clinical-select')} />
          <ModeCard title="Speed Challenge" desc="Kahoot-style rapid fire." icon={<Zap size={24} />} duration="5-15 min" timer="Progressive" color="amber" onClick={() => initQuiz('speed')} />
          <ModeCard title="Quick Quiz" desc="5-10 rapid questions." icon={<Clock size={24} />} duration="2-5 min" timer="Optional" color="indigo" onClick={() => setQuizMode('quick-select')} />
          <ModeCard title="Subject Mastery" desc="Master one course." icon={<Target size={24} />} duration="Custom" timer="Optional" color="emerald" onClick={() => setQuizMode('subject-select')} />
        </div>

        {quizMode && quizMode.endsWith('-select') && (
           <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl animate-in fade-in duration-300">
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-800 p-8 rounded-[3rem] shadow-2xl max-w-lg w-full">
                 <button onClick={() => setQuizMode(null)} className="flex items-center gap-2 text-slate-500 font-black uppercase tracking-widest text-[10px] mb-6 hover:text-medical-600"><ChevronLeft size={16} /> Back</button>
                 <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-6 uppercase tracking-tight">{quizMode.split('-')[0]} Protocol</h3>
                 <div className="space-y-6">
                    <div className="space-y-3">
                       <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Protocol Depth</p>
                       <div className="flex gap-3">
                          {[10, 20, 50].map(n => (<button key={n} onClick={() => setQuestionLimit(n)} className={`flex-1 py-4 rounded-2xl font-black transition-all ${questionLimit === n ? 'bg-medical-600 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}>{n}</button>))}
                       </div>
                    </div>
                    <div className="space-y-3">
                       <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Time Constraints</p>
                       <button onClick={() => setUseTimer(!useTimer)} className={`w-full py-4 rounded-2xl font-black transition-all flex items-center justify-center gap-2 ${useTimer ? 'bg-red-500 text-white shadow-lg' : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200'}`}><Timer size={16} /> {useTimer ? '30s / Item' : 'Disabled'}</button>
                    </div>
                    {quizMode === 'subject-select' ? (
                       <div className="max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                          <div className="grid grid-cols-1 gap-2">
                             {subjects.map(sub => (<button key={sub.name} onClick={() => initQuiz('subject', sub.name)} className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-emerald-500 transition-all text-left flex justify-between items-center"><p className="font-bold text-slate-900 dark:text-white truncate">{sub.name}</p><span className="text-[10px] font-black text-slate-400 bg-white dark:bg-slate-800 px-2 py-1 rounded-lg">{sub.count}</span></button>))}
                          </div>
                       </div>
                    ) : (
                       <button onClick={() => initQuiz(quizMode.split('-')[0])} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-xl uppercase tracking-widest shadow-2xl active:scale-95 transition-all hover:bg-slate-800 mt-4">Activate Protocol</button>
                    )}
                 </div>
              </motion.div>
           </div>
        )}
      </div>
    );
  }

  if (quizStatus === QUIZ_STATES.RESUME_PROMPT) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-xl">
         <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#1B2343] p-10 rounded-[3.5rem] shadow-2xl max-w-md w-full text-center border border-white/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><History size={160} /></div>
            <div className="w-20 h-20 bg-indigo-500/10 text-indigo-400 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-inner"><RefreshCw size={40} className="animate-spin-slow" /></div>
            <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-4">Resume Session?</h2>
            <div className="bg-white/5 rounded-3xl p-6 mb-8 text-left space-y-3 border border-white/5">
               <div className="flex justify-between items-center"><span className="text-xs text-white/40 uppercase font-black tracking-widest">Protocol</span><span className="text-sm text-indigo-400 font-bold uppercase">{pendingSession?.quizMode}</span></div>
               <div className="flex justify-between items-center"><span className="text-xs text-white/40 uppercase font-black tracking-widest">Progress</span><span className="text-sm text-white font-bold">{pendingSession?.currentIndex + 1} / {pendingSession?.questions?.length}</span></div>
               <div className="flex justify-between items-center"><span className="text-xs text-white/40 uppercase font-black tracking-widest">Score</span><span className="text-sm text-emerald-400 font-bold">{pendingSession?.score}</span></div>
            </div>
            <div className="flex flex-col gap-3">
               <button onClick={handleResumeSession} className="w-full py-5 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-xs shadow-lg shadow-[#FF7A00]/20 active:scale-95 transition-all">Resume Session</button>
               <button onClick={handleStartFresh} className="w-full py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[10px] hover:text-white transition-colors">Start Fresh</button>
            </div>
         </motion.div>
      </div>
    );
  }

  if (quizStatus === QUIZ_STATES.RESULTS) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32 px-4 text-slate-900 dark:text-white">
        <div className="relative inline-block"><div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" /><div className={`relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 ${isLowPowerMode ? "" : "shadow-2xl"}`}><Trophy size={64} /></div></div>
        <h2 className="text-4xl font-black tracking-tighter uppercase">Validation Complete</h2>
        <p className="text-slate-500 dark:text-slate-400 text-xl font-medium tracking-widest uppercase">Rank: <span className="text-medical-600 font-black">{currentMilestone}</span></p>
        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">Score</p><p className="text-3xl font-black">{score} / {quizQuestions.length}</p></div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-800 shadow-clinical text-center"><p className="text-[10px] font-black text-slate-400 mb-1 uppercase">XP Earned</p><p className="text-3xl font-black text-medical-600">+{sessionXP}</p></div>
        </div>
        <div className="flex flex-col gap-4 max-w-sm mx-auto"><button onClick={() => { setQuizStatus(QUIZ_STATES.SELECTION); setQuizMode(null); setIsQuizActive(false); }} className={`w-full py-6 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-[2rem] font-black text-lg ${isLowPowerMode ? "" : "shadow-2xl"} active:scale-95 transition-all uppercase`}>New Protocol</button><button onClick={() => navigate('/dashboard')} className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 rounded-[2rem] font-black border border-slate-100 dark:border-slate-800 hover:bg-slate-50 transition-all uppercase">Dashboard</button></div>
      </div>
    );
  }

  if (!currentQ) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
         <div className="w-16 h-16 border-4 border-medical-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const isSpeed = quizMode === 'speed';

  return (
    <div className={`fixed inset-0 z-[60] bg-[#0F172A] flex flex-col text-white overflow-hidden`}>
      {/* 1. HEADER SECTION */}
      <div className={`h-[15vh] bg-indigo-600 w-full relative transition-colors duration-500 shadow-2xl`}>
         <div className="p-4 pt-8 flex items-center justify-between gap-3 max-w-3xl mx-auto">
            <div className="bg-black/60 backdrop-blur-md rounded-2xl px-4 py-2 flex items-center gap-2 border border-white/5 shadow-xl">
               <Users size={16} className="text-white opacity-80" />
               <span className="text-white font-black text-sm tracking-tighter">{currentQuestionIndex + 1} of {quizQuestions.length}</span>
            </div>
            <div className="flex-1 h-2.5 bg-black/20 rounded-full overflow-hidden relative mx-2 shadow-inner">
               <motion.div className="h-full bg-gradient-to-r from-orange-400 to-orange-600 rounded-full shadow-[0_0_10px_rgba(251,146,60,0.4)]" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
            </div>
            <div className="bg-orange-500 rounded-2xl px-4 py-2 flex items-center gap-2 shadow-lg shadow-orange-600/30 border border-white/10">
               <CheckCircle2 size={16} className="text-white fill-white" />
               <span className="text-white font-black text-sm tracking-tighter">{score}</span>
            </div>
         </div>
         <div className="absolute bottom-3 left-0 right-0 px-6 flex justify-between items-center max-w-3xl mx-auto opacity-70">
            <button onClick={handleWalkAway} className="flex items-center gap-1.5 text-white/60 hover:text-white transition-colors group">
               <X size={16} className="group-hover:rotate-90 transition-transform" />
               <span className="text-[10px] font-black uppercase tracking-widest">Exit protocol</span>
            </button>
            {isSpeed && <span className="text-[10px] font-black uppercase tracking-widest text-white bg-white/10 px-3 py-1 rounded-full">{currentMilestone}</span>}
         </div>
      </div>

      {/* 2. MAIN INTERACTION AREA */}
      <div className="flex-1 flex flex-col px-4 -mt-10 z-10 max-w-3xl mx-auto w-full overflow-y-auto no-scrollbar pb-32">
         <div className="relative flex justify-center mb-4">
            <div className={`relative w-[88px] h-[88px] bg-[#1B2343] rounded-full flex items-center justify-center border-[8px] border-[#0F172A] ${isLowPowerMode ? "" : "shadow-2xl"} z-20`}>
               <svg className="absolute inset-0 w-full h-full -rotate-90 p-1">
                  <circle cx="36" cy="36" r="32" stroke="currentColor" strokeWidth="6" fill="transparent" className={timeLeft < 5 ? 'text-red-500' : 'text-[#FF7A00]'} style={{ strokeDasharray: 201, strokeDashoffset: 201 - (201 * timeLeft) / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30), transition: timeLeft === 30 ? 'none' : 'stroke-dashoffset 1s linear' }} />
               </svg>
               <span className={`text-3xl font-black tabular-nums ${timeLeft < 5 ? "text-red-500 animate-pulse" : "text-white"}`}>{timeLeft}</span>
            </div>
         </div>

         <motion.div key={currentQuestionIndex} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`bg-[#1B2343] rounded-[2.5rem] p-8 sm:p-10 border border-white/10 ${isLowPowerMode ? "" : "shadow-2xl"} text-center mb-6 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={160} /></div>
            <div className="flex flex-col sm:flex-row justify-between items-center gap-6 mb-8">
               <SourceBadge source={currentQ.source} />
               <div className="flex items-center gap-2">
                  <button disabled={lifelinesUsed.hint} onClick={handleUseHint} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.hint ? "opacity-20 grayscale" : "active:scale-95"}`} title="Hint"><Zap size={16} className="text-orange-400" /></button>
                  <button disabled={lifelinesUsed.fiftyFifty} onClick={handleEliminateTwo} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.fiftyFifty ? "opacity-20 grayscale" : "active:scale-95"}`} title="50/50"><Shuffle size={16} /></button>
                  <button disabled={lifelinesUsed.askClass} onClick={handleAskClass} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.askClass ? "opacity-20 grayscale" : "active:scale-95"}`} title="Poll"><Users size={16} /></button>
                  <button disabled={lifelinesUsed.mentor} onClick={handleUseMentor} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.mentor ? "opacity-20 grayscale" : "active:scale-95"}`} title="Mentor"><Shield size={16} className="text-blue-400" /></button>
               </div>
            </div>
            <div>
               <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em]">Item {String(currentQuestionIndex + 1).padStart(2, '0')}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-indigo-500/40"></div>
                  <span className="text-[10px] font-black text-indigo-400/80 uppercase tracking-widest truncate max-w-[150px]">{currentQ.subject}</span>
               </div>
               <h3 className="text-xl sm:text-2xl font-bold leading-tight text-white tracking-tight text-balance">"{currentQ.question}"</h3>
            </div>
         </motion.div>

         <div className="space-y-4">
            {currentQ.options.map((option, idx) => {
               const isEliminated = eliminatedOptions.includes(option);
               const isSelected = selectedOption === option;
               const isReview = quizStatus === QUIZ_STATES.REVIEWING;
               let state = 'normal';
               if (isSelected) state = 'selected';
               if (isReview) {
                  if (option === currentQ.correctAnswer) state = 'correct';
                  else if (isSelected) state = 'wrong';
               }
               if (isEliminated) return null;
               return (
                  <motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} layout transition={{ duration: 0.3 }}>
                     <OptionButton label={option} index={idx} state={state} onClick={() => handleOptionSelect(option)} disabled={isReview || quizStatus === QUIZ_STATES.CONFIRMING} pollValue={classPoll ? classPoll[option] : undefined} isLowPowerMode={isLowPowerMode} />
                  </motion.div>
               );
            })}
         </div>

         <AnimatePresence>
            {quizStatus === QUIZ_STATES.REVIEWING && (
               <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-8 space-y-6 pb-20">
                  <div className={`p-6 ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-orange-500/10 border-orange-500/20'} rounded-[2.5rem] border flex items-center gap-4 shadow-lg`}>
                     <div className={`w-12 h-12 ${isCorrect ? 'bg-emerald-500' : 'bg-orange-500'} text-white rounded-full flex items-center justify-center shrink-0 shadow-lg`}>{isCorrect ? <CheckCircle2 size={24}/> : <XCircle size={24} />}</div>
                     <div><p className={`text-[10px] font-black uppercase ${isCorrect ? 'text-emerald-400' : 'text-orange-400'} tracking-widest`}>{isCorrect ? 'Verification Success' : 'Critical Correction Required'}</p><p className="font-black text-white text-lg leading-tight">{currentQ.correctAnswerText}</p></div>
                  </div>
                  <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 space-y-6">
                     <div><p className="text-[10px] font-black uppercase text-indigo-400 mb-2 tracking-widest flex items-center gap-2"><Info size={12} /> Clinical Rationale</p><p className="font-medium text-sm leading-relaxed text-slate-300 italic">"{currentQ.rationale}"</p></div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-5 bg-blue-500/5 rounded-2xl border border-blue-500/10"><p className="text-[10px] font-black uppercase text-blue-400 mb-2 tracking-widest">🏥 Clinical Application</p><p className="text-xs font-bold text-slate-200">{currentQ.clinical_application}</p></div>
                        <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/10"><p className="text-[10px] font-black uppercase text-amber-500 mb-2 tracking-widest">💡 Simplification</p><p className="text-xs font-medium text-amber-200/80 leading-relaxed">{currentQ.simplification}</p></div>
                     </div>
                  </div>
               </motion.div>
            )}
         </AnimatePresence>
      </div>

      <AnimatePresence>
         {quizStatus === QUIZ_STATES.CONFIRMING && (
            <div className={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-950/90 ${isLowPowerMode ? "" : "backdrop-blur-md"}`}>
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className={`bg-[#1B2343] p-10 rounded-[3.5rem] ${isLowPowerMode ? "" : "shadow-2xl"} border border-white/10 flex flex-col items-center gap-6 max-w-md w-full text-center relative overflow-hidden`}>
                  <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><HelpCircle size={160} /></div>
                  <div className="w-20 h-20 bg-orange-500/10 text-orange-500 rounded-[2rem] flex items-center justify-center shadow-inner relative z-10"><HelpCircle size={40}/></div>
                  <div className="relative z-10"><h4 className="text-2xl font-black text-white uppercase tracking-tighter">Final Selection?</h4><p className="text-sm text-slate-400 font-medium tracking-tight mt-2 italic px-4">"Are you locked in your clinical decision for this case?"</p></div>
                  <div className="flex gap-4 w-full relative z-10 pt-4">
                     <button onClick={() => { setSelectedOption(null); setQuizStatus(QUIZ_STATES.ANSWERING); }} className="flex-1 py-5 bg-white/5 text-white/60 rounded-2xl font-black uppercase text-[10px] hover:bg-white/10 transition-colors">Change</button>
                     <button onClick={() => handleConfirmAnswer()} className="flex-1 py-5 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-orange-500/30 active:scale-95 transition-all">Confirm</button>
                  </div>
               </motion.div>
            </div>
         )}
      </AnimatePresence>

      <AnimatePresence>
         {quizStatus === QUIZ_STATES.REVIEWING && (
            <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#0F172A] to-transparent z-[80]">
               <button onClick={handleNextQuestion} className={`w-full max-w-3xl mx-auto py-6 bg-[#FF7A00] text-white rounded-[2.5rem] font-black text-xl uppercase tracking-widest ${isLowPowerMode ? "" : "shadow-2xl"} active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-orange-600 group`}>
                  {currentQuestionIndex === quizQuestions.length - 1 ? 'Finish Challenge' : 'Next Protocol'} <ArrowRight size={24} className="group-hover:translate-x-2 transition-transform" />
               </button>
            </motion.div>
         )}
      </AnimatePresence>

      <AnimatePresence>
        {showHint && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.8, opacity: 0 }} className={`relative w-full max-w-md bg-[#1B2343] p-10 rounded-[3.5rem] ${isLowPowerMode ? "" : "shadow-2xl"} border border-white/10 text-center`}>
                <div className={`w-20 h-20 ${mentorAdvice?.type?.includes('Mentor') ? 'bg-blue-500/10 text-blue-400' : 'bg-orange-500/10 text-orange-400'} rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner`}>{mentorAdvice?.type?.includes('Mentor') ? <Shield size={40} /> : <Zap size={40} />}</div>
                <h4 className="text-2xl font-black text-white mb-1 uppercase tracking-tighter">{mentorAdvice?.type}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase mb-6 tracking-[0.2em]">Confidence Level: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-300 font-medium italic text-lg leading-relaxed mb-10 px-4">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px] hover:bg-white/20 transition-all border border-white/5">Return to Case</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExitConfirm && (
          <div className={`fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/90 ${isLowPowerMode ? "" : "backdrop-blur-xl"}`}>
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`bg-[#1B2343] p-10 rounded-[3.5rem] ${isLowPowerMode ? "" : "shadow-2xl"} max-w-md w-full text-center border border-white/10 relative overflow-hidden`}>
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><AlertCircle size={160} /></div>
                <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner relative z-10"><AlertCircle size={40} /></div>
                <div className="relative z-10"><h4 className="text-2xl font-black text-white mb-2 uppercase tracking-tighter">Terminate Protocol?</h4><p className="text-slate-400 font-medium italic mb-6 leading-relaxed text-balance px-4 italic">"{exitPrompt}"</p></div>
                <div className="bg-white/5 rounded-3xl p-6 mb-8 text-left space-y-2 border border-white/5 relative z-10">
                   <div className="flex justify-between items-center"><span className="text-[10px] text-white/40 uppercase font-black tracking-widest">Progress</span><span className="text-xs text-white font-bold">{currentQuestionIndex + 1} / {quizQuestions.length} Items</span></div>
                   <div className="flex justify-between items-center"><span className="text-[10px] text-white/40 uppercase font-black tracking-widest">Accuracy</span><span className="text-xs text-emerald-400 font-bold">{Math.round((score / (currentQuestionIndex || 1)) * 100)}% Verified</span></div>
                </div>
                <div className="flex flex-col gap-3 relative z-10">
                   <button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black uppercase text-xs shadow-lg active:scale-95 transition-all">Stay and Continue</button>
                   <button onClick={() => { setQuizStatus(QUIZ_STATES.SELECTION); setIsQuizActive(false); setShowExitConfirm(false); localStorage.removeItem('APEX_QUIZ_SESSION'); }} className="w-full py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[10px] hover:text-red-500 transition-colors">End Session</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};"""

# Build the final file content
final_header = content[:content.find('const Quiz = () => {')]
final_footer = content[content.find('const ModeCard ='):]

with open(file_path, 'w') as f:
    f.write(final_header + quiz_component + "\n\n" + final_footer)
