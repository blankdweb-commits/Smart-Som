with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

import re
# Simplify the timer condition
content = re.sub(
    r"if \(quizStarted && !showResults && !showRationale .*? && \(quizMode === 'speed' \|\| useTimer\)\)",
    "if (quizStarted && !showResults && !showRationale && !isFinalAnswer && (quizMode === 'speed' || useTimer))",
    content
)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
