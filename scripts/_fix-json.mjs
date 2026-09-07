import { readFileSync, writeFileSync } from 'fs';

let p = 'src/data/flashcards/nmcn/200level questions.json';
let s = readFileSync(p, 'utf8').replace(/^\uFEFF/, '');

const target = '"Restoration of function after permanent disability"\r\n    "correct_answer"';
const fixed = '"Restoration of function after permanent disability"\r\n    ],\r\n    "correct_answer"';

if (s.includes(target)) {
  s = s.replace(target, fixed);
  writeFileSync(p, s);
  console.log('FIXED missing ] in', p);
} else {
  console.log('pattern not found; trying JSON.parse to check state');
}

// validate all json parse
try {
  JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
  console.log('PARSE OK:', p);
} catch (e) {
  console.log('STILL BROKEN:', e.message.slice(0, 200));
}
