import sys

with open('src/pages/Quiz.jsx', 'r') as f:
    content = f.read()

# 1. Update normalizeQuestion to be strict about placeholders
old_norm_start = 'const normalizeQuestion = (q) => {'
new_norm = r'''const normalizeQuestion = (q) => {
  if (!q) return null;
  try {
    // Definitive Extraction Chain
    let questionText = q.question || q.text || q.front || q.title || q.prompt || q.q || q.item || "";

    // Support nested data structures from bulk imports
    if (!questionText && q.data) {
        questionText = q.data.question || q.data.text || q.data.item || "";
    }

    // Force string and trim
    questionText = String(questionText).trim();

    // Critical Filter: Skip obvious placeholders in the database
    if (questionText.toLowerCase().includes("sample question") || questionText === "") {
        console.warn("Skipping placeholder or empty question:", q.id);
        return null;
    }

    let options = [];
    let correctAnswerText = "";

    if (Array.isArray(q.options) && q.options.length > 0) {
      options = [...q.options];
    } else if (q.options && typeof q.options === 'object') {
      options = Object.values(q.options);
    } else if (q.option_a || q.option_A || q.option_1) {
      options = [
        q.option_a || q.option_A || q.option_1,
        q.option_b || q.option_B || q.option_2,
        q.option_c || q.option_C || q.option_3,
        q.option_d || q.option_D || q.option_4
      ].filter(Boolean);
    }

    // Filter out obvious placeholder options
    if (options.some(opt => String(opt).toLowerCase() === "option a")) {
        console.warn("Skipping question with placeholder options:", q.id);
        return null;
    }

    const ca = q.correct_answer || q.correctAnswer || q.answer || q.back || q.correct || "";
    if (options.length > 0) {
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
    } else {
        // Questions without options are flashcards, not quiz items
        console.warn("Skipping non-quiz item (no options):", q.id);
        return null;
    }

    return {
      id: q.id || 'gen-' + Math.random().toString(36).substr(2, 9),
      subject: q.subject || q.category || q.topic || "General Nursing",
      source: q.source || (String(q.id).includes('richard') ? "Richard's Bank" : "NMCN Bank"),
      question: questionText,
      options: options.map(opt => String(opt).trim()),
      correctAnswer: String(correctAnswerText).trim(),
      correctAnswerText: String(correctAnswerText).trim(),
      rationale: q.rationale || q.explanation || q.back || "Clinical judgment and patient safety protocols guide this nursing intervention.",
      clinical_application: q.clinical_application || q.clinicalApplication || q.context || "Apply nursing priorities (ABC) to ensure patient stability.",
      simplification: q.simplification || "Focus on the most immediate threat or priority.",
      hints: Array.isArray(q.hints) ? q.hints : (q.hint ? [q.hint] : ["Think about the most immediate threat to the patient."])
    };
  } catch (error) {
    console.error("Normalization Error:", error);
    return null;
  }
};'''

start_idx = content.find(old_norm_start)
# Find the end of the existing normalizeQuestion function
# It ends with }; followed by two newlines
end_idx = content.find('const Quiz = () => {')

if start_idx != -1 and end_idx != -1:
    content = content[:start_idx] + new_norm + "\n\n" + content[end_idx:]
    with open('src/pages/Quiz.jsx', 'w') as f:
        f.write(content)
    print('Hardened normalizeQuestion logic.')
else:
    print('Markers not found.')
