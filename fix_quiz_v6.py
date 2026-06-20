import re

with open('src/pages/Quiz.jsx', 'r') as f:
    lines = f.readlines()

# 1. Define normalizeQuestion outside of the component or at the top
normalize_func = """
const normalizeQuestion = (q) => {
  const normalized = {
    id: q.id,
    subject: q.subject || 'General Nursing',
    source: q.source || 'Apex Scholars Core Bank',
    question: q.question,
    options: [],
    correctAnswer: '',
    rationale: q.rationale || q.explanation || "Nurses must apply critical thinking and clinical protocols to ensure patient safety and prioritize airway, breathing, and circulation.",
    clinical_application: q.clinical_application || q.clinicalApplication || "Apply standard nursing precautions and prioritize interventions based on patient stability and acuity.",
    simplification: q.simplification || "Focus on the most direct nursing action that addresses the physiological root cause of the presentation.",
    hint: q.hint || (Array.isArray(q.hints) ? q.hints[0] : q.hints) || "Consider the primary physiological priority and the intervention that ensures long-term clinical stability."
  };

  if (q.options && Array.isArray(q.options) && q.options.length > 0) {
    normalized.options = [...q.options];
    normalized.correctAnswer = q.answer || q.correct_answer_text || q.correct_answer;
  } else if (q.option_a) {
    normalized.options = [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean);
    normalized.correctAnswer = q.answer || q.correct_answer_text;
  } else {
    const distractors = [
      "Increase the frequency of vital sign monitoring",
      "Document the clinical findings and notify the charge nurse",
      "Review the patient's medical history for relevant comorbidities",
      "Implement standard safety precautions and continue assessment"
    ];
    normalized.options = [q.answer, ...distractors.slice(0, 3)];
    normalized.correctAnswer = q.answer;
  }

  if (!normalized.options.includes(normalized.correctAnswer)) {
    normalized.options[0] = normalized.correctAnswer;
  }

  normalized.options = normalized.options.sort(() => Math.random() - 0.5);
  return normalized;
};

"""

# Find a good place to insert - after the ACHIEVEMENTS/MILESTONES
insert_idx = 0
for i, line in enumerate(lines):
    if "const MILESTONES =" in line:
        # find end of milestones
        j = i
        while "];" not in lines[j]:
            j += 1
        insert_idx = j + 1
        break

lines.insert(insert_idx, normalize_func)

# 2. Update initQuiz to use 70% Richard weighting and normalize
# Looking for initQuiz logic in the original file
content = "".join(lines)

weighting_normalization_logic = """    // Prioritization for Speed Mode (70% Richard's Bank)
    if (mode === 'speed') {
       const richard = pool.filter(c => c.source?.toLowerCase().includes('richard'));
       const others = pool.filter(c => !c.source?.toLowerCase().includes('richard'));

       richard.sort(() => 0.5 - Math.random());
       others.sort(() => 0.5 - Math.random());

       const limit = 15;
       const richardCount = Math.min(Math.ceil(limit * 0.7), richard.length);
       const othersCount = limit - richardCount;

       pool = [...richard.slice(0, richardCount), ...others.slice(0, othersCount)];
    }

    const seen = new Set();
    const uniquePool = pool.filter(c => seen.has(c.question) ? false : seen.add(c.question));

    const limit = mode === 'speed' ? 15 : questionLimit;
    const shuffled = uniquePool.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(limit, uniquePool.length));

    const questions = selected.map(q => normalizeQuestion(q));
    setQuizQuestions(questions);"""

# Replace the old initQuiz pool/shuffling logic
# Pattern matches from "let pool =" to "setQuizQuestions(questions);"
pattern = r"let pool = \[.*?setQuizQuestions\(questions\);"
content = re.sub(pattern, "let pool = [...flashcards];\n    if (subjectFilter) {\n      pool = pool.filter(c => c.subject === subjectFilter);\n    }\n    if (pool.length === 0) return;\n\n" + weighting_normalization_logic, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
