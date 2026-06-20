import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update OptionButton to support scrollable content and fixed height
option_button_fixed = """const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark, isSpeed }) => {
  const shapes = ['■', '●', '▲', '◆'];
  let baseStyles = dark ? 'bg-white/5 border-white/10 text-white/80' : 'bg-white border-slate-100 text-slate-700';
  if (state === 'selected') baseStyles = dark ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-medical-50 border-medical-500 text-medical-700';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500';
  if (state === 'eliminated') baseStyles = 'opacity-10 grayscale pointer-events-none';

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center p-4 rounded-[2rem] border-2 transition-all duration-300 ${baseStyles} ${isSpeed ? 'h-[150px]' : 'min-h-[80px]'} active:scale-95 overflow-hidden`}
    >
      <div className="flex flex-col items-center gap-2 h-full w-full">
         <span className="text-2xl font-black opacity-40 shrink-0">{shapes[index]}</span>
         <div className="overflow-y-auto w-full custom-scrollbar flex items-center justify-center">
            <p className="font-bold text-center leading-tight text-sm sm:text-base px-2">{label}</p>
         </div>
      </div>
      {pollValue !== undefined && <div className="absolute bottom-2 inset-x-4"><div className="h-1 bg-white/20 rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pollValue}%`}} className="h-full bg-medical-500" /></div><p className="text-[8px] font-black mt-1">{pollValue}%</p></div>}
      {state === 'correct' && <motion.div initial={{scale:0}} animate={{scale:1}} className="absolute right-2 top-2 text-emerald-500 shrink-0"><CheckCircle2 size={24} /></motion.div>}
    </button>
  );
};"""

content = re.sub(r"const OptionButton = \(.*?\}\);", option_button_fixed, content, flags=re.DOTALL)

# 2. Update Rationale Screen to show all normalized fields
review_screen_fixed = """                <div className="max-h-60 overflow-y-auto custom-scrollbar mb-8 space-y-6 text-left">
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
                </div>"""

content = re.sub(r'<div className="max-h-40 overflow-y-auto custom-scrollbar mb-8 text-slate-600 dark:text-slate-300">.*?</div>', review_screen_fixed, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
