import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update the main return block with the Premium Executive Theme background
# Replace <div className={`fixed inset-0 z-[60] bg-white dark:bg-slate-950
old_bg = r'className={`fixed inset-0 z-\[60\] bg-white dark:bg-slate-950'
new_bg = 'className={`fixed inset-0 z-[60] bg-gradient-to-b from-[#1B2343] to-[#0B1020]'

content = re.sub(old_bg, new_bg, content)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
