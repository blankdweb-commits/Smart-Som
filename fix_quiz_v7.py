import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Fix the broken line 533
broken_pattern = r'<                      <h4'
fixed_pattern = '<h4'
content = content.replace(broken_pattern, fixed_pattern)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
