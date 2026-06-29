import sys

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

old_logic = """    if (mode === 'speed') {
      const shuffledRichard = [...richard].sort(() => 0.5 - Math.random());
      const nmcnPool = pool.filter(c => !String(c.id).includes('richard') && !(c.source && c.source.toLowerCase().includes('richard')));
      const shuffledNmcn = [...nmcnPool].sort(() => 0.5 - Math.random());
      const rCount = Math.min(Math.ceil(limit * 0.7), shuffledRichard.length);
      combined = [...shuffledRichard.slice(0, rCount), ...shuffledNmcn.slice(0, Math.max(0, limit - rCount))];
    } else if (mode === 'mock') {
        const shuffledRichard = [...richard].sort(() => 0.5 - Math.random());
        const nmcnPool = pool.filter(c => !String(c.id).includes('richard'));
        const shuffledNmcn = [...nmcnPool].sort(() => 0.5 - Math.random());
        const half = Math.floor(limit / 2);
        combined = [...shuffledRichard.slice(0, half), ...shuffledNmcn.slice(0, limit - half)];
    } else {
        combined = [...pool].sort(() => 0.5 - Math.random()).slice(0, limit);
    }"""

new_logic = """    if (mode === 'speed') {
      const shuffledRichard = [...richard].sort(() => 0.5 - Math.random());
      const nmcnPool = pool.filter(c => !String(c.id).includes('richard') && !(c.source && c.source.toLowerCase().includes('richard')));
      const shuffledNmcn = [...nmcnPool].sort(() => 0.5 - Math.random());
      const rCount = Math.min(Math.ceil(limit * 0.7), shuffledRichard.length);
      combined = [...shuffledRichard.slice(0, rCount), ...shuffledNmcn.slice(0, Math.max(0, limit - rCount))];
    } else if (mode === 'mock') {
        const shuffledRichard = [...richard].sort(() => 0.5 - Math.random());
        const nmcnPool = pool.filter(c => !String(c.id).includes('richard'));
        const shuffledNmcn = [...nmcnPool].sort(() => 0.5 - Math.random());
        const half = Math.floor(limit / 2);
        combined = [...shuffledRichard.slice(0, half), ...shuffledNmcn.slice(0, limit - half)];
    } else if (mode === 'revision') {
        const highYield = pool.filter(c =>
            String(c.id).includes('richard') ||
            String(c.id).includes('nclex') ||
            (c.source && (c.source.toLowerCase().includes('richard') || c.source.toLowerCase().includes('nclex')))
        );
        combined = [...highYield].sort(() => 0.5 - Math.random()).slice(0, limit);
        if (combined.length < limit) {
             const others = pool.filter(c => !highYield.includes(c)).sort(() => 0.5 - Math.random());
             combined = [...combined, ...others].slice(0, limit);
        }
    } else {
        combined = [...pool].sort(() => 0.5 - Math.random()).slice(0, limit);
    }"""

if old_logic in content:
    with open('src/pages/Quiz.jsx', 'w') as f:
        f.write(content.replace(old_logic, new_logic))
    print('Refined Revision Challenge logic.')
else:
    print('Could not find old_logic exactly. Checking for partial match...')
    # It might be due to line breaks or minor spacing diffs from the previous cat
    # I will try a more robust replacement
    import re
    # Just finding the initQuiz block and replacing the if/else chain
    start_match = re.search(r"if \(mode === 'speed'\) \{", content)
    end_match = re.search(r"combined = \[\.\.\.pool\]\.sort\(\(\) => 0\.5 - Math\.random\(\)\)\.slice\(0, limit\);", content)
    if start_match and end_match:
        # Reconstruct the section
        prefix = content[:start_match.start()]
        suffix = content[end_match.end():]
        # Need to find the closing brace of the last else
        brace_pos = suffix.find('}')
        suffix = suffix[brace_pos+1:]

        final_content = prefix + new_logic + suffix
        with open('src/pages/Quiz.jsx', 'w') as f:
            f.write(final_content)
        print('Refined Revision Challenge logic via regex.')
    else:
        print('Failed to find targets.')
