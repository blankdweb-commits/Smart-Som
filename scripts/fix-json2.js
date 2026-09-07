import fs from 'fs';

const content = fs.readFileSync('src/data/flashcards/nmcn/200level questions.json', 'utf8');

// Use a simple state machine to extract complete JSON objects
const results = [];
let braceDepth = 0;
let bracketDepth = 0;
let inString = false;
let escape = false;
let currentObject = '';
let startIdx = -1;

for (let i = 0; i < content.length; i++) {
  const ch = content[i];
  
  if (inString) {
    currentObject += ch;
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
    currentObject += ch;
    continue;
  }
  
  if (ch === '{') {
    if (braceDepth === 0 && bracketDepth === 0) {
      startIdx = i;
    }
    braceDepth++;
    currentObject += ch;
  } else if (ch === '}') {
    braceDepth--;
    currentObject += ch;
    if (braceDepth === 0 && bracketDepth === 0) {
      // Complete object found
      try {
        const parsed = JSON.parse(currentObject);
        results.push(parsed);
      } catch(e) {
        // ignore
      }
      currentObject = '';
    }
  } else if (ch === '[') {
    bracketDepth++;
    if (bracketDepth > 1) currentObject += ch;
  } else if (ch === ']') {
    bracketDepth--;
    if (bracketDepth > 0) currentObject += ch;
  } else {
    if (braceDepth > 0 || bracketDepth > 0) {
      currentObject += ch;
    }
  }
}

console.log('Total objects extracted:', results.length);

// Filter to keep only objects that look like questions (have question field)
const validQuestions = results.filter(q => q && q.question);
console.log('Valid questions:', validQuestions.length);

fs.writeFileSync('src/data/flashcards/nmcn/200level questions.json', JSON.stringify(validQuestions, null, 2));
console.log('Written fixed file');