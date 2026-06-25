import re

file_path = 'src/pages/Quiz.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# Add Skeleton Component
skeleton_code = """const QuestionSkeleton = () => (
  <div className="w-full max-w-3xl mx-auto space-y-6 animate-pulse">
    <div className="bg-[#1B2343] rounded-[2.5rem] p-10 h-64 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full animate-[shimmer_2s_infinite]"></div>
      <div className="w-32 h-4 bg-white/10 rounded-full mb-8"></div>
      <div className="w-full h-8 bg-white/10 rounded-lg mb-4"></div>
      <div className="w-2/3 h-8 bg-white/10 rounded-lg"></div>
    </div>
    <div className="space-y-4">
      {[1, 2, 3, 4].map(i => (
        <div key={i} className="bg-[#1B2343] rounded-[2rem] h-20 border border-white/5"></div>
      ))}
    </div>
  </div>
);"""

if "QuestionSkeleton" not in content:
    content = content.replace('const Quiz = () => {', skeleton_code + '\n\nconst Quiz = () => {')

# Use Skeleton when currentQ is missing during gameplay
loading_ui = """  if (!currentQ && quizStatus !== QUIZ_STATES.SELECTION && quizStatus !== QUIZ_STATES.RESULTS) {
    return (
      <div className="fixed inset-0 z-[60] bg-[#0F172A] flex flex-col items-center justify-center p-6">
        <QuestionSkeleton />
      </div>
    );
  }"""

content = re.sub(r'if \(!currentQ\) \{.*?\}', loading_ui, content, flags=re.DOTALL)

# Add custom shimmer animation to index.css if needed, but I'll add it inline via tailwind if possible
# Shimmer is usually custom. I'll add a style tag to Quiz.jsx for safety.

style_tag = """<style>{`
  @keyframes shimmer {
    100% { transform: translateX(100%); }
  }
`}</style>"""

content = content.replace('    <div className={`fixed inset-0 z-[60] bg-[#0F172A] flex flex-col text-white overflow-hidden`}>', '    <div className={`fixed inset-0 z-[60] bg-[#0F172A] flex flex-col text-white overflow-hidden`}>\n      ' + style_tag)

with open(file_path, 'w') as f:
    f.write(content)
