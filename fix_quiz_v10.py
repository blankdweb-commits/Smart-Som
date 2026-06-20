import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update Weighting: 70% Richard, 20% NMCN, 10% NCLEX/Apex
new_weighting = """    // Prioritization for Speed Mode (70% Richard's Bank, 20% NMCN, 10% NCLEX/Apex)
    if (mode === 'speed') {
       const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
       const nmcn = pool.filter(c => c.source?.toLowerCase().includes('nmcn') || c.category === 'NMCN');
       const others = pool.filter(c => !richard.includes(c) && !nmcn.includes(c));

       richard.sort(() => 0.5 - Math.random());
       nmcn.sort(() => 0.5 - Math.random());
       others.sort(() => 0.5 - Math.random());

       const limit = 15;
       const rCount = Math.min(Math.ceil(limit * 0.7), richard.length);
       const nmCount = Math.min(Math.ceil(limit * 0.2), nmcn.length);
       const oCount = limit - (rCount + nmCount);

       pool = [
         ...richard.slice(0, rCount),
         ...nmcn.slice(0, nmCount),
         ...others.slice(0, Math.max(0, oCount))
       ];
       // Final shuffle of the selection to mix sources
       pool = pool.sort(() => 0.5 - Math.random());
    }"""

# Use a regex that matches the existing weighting block
content = re.sub(r"// Prioritization for Speed Mode.*?\}", new_weighting, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
