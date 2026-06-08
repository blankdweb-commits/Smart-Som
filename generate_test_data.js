const fs = require('fs');

function generateQuestions(count) {
  const flashcards = [];
  for (let i = 1; i <= count; i++) {
    flashcards.push({
      id: "test-q-" + i,
      question: "Sample Question " + i + " (a) Option A (b) Option B (c) Option C (d) Option D",
      answer_text: "Option A",
      options: ["Option A", "Option B", "Option C", "Option D"],
      explanation: "Rationale for question " + i,
      rationale: "Rationale for question " + i
    });
  }
  return {
    metadata: {
      source: "Stress Test Bank",
      title: "MedSurg"
    },
    flashcards: flashcards
  };
}

const counts = [100, 500, 1000, 5000];
counts.forEach(count => {
  const data = generateQuestions(count);
  fs.writeFileSync(`test_data_${count}.json`, JSON.stringify(data, null, 2));
  console.log(`Generated test_data_${count}.json`);
});
