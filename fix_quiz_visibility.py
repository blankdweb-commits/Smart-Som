import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update Question Card Header (Badge + Lifelines)
replace_header = """<div className="flex flex-col items-center gap-4 mb-6">
                     <SourceBadge source={currentQ.source} />
                     <div className="flex items-center justify-center gap-3 py-2 px-4 bg-white/5 rounded-2xl border border-white/5">
                        <button disabled={lifelinesUsed.hint} onClick={handleUseHint} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/20 transition-all ${lifelinesUsed.hint ? "opacity-20 grayscale" : "active:scale-95"}`} title="Hint"><Zap size={20} className="text-orange-400" /></button>
                        <button disabled={lifelinesUsed.fiftyFifty} onClick={handleEliminateTwo} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition-all ${lifelinesUsed.fiftyFifty ? "opacity-20 grayscale" : "active:scale-95"}`} title="50/50"><Shuffle size={20} className="text-white" /></button>
                        <button disabled={lifelinesUsed.askClass} onClick={handleAskClass} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 transition-all ${lifelinesUsed.askClass ? "opacity-20 grayscale" : "active:scale-95"}`} title="Poll"><Users size={20} className="text-white" /></button>
                        <button disabled={lifelinesUsed.mentor} onClick={handleUseMentor} className={`w-12 h-12 flex items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 hover:bg-blue-500/20 transition-all ${lifelinesUsed.mentor ? "opacity-20 grayscale" : "active:scale-95"}`} title="Mentor"><Shield size={20} className="text-blue-400" /></button>
                     </div>
                  </div>"""

content = re.sub(r'<div className="flex flex-col sm:flex-row justify-between items-center gap-6 mb-8">.*?<SourceBadge source=\{currentQ\.source\} />.*?<div className="flex items-center gap-2">.*?</div>.*?</div>', replace_header, content, flags=re.DOTALL)

# 2. Update Question Text and Metadata
replace_metadata = """<div className="flex items-center justify-center gap-3 mb-4">
                        <span className="text-[12px] font-black text-white/60 uppercase tracking-[0.2em] bg-white/5 px-3 py-1 rounded-lg border border-white/5">Item {String(currentQuestionIndex + 1).padStart(2, '0')}</span>
                        <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>
                        <span className="text-[12px] font-black text-indigo-300 uppercase tracking-widest">{currentQ.subject}</span>
                     </div>"""

content = re.sub(r'<div className="flex items-center justify-center gap-2 mb-2">.*?Item.*?</div>', replace_metadata, content, flags=re.DOTALL)

# 3. Update h2 Question Text
replace_p = """<p className="text-xl sm:text-2xl font-black leading-tight text-white tracking-tight text-center px-2" style={{ display: "block", visibility: "visible", opacity: 1 }}>{currentQ.question || "Clinical data synchronized. Analyzing case..."}</p>"""

content = re.sub(r'<h2 className="text-xl sm:text-2xl font-bold leading-tight text-white tracking-tight italic block w-full".*?</h2>', replace_p, content)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
