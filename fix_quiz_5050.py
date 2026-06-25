import re

file_path = 'src/pages/Quiz.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Update OptionButton to be larger (48px+ touch target is already there but let's enhance)
# 2. Update Options layout to expand if 50/50 is used

# Find the options map
# We want to change the grid/flex behavior
old_options_container = r'<div className="space-y-4">'
new_options_container = r'<div className={`flex flex-col gap-4 ${eliminatedOptions.length > 0 ? "min-h-[300px]" : ""}`}>\n            {/* Expandable Options Layout */}'
content = content.replace(old_options_container, new_options_container)

# Change motion.div in the loop to use flex-1 if few options remain
old_loop_item = r'<motion.div key=\{idx\} initial=\{\{ opacity: 0, y: 10 \}\} animate=\{\{ opacity: 1, y: 0 \}\} layout transition=\{\{ duration: 0.3 \}\}>'
new_loop_item = r'<motion.div key={idx} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} layout transition={{ duration: 0.3 }} className={eliminatedOptions.length > 0 ? "flex-1" : ""}>'
content = content.replace(old_loop_item, new_loop_item)

# Ensure OptionButton inside takes full height if flex-1 is used
content = content.replace('className={`relative flex items-center justify-between w-full p-6', 'className={`relative flex items-center justify-between w-full h-full p-6')

with open(file_path, 'w') as f:
    f.write(content)
