import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Add the correct answer display to the review screen
review_insertion = """                <div className="max-h-60 overflow-y-auto custom-scrollbar mb-8 space-y-6 text-left">
                   <div className="p-5 bg-emerald-50 dark:bg-emerald-900/20 rounded-[2rem] border-2 border-emerald-200 dark:border-emerald-800/50 flex items-center gap-4">
                      <div className="w-12 h-12 bg-emerald-500 text-white rounded-full flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20"><CheckCircle2 size={24}/></div>
                      <div>
                         <p className="text-[10px] font-black uppercase text-emerald-600 dark:text-emerald-400 tracking-widest">Correct Answer</p>
                         <p className="font-black text-slate-900 dark:text-white leading-tight">{currentQ.correctAnswerText}</p>
                      </div>
                   </div>
                   <div><p className="text-[10px] font-black uppercase text-slate-400 mb-1 tracking-widest">✔ Clinical Rationale</p><p className="font-medium text-sm leading-relaxed italic text-slate-600 dark:text-slate-300">{currentQ.rationale}</p></div>"""

# Replace the rationale-only part with the enhanced display
content = re.sub(r'<div className="max-h-60 overflow-y-auto custom-scrollbar mb-8 space-y-6 text-left">.*?<div><p className="text-\[10px\] font-black uppercase text-slate-400 mb-1">✔ Rationale</p>', review_insertion, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
