import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { Brain, Sparkles, ChevronRight, CheckCircle2, XCircle, AlertCircle, Trophy, Target } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

const DailyChallengeWidget = () => {
  const { flashcards, userProfile, studyStats } = useAppContext();
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [dailyQuestions, setDailyQuestions] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [challengeScore, setChallengeScore] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);

  // Personalized logic: Filter by level and shuffle
  useEffect(() => {
    if (flashcards.length > 0 && dailyQuestions.length === 0) {
      const userLevel = userProfile.level || 'Year 1';
      const levelAppropriate = flashcards.filter(c => c.level === userLevel);
      const pool = levelAppropriate.length >= 5 ? levelAppropriate : flashcards;

      const shuffled = [...pool].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, 5).map(card => {
        // Generate options if not present
        const distractors = flashcards
          .filter(c => c.id !== card.id)
          .sort(() => 0.5 - Math.random())
          .slice(0, 3)
          .map(c => c.answer);
        const options = [card.answer, ...distractors].sort(() => 0.5 - Math.random());
        return { ...card, options, correctAnswer: card.answer };
      });
      setDailyQuestions(selected);
    }
  }, [flashcards, userProfile, dailyQuestions.length]);

  const handleAnswer = (option) => {
    if (selectedOption) return;
    const correct = option === dailyQuestions[currentIdx].correctAnswer;
    setSelectedOption(option);
    setIsCorrect(correct);
    if (correct) setChallengeScore(prev => prev + 1);

    setTimeout(() => {
      if (currentIdx < dailyQuestions.length - 1) {
        setCurrentIdx(prev => prev + 1);
        setSelectedOption(null);
        setIsCorrect(null);
      } else {
        setIsCompleted(true);
      }
    }, 1500);
  };

  if (dailyQuestions.length === 0) return null;

  if (isCompleted) {
    return (
      <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 text-center animate-in zoom-in duration-500">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Trophy size={32} />
        </div>
        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">Challenge Complete!</h3>
        <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mb-6">
          You mastered {challengeScore}/5 concepts today.
        </p>
        <div className="flex items-center justify-center gap-2">
           {[...Array(5)].map((_, i) => (
             <div key={i} className={`w-3 h-3 rounded-full ${i < challengeScore ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
           ))}
        </div>
      </div>
    );
  }

  if (!challengeStarted) {
    return (
      <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-110 transition-transform">
          <Sparkles size={80} className="text-apex-600" />
        </div>
        <div className="relative z-10">
          <h4 className="text-[10px] font-black text-apex-600 uppercase tracking-[0.2em] mb-4">Daily Precision</h4>
          <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">Today's Clinical Challenge</h3>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mb-8 max-w-[200px]">
            5 randomized concepts tailored for {userProfile.level || 'Year 1'}.
          </p>
          <button
            onClick={() => setChallengeStarted(true)}
            className="px-6 py-3 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center gap-2 hover:gap-4 transition-all"
          >
            Start Challenge <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  const currentQ = dailyQuestions[currentIdx];

  return (
    <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 min-h-[350px] flex flex-col animate-in fade-in duration-500">
       <div className="flex justify-between items-center mb-6">
          <div className="flex gap-1">
             {dailyQuestions.map((_, i) => (
               <div key={i} className={`h-1.5 rounded-full transition-all ${i === currentIdx ? 'w-8 bg-apex-600' : i < currentIdx ? 'w-4 bg-emerald-500' : 'w-4 bg-slate-100 dark:bg-slate-700'}`} />
             ))}
          </div>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentIdx + 1}/5</span>
       </div>

       <div className="flex-1 space-y-6">
          <h4 className="text-lg font-bold text-slate-800 dark:text-white leading-tight tracking-tight">
            {currentQ.question}
          </h4>

          <div className="grid gap-2">
             {currentQ.options.map((opt, i) => {
                let style = "border-slate-100 dark:border-slate-700 hover:border-apex-600";
                if (selectedOption === opt) {
                  style = opt === currentQ.correctAnswer ? "bg-emerald-50 border-emerald-500 text-emerald-700" : "bg-red-50 border-red-500 text-red-700";
                } else if (selectedOption && opt === currentQ.correctAnswer) {
                  style = "bg-emerald-50 border-emerald-500 text-emerald-700";
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(opt)}
                    disabled={!!selectedOption}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all font-bold text-xs tracking-tight ${style}`}
                  >
                    {opt}
                  </button>
                );
             })}
          </div>
       </div>

       <AnimatePresence>
         {selectedOption && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 flex items-center gap-2 font-black uppercase tracking-widest text-[9px] ${isCorrect ? 'text-emerald-600' : 'text-red-600'}`}
            >
               {isCorrect ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
               {isCorrect ? 'Masterfully Answered' : 'Incorrect Logic'}
            </motion.div>
         )}
       </AnimatePresence>
    </div>
  );
};

export default DailyChallengeWidget;
