import sys

with open('src/pages/Quiz.jsx', 'r') as f:
    lines = f.readlines()

# Search for the start of the corruption
start_line = -1
for i, line in enumerate(lines):
    if '<div className="flex items-center gap-1">' in line:
        start_line = i
        break

# The corruption starts right after the closing </div> of the lifelines
# Line 367 in cat was "           </div>"
# Line 368 was "}"
# We need to find where the components like "const ModeCard" start.

target_line = -1
for i in range(start_line, len(lines)):
    if 'const ModeCard' in lines[i]:
        target_line = i
        break

# The block between lifelines and ModeCard should be the rest of the Quiz component return
rest_of_quiz = """
      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col p-4 sm:p-8">
        <div className="max-w-3xl mx-auto w-full flex flex-col gap-6">
          <div className="flex justify-between items-center"><span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Question {currentQuestionIndex + 1} / {quizQuestions.length}</span><SourceBadge source={currentQ.source} /></div>
          <div className="bg-white dark:bg-white/5 p-8 rounded-[2.5rem] border border-slate-100 dark:border-white/10 shadow-soft relative overflow-hidden min-h-[160px] flex items-center justify-center">
             <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={120} /></div>
             <h3 className="text-xl sm:text-2xl font-black leading-tight tracking-tight text-center z-10">{currentQ.question}</h3>
          </div>
          <div className={`grid gap-3 sm:gap-4 ${quizMode === 'speed' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {currentQ.options.map((option, idx) => (
              <OptionButton key={idx} label={option} index={idx} state={showRationale ? (option === currentQ.correctAnswer ? 'correct' : (selectedOption === option ? 'wrong' : 'normal')) : (selectedOption === option ? 'selected' : (eliminatedOptions.includes(option) ? 'eliminated' : 'normal'))} onClick={() => handleOptionClick(option)} disabled={showRationale || eliminatedOptions.includes(option)} dark={isSpeed} isSpeed={isSpeed} pollValue={classPoll ? classPoll[option] : undefined} />
            ))}
          </div>
        </div>
      </div>

      <AnimatePresence>
         {isFinalAnswer && !showRationale && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-sm">
               <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white dark:bg-slate-900 p-8 rounded-[3rem] shadow-2xl border border-white/10 flex flex-col items-center gap-6 max-w-sm w-full text-center">
                  <div className="w-16 h-16 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center"><HelpCircle size={32}/></div>
                  <div><h4 className="text-xl font-black text-slate-900 dark:text-white">Final Answer?</h4><p className="text-sm text-slate-500 font-medium">Ready to validate?</p></div>
                  <div className="flex gap-4 w-full"><button onClick={() => { setSelectedOption(null); setIsFinalAnswer(false); }} className="flex-1 py-4 bg-slate-100 dark:bg-white/5 text-slate-600 rounded-2xl font-black uppercase text-[10px]">Change</button><button onClick={() => confirmAnswer()} className="flex-1 py-4 bg-amber-500 text-white rounded-2xl font-black uppercase text-[10px] animate-pulse">Confirm</button></div>
               </motion.div>
            </div>
         )}
      </AnimatePresence>

      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center p-0 sm:p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={nextQuestion} />
             <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} className="relative w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-[3rem] sm:rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-white/10">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4 text-center sm:text-left">
                   <div className="w-full">
                      <p className="text-[10px] font-black uppercase text-slate-400 mb-1">{isCorrect ? 'Logic Validated' : 'Misalignment'}</p>
                      <h4 className="text-2xl font-black text-slate-900 dark:text-white leading-none">{isCorrect ? 'Mastery Confirmed' : 'Opportunity'}</h4>
                      <div className="mt-4"><SourceBadge source={currentQ.source} /></div>
                   </div>
                   {restoredThisTurn && isCorrect && <div className="px-4 py-2 bg-amber-100 text-amber-700 rounded-xl text-[10px] font-black uppercase animate-bounce flex items-center gap-2 border border-amber-200 shrink-0"><Zap size={12} /> Lifeline Restored!</div>}
                </div>
                <div className="max-h-60 overflow-y-auto custom-scrollbar mb-8 space-y-6 text-left">
                   <div><p className="text-[10px] font-black uppercase text-slate-400 mb-1">✔ Rationale</p><p className="font-medium text-sm italic text-slate-600 dark:text-slate-300">{currentQ.rationale}</p></div>
                   <div><p className="text-[10px] font-black uppercase text-medical-600 mb-1">🏥 Application</p><p className="text-sm font-bold text-slate-700 dark:text-slate-200">{currentQ.clinical_application}</p></div>
                   <div className="p-4 bg-amber-50 dark:bg-amber-900/10 rounded-2xl border border-amber-100"><p className="text-[10px] font-black uppercase text-amber-600 mb-1">💡 Simplification</p><p className="text-sm font-medium text-amber-800 dark:text-amber-200">{currentQ.simplification}</p></div>
                </div>
                <button onClick={nextQuestion} className="w-full py-6 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-[2rem] font-black uppercase text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-4">{currentQuestionIndex < quizQuestions.length - 1 ? 'Next' : 'Complete'} <ArrowRight size={20} /></button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
             <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => setShowHint(false)} />
             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white dark:bg-slate-800 p-10 rounded-[3rem] shadow-2xl text-center">
                <div className="w-20 h-20 bg-medical-50 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8"><Target size={40} /></div>
                <h4 className="text-2xl font-black mb-1">{mentorAdvice?.type}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase mb-6">Confidence: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-600 dark:text-slate-300 font-medium italic text-lg leading-relaxed mb-10">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-slate-100 dark:bg-white/10 rounded-2xl font-black uppercase text-[10px]">Return</button>
             </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
             <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white dark:bg-slate-900 p-10 rounded-[3rem] shadow-2xl max-w-sm w-full text-center">
                <div className="w-20 h-20 bg-red-100 text-red-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8"><AlertCircle size={40} /></div>
                <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-4">Pause Journey?</h4>
                <p className="text-slate-500 font-medium italic mb-10 leading-relaxed">"{exitPrompt}"</p>
                <div className="flex flex-col gap-3">
                   <button onClick={() => setShowExitConfirm(false)} className="w-full py-5 bg-medical-600 text-white rounded-2xl font-black uppercase text-[10px]">Continue</button>
                   <button onClick={() => { setQuizStarted(false); setShowResults(true); setIsQuizActive(false); }} className="w-full py-4 bg-slate-100 dark:bg-white/5 text-slate-400 rounded-2xl font-black uppercase text-[10px] hover:text-red-500">End Session</button>
                </div>
             </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
"""

new_lines = lines[:start_line + 5] # includes the closing </div> of lifelines
# Find where the </div> ends properly
actual_end_of_header = -1
for i in range(start_line, len(lines)):
    if '</div>' in lines[i]:
        actual_end_of_header = i
        # We need to find the specific one that closes the immersive top bar
        # based on my previous cat, it was line 367
        break

new_lines = lines[:start_line + 6]
final_full_lines = new_lines + [rest_of_quiz] + lines[target_line:]

with open('src/pages/Quiz.jsx', 'w') as f:
    f.writelines(final_full_lines)
