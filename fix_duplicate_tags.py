import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Pattern for the duplicate block
pattern = r'<div className="flex items-center justify-center gap-3 mb-4">.*?</span>\s*</div>\s*<span className="text-\[10px\] font-black text-indigo-400/80 uppercase tracking-widest truncate max-w-\[150px\]">\{currentQ\.subject\}</span>\s*</div>'
replacement = r'<div className="flex items-center justify-center gap-3 mb-4">\n                        <span className="text-[12px] font-black text-white/60 uppercase tracking-[0.2em] bg-white/5 px-3 py-1 rounded-lg border border-white/5">Item {String(currentQuestionIndex + 1).padStart(2, "0")}</span>\n                        <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)]"></div>\n                        <span className="text-[12px] font-black text-indigo-300 uppercase tracking-widest">{currentQ.subject}</span>\n                     </div>'

content = re.sub(pattern, replacement, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
