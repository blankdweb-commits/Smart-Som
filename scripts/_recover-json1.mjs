import { readFileSync, writeFileSync } from 'fs';

const SRC = 'src/data/flashcards/nmcn/200level questions.json';
const raw = readFileSync(SRC, 'utf8').replace(/^\uFEFF/, '');
const lines = raw.split(/\r?\n/);

// Step 1: fix the entire document line-by-line to be valid JSON, then validate.

// Each top-level object is introduced by a line that starts with '  {' (2 spaces).
// We'll reconstruct: prepend '[', fix options closures, drop stray '[' bracket
// lines and the embedded "flashcards" wrapper object, then append ']'.

const out = [];
let i = 0;
const n = lines.length;
const isObjOpen = (l) => /^  \{\s*$/.test(l);
const isOptionsOpen = (l) => /^\s*"options"\s*:\s*\[\s*$/.test(l);
const isFieldLine = (l) => /^\s*"[^"]*"\s*:\s*/.test(l); // `"key": ...`
const isStrayOpenBracket = (l) => /^\s*\[\s*$/.test(l) || /^\s*\},\s*\[\s*$/.test(l);
const isFlashcardsOpen = (l) => /^\s*"flashcards"\s*:\s*\[\s*$/.test(l);

while (i < n) {
  const line = lines[i];

  // Skip stray opening brackets (e.g. line == '  [' or '  },[')
  if (isStrayOpenBracket(line.trim()) ) {
    i++;
    continue;
  }

  // If this starts a "flashcards" wrapper object, skip to its matching top-level close.
  if (isObjOpen(line)) {
    // look ahead: is the next meaningful line a "flashcards" opener?
    let j = i + 1;
    while (j < n && lines[j].trim() === '') j++;
    if (j < n && isFlashcardsOpen(lines[j])) {
      // skip entire wrapper object: find its closing '  }' at top level
      // The flashcards array ends with a ']' then a top-level '  }'
      let k = i + 1;
      while (k < n) {
        const tl = lines[k].trim();
        if (/^\}\s*$/.test(tl) && lines[k].indexOf('}') === 2) break; // '  }' top-level
        if (k > i + 1 && /^\]\s*$/.test(tl)) {
          // found array close; next top-level '}' after it
          // keep scanning for the '  }'
        }
        k++;
      }
      // find the first top-level '  }' after the array close
      let k2 = i + 1;
      let lastArrayClose = -1;
      while (k2 < n) {
        const tl = lines[k2].trim();
        if (/^\]\s*$/.test(tl)) {
          lastArrayClose = k2;
        }
        if (lastArrayClose >= 0 && lines[k2].indexOf('}') === 2 && /^\}\s*$/.test(lines[k2].trim())) {
          break;
        }
        k2++;
      }
      if (k2 < n && /^\}\s*$/.test(lines[k2].trim())) {
        i = k2 + 1;
        continue;
      }
    }
  }

  out.push(line);
  i++;
}

const rebuilt = '[' + out.join('\n').replace(/\r$/, '') + ']';

// Validate and iterate
writeFileSync('scripts/_rebuilt1.json', rebuilt);
try {
  const parsed = JSON.parse(rebuilt);
  console.log('PASS1: parsed, items =', suitableCount(parsed));
} catch (e) {
  console.log('FAIL1:', e.message.slice(0, 120));
}

function suitableCount(arr) {
  return arr.length;
}
