import { readFileSync } from 'fs';
const s = readFileSync('src/data/flashcards/nmcn/200level questions.json', 'utf8').replace(/^\uFEFF/, '');
for (const [k, re] of Object.entries({
  options: /"options":/g,
  question_id: /"question_id":/g,
  '"id"': /"id":/g,
  correct_answer: /"correct_answer":/g,
  hints: /"hints":/g,
  rationale: /"rationale":/g,
  clinical_application: /"clinical_application":/g,
  simplification: /"simplification":/g,
  explanation: /"explanation":/g,
  '"answer"': /"answer":/g,
})) {
  console.log(k, ':', (s.match(re) || []).length);
}
