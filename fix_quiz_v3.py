import re

file_path = 'src/pages/Quiz.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# 2. Add sequential hint logic and intelligent mentor clues
# Sequential hints logic: hintLevel state is already there.

mentor_logic = """  const handleUseMentor = () => {
    if (lifelinesUsed.mentor || quizStatus !== QUIZ_STATES.ANSWERING) return;
    const currentQ = quizQuestions[currentQuestionIndex];

    // Intelligent Nursing Tutor Clue
    const clue = currentQ.simplification || "Consider the most immediate patient priority (ABC).";
    const text = `Mentor Insight: ${clue}. I recommend evaluating the option that aligns with clinical safety protocols.`;

    setMentorAdvice({ type: 'Clinical Mentor', text, confidence: 96 });
    setShowHint(true);
    setLifelinesUsed(prev => ({ ...prev, mentor: true }));
  };"""

content = re.sub(r'const handleUseMentor = \(\) => \{.*?\};', mentor_logic, content, flags=re.DOTALL)

# 3. Floating 88px Timer Positioning
timer_ui = """         <div className="relative flex justify-center mb-6">
            <div className={`relative w-[88px] h-[88px] bg-[#1B2343] rounded-full flex items-center justify-center border-[6px] border-[#0F172A] ${isLowPowerMode ? "" : "shadow-xl"} z-20 overflow-hidden`}>
               <svg className="absolute inset-0 w-full h-full -rotate-90 p-1">
                  <circle cx="38" cy="36" r="34" stroke="currentColor" strokeWidth="6" fill="transparent" className={timeLeft < 5 ? 'text-red-500' : 'text-[#FF7A00]'} style={{ strokeDasharray: 214, strokeDashoffset: 214 - (214 * timeLeft) / (isSpeed ? getSpeedTimerValue(currentQuestionIndex) : 30), transition: timeLeft === 30 ? 'none' : 'stroke-dashoffset 1s linear' }} />
               </svg>
               <span className={`text-2xl font-black tabular-nums ${timeLeft < 5 ? "text-red-500 animate-pulse" : "text-white"}`}>{timeLeft}</span>
            </div>
         </div>"""

content = re.sub(r'<div className="relative flex justify-center mb-4">.*?</div>', timer_ui, content, flags=re.DOTALL)

with open(file_path, 'w') as f:
    f.write(content)
