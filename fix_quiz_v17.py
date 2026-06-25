import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Immersive Header & Background
new_full_block = """  return (
    <div className={`fixed inset-0 z-[60] bg-gradient-to-b from-[#1B2343] to-[#0B1020] flex flex-col text-slate-900 dark:text-white`}>
      {/* HEADER: Student Progress, XP, Animated Progress Bar */}
      <div className="p-4 bg-slate-900/40 backdrop-blur-md border-b border-white/10 flex flex-col gap-3 relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 shrink-0">
             <span className="text-white opacity-60 text-xs">👤</span>
             <span className="text-white font-black text-xs">{currentQuestionIndex + 1} / {quizQuestions.length}</span>
          </div>

          <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden relative shadow-[0_0_15px_rgba(168,85,247,0.1)]">
             <motion.div
               className="h-full bg-gradient-to-r from-purple-500 to-indigo-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]"
               initial={{ width: 0 }}
               animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
               transition={{ duration: 0.5 }}
             />
          </div>

          <div className="flex items-center gap-2 px-3 py-1 bg-amber-500/10 rounded-full border border-amber-500/20 shrink-0">
             <Star size={12} className="text-amber-500 fill-amber-500" />
             <span className="text-amber-500 font-black text-xs">{sessionXP} XP</span>
          </div>
        </div>

        <div className="flex items-center justify-between">
           <div className="flex items-center gap-2">
              <button onClick={walkAway} className="p-1 text-white/40 hover:text-white transition-colors shrink-0"><ChevronLeft size={20} /></button>
              <p className="text-[9px] font-black uppercase text-white/40 tracking-[0.2em]">{currentQ.source?.toLowerCase().includes('richard') ? "Richard's Bank" : "NMCN Exam Bank"}</p>
           </div>

           <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar max-w-[200px]">
              <button disabled={lifelinesUsed.fiftyFifty || showRationale} onClick={eliminateTwo} className={`p-2 rounded-xl transition-all ${lifelinesUsed.fiftyFifty ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 text-white shadow-lg active:scale-95 hover:bg-white/20'}`} title="50/50"><ShuffleIcon size={14} /></button>
              <button disabled={lifelinesUsed.askClass || showRationale} onClick={askClass} className={`p-2 rounded-xl transition-all ${lifelinesUsed.askClass ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 text-white shadow-lg active:scale-95 hover:bg-white/20'}`} title="Poll"><Users size={14} /></button>
              <button disabled={lifelinesUsed.mentor || showRationale} onClick={useMentor} className={`p-2 rounded-xl transition-all ${lifelinesUsed.mentor ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 text-white shadow-lg active:scale-95 hover:bg-white/20'}`} title="Mentor"><Shield size={14} /></button>
              <button disabled={lifelinesUsed.hint || showRationale} onClick={useHint} className={`p-2 rounded-xl transition-all ${lifelinesUsed.hint ? 'opacity-10 scale-90 grayscale' : 'bg-white/10 text-white shadow-lg active:scale-95 hover:bg-white/20'}`} title="Hint"><Zap size={14} /></button>
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col p-4 sm:p-8">
        <div className="max-w-3xl mx-auto w-full flex flex-col gap-8">

          {/* QUESTION CARD: Large Floating Card, Glassmorphism, Timer Circle */}
          <div className="relative mt-8">
             {/* TIMER: Large floating circle overlapping top of card */}
             {(isSpeed || useTimer) && !showRationale && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-20">
                   <div className="relative w-20 h-20 bg-slate-900 rounded-full flex items-center justify-center border-4 border-white/5 shadow-2xl">
                      <svg className="absolute inset-0 w-full h-full -rotate-90">
                         <circle
                            cx="40" cy="40" r="36"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="transparent"
                            className={timeLeft < 5 ? 'text-red-500' : (timeLeft < 10 ? 'text-yellow-500' : 'text-[#FF7A00]')}
                            style={{
                               strokeDasharray: 226,
                               strokeDashoffset: 226 - (226 * timeLeft) / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30),
                               transition: 'stroke-dashoffset 1s linear'
                            }}
                         />
                      </svg>
                      <span className={`text-2xl font-black tabular-nums ${timeLeft < 5 ? 'text-red-500 animate-pulse' : 'text-white'}`}>{timeLeft}</span>
                   </div>
                </div>
             )}

             <motion.div
               key={currentQuestionIndex}
               initial={{ opacity: 0, y: 20 }}
               animate={{ opacity: 1, y: 0 }}
               className="bg-[#1e293b]/60 backdrop-blur-xl p-8 pt-14 sm:p-12 sm:pt-16 rounded-[2rem] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.3)] relative overflow-hidden text-center"
             >
                <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={160} /></div>
                <div className="relative z-10 space-y-4">
                   <div className="flex flex-col items-center gap-1">
                      <p className="text-[10px] font-black uppercase text-purple-400 tracking-[0.3em]">Question {currentQuestionIndex + 1}</p>
                      <div className="flex items-center gap-2">
                        <span className="px-3 py-1 bg-white/5 text-white/60 rounded-lg text-[8px] font-black uppercase tracking-widest border border-white/5">{currentQ.subject}</span>
                        <SourceBadge source={currentQ.source} />
                      </div>
                   </div>
                   <h3 className="text-xl sm:text-3xl font-black leading-tight tracking-tight text-white text-balance drop-shadow-md">
                     {currentQ.question}
                   </h3>
                </div>
             </motion.div>
          </div>

          {/* OPTIONS: 2x2 Answer Grid, Compact Rounded Cards */}
          <div className={`grid gap-4 ${isSpeed ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
            {currentQ.options.map((option, idx) => (
              <OptionButton
                key={idx}
                label={option}
                index={idx}
                state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : (eliminatedOptions.includes(option) ? 'eliminated' : 'normal'))}
                onClick={() => handleOptionClick(option)}
                disabled={showRationale}
                dark={true}
                isSpeed={true}
                pollValue={classPoll ? classPoll[option] : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
         {isFinalAnswer && !showRationale && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/80 backdrop-blur-md">
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-[#1B2343] p-8 rounded-[2.5rem] shadow-2xl border border-white/10 flex flex-col items-center gap-6 max-w-sm w-full text-center">
                  <div className="w-16 h-16 bg-[#FF7A00]/20 text-[#FF7A00] rounded-2xl flex items-center justify-center shadow-[0_0_20px_rgba(255,122,0,0.2)]"><HelpCircle size={32}/></div>
                  <div><h4 className="text-xl font-black text-white">FINAL ANSWER?</h4><p className="text-sm text-slate-400 font-medium">Locked in your selection?</p></div>
                  <div className="flex gap-4 w-full">
                    <button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="flex-1 py-4 bg-white/5 text-white/60 rounded-2xl font-black uppercase text-[10px]">Change</button>
                    <button onClick={() => confirmAnswer()} className="flex-1 py-4 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-[#FF7A00]/20 animate-pulse">Confirm</button>
                  </div>
               </motion.div>
            </div>
         )}
      </AnimatePresence>

      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center p-0 sm:p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm" onClick={nextQuestion} />
             <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} className="relative w-full max-w-2xl bg-[#0B1020] rounded-t-[3rem] sm:rounded-[3rem] p-10 shadow-2xl border border-white/10">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8">
                   <div className="w-full">
                      <p className="text-[10px] font-black uppercase text-purple-400 mb-1 tracking-[0.2em]">{isCorrect ? 'Logic Validated' : 'Misalignment'}</p>
                      <h4 className="text-2xl font-black text-white leading-none">{isCorrect ? 'Mastery Confirmed' : 'Opportunity'}</h4>
                      <div className="mt-4"><SourceBadge source={currentQ.source} /></div>
                   </div>
                   {restoredThisTurn && isCorrect && <div className="px-4 py-2 bg-amber-500/10 text-amber-500 rounded-xl text-[10px] font-black uppercase animate-bounce flex items-center gap-2 border border-amber-500/20 shrink-0"><Zap size={12} /> Lifeline Restored!</div>}
                </div>

                <div className="max-h-[50vh] overflow-y-auto custom-scrollbar mb-10 space-y-6 text-left">
                   <div className="p-6 bg-emerald-500/10 rounded-[2rem] border border-emerald-500/20 flex items-center gap-4 shadow-[0_0_20px_rgba(34,197,94,0.1)]">
                      <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20"><CheckCircle2 size={24}/></div>
                      <div>
                         <p className="text-[10px] font-black uppercase text-emerald-400 tracking-widest">Correct Answer</p>
                         <p className="font-black text-white leading-tight text-lg">{currentQ.correctAnswerText}</p>
                      </div>
                   </div>

                   <div><p className="text-[10px] font-black uppercase text-white/40 mb-2 tracking-widest">✔ Clinical Rationale</p><p className="font-medium text-sm leading-relaxed text-slate-300 italic">{currentQ.rationale}</p></div>
                   <div><p className="text-[10px] font-black uppercase text-blue-400 mb-2 tracking-widest">🏥 Clinical Application</p><p className="text-sm font-bold text-slate-200">{currentQ.clinical_application}</p></div>
                   <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/10"><p className="text-[10px] font-black uppercase text-amber-500 mb-2 tracking-widest">💡 Simplification</p><p className="text-sm font-medium text-amber-200/80 leading-relaxed">{currentQ.simplification}</p></div>
                </div>

                <button onClick={nextQuestion} className="w-full py-6 bg-white text-[#0B1020] rounded-[2rem] font-black uppercase text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4 hover:bg-slate-200">Next Challenge <ArrowRight size={20} /></button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowHint(false)} />
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-[#1B2343] p-10 rounded-[3rem] shadow-2xl border border-white/10 text-center">
                <div className="w-20 h-20 bg-amber-500/10 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><Target size={40} /></div>
                <h4 className="text-2xl font-black text-white mb-1 uppercase tracking-tight">{mentorAdvice?.type}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase mb-8 tracking-[0.2em]">Confidence: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-300 font-medium italic text-lg leading-relaxed mb-10">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-white/10 text-white rounded-2xl font-black uppercase text-[10px] hover:bg-white/20 transition-all">Return to Challenge</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-xl">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-[#1B2343] p-10 rounded-[3rem] shadow-2xl max-w-sm w-full text-center border border-white/10">
                <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><AlertCircle size={40} /></div>
                <h4 className="text-2xl font-black text-white mb-4 uppercase tracking-tighter">Pause Journey?</h4>
                <p className="text-slate-400 font-medium italic mb-10 leading-relaxed text-balance px-4">"{exitPrompt}"</p>
                <div className="flex flex-col gap-3">
                   <button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-[#FF7A00] text-white rounded-2xl font-black uppercase text-[10px] shadow-lg shadow-[#FF7A00]/20">Stay and Continue</button>
                   <button onClick={() => { setQuizStarted(false); setShowResults(true); setIsQuizActive(false); }} className="w-full py-4 bg-white/5 text-slate-500 rounded-2xl font-black uppercase text-[10px] hover:text-red-500 transition-colors">End Session</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};"""

# Pattern to replace the entire return block of the Quiz component
# From "return (" to the last "};" before "const ModeCard"
pattern = r"return \(.*?\}\s+const ModeCard ="
content = re.sub(pattern, new_full_block + "\n\nconst ModeCard =", content, flags=re.DOTALL)

# Also update the OptionButton state colors
# Selected: Orange, Correct: Green, Wrong: Red
option_update = """  if (state === 'selected') baseStyles = 'bg-[#FF7A00]/20 border-[#FF7A00] text-white';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(34,197,94,0.2)]';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500 shadow-[0_0_20px_rgba(239,68,68,0.2)]';
  if (state === 'eliminated') baseStyles = 'opacity-0 pointer-events-none scale-95 grayscale';"""

# Replace the baseStyles logic in OptionButton
content = re.sub(r"if \(state === 'selected'\) baseStyles = .*?if \(state === 'eliminated'\) baseStyles = .*?;", option_update, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
