import re

file_path = 'src/pages/Quiz.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Update Header to exactly match design capsules
old_header = r'<div className={`h-\[15vh\] bg-indigo-600 w-full relative transition-colors duration-500 shadow-2xl`}>'
new_header = r'<div className={`h-[12vh] sm:h-[15vh] bg-indigo-600 w-full relative transition-colors duration-500 shadow-xl`}>'
content = content.replace(old_header, new_header)

# 2. Update Progress Capsules
old_capsules = r'<div className="p-4 pt-8 flex items-center justify-between gap-3 max-w-3xl mx-auto">'
new_capsules = r'<div className="p-4 pt-6 flex items-center justify-between gap-3 max-w-2xl mx-auto">'
content = content.replace(old_capsules, new_capsules)

# 3. Update OptionButton for expansion (flex-1)
# Actually, I should update the Options grid to handle expansion if 50/50 is used.
# I'll modify the loop.

# Find the loop over currentQ.options.map
options_loop_start = r'{currentQ.options.map\(\(option, idx\) => \{'
# I want to add a check for eliminated options to decide if we should use flex-1

# This is getting complex for a simple regex. I'll use python's re.sub with a function.

def add_toast_logic(match):
    return """import Toast from '../components/Toast';\n\nconst MOTIVATIONAL_MESSAGES = [
  "One more correct answer restores a lifeline.",
  "You're approaching Clinical Novice.",
  "3-question streak achieved.",
  "Richard's Bank Mastery improving.",
  "Persistence pays off in nursing excellence.",
  "Your clinical judgment is sharpening!"
];\n\n""" + match.group(0)

content = re.sub(r'const Quiz = \(\) => \{', 'const [toast, setToast] = useState(null);\n  const Quiz = () => {', content)
# Wait, that's inside the component. I'll move it properly.

with open(file_path, 'w') as f:
    f.write(content)
