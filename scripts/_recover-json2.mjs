import { readFileSync, writeFileSync } from 'fs';

const SRC = 'src/data/flashcards/nmcn/200level questions.json';
const lines = readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);

const isObjOpen = (l) => /^  \{\s*$/.test(l);
const isFlashcardsOpen = (l) => /^\s*"flashcards"\s*:\s*\[\s*$/.test(l);
const isOptionsOpen = (l) => /^\s*"options"\s*:\s*\[\s*$/.test(l);
const isDictItem = (l) => /^\s*"[^"]*"\s*:/.test(l);

let i = 0;
const n = lines.length;
const pass1 = [];

while (i < n) {
  const line = lines[i];
  const t = line.trim();

  if (/^\[$/.test(t) || /^\},\[$/.test(t) || /^\]\s*,\s*$/.test(t)) {
    i++;
    continue;
  }

  if (isObjOpen(line)) {
    let j = i + 1;
    while (j < n && lines[j].trim() === '') j++;
    if (j < n && isFlashcardsOpen(lines[j])) {
      let seenArrayClose = false;
      let k = j + 1;
      for (; k < n; k++) {
        const kt = lines[k].trim();
        if (/^\]\s*$/.test(kt) && lines[k].indexOf(']') === 0) seenArrayClose = true;
        if (seenArrayClose && /^  \}\s*$/.test(lines[k])) break;
      }
      i = k + 1;
      continue;
    }
  }

  pass1.push(line);
  i++;
}

// Phase 2: fix options closures
const fixed = [];
let inOptions = false;
for (const l of pass1) {
  const t = l.trim();

  if (!inOptions && isOptionsOpen(l)) {
    inOptions = true;
    fixed.push(l);
    continue;
  }

  if (inOptions) {
    if (t === ']' || t === '],') {
      inOptions = false;
      fixed.push(l);
      continue;
    }
    if (isDictItem(t)) {
      fixed.push('    ],');
      inOptions = false;
      fixed.push(l);
      continue;
    }
    fixed.push(l);
    continue;
  }

  fixed.push(l);
}

// Phase 3: comma between top-level objects: '  }' followed by '  {'
for (let idx = 0; idx < fixed.length; idx++) {
  const l = fixed[idx];
  if (/^  \}\s*$/.test(l)) {
    let j = idx + 1;
    while (j < fixed.length && fixed[j].trim() === '') j++;
    if (j < fixed.length && /^  \{\s*$/.test(fixed[j])) {
      fixed[idx] = l.replace(/\}\s*$/, '},');
    }
  }
}

let doc = '[' + fixed.join('\n') + ']';

try {
  const parsed = JSON.parse(doc);
  console.log('PARSE OK, top-level items:', parsed.length);
  writeFileSync('scripts/_rebuilt.json', doc);
} catch (e) {
  console.log('PARSE FAIL:', e.message.slice(0, 250));
  writeFileSync('scripts/_rebuilt.json', doc);
}
