import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update getSpeedTimerValue to use streak
content = content.replace(
    "const getSpeedTimerValue = (index) => {\n  if (index < 5) return 20;\n  if (index < 10) return 18;\n  return 15;\n};",
    "const getSpeedTimerValue = (streak) => {\n  if (streak < 3) return 20;\n  if (streak < 6) return 18;\n  if (streak < 10) return 15;\n  return 12;\n};"
)

# 2. Update initQuiz to use consecutiveCorrect for timer
content = content.replace(
    "setTimeLeft(mode === 'speed' ? getSpeedTimerValue(0) : 30);",
    "setTimeLeft(mode === 'speed' ? getSpeedTimerValue(consecutiveCorrect) : 30);"
)

# 3. Update nextQuestion to use consecutiveCorrect for timer
content = content.replace(
    "setTimeLeft(quizMode === 'speed' ? getSpeedTimerValue(nextIdx) : 30);",
    "setTimeLeft(quizMode === 'speed' ? getSpeedTimerValue(consecutiveCorrect) : 30);"
)

# 4. Add Achievement Badge to the Header UI
# Find student progress div and add badge after it
achievement_badge = """
          <div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 shrink-0">
             <span className="text-white opacity-60 text-xs">👤</span>
             <span className="text-white font-black text-xs">{currentQuestionIndex + 1} / {quizQuestions.length}</span>
          </div>

          <AnimatePresence mode="wait">
            {isSpeed && (
              <motion.div
                key={currentMilestone}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="px-3 py-1 bg-indigo-500/20 rounded-full border border-indigo-500/30 shrink-0"
              >
                 <p className="text-indigo-400 font-black text-[9px] uppercase tracking-widest">{currentMilestone}</p>
              </motion.div>
            )}
          </AnimatePresence>
"""

content = content.replace(
    '<div className="flex items-center gap-2 px-3 py-1 bg-white/5 rounded-full border border-white/10 shrink-0"><span className="opacity-60 text-xs">👤</span><span className="font-black text-xs">{currentQuestionIndex + 1} / {quizQuestions.length}</span></div>',
    achievement_badge
)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
