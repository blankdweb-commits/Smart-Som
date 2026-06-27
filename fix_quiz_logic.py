import re

file_path = 'src/pages/Quiz.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# 1. Update normalizeQuestion to handle Format A, B, and C robustly
normalize_logic = """const normalizeQuestion = (q) => {
  if (!q) return null;
  try {
    let questionText = q.question || q.text || q.front || "Question unavailable";
    let options = [];
    let correctAnswerText = "";

    // Normalize Options (Formats A, B, C)
    if (Array.isArray(q.options)) {
      options = [...q.options];
    } else if (q.options && typeof q.options === 'object') {
      options = Object.values(q.options);
    } else if (q.option_a || q.option_A) {
      options = [
        q.option_a || q.option_A,
        q.option_b || q.option_B,
        q.option_c || q.option_C,
        q.option_d || q.option_D
      ].filter(Boolean);
    }

    if (options.length === 0) {
      const fallbackAns = q.correct_answer || q.answer || q.correct_answer_text || q.back || "Consult protocol";
      options = [fallbackAns, "Increase monitoring", "Document findings", "Perform assessment"];
    }

    // Normalize Correct Answer
    const ca = q.correct_answer || q.correctAnswer || q.answer || q.back || "";
    if (typeof ca === 'number' && ca >= 0 && ca < options.length) {
      correctAnswerText = options[ca];
    } else if (typeof ca === 'string' && ca.length === 1 && /^[A-D]$/i.test(ca)) {
      const index = ca.toUpperCase().charCodeAt(0) - 65;
      if (q.options && typeof q.options === 'object' && !Array.isArray(q.options)) {
        correctAnswerText = q.options[ca.toUpperCase()] || q.options[ca.toLowerCase()] || options[index] || options[0];
      } else {
        correctAnswerText = options[index] || ca;
      }
    } else {
      correctAnswerText = ca || options[0];
    }

    return {
      id: q.id || Math.random().toString(36).substr(2, 9),
      subject: q.subject || q.category || 'General Nursing',
      source: q.source || 'Apex Scholars Bank',
      question: questionText,
      options: options.map(opt => String(opt).trim()),
      correctAnswer: String(correctAnswerText).trim(),
      correctAnswerText: String(correctAnswerText).trim(),
      rationale: q.rationale || q.explanation || q.back || "Clinical judgment and patient safety protocols guide this nursing intervention.",
      clinical_application: q.clinical_application || q.clinicalApplication || q.context || "Apply nursing priorities to ensure patient safety and stability.",
      simplification: q.simplification || "Focus on the most immediate clinical priority.",
      hints: Array.isArray(q.hints) ? q.hints : (q.hint ? [q.hint] : ["Think about the most immediate threat to the patient."])
    };
  } catch (error) {
    console.error("Normalization Error:", error);
    return null;
  }
};"""

content = re.sub(r'const normalizeQuestion = \(q\) => \{.*?};', normalize_logic, content, flags=re.DOTALL)

with open(file_path, 'w') as f:
    f.write(content)
