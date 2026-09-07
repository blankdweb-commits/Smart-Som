import fs from 'fs';
import JSON5 from 'json5';

const content = fs.readFileSync('src/data/flashcards/nmcn/200level questions.json', 'utf8');

try {
  const parsed = JSON5.parse(content);
  console.log('Parsed successfully, type:', Array.isArray(parsed) ? 'array' : 'object');
  if (Array.isArray(parsed)) {
    console.log('Length:', parsed.length);
    fs.writeFileSync('src/data/flashcards/nmcn/200level questions.json', JSON.stringify(parsed, null, 2));
    console.log('Written fixed file');
  }
} catch(e) {
  console.error('Parse error:', e.message);
}