import re

file_path = 'src/pages/Quiz.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# 4. Integrate Source Badge INSIDE Question Card
# And handle Review Screen Layout (Issue 14)

question_card_ui = """         <motion.div key={currentQuestionIndex} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className={`bg-[#1B2343] rounded-[2.5rem] p-8 sm:p-10 border border-white/10 ${isLowPowerMode ? "" : "shadow-2xl"} text-center mb-6 relative overflow-hidden`}>
            <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none"><Brain size={160} /></div>

            {/* Lifelines Row */}
            <div className="flex items-center justify-center gap-2 mb-8">
               <button disabled={lifelinesUsed.hint} onClick={handleUseHint} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.hint ? "opacity-20 grayscale" : "active:scale-95"}`} title="Hint"><Zap size={16} className="text-orange-400" /></button>
               <button disabled={lifelinesUsed.fiftyFifty} onClick={handleEliminateTwo} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.fiftyFifty ? "opacity-20 grayscale" : "active:scale-95"}`} title="50/50"><Shuffle size={16} /></button>
               <button disabled={lifelinesUsed.askClass} onClick={handleAskClass} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.askClass ? "opacity-20 grayscale" : "active:scale-95"}`} title="Poll"><Users size={16} /></button>
               <button disabled={lifelinesUsed.mentor} onClick={handleUseMentor} className={`p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all ${lifelinesUsed.mentor ? "opacity-20 grayscale" : "active:scale-95"}`} title="Mentor"><Shield size={16} className="text-blue-400" /></button>
            </div>

            <div className="flex flex-col items-center gap-4">
               <SourceBadge source={currentQ.source} />
               <div className="flex items-center justify-center gap-2">
                  <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.3em]">Question {String(currentQuestionIndex + 1).padStart(2, '0')}</span>
                  <div className="w-1 h-1 rounded-full bg-indigo-500/40"></div>
                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">{currentQ.subject}</span>
               </div>
               <h3 className="text-xl sm:text-2xl font-bold leading-tight text-white tracking-tight text-balance italic">"{currentQ.question}"</h3>
            </div>
         </motion.div>"""

content = re.sub(r'<motion.div key=\{currentQuestionIndex\}.*?</motion.div>', question_card_ui, content, flags=re.DOTALL)

# 5. Fix Review Screen (Issue 14) and ensure it displays all fields
review_ui = """         <AnimatePresence>
            {quizStatus === QUIZ_STATES.REVIEWING && (
               <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mt-8 space-y-6 pb-20">
                  <div className={`p-6 ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-orange-500/10 border-orange-500/20'} rounded-[2.5rem] border flex items-center gap-4 shadow-lg`}>
                     <div className={`w-12 h-12 ${isCorrect ? 'bg-emerald-500' : 'bg-orange-500'} text-white rounded-full flex items-center justify-center shrink-0 shadow-lg`}>{isCorrect ? <CheckCircle2 size={24}/> : <XCircle size={24} />}</div>
                     <div className="text-left">
                        <p className={`text-[10px] font-black uppercase ${isCorrect ? 'text-emerald-400' : 'text-orange-400'} tracking-widest`}>{isCorrect ? 'Mastery Verified' : 'Critical Clinical Correction'}</p>
                        <p className="text-[10px] text-white/40 uppercase font-black mb-1">Correct Answer:</p>
                        <p className="font-black text-white text-lg leading-tight">{currentQ.correctAnswerText}</p>
                     </div>
                  </div>

                  <div className="bg-white/5 rounded-[2.5rem] p-8 border border-white/10 space-y-6 text-left">
                     <div>
                        <p className="text-[10px] font-black uppercase text-indigo-400 mb-2 tracking-widest flex items-center gap-2"><Info size={12} /> Clinical Rationale</p>
                        <p className="font-medium text-sm leading-relaxed text-slate-300 italic">"{currentQ.rationale}"</p>
                     </div>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="p-5 bg-blue-500/5 rounded-2xl border border-blue-500/10">
                           <p className="text-[10px] font-black uppercase text-blue-400 mb-2 tracking-widest">🩺 Clinical Application</p>
                           <p className="text-xs font-bold text-slate-200">{currentQ.clinical_application}</p>
                        </div>
                        <div className="p-5 bg-amber-500/5 rounded-2xl border border-amber-500/10">
                           <p className="text-[10px] font-black uppercase text-amber-500 mb-2 tracking-widest">💡 Simplification</p>
                           <p className="text-xs font-medium text-amber-200/80 leading-relaxed">{currentQ.simplification}</p>
                        </div>
                     </div>
                  </div>
               </motion.div>
            )}
         </AnimatePresence>"""

content = re.sub(r'<AnimatePresence>\s+{quizStatus === QUIZ_STATES.REVIEWING && \(.*?</AnimatePresence>', review_ui, content, flags=re.DOTALL)

with open(file_path, 'w') as f:
    f.write(content)
