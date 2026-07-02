with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

import re

# Update combined.map to filter Boolean (nulls) and check for enough questions
# Logic to ensure we don't start with 0 questions if many are filtered out
old_init_part = '    const questions = combined.map(q => {\n      const n = normalizeQuestion(q);\n      if (!n) return null;\n      return { ...n, options: [...n.options].sort(() => 0.5 - Math.random()) };\n    }).filter(Boolean);'

# Finding the section that sets the question limit to handle filtered-out items
# Actually, it's better to filter the pool BEFORE taking the slice.

start_pattern = r"const initQuiz = \(mode, subjectFilter = null\) => \{"
end_marker = "const questions = combined.map"

match = re.search(start_pattern, content)
if match:
    start_pos = match.end()
    end_pos = content.find(end_marker)

    new_init_logic = r"""
    let pool = [...flashcards].filter(c => {
        const n = normalizeQuestion(c);
        return n !== null;
    });

    if (mode === 'revision' && learningAnalytics?.recommendedRevision?.length > 0) {
        pool = learningAnalytics.recommendedRevision.filter(c => normalizeQuestion(c) !== null);
    }

    if (subjectFilter) pool = pool.filter(c => c.subject === subjectFilter);
    if (pool.length === 0) {
        setToast({ message: "No verified clinical items found for this selection.", type: 'error' });
        setQuizStatus(QUIZ_STATES.SELECTION);
        return;
    }

    const richard = pool.filter(c => String(c.id).includes('richard') || (c.source && c.source.toLowerCase().includes('richard')));

    let combined = [];
    const limit = (mode === 'speed' || mode === 'quick' || mode === 'revision') ? 10 : (mode === 'subject' || mode === 'clinical' || mode === 'mock' ? Math.min(pool.length, questionLimit) : questionLimit);

    if (mode === 'speed') {
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
    }
"""
    # Replace the section between start_pos and end_pos
    final_content = content[:start_pos] + new_init_logic + "\n    " + content[end_pos:]
    with open('src/pages/Quiz.jsx', 'w') as f:
        f.write(final_content)
    print('Updated initQuiz with pre-filtering.')
else:
    print('initQuiz not found.')
