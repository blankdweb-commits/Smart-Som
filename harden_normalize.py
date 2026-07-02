import sys

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# We want to replace the part between 'try {' and 'let options = [];'
import re

start_marker = 'const normalizeQuestion = (q) => {\n  if (!q) return null;\n  try {'
end_marker = '    let options = [];'

start_pos = content.find(start_marker)
end_pos = content.find(end_marker)

if start_pos != -1 and end_pos != -1:
    new_logic = r"""
    // Definitive Extraction Chain
    let questionText = q.question || q.text || q.front || q.title || q.prompt || q.q || q.item || "";

    // Support nested data structures from bulk imports
    if (!questionText && q.data) {
        questionText = q.data.question || q.data.text || q.data.item || "";
    }

    // Force string and trim
    questionText = String(questionText).trim();
"""
    # Replace the section
    final_content = content[:start_pos + len(start_marker)] + new_logic + content[end_pos:]
    with open('src/pages/Quiz.jsx', 'w') as f:
        f.write(final_content)
    print('Normalization logic hardened.')
else:
    print(f'Markers not found: start={start_pos}, end={end_pos}')
