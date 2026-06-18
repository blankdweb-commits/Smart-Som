import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. 70% Richard's Bank weighting in Speed Challenge
weighting_logic = """    // Prioritization for Speed Mode (70% Richard's Bank)
    if (mode === 'speed') {
       const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
       const others = pool.filter(c => !c.source?.toLowerCase().includes('richard'));

       richard.sort(() => 0.5 - Math.random());
       others.sort(() => 0.5 - Math.random());

       const limit = 15;
       const richardCount = Math.min(Math.ceil(limit * 0.7), richard.length);
       const othersCount = limit - richardCount;

       pool = [...richard.slice(0, richardCount), ...others.slice(0, othersCount)];
    }"""

content = re.sub(r"// Prioritization for Speed Mode.*?\}", weighting_logic, content, flags=re.DOTALL)

# 2. Lifeline Restoration (Every 5 correct answers)
# Find consecutiveCorrect logic
restoration_logic = """    if (newStreak % 5 === 0 && newStreak > 0) {
      setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });
      setConsecutiveCorrect(newStreak);
    }"""

# Update confirmAnswer logic for lifeline restoration
if "setConsecutiveCorrect(newStreak);" in content:
    content = content.replace("setConsecutiveCorrect(newStreak);", restoration_logic)

# 3. Walk Away motivational prompts
prompts = """    const prompts = [
      "Future patients are counting on your preparation.",
      "One more question could strengthen the knowledge that saves a life.",
      "Growth happens when you push beyond discomfort.",
      "Persistence is the hallmark of a great healthcare professional.",
      "Your clinical judgment is sharpening with every answer.",
      "Don't stop now—mastery is just a few challenges away."
    ];"""

content = re.sub(r"const prompts = \[.*?\];", prompts, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
