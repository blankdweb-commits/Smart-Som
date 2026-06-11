import sys

with open('src/pages/Quiz.jsx', 'r') as f:
    lines = f.readlines()

# We need to find the point where the file gets corrupted.
# It seems around the second "if (quizMode === 'mastery_select')"

new_lines = []
skip = False
for i, line in enumerate(lines):
    if i == 18: # After state declarations
        new_lines.append(line)
        new_lines.append("  const currentQ = quizQuestions[currentQuestionIndex];\n")
        continue

    if "if (quizMode === 'mastery_select') {" in line and i > 300:
        skip = True
        continue

    if skip:
        if "if (quizStarted && !currentQ) {" in line:
            skip = False
            # Fall through to append this line
        else:
            continue

    new_lines.append(line)

# Clean up the end of the file
# Remove the extra closing brace before export
final_lines = []
brace_count = 0
for line in new_lines:
    if "export default Quiz;" in line:
        break
    final_lines.append(line)

# Now we need to make sure the last line of the component is just "};"
# And then "export default Quiz;"
# The OptionButton etc should be OUTSIDE the Quiz component.

# Let's just rewrite the whole file with a cleaner structure to be safe.
