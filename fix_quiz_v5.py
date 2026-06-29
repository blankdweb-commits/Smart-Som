with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Fix the Unified Timer Effect to include !isFinalAnswer
# 114: if (quizStarted && !showResults && !showRationale && (quizMode === 'speed' || useTimer)) {
content = content.replace(
    "if (quizStarted && !showResults && !showRationale && (quizMode === 'speed' || useTimer)) {",
    "if (quizStarted && !showResults && !showRationale && !isFinalAnswer && (quizMode === 'speed' || useTimer)) {"
)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
