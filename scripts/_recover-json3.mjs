import { readFileSync, writeFileSync, statSync } from 'fs';

const SRC = 'src/data/flashcards/nmcn/200level questions.json';
const before = statSync(SRC).size;
const lines = readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);

const isObjOpen = (l) => /^  \{\s*$/.test(l);
const isFlashcardsOpen = (l) => /^\s*"flashcards"\s*:\s*\[\s*$/.test(l);
const isStarterKey = (l) => /^\s*"(question_id|id)"\s*:\s*(\d+)/.test(l);

let i = 0;
const n = lines.length;

const questions = [];
let current = null;
let inOptions = false;
let optRaw = [];
let skipped = [];

const flush = () => {
  if (current) questions.push(current);
  current = null;
  inOptions = false;
  optRaw = [];
};

const parseField = (t) => {
  const m = t.match(/^"([A-Za-z_]+)"\s*:\s*(.*)$/);
  if (!m) return false;
  const key = m[1];
  let rest = m[2].trim();
  // trailing comma
  if (rest.endsWith(',')) rest = rest.slice(0, -1).trim();
  if (key === 'options' && rest === '[') {
    current[key] = null; // marker; filled by array collector
    inOptions = true;
    optRaw = [];
    return true;
  }
  // options already-open unclosed handled separately
  if (rest === '') { skipped.push('EMPTYFIELD ' + t.slice(0, 40)); return false; }
  current[key] = parseValue(rest);
  return true;
};

const parseValue = (rest) => {
  if (/^-?\d+$/.test(rest)) return Number(rest);
  try {
    return JSON.parse(rest);
  } catch (e) {
    return rest; // keep as raw string
  }
};

while (i < n) {
  const line = lines[i];
  const t = line.trim();

  // blank / stray noise
  if (t === '') { i++; continue; }
  if (/^\[$/.test(t) || /^\},\[$/.test(t) || /^\]\s*$/.test(t) || /^\]\s*,\s*$/.test(t)) { i++; continue; }

  // flashcards wrapper: skip whole object
  if (isObjOpen(line)) {
    let j = i + 1;
    while (j < n && lines[j].trim() === '') j++;
    if (j < n && isFlashcardsOpen(lines[j])) {
      let seenClose = false;
      let k = j + 1;
      for (; k < n; k++) {
        const kt = lines[k].trim();
        if (/^\]\s*$/.test(kt)) seenClose = true;
        if (seenClose && /^  \}\s*$/.test(lines[k])) break;
      }
      i = k + 1;
      continue;
    }
  }

  // inside options array collection
  if (inOptions) {
    if (t === ']' || t === '],') {
      current['options'] = optRaw.map((s) => {
        let v = s.trim();
        if (v.endsWith(',')) v = v.slice(0, -1).trim();
        try { return JSON.parse(v); } catch (e) { return v; }
      });
      inOptions = false;
      optRaw = [];
      i++;
      continue;
    }
    // an options item (string) OR we encountered a new dict (corrupted unclosed options)
    if (/^\s*"[^"]*"\s*:/.test(t) && !/^\s*"[^"]*",?\s*$/.test(t)) {
      // dict line while expecting options items -> options array was unclosed
      current['options'] = optRaw.map((s) => {
        let v = s.trim();
        if (v.endsWith(',')) v = v.slice(0, -1).trim();
        try { return JSON.parse(v); } catch (e) { return v; }
      });
      inOptions = false;
      optRaw = [];
      // do NOT consume this line; reprocess as a field
      continue;
    }
    optRaw.push(t);
    i++;
    continue;
  }

  // new question object start
  if (isStarterKey(t)) {
    flush();
    current = {};
    parseField(t);
    i++;
    continue;
  }

  // field line when current exists
  if (current && /^\s*"[A-Za-z_]+"\s*:/.test(t)) {
    parseField(t);
    i++;
    continue;
  }

  // a stray '  {' or '  }' or '  },' delimiter
  if (/^\{$/.test(t)) { i++; continue; }
  if (/^\},\s*$/.test(t) || /^\}\s*$/.test(t)) { i++; continue; }

  // unclassified
  skipped.push('LINE ' + (i + 1) + ': ' + t.slice(0, 60));
  i++;
}
flush();

// Filter to proper question objects (must have a question + options)
const kept = questions.filter((q) => q && q.question && Array.isArray(q.options) && q.options.length > 0);
const dropped = questions.length - kept.length;

const out = JSON.stringify(kept, null, 2);
writeFileSync('scripts/_recovered.json', out);

try {
  const chk = JSON.parse(out);
  console.log('REPAIRED OK.');
  console.log('  raw objects captured :', questions.length);
  console.log('  kept questions       :', kept.length);
  console.log('  dropped (no q/opts)  :', dropped);
  console.log('  skipped lines        :', skipped.length);
  console.log('  file bytes before    :', before);
  console.log('  file bytes after     :', statSync(SRC).size);
  if (skipped.length) {
    console.log('  --- first 15 skipped lines ---');
    skipped.slice(0, 15).forEach((s) => console.log('   ', s));
  }
} catch (e) {
  console.log('REPAIR OUTPUT INVALID:', e.message.slice(0, 150));
}
