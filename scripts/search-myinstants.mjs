// scripts/search-myinstants.mjs <term> [...terms]
// Prints myinstants search results (name + direct .mp3 URL) so clips can be
// selected and downloaded. Usage: node scripts/search-myinstants.mjs timeout
import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// Load music-metadata from the project's node_modules.
const require = createRequire(path.join(process.cwd(), 'package.json'));
const { parseBuffer } = require('music-metadata');

const terms = process.argv.slice(2);
const MAX = Number(process.env.MAX ?? 8);

async function probe(buf) {
  try {
    const m = await parseBuffer(buf, { mimeType: 'audio/mpeg' });
    return m.format.duration;
  } catch {
    return null;
  }
}

for (const term of terms) {
  console.log(`\n===== ${term} =====`);
  const res = await fetch(`https://www.myinstants.com/api/v1/instants/?name=${encodeURIComponent(term)}&format=json`, { headers: { 'user-agent': UA } });
  if (!res.ok) { console.log('  search FAIL', res.status); continue; }
  const j = await res.json();
  const results = (j.results || []).slice(0, MAX);
  for (const r of results) {
    let dur = '?';
    try {
      const a = await fetch(r.sound, { headers: { 'user-agent': UA } });
      if (a.ok) dur = (await probe(Buffer.from(await a.arrayBuffer())) ?? '?')?.toFixed(2) + 's';
      else dur = `HTTP ${a.status}`;
    } catch (e) { dur = 'ERR'; }
    console.log(`  ${dur.padEnd(8)} | ${String(r.name).slice(0, 38).padEnd(38)} | ${r.sound}`);
  }
}
