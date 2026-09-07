import { readFileSync } from 'fs';
const p = 'src/data/flashcards/nmcn/200level questions.json';
const raw = readFileSync(p, 'utf8');
const s = raw.replace(/^\uFEFF/, '');
const lines = s.split(/\r?\n/);

const problems = [];
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  // lines containing a bracket that are not "options": [ or "]" closing
  if (t.includes('[') && !t.includes('"options": [')) {
    problems.push({ ln: i + 1, kind: 'OPEN-BRACKET', txt: t.slice(0, 80) });
  }
}
// track options closure
let inOptions = false;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t.startsWith('"options":') || t === '"options": [' || t.startsWith('"options": [')) {
    inOptions = true;
    continue;
  }
  if (!inOptions) continue;
  // a line that is a key: value at depth (i.e., starts with quote and has colon) means options ended
  if (/^"[^"]*"\s*:/.test(t) || /^\}/.test(t) || /^\]/.test(t)) {
    // check previous non-empty line was not a close bracket
    let j = i - 1; while (j >= 0 && lines[j].trim() === '') j--;
    if (j >= 0 && !lines[j].trim().startsWith(']')) {
      problems.push({ ln: i + 1, kind: 'OPTIONS-MISSING-CLOSE', prev: lines[j].trim().slice(0, 60), txt: t.slice(0, 60) });
    }
    inOptions = false;
  }
}
// object separation: line "}" (end obj) not followed by comma then next obj "{"
let prevObjKey = false;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (/^\}\s*,?\s*$/.test(t)) {
    prevObjKey = true;
  } else if (/\{/.test(t) && prevObjKey) {
    // we are at a line that opens something right after a closing } — check if previous wasn't 
    const prev = lines[i - 1].trim();
    if (prev !== '},' && !prev.endsWith(',') && prev !== '}') {
      // skip; handled separately
    }
    prevObjKey = false;
  } else {
    prevObjKey = false;
  }
}

console.log('OPEN-BRACKET problems:', problems.filter(x => x.kind === 'OPEN-BRACKET').length);
console.log('OPTIONS-MISSING-CLOSE problems:', problems.filter(x => x.kind === 'OPTIONS-MISSING-CLOSE').length);

// show examples of stray brackets
const br = problems.filter(x => x.kind === 'OPEN-BRACKET');
br.slice(0, 30).forEach(x => console.log(`  ln${x.ln}: ${x.txt}`));
