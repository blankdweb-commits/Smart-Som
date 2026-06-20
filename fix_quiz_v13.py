import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update Return Block for Immersive UI
# We'll replace everything from "const isSpeed =" until the end of the Quiz component's main return.

new_return_block = """  const currentQ = quizQuestions[currentQuestionIndex];
  if (!currentQ) return null;
  const isSpeed = quizMode === 'speed';

  return (
    <div className={`fixed inset-0 z-[60] bg-white dark:bg-slate-950 flex flex-col ${isSpeed ? 'dark' : ''} text-slate-900 dark:text-white`}>
      {/* Immersive Top Bar */}
      <div className="p-4 bg-slate-50 dark:bg-white/5 border-b border-slate-100 dark:border-white/5 flex items-center justify-between gap-4">
        <button onClick={walkAway} className="p-2 text-slate-400 hover:text-slate-600 shrink-0"><ChevronLeft size={24} /></button>

        <div className="flex-1 max-w-md h-2 bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
           <motion.div className="h-full bg-medical-500" initial={{ width: 0 }} animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }} />
        </div>

        <div className="flex items-center gap-2">
           {(isSpeed || useTimer) && !showRationale && (
              <div className={`px-3 py-1 rounded-xl font-black text-xs tabular-nums ${timeLeft < 5 ? 'bg-red-500 text-white animate-pulse' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                {timeLeft}s
              </div>
           )}
           <div className="flex items-center gap-1">
              <button disabled={lifelinesUsed.fiftyFifty || showRationale} onClick={eliminateTwo} className={`p-2 rounded-lg transition-all ${lifelinesUsed.fiftyFifty ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="50/50"><ShuffleIcon size={14} /></button>
              <button disabled={lifelinesUsed.askClass || showRationale} onClick={askClass} className={`p-2 rounded-lg transition-all ${lifelinesUsed.askClass ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="Poll"><Users size={14} /></button>
              <button disabled={lifelinesUsed.hint || showRationale} onClick={useMentor} className={`p-2 rounded-lg transition-all ${lifelinesUsed.hint ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="Mentor"><Info size={14} /></button>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col p-4 sm:p-8">
        <div className="max-w-3xl mx-auto w-full flex flex-col gap-6">
          <div className="flex justify-between items-center">
             <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question {currentQuestionIndex + 1} / {quizQuestions.length}</span>
             <SourceBadge source={currentQ.source} />
          </div>

          <div className="bg-white dark:bg-white/5 p-8 rounded-[2.5rem] border border-slate-100 dark:border-white/10 shadow-soft relative overflow-hidden min-h-[160px] flex items-center justify-center">
             <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={120} /></div>
             <h3 className="text-xl sm:text-2xl font-black leading-tight tracking-tight text-center text-slate-900 dark:text-white z-10">{currentQ.question}</h3>
          </div>

          <div className={`grid gap-3 sm:gap-4 ${quizMode === 'speed' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {currentQ.options.map((option, idx) => (
              <OptionButton
                key={idx}
                label={option}
                index={idx}
                state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : (eliminatedOptions.includes(option) ? 'eliminated' : 'normal'))}
                onClick={() => handleOptionClick(option)}
                disabled={showRationale || eliminatedOptions.includes(option)}
                dark={isSpeed}
                isSpeed={isSpeed}
                pollValue={classPoll ? classPoll[option] : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
         {isFinalAnswer && !showRationale && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-white/10 flex flex-col items-center gap-6 max-w-sm w-full text-center">
                  <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center shadow-inner"><HelpCircle size={32}/></div>
                  <div>
                    <h4 className="text-xl font-black text-slate-900 dark:text-white">Final Answer?</h4>
                    <p className="text-sm text-slate-500 font-medium">Your choice has been recorded. Ready to validate?</p>
                  </div>
                  <div className="flex gap-4 w-full">
                     <button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="flex-1 py-4 bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 rounded-2xl font-black uppercase tracking-widest text-[10px]">Change</button>
                     <button onClick={() => confirmAnswer()} className="flex-1 py-4 bg-amber-500 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl shadow-amber-500/20 animate-pulse">Confirm</button>
                  </div>
               </motion.div>
            </motion.div>
         )}
      </AnimatePresence>

      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center p-0 sm:p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={nextQuestion} />
             <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[3rem] sm:rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-white/10">
                <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-8 mx-auto sm:mx-0 ${isCorrect ? 'bg-emerald-100 text-emerald-600 shadow-lg shadow-emerald-500/20' : 'bg-red-100 text-red-600 shadow-lg shadow-red-500/20'}`}>{isCorrect ? <CheckCircle2 size={40} /> : <XCircle size={40} />}</div>
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4 text-center sm:text-left">
                   <div className="w-full">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">{isCorrect ? 'Logic Validated' : 'Conceptual Misalignment'}</p>
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">{isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}</h4>
                      <div className="mt-4"><SourceBadge source={currentQ.source} /></div>
                   </div>
                   {consecutiveCorrect >= 5 && isCorrect && (
                      <div className="px-4 py-2 bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-widest animate-bounce flex items-center gap-2 border border-amber-200 shrink-0">
                         <Zap size={12} /> Lifeline Restored!
                      </div>
                   )}
                </div>

                <div className="max-h-60 overflow-y-auto custom-scrollbar mb-8 space-y-6 text-left">
                   <div>
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">✔ Clinical Rationale</p>
                      <p className="font-medium text-sm leading-relaxed italic text-slate-600 dark:text-slate-300">{currentQ.rationale}</p>
                   </div>
                   <div>
                      <p className="text-[10px] font-black uppercase text-medical-600 mb-1 tracking-widest">🏥 Clinical Application</p>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{currentQ.clinical_application}</p>
                   </div>
                   <div className="p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100 dark:border-amber-900/20">
                      <p className="text-[10px] font-black uppercase text-amber-600 mb-1 tracking-widest">💡 Simplification</p>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{currentQ.simplification}</p>
                   </div>
                </div>

                <button onClick={nextQuestion} className="w-full py-6 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:gap-6">{currentQuestionIndex < quizQuestions.length - 1 ? 'Next Challenge' : 'Complete Quiz'} <ArrowRight size={20} /></button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowHint(false)} />
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white dark:bg-slate-800 p-10 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-700 text-center">
                <div className="w-20 h-20 bg-medical-50 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><Target size={40} /></div>
                <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-1">{mentorAdvice?.type || 'Mentor Strategy'}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-6">Confidence: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-600 dark:text-slate-300 font-medium italic text-lg leading-relaxed mb-10 text-balance text-center">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-all">Return to Question</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};"""

# Identify the start of the final return block
pattern = r"const currentQ = quizQuestions\[currentQuestionIndex\].*?export default Quiz;"
content = re.sub(pattern, new_return_block + "\n\n// [Icons and helper components omitted for re-injection]\n\nexport default Quiz;", content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
