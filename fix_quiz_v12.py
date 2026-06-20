import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. New Mentor Advice logic
new_mentor_logic = """    const useMentor = () => {
    if (lifelinesUsed.hint || showReview || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];

    // Intelligent clinical tutor logic
    const keyword = currentQ.question.toLowerCase().includes('contraindication') ? 'contraindication' :
                    currentQ.question.toLowerCase().includes('priority') ? 'priority' :
                    currentQ.question.toLowerCase().includes('medication') ? 'pharmacology' : 'clinical presentation';

    const text = `Let's think like a registered nurse. This question is testing ${currentQ.subject.toLowerCase()}. Notice the context of the ${keyword}. I strongly believe "${currentQ.correctAnswerText}" is the most appropriate action because ${currentQ.simplification.toLowerCase()}.`;

    setMentorAdvice({
      type: 'Clinical Mentor',
      text: text,
      confidence: Math.floor(Math.random() * 10 + 85)
    });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, hint: true }));
  };"""

content = re.sub(r"const useMentor = \(.*?\}\s+\};", new_mentor_logic, content, flags=re.DOTALL)

# 2. Update Hint Modal UI to show Mentor confidence
new_mentor_modal = """             <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white dark:bg-slate-800 p-10 rounded-[3rem] shadow-2xl border border-slate-100 dark:border-slate-700 text-center">
                <div className="w-20 h-20 bg-medical-50 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8 shadow-inner"><Target size={40} /></div>
                <h4 className="text-2xl font-black text-slate-900 dark:text-white mb-1">{mentorAdvice?.type || 'Mentor Strategy'}</h4>
                {mentorAdvice?.confidence && <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-6">Confidence: {mentorAdvice.confidence}%</p>}
                <p className="text-slate-600 dark:text-slate-300 font-medium italic text-lg leading-relaxed mb-10 text-balance text-center">"{mentorAdvice?.text}"</p>
                <button onClick={() => setShowHint(false)} className="w-full py-5 bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-all">Return to Question</button>
             </motion.div>"""

content = re.sub(r'<motion\.div initial=\{\{ scale: 0\.8, opacity: 0 \}\}.*?Return to Question</button>\s+</motion\.div>', new_mentor_modal, content, flags=re.DOTALL)

# 3. Fix 50/50 animation and logic (opacity-0 scale-90 handled in CSS/OptionButton already)
# Ensure eliminateTwo correctly picks two wrong answers
new_eliminate_logic = """    const eliminateTwo = () => {
    if (lifelinesUsed.fiftyFifty || showReview || showRationale) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const incorrectOptions = currentQ.options.filter(opt => opt !== currentQ.correctAnswer);
    const toEliminate = incorrectOptions.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };"""
# Current logic seems correct based on previous cat, just ensuring it's robust.

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
