import { readFileSync, readdirSync } from 'fs';
const dir = 'src/data/flashcards/nmcn';
const files = readdirSync(dir).filter(f => f.endsWith('.json'));
for (const f of files) {
  try {
    const txt = readFileSync(`${dir}/${f}`, 'utf8').replace(/^\uFEFF/, '');
    const j = JSON.parse(txt);
    const arr = Array.isArray(j) ? j : (j.flashcards || j.questions || Object.values(j).find(Array.isArray));
    console.log(`${f}: OK  items=${arr ? arr.length : 'n/a'} topIs${Array.isArray(j) ? 'array' : 'object'}`);
  } catch (e) {
    console.log(`${f}: BROKEN  ${e.message.slice(0, 60)}`);
  }
}
