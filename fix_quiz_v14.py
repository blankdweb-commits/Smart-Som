import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update lifelinesUsed state
content = content.replace(
    "lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false });",
    "lifelinesUsed, setLifelinesUsed] = useState({ hint: false, mentor: false, fiftyFifty: false, askClass: false });"
)

# 2. Update initQuiz to reset all 4 lifelines
content = content.replace(
    "setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });",
    "setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });"
)

# 3. Update confirmAnswer to restore all 4 lifelines
content = content.replace(
    "setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });",
    "setLifelinesUsed({ hint: false, mentor: false, fiftyFifty: false, askClass: false });"
)

# 4. Implement useHint function
use_hint_func = """
  const useHint = () => {
    if (lifelinesUsed.hint || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const hintText = (currentQ.hints && currentQ.hints.length > 0) ? currentQ.hints[0] : currentQ.simplification;
    setMentorAdvice({ type: 'Quick Hint', text: hintText });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, hint: true }));
  };

  const useMentor = () => {
    if (lifelinesUsed.mentor || showRationale) return;
"""

content = content.replace("const useMentor = () => {", use_hint_func)
content = content.replace("setLifelinesUsed(prev => ({ ...prev, hint: true }));", "setLifelinesUsed(prev => ({ ...prev, mentor: true }));")

# 5. Update Top Bar UI to show 4 lifelines
new_lifelines_ui = """
           <div className="flex items-center gap-1">
              <button disabled={lifelinesUsed.fiftyFifty || showRationale} onClick={eliminateTwo} className={`p-2 rounded-lg transition-all ${lifelinesUsed.fiftyFifty ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="50/50"><ShuffleIcon size={14} /></button>
              <button disabled={lifelinesUsed.askClass || showRationale} onClick={askClass} className={`p-2 rounded-lg transition-all ${lifelinesUsed.askClass ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="Poll"><Users size={14} /></button>
              <button disabled={lifelinesUsed.mentor || showRationale} onClick={useMentor} className={`p-2 rounded-lg transition-all ${lifelinesUsed.mentor ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="Mentor"><Shield size={14} /></button>
              <button disabled={lifelinesUsed.hint || showRationale} onClick={useHint} className={`p-2 rounded-lg transition-all ${lifelinesUsed.hint ? 'opacity-20' : 'bg-white dark:bg-white/10 text-medical-600 shadow-sm'}`} title="Hint"><Zap size={14} /></button>
           </div>
"""

# Match the 3-button block
old_lifelines_pattern = r'<div className="flex items-center gap-1">.*?<Users size=\{14\} />.*<Info size=\{14\} />.*</div>'
content = re.sub(old_lifelines_pattern, new_lifelines_ui, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
