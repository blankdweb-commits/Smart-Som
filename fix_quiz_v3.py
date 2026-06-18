import re

with open('src/pages/Quiz.jsx', 'r') as f:
    lines = f.readlines()

fixed_lines = []
skip = False
for i, line in enumerate(lines):
    if "const questions = selected.map(card => {" in line:
        fixed_lines.append("    const questions = selected.map(card => {\n")
        fixed_lines.append("      let options;\n")
        fixed_lines.append("      if (card.options && card.options.length > 0) {\n")
        fixed_lines.append("        options = [...card.options].sort(() => 0.5 - Math.random());\n")
        fixed_lines.append("      } else {\n")
        fixed_lines.append("        options = [card.answer, 'Option B', 'Option C', 'Option D'].sort(() => 0.5 - Math.random());\n")
        fixed_lines.append("      }\n")
        fixed_lines.append("      return { ...card, options, correctAnswer: card.answer };\n")
        fixed_lines.append("    });\n")
        skip = True
        continue

    if skip:
        if "setQuizQuestions(questions);" in line:
            fixed_lines.append(line)
            skip = False
        continue

    fixed_lines.append(line)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.writelines(fixed_lines)
