import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Improve OptionButton scrolling for long text
# Replace the centered div with one that handles overflow better
old_div = r'<div className="overflow-y-auto w-full custom-scrollbar flex items-center justify-center">'
new_div = '<div className="overflow-y-auto w-full custom-scrollbar flex flex-col justify-start items-center" style={{ maxHeight: "calc(100% - 40px)" }}>'

content = content.replace(old_div, new_div)

# Ensure the p tag doesn't have alignment issues when scrolling
content = content.replace('p className="font-bold text-center leading-tight text-sm sm:text-base px-2"', 'p className="font-bold text-center leading-tight text-sm sm:text-base px-2 py-2"')

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
