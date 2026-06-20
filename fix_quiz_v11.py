import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Redesign OptionButton: Compact, 150px max, scrollable, real text
new_option_button = """
const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark, isSpeed }) => {
  const shapes = ['■', '●', '▲', '◆'];
  let baseStyles = dark ? 'bg-white/5 border-white/10 text-white/80' : 'bg-white border-slate-100 text-slate-700';
  if (state === 'selected') baseStyles = dark ? 'bg-amber-500/20 border-amber-500 text-amber-500' : 'bg-medical-50 border-medical-500 text-medical-700';
  if (state === 'correct') baseStyles = 'bg-emerald-500/20 border-emerald-500 text-emerald-500';
  if (state === 'wrong') baseStyles = 'bg-red-500/20 border-red-500 text-red-500';
  if (state === 'eliminated') baseStyles = 'opacity-0 pointer-events-none scale-90 grayscale';

  return (
    <button
      disabled={disabled || state === 'eliminated'}
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center p-4 rounded-3xl border-2 transition-all duration-200 ${baseStyles} ${isSpeed ? 'h-[120px] sm:h-[150px]' : 'min-h-[80px]'} active:scale-95 overflow-hidden shadow-sm`}
    >
      <div className="flex flex-col items-center gap-2 h-full w-full">
         <span className="text-xl font-black opacity-30 shrink-0">{shapes[index]}</span>
         <div className="overflow-y-auto w-full custom-scrollbar flex items-center justify-center">
            <p className="font-bold text-center leading-tight text-xs sm:text-sm px-1">{label}</p>
         </div>
      </div>
      {pollValue !== undefined && <div className="absolute bottom-2 inset-x-4"><div className="h-1 bg-white/20 rounded-full overflow-hidden"><motion.div initial={{width:0}} animate={{width:`${pollValue}%`}} className="h-full bg-medical-500" /></div><p className="text-[8px] font-black mt-1">{pollValue}%</p></div>}
      {state === 'correct' && <motion.div initial={{scale:0}} animate={{scale:1}} className="absolute right-2 top-2 text-emerald-500 shrink-0"><CheckCircle2 size={18} /></motion.div>}
    </button>
  );
};
"""

content = re.sub(r"const OptionButton = \(.*?\}\);", new_option_button, content, flags=re.DOTALL)

# 2. Update Quiz Layout for Immersion: Header, Lifelines at Top
# We need to find the main return block of the Quiz component
# It starts with: return ( <div className={`max-w-4xl mx-auto space-y-6 ...

# Target the header area:
# Replace the current header with a compact one that includes lifelines beside timer/progress
new_immersive_header = """
    <div className={`fixed inset-0 z-[60] bg-white dark:bg-slate-950 flex flex-col ${isSpeed ? 'dark' : ''}`}>
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
              <button disabled={lifelinesUsed.fiftyFifty} onClick={eliminateTwo} className={`p-2 rounded-lg transition-all ${lifelinesUsed.fiftyFifty ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="50/50"><ShuffleIcon size={14} /></button>
              <button disabled={lifelinesUsed.askClass} onClick={askClass} className={`p-2 rounded-lg transition-all ${lifelinesUsed.askClass ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="Poll"><Users size={14} /></button>
              <button disabled={lifelinesUsed.hint} onClick={useMentor} className={`p-2 rounded-lg transition-all ${lifelinesUsed.hint ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="Mentor"><Info size={14} /></button>
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
                disabled={showRationale}
                dark={isSpeed}
                isSpeed={isSpeed}
                pollValue={classPoll ? classPoll[option] : undefined}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Legacy floating elements removal logic would go here, but I'm rewriting the return structure */}
"""

# We need to carefully replace the entire conditional return for when the quiz is active.
# The original code has return blocks for 'selection' and 'showResults' first.
# Then it declares currentQ, isSpeed, etc.
# Then it returns the quiz UI.

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
