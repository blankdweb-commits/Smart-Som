import { readFileSync } from 'fs';

const qs = JSON.parse(readFileSync('scripts/_recovered.json', 'utf8'));
console.log('total questions:', qs.length);

const bySubject = {};
let missingQuestion = 0, missingOptions = 0, emptyOptions = 0, noAnswer = 0, badDifficulty = 0;
const diffs = {};
for (const q of qs) {
  if (!q.question) missingQuestion++;
  if (!Array.isArray(q.options) || q.options.length === 0) missingOptions++;
  else if (q.options.some((o) => typeof o !== 'string' || !o)) emptyOptions++;
  const a = q.correct_answer || q.correct_answer_text;
  if (!a) noAnswer++;
  if (!q.difficulty) badDifficulty++;
  diffs[q.difficulty] = (diffs[q.difficulty] || 0) + 1;
  const s = q.subject || '(none)';
  bySubject[s] = (bySubject[s] || 0) + 1;
}

console.log('missingQuestion:', missingQuestion);
console.log('missingOptions/empty:', missingOptions, emptyOptions);
console.log('noAnswer:', noAnswer);
console.log('badDifficulty:', badDifficulty);
console.log('difficulties:', diffs);
console.log('--- subjects ---');
for (const [k, v] of Object.entries(bySubject).sort((a, b) => b[1] - a[1])) console.log(' ', v, k);

console.log('--- sample id-based question ---');
const idQ = qs.find((q) => typeof q.id !== 'undefined');
console.log(JSON.stringify(idQ, null, 1).slice(0, 700));

console.log('--- sample question_id-based ---');
const qidQ = qs.find((q) => typeof q.question_id !== 'undefined');
console.log(JSON.stringify(qidQ, null, 1).slice(0, 700));