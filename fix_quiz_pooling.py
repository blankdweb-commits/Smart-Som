import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update normalizeQuestion to support all metadata
normalize_func = """
const normalizeQuestion = (q) => {
  let options = [];
  if (q.options && Array.isArray(q.options) && q.options.length > 0) {
    options = [...q.options];
  } else if (q.option_a) {
    options = [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean);
  }

  if (options.length === 0) {
    const fallbackAns = q.answer || q.correct_answer_text || "Consult medical protocol";
    options = [fallbackAns, "Increase monitoring of vital signs", "Document findings", "Perform head-to-toe assessment"];
  }

  const correctText = q.answer || q.correct_answer_text || q.correct_answer || options[0];

  return {
    ...q,
    id: q.id || Math.random().toString(36).substr(2, 9),
    subject: q.subject || 'General Nursing',
    source: q.source || 'Apex Scholars Core Bank',
    question: q.question || "Question text unavailable.",
    options: options,
    correctAnswer: correctText,
    correctAnswerText: correctText,
    rationale: q.rationale || q.explanation || "Clinical judgment and patient safety protocols guide this nursing intervention.",
    clinical_application: q.clinical_application || q.clinicalApplication || "Apply the ABC framework to prioritize patient care.",
    simplification: q.simplification || "Focus on the intervention that addresses the most immediate threat to patient stability.",
    hints: q.hints || (q.hint ? [q.hint] : ["Think about the most prioritized nursing action in this scenario."])
  };
};
"""

content = re.sub(r"const normalizeQuestion = \(q\) => \{.*?\};", normalize_func, content, flags=re.DOTALL)

# 2. Update initQuiz to use only Richard and NMCN (70/30)
# and remove Apex Core from generation.
pooling_logic = """    // Exclusive pooling: Only Richard's Bank and NMCN
    const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
    const nmcn = pool.filter(c => c.source?.toLowerCase().includes('nmcn') || c.category === 'NMCN');

    // Weighted combination for all modes as requested (70/30)
    richard.sort(() => 0.5 - Math.random());
    nmcn.sort(() => 0.5 - Math.random());

    const limit = mode === 'speed' ? 15 : questionLimit;
    const rCount = Math.min(Math.ceil(limit * 0.7), richard.length);
    const nmCount = limit - rCount;

    const combinedPool = [
      ...richard.slice(0, rCount),
      ...nmcn.slice(0, Math.max(0, nmCount))
    ];

    // Final shuffle and unique check
    const uniquePool = combinedPool.filter((c, i, s) => s.findIndex(t => t.question === c.question) === i);
    const finalSelection = uniquePool.sort(() => 0.5 - Math.random());

    const questions = finalSelection.map(q => {
       const n = normalizeQuestion(q);
       return { ...n, options: [...n.options].sort(() => 0.5 - Math.random()) };
    });

    setQuizQuestions(questions);"""

# Replace the block from "if (mode === 'speed')" to "setQuizQuestions(questions);"
pattern = r"if \(mode === 'speed'\) \{.*?setQuizQuestions\(questions\);"
content = re.sub(pattern, pooling_logic, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
