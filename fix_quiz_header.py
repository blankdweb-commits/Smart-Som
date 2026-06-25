import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Redesign Header: Student Progress, XP, Animated Progress Bar with Purple Glow
new_header = """
      <div className="p-4 bg-slate-900/40 backdrop-blur-md border-b border-white/10 flex flex-col gap-3 relative">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 shrink-0">
             <span className="text-white opacity-60 text-xs">👤</span>
             <span className="text-white font-black text-xs">{currentQuestionIndex + 1} / {quizQuestions.length}</span>
          </div>

          <div className="flex-1 h-3 bg-white/5 rounded-full overflow-hidden relative shadow-[0_0_15px_rgba(168,85,247,0.2)]">
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
"""

# Match the old top bar block
old_header_pattern = r'<div className="p-4 bg-slate-50.*?</div>\s+</div>'
content = re.sub(old_header_pattern, new_header, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
