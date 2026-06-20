import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# Add SourceBadge to the Review Screen (showRationale modal)
# Find the part where Mastery Confirmed / Learning Opportunity is shown
badge_insertion = """                      <h4 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">{isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}</h4>
                      <div className="mt-4"><SourceBadge source={currentQ.source} /></div>"""

content = content.replace('h4 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight leading-none">{isCorrect ? \'Mastery Confirmed\' : \'Learning Opportunity\'}</h4>', badge_insertion)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
