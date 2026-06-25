import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Update XP multiplier thresholds to 3, 5, 10
content = content.replace(
    "newCombo >= 8 ? 5 : (newCombo >= 5 ? 3 : (newCombo >= 3 ? 2 : 1))",
    "newCombo >= 10 ? 5 : (newCombo >= 5 ? 3 : (newCombo >= 3 ? 2 : 1))"
)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
