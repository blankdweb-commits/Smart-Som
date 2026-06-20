import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

weighting_logic = """    // Prioritization for Speed Mode (70% Richard's Bank, 15% NMCN, 10% NCLEX, 5% Apex)
    if (mode === 'speed') {
       const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
       const nmcn = pool.filter(c => c.source?.toLowerCase().includes('nmcn') || c.category === 'NMCN');
       const nclex = pool.filter(c => c.source?.toLowerCase().includes('nclex') || c.category === 'NCLEX');
       const apex = pool.filter(c => !richard.includes(c) && !nmcn.includes(c) && !nclex.includes(c));

       richard.sort(() => 0.5 - Math.random());
       nmcn.sort(() => 0.5 - Math.random());
       nclex.sort(() => 0.5 - Math.random());
       apex.sort(() => 0.5 - Math.random());

       const limit = 15;
       const rCount = Math.min(11, richard.length);
       const nmCount = Math.min(2, nmcn.length);
       const ncCount = Math.min(1, nclex.length);
       const aCount = limit - (rCount + nmCount + ncCount);

       pool = [
         ...richard.slice(0, rCount),
         ...nmcn.slice(0, nmCount),
         ...nclex.slice(0, ncCount),
         ...apex.slice(0, Math.max(0, aCount))
       ];
       pool = pool.sort(() => 0.5 - Math.random());
    }"""

content = re.sub(r"// Prioritization for Speed Mode \(70% Richard's Bank\).*?\}\s+const seen", weighting_logic + "\n\n    const seen", content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
