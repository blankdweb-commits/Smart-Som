import re

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

normalize_code = """
const normalizeQuestion = (q) => {
  // Extract options based on available schema
  let options = [];
  if (q.options && Array.isArray(q.options) && q.options.length > 0) {
    options = [...q.options];
  } else if (q.option_a) {
    options = [q.option_a, q.option_b, q.option_c, q.option_d].filter(Boolean);
  }

  // Handle missing options with generic medical distractors if necessary
  if (options.length === 0) {
    const fallbackAns = q.answer || q.correct_answer_text || "Consult medical protocol";
    options = [
      fallbackAns,
      "Increase monitoring of vital signs",
      "Document findings and notify supervisor",
      "Perform a full head-to-toe assessment"
    ];
  }

  // Determine correct answer text
  const correctText = q.answer || q.correct_answer_text || q.correct_answer || options[0];

  return {
    id: q.id || Math.random().toString(36).substr(2, 9),
    subject: q.subject || 'General Nursing',
    source: q.source || 'Apex Scholars Core Bank',
    question: q.question || "Question text unavailable.",
    options: options.sort(() => 0.5 - Math.random()),
    correctAnswer: correctText,
    correctAnswerText: correctText,
    rationale: q.rationale || q.explanation || "Clinical judgment and patient safety protocols guide this nursing intervention.",
    clinical_application: q.clinical_application || q.clinicalApplication || "Apply the ABC (Airway, Breathing, Circulation) framework to prioritize patient care.",
    simplification: q.simplification || "Focus on the intervention that addresses the most immediate threat to patient stability.",
    hints: q.hints || (q.hint ? [q.hint] : ["Think about the most prioritized nursing action in this scenario."])
  };
};

"""

# Insert normalizeQuestion before the component
if "const normalizeQuestion =" not in content:
    content = content.replace("const getSpeedTimerValue =", normalize_code + "const getSpeedTimerValue =")

# Update initQuiz to use normalizeQuestion
# Pattern: const questions = selected.map(q => normalizeQuestion(q));
# Check if it's already there from previous step
if "const questions = selected.map(q => normalizeQuestion(q));" not in content:
     # Match the mapping logic
     old_map = r"const questions = selected\.map\(card => \{.*?\}\);"
     new_map = "const questions = selected.map(q => normalizeQuestion(q));"
     content = re.sub(old_map, new_map, content, flags=re.DOTALL)

with open('src/pages/Quiz.jsx', 'w') as f:
    f.write(content)
