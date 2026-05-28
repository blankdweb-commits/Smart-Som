import React, { useState, useMemo, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { Brain, CheckCircle2, XCircle, RefreshCw, ChevronRight, Trophy, AlertCircle, Lock, Star, Users, Share2, ArrowRight, Clock, Award, Shield, Target } from '../components/Icons';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const MILESTONES = [
  "Clinical Beginner",
  "Ward Ready",
  "Exam Survivor",
  "Clinical Strategist",
  "Apex Scholar"
];

const Quiz = () => {
  const { flashcards, userProfile, studyStats, updateQuizStats } = useAppContext();
  const navigate = useNavigate();
  const [quizStarted, setQuizStarted] = useState(false);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);

  // Milestone logic
  const currentMilestone = MILESTONES[Math.min(Math.floor(score / 3), MILESTONES.length - 1)];

  // Generate a quiz from existing flashcards
  const startQuiz = () => {
    if (flashcards.length < 4) return;

    // Shuffle and pick 10 random cards (or all if less than 10)
    const shuffled = [...flashcards].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 10);

    const questions = selected.map(card => {
      // Create distractors from other cards' answers
      const distractors = flashcards
        .filter(c => c.id !== card.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(c => c.answer);

      const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());

      return {
        ...card,
        options,
        correctAnswer: card.answer
      };
    });

    setQuizQuestions(questions);
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
    setAttempts(0);
    setShowHint(false);
    setShowRationale(false);
    setIsCorrect(null);
    setEliminatedOptions([]);
  };

  const handleOptionClick = (option) => {
    if (selectedOption !== null && isCorrect) return;
    if (eliminatedOptions.includes(option)) return;
    setSelectedOption(option);
    setIsConfirming(true);
  };

  const confirmAnswer = () => {
    const currentQ = quizQuestions[currentQuestionIndex];
    const correct = selectedOption === currentQ.correctAnswer;
    setIsCorrect(correct);
    setIsConfirming(false);

    if (correct) {
      if (attempts === 0) setScore(score + 1);
      setShowRationale(true);
      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      if (newAttempts >= 2) {
        setShowRationale(true);
        updateQuizStats({ quizStreak: 0 });
      }
    }
  };

  const eliminateTwo = () => {
    if (attempts > 0 || lifelinesUsed.fiftyFifty) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrectOptions = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    const toEliminate = incorrectOptions.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const askClass = () => {
    if (lifelinesUsed.askClass) return;
    const currentQ = quizQuestions[currentQuestionIndex];

    // Advanced Simulation Algorithm
    // Simulates a realistic student population poll
    const isHardQuestion = currentQ.question.length > 100; // Proxy for complexity
    const accuracyBase = isHardQuestion ? 0.45 : 0.75;
    const isAudienceCorrect = Math.random() < accuracyBase;

    const results = {};
    let remainingPercentage = 100;
    const options = [...currentQ.options];

    if (isAudienceCorrect) {
      // Crowd identifies the correct answer
      const winnerShare = Math.floor(Math.random() * (82 - 55) + 55);
      results[currentQ.correctAnswer] = winnerShare;
      remainingPercentage -= winnerShare;
    } else {
      // Crowd is split or wrong (common in hard nursing questions)
      const wrongOptions = options.filter(o => o !== currentQ.correctAnswer);
      const deceptiveOption = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
      const winnerShare = Math.floor(Math.random() * (52 - 38) + 38);
      results[deceptiveOption] = winnerShare;
      remainingPercentage -= winnerShare;
    }

    // Distribute remaining percentages among other options
    const remainingOptions = options.filter(o => !results[o]);
    remainingOptions.forEach((opt, idx) => {
      if (idx === remainingOptions.length - 1) {
        results[opt] = remainingPercentage;
      } else {
        const share = Math.floor(Math.random() * (remainingPercentage / 1.5));
        results[opt] = share;
        remainingPercentage -= share;
      }
    });

    setClassPoll(results);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  const [showShareModal, setShowShareModal] = useState(false);

  const shareQuestion = (platform) => {
    const currentQ = quizQuestions[currentQuestionIndex];
    const baseUrl = window.location.origin;
    const text = `🚨 CLINICAL CHALLENGE\n\nNurse, I need your brain! 🧠\n\nQ: ${currentQ.question}\n\nCan you solve this? Check it out on Apex Scholars:\n${baseUrl}`;

    let url = '';
    if (platform === 'whatsapp') {
      url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    } else if (platform === 'telegram') {
      url = `https://t.me/share/url?url=${encodeURIComponent(baseUrl)}&text=${encodeURIComponent(text)}`;
    } else if (platform === 'copy') {
      navigator.clipboard.writeText(text);
      alert('Challenge copied to clipboard!');
      setShowShareModal(false);
      return;
    }

    if (url) window.open(url, '_blank');
    setShowShareModal(false);
  };

  const nextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOption(null);
      setAttempts(0);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setEliminatedOptions([]);
      setClassPoll(null);
    } else {
      setShowResults(true);
    }
  };

  const walkAway = () => {
    updateQuizStats({ milestone: currentMilestone });
    setShowResults(true);
  };

  if (!quizStarted) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="relative group">
          <div className="absolute inset-0 bg-medical-500/20 blur-3xl rounded-full scale-150 group-hover:scale-175 transition-transform duration-700" />
          <div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-medical-400 mx-auto border-2 border-medical-500/30 shadow-2xl">
            <Brain size={64} className="animate-pulse" />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">Clinical Challenge</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xl font-medium">
            Risk your streak to climb the nursing milestones. High-stakes, high-reward learning.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
           <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-clinical">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Current Streak</p>
              <p className="text-3xl font-black text-slate-900 dark:text-white">{studyStats.quizStreak || 0}</p>
           </div>
           <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 shadow-clinical">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Milestone</p>
              <p className="text-sm font-black text-medical-600 uppercase tracking-tight">{studyStats.milestone}</p>
           </div>
        </div>

        {flashcards.length < 4 ? (
          <div className="p-8 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30 rounded-[2rem] flex items-center gap-6 text-left">
            <div className="p-4 bg-white dark:bg-slate-800 rounded-2xl text-amber-500 shadow-sm"><AlertCircle size={32} /></div>
            <div>
              <p className="font-black text-amber-900 dark:text-amber-400 uppercase tracking-widest text-xs">Awaiting Data</p>
              <p className="text-sm text-amber-800 dark:text-amber-500/80 font-medium mt-1">Add at least 4 flashcards to your clinical vault to activate Challenge Mode.</p>
            </div>
          </div>
        ) : (
          <button
            onClick={startQuiz}
            className="w-full max-w-sm px-12 py-6 bg-slate-900 text-white rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 mx-auto hover:bg-slate-800 border-2 border-white/10 group"
          >
            Enter The Vault <ArrowRight className="group-hover:translate-x-2 transition-transform" />
          </button>
        )}
      </div>
    );
  }

  if (showResults) {
    return (
      <div className="max-w-2xl mx-auto mt-12 text-center space-y-10 animate-in zoom-in duration-700 pb-32">
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-amber-500/20 blur-3xl rounded-full scale-150" />
          <div className="relative w-32 h-32 bg-slate-900 rounded-[2.5rem] flex items-center justify-center text-amber-400 mx-auto border-2 border-amber-500/30 shadow-2xl">
            <Trophy size={64} />
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-5xl font-black text-slate-900 dark:text-white tracking-tighter">Challenge Results</h2>
          <p className="text-slate-500 dark:text-slate-400 text-xl font-medium">
            You've reached the milestone of <span className="text-medical-600 dark:text-medical-400 font-black">{currentMilestone}</span>
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Final Score</p>
            <p className="text-4xl font-black text-slate-900 dark:text-white">{score}</p>
          </div>
          <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">New Streak</p>
            <p className="text-4xl font-black text-medical-600">{studyStats.quizStreak || 0}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 max-w-sm mx-auto">
          <button
            onClick={startQuiz}
            className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black text-lg shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-slate-800 border-2 border-white/10 group"
          >
            <RefreshCw size={24} className="group-hover:rotate-180 transition-transform duration-500" />
            New Challenge
          </button>
          <button
            onClick={() => setQuizStarted(false)}
            className="w-full py-5 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-[2rem] font-black uppercase tracking-widest text-xs border border-slate-100 dark:border-slate-700 hover:bg-slate-50 transition-all"
          >
            Exit to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-32 relative">
      {/* Dynamic Header */}
      <div className="flex justify-between items-end px-2">
        <div className="space-y-2">
           <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-medical-500 animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-medical-600 dark:text-medical-400">{currentMilestone}</span>
           </div>
           <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Question {currentQuestionIndex + 1}</h3>
        </div>
        <div className="flex flex-col items-end">
           <div className="flex items-center gap-2 mb-1">
              <Star className="text-amber-500 fill-amber-500" size={14} />
              <span className="text-[10px] font-black uppercase text-slate-400">Streak</span>
           </div>
           <p className="text-3xl font-black text-slate-900 dark:text-white leading-none">{studyStats.quizStreak || 0}</p>
        </div>
      </div>

      {/* Lifelines Bar */}
      <div className="grid grid-cols-4 gap-3">
        <LifelineButton
          icon={<Clock />} label="Hint" used={showHint || lifelinesUsed.hint}
          onClick={() => { setShowHint(true); setLifelinesUsed(p => ({...p, hint: true})); }}
        />
        <LifelineButton
          icon={<Shield />} label="50/50" used={lifelinesUsed.fiftyFifty}
          onClick={eliminateTwo}
        />
        <LifelineButton
          icon={<Users />} label="Class" used={lifelinesUsed.askClass}
          onClick={askClass}
        />
        <LifelineButton
          icon={<Share2 />} label="Friend"
          onClick={() => setShowShareModal(true)}
        />
      </div>

      {/* Main Question Card */}
      <div className="relative">
        <div className="absolute inset-0 bg-slate-900 rounded-[3rem] blur-2xl opacity-10 dark:opacity-40" />
        <div className="relative bg-slate-900 dark:bg-slate-950 rounded-[3rem] p-8 sm:p-12 border border-white/10 shadow-2xl overflow-hidden min-h-[400px] flex flex-col justify-center">

           <AnimatePresence mode="wait">
             <motion.div
               key={currentQuestionIndex}
               initial={{ opacity: 0, scale: 0.9 }}
               animate={{ opacity: 1, scale: 1 }}
               exit={{ opacity: 0, scale: 1.1 }}
               className="space-y-12"
             >
                <div className="text-center space-y-4">
                   <p className="text-[10px] font-black uppercase tracking-[0.3em] text-medical-500/60">Subject: {currentQ.subject}</p>
                   <h2 className="text-2xl sm:text-4xl font-black text-white leading-tight tracking-tight px-4">
                     {currentQ.question}
                   </h2>
                </div>

                <div className="grid gap-3 sm:gap-4 relative">
                  {currentQ.options.map((option, idx) => {
                    const isEliminated = eliminatedOptions.includes(option);
                    let state = "idle"; // idle, selected, correct, wrong, eliminated

                    if (isEliminated) state = "eliminated";
                    else if (selectedOption === option) {
                      if (isCorrect === null) state = "selected";
                      else state = isCorrect ? "correct" : "wrong";
                    } else if (showRationale && option === currentQ.correctAnswer) {
                      state = "correct";
                    }

                    return (
                      <OptionButton
                        key={idx}
                        label={option}
                        index={idx}
                        state={state}
                        pollValue={classPoll?.[option]}
                        onClick={() => handleOptionClick(option)}
                        disabled={isCorrect !== null || isEliminated}
                      />
                    );
                  })}
                </div>
             </motion.div>
           </AnimatePresence>

           {/* Final Answer Modal */}
           <AnimatePresence>
             {isConfirming && (
               <motion.div
                 initial={{ opacity: 0 }}
                 animate={{ opacity: 1 }}
                 exit={{ opacity: 0 }}
                 className="absolute inset-0 z-50 bg-slate-900/90 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center"
               >
                  <motion.div
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    className="space-y-8"
                  >
                     <div className="w-20 h-20 bg-medical-500/10 rounded-full flex items-center justify-center mx-auto border border-medical-500/20">
                        <HelpCircle size={40} className="text-medical-500 animate-pulse" />
                     </div>
                     <div>
                        <h4 className="text-2xl font-black text-white tracking-tight">Is this your final answer?</h4>
                        <p className="text-slate-400 font-medium mt-2">"{selectedOption}"</p>
                     </div>
                     <div className="flex flex-col gap-3 w-full max-w-[240px] mx-auto">
                        <button
                          onClick={confirmAnswer}
                          className="w-full py-4 bg-medical-600 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg shadow-medical-600/20 active:scale-95 transition-all"
                        >
                          Confirm Answer
                        </button>
                        <button
                          onClick={() => { setIsConfirming(false); setSelectedOption(null); }}
                          className="w-full py-4 bg-white/10 text-white rounded-2xl font-black uppercase tracking-widest text-xs hover:bg-white/20 transition-all"
                        >
                          Change Mind
                        </button>
                     </div>
                  </motion.div>
               </motion.div>
             )}
           </AnimatePresence>
        </div>
      </div>

      {/* Social Share Modal */}
      <AnimatePresence>
        {showShareModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white dark:bg-slate-800 w-full max-w-sm rounded-[2.5rem] p-8 shadow-2xl space-y-8"
            >
              <div className="text-center space-y-2">
                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Call For Backup</h3>
                <p className="text-slate-500 font-medium text-sm">Send this clinical challenge to your colleagues.</p>
              </div>

              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => shareQuestion('whatsapp')}
                  className="flex items-center justify-between p-4 bg-[#25D366]/10 text-[#25D366] rounded-2xl font-black uppercase tracking-widest text-[10px] border border-[#25D366]/20 hover:bg-[#25D366]/20 transition-all"
                >
                  Share via WhatsApp <Share2 size={18} />
                </button>
                <button
                  onClick={() => shareQuestion('telegram')}
                  className="flex items-center justify-between p-4 bg-[#0088cc]/10 text-[#0088cc] rounded-2xl font-black uppercase tracking-widest text-[10px] border border-[#0088cc]/20 hover:bg-[#0088cc]/20 transition-all"
                >
                  Share via Telegram <Send size={18} />
                </button>
                <button
                  onClick={() => shareQuestion('copy')}
                  className="flex items-center justify-between p-4 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-2xl font-black uppercase tracking-widest text-[10px] border border-transparent hover:bg-slate-200 transition-all"
                >
                  Copy Challenge Link <Copy size={18} />
                </button>
              </div>

              <button
                onClick={() => setShowShareModal(false)}
                className="w-full py-4 text-slate-400 font-black uppercase tracking-[0.2em] text-[10px] hover:text-slate-600 transition-all"
              >
                Cancel Backup
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Rationale System - Educational Polish */}
      <AnimatePresence>
        {showRationale && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 overflow-hidden relative">
               <div className="absolute top-0 right-0 p-8 opacity-5 text-slate-900 dark:text-white">
                  <Award size={120} />
               </div>

               <div className="relative z-10 space-y-8">
                  <header className="flex justify-between items-center">
                     <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                           {isCorrect ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                        </div>
                        <div>
                           <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}</p>
                           <h4 className="text-xl font-black text-slate-900 dark:text-white">{isCorrect ? 'Excellent Reasoning' : 'Almost There, Nurse'}</h4>
                        </div>
                     </div>
                  </header>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                     <div className="space-y-4">
                        <div className="flex items-center gap-2">
                           <Target size={16} className="text-medical-500" />
                           <p className="text-xs font-black uppercase tracking-widest text-slate-400">Clinical Insight</p>
                        </div>
                        <p className="text-sm sm:text-base font-medium text-slate-600 dark:text-slate-300 leading-relaxed italic">
                          {currentQ.rationale || "The correct answer is derived from standard clinical protocols and the physiological basis of nursing practice."}
                        </p>
                     </div>
                     <div className="space-y-6">
                        <div className="p-5 bg-medical-50 dark:bg-medical-900/20 rounded-2xl border border-medical-100 dark:border-medical-900/30">
                           <div className="flex items-center gap-2 mb-2">
                              <Zap size={14} className="text-amber-500" />
                              <p className="text-[10px] font-black uppercase tracking-widest text-medical-600">Exam Memory Tip</p>
                           </div>
                           <p className="text-xs font-bold text-slate-600 dark:text-slate-400 italic leading-relaxed">
                             "{currentQ.hint || 'Focus on the underlying physiological mechanism to eliminate distractors.'}"
                           </p>
                        </div>
                        {!isCorrect && (
                           <div className="p-5 bg-red-50 dark:bg-red-900/20 rounded-2xl border border-red-100 dark:border-red-900/30">
                              <p className="text-[10px] font-black uppercase tracking-widest text-red-600 mb-1">Common Pitfall</p>
                              <p className="text-xs font-bold text-slate-600 dark:text-slate-400">Students often confuse this with secondary assessment findings. Remember: primary ABCs always come first.</p>
                           </div>
                        )}
                     </div>
                  </div>
               </div>
            </div>

            <div className="flex gap-4">
               <button
                 onClick={walkAway}
                 className="flex-1 py-5 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-[1.5rem] font-black uppercase tracking-widest text-[10px] border border-slate-100 dark:border-slate-700 shadow-sm active:scale-95 transition-all flex items-center justify-center gap-2"
               >
                 Walk Away (Save Streak)
               </button>
               <button
                 onClick={nextQuestion}
                 className="flex-[2] py-5 bg-slate-900 text-white rounded-[1.5rem] font-black uppercase tracking-widest text-xs shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
               >
                 {currentQuestionIndex < quizQuestions.length - 1 ? 'Next Challenge' : 'Complete Challenge'}
                 <ChevronRight size={18} />
               </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const LifelineButton = ({ icon, label, used, onClick }) => (
  <button
    disabled={used}
    onClick={onClick}
    className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all active:scale-95 ${used ? 'bg-slate-50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 text-slate-300 grayscale' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-medical-600 hover:border-medical-500 shadow-sm'}`}
  >
    {React.cloneElement(icon, { size: 20 })}
    <span className="text-[9px] font-black uppercase tracking-widest mt-2">{label}</span>
  </button>
);

const OptionButton = ({ label, index, state, pollValue, onClick, disabled }) => {
  const letters = ['A', 'B', 'C', 'D'];

  let styles = "bg-white/5 border-white/10 text-white/70 hover:bg-white/10 hover:border-white/30";
  if (state === 'selected') styles = "bg-amber-500/20 border-amber-500 text-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.2)]";
  if (state === 'correct') styles = "bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.2)]";
  if (state === 'wrong') styles = "bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]";
  if (state === 'eliminated') styles = "opacity-20 pointer-events-none grayscale blur-[1px]";

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`w-full group relative flex items-center p-4 sm:p-5 rounded-2xl border-2 transition-all duration-300 overflow-hidden ${styles}`}
    >
      <div className="flex items-center gap-4 w-full relative z-10">
         <span className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-xs border ${state === 'selected' ? 'bg-amber-500 border-amber-400 text-white' : 'bg-white/10 border-white/10'}`}>
            {letters[index]}
         </span>
         <span className="flex-1 font-bold text-sm sm:text-base text-left leading-tight pr-8">{label}</span>
         {pollValue !== undefined && (
            <div className="text-right">
               <p className="text-lg font-black">{pollValue}%</p>
               <div className="w-12 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-medical-500" style={{ width: `${pollValue}%` }} />
               </div>
            </div>
         )}
      </div>
      {state === 'correct' && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1.5 }}
          className="absolute right-[-20px] top-[-20px] p-8 text-emerald-500/10"
        >
          <CheckCircle2 size={80} />
        </motion.div>
      )}
    </button>
  );
};

const HelpCircle = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const Zap = ({ size, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

export default Quiz;
