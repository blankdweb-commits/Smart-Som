const fs = require('fs');
const p = 'src/data/flashcards/nmcn/Neurological-Nursing.json';
let raw = fs.readFileSync(p, 'utf8');
const danglingIdx = raw.lastIndexOf('"simplification":');
if (danglingIdx === -1) {
  console.log('no dangling field found');
  process.exit(1);
}
let fixed = raw.slice(0, danglingIdx);
fixed = fixed.replace(/[\s,]+$/, '');
fixed += '\n  }\n]\n';
fs.writeFileSync(p, fixed, 'utf8');
try {
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  console.log('REPAIRED — valid JSON,', d.length, 'questions');
  console.log('last id:', d[d.length - 1].id, '| last question:', String(d[d.length - 1].question).slice(0, 60));
  const missing = d.filter(q => !q.correct_answer_text && !q.correct_answer);
  console.log('questions missing answers:', missing.length);
  const noOptions = d.filter(q => !Array.isArray(q.options) || q.options.length < 2);
  console.log('questions with <2 options:', noOptions.length);
} catch (e) {
  console.log('still invalid:', e.message);
}
