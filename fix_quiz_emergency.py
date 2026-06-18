import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Fix the Unified Timer Effect corruption
# Target: if (quizStarted && !showResults && !showRationale !showRationale &&!showRationale && !isFinalAnswer && (quizMode === 'speed' || useTimer)) {
corrupted_timer = r"if \(quizStarted && !showResults && !showRationale !showRationale &&!showRationale && !isFinalAnswer && \(quizMode === 'speed' \|\| useTimer\)\)"
fixed_timer = "if (quizStarted && !showResults && !showRationale && !isFinalAnswer && (quizMode === 'speed' || useTimer))"
content = re.sub(corrupted_timer, fixed_timer, content)

# 2. Fix the Progress Bar conditional around line 442 (based on content retrieved)
# The user wants:
# {( (quizMode === "clinical" || quizMode === "quick" || quizMode === "subject" || isSpeed) && useTimer && !showRationale && !isFinalAnswer ) && ( ... )}
# Current: {(isSpeed || ((quizMode === 'subject' || quizMode === 'quick') && useTimer)) && !showRationale && (

# Actually, let's just make it robust.
# The user's prompt specifically mentions line ~437 and a very messy string.
# In my `cat` output, line 442 is:
# {(isSpeed || ((quizMode === 'subject' || quizMode === 'quick') && useTimer)) && !showRationale && (

# Let's check for any other mess in the file.
# The user's error string: ... && useTimer)) && !showRationale !showRationale &&!showRationale && !isFinalAnswer && (

messy_pattern = r"!showRationale !showRationale &&!showRationale"
content = content.replace(messy_pattern, "&& !showRationale")

# Clean up any "&& &&" or "!!showRationale" or duplicated "!showRationale"
content = re.sub(r"!showRationale\s+!showRationale", "!showRationale", content)
content = re.sub(r"&&!showRationale", "&& !showRationale", content)
content = re.sub(r"&& &&", "&&", content)

# Let's ensure line 442 is clean
# We want the timer bar to show if: (isSpeed || timer enabled) AND !showRationale AND !isFinalAnswer
clean_ui_timer = "{(isSpeed || ((quizMode === 'subject' || quizMode === 'quick' || quizMode === 'clinical') && useTimer)) && !showRationale && !isFinalAnswer && ("
# Wait, I should see what the actual code is around there.
# Looking at my previous cat output:
# 442: {(isSpeed || ((quizMode === 'subject' || quizMode === 'quick') && useTimer)) && !showRationale && (
# It is missing !isFinalAnswer there to prevent the bar showing while the modal is up.

pattern_ui_bar = r"\{\(isSpeed \|\| \(\(quizMode === 'subject' \|\| quizMode === 'quick'\) && useTimer\)\) && !showRationale && \("
replacement_ui_bar = "{(isSpeed || ((quizMode === 'subject' || quizMode === 'quick' || quizMode === 'clinical') && useTimer)) && !showRationale && !isFinalAnswer && ("
content = re.sub(pattern_ui_bar, replacement_ui_bar, content)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
