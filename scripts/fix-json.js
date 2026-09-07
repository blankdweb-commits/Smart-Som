import fs from 'fs';
const content = fs.readFileSync('src/data/flashcards/nmcn/200level questions.json', 'utf8');

// Parse all JSON values sequentially
const results = [];
let depth = 0;
let start = 0;
let inString = false;
let escape = false;

for (let i = 0; i < content.length; i++) {
  const ch = content[i];
  
  if (inString) {
    if (escape) {
      escape = false;
    } else if (ch === '\\') {
      escape = true;
    } else if (ch === '"') {
      inString = false;
    }
    continue;
  }
  
  if (ch === '"') {
    inString = true;
    continue;
  }
  
  if (ch === '[' || ch === '{') {
    if (depth === 0) start = i;
    depth++;
  } else if (ch === ']' || ch === '}') {
    depth--;
    if (depth === 0) {
      const jsonStr = content.substring(start, i + 1);
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          results.push(...parsed);
        } else {
          results.push(parsed);
        }
      } catch(e) {
        // ignore parse errors
      }
    }
  }
}

console.log('Total objects:', results.length);
fs.writeFileSync('src/data/flashcards/nmcn/200level questions.json', JSON.stringify(results, null, 2));
console.log('Written fixed file');