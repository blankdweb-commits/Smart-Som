// One-off repair: a PowerShell (Get-Content -Raw) -> WriteAllText round-trip
// re-encoded the UTF-8 source through Windows-1252 (the exact failure recorded
// in AGENTS.md for api/_community.js). This walks the file back to UTF-8.
// ASCII is unaffected, so applying it to the whole file is safe.
import fs from 'fs';

const FILE = process.argv[2];
const src = fs.readFileSync(FILE, 'utf8');

// cp1252 0x80-0x9F do not map 1:1 to Latin-1, so use the real reverse table.
const HIGH = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};

let fixed = 0;
let out = '';
for (const ch of src) {
  const cp = ch.codePointAt(0);
  if (cp < 0x80) { out += ch; continue; }
  if (cp <= 0xFF) { out += String.fromCharCode(cp); fixed++; continue; }
  if (HIGH[cp] !== undefined) { out += String.fromCharCode(HIGH[cp]); fixed++; continue; }
  // Genuine non-cp1252 character (emoji, box-drawing, etc.) — leave untouched.
  out += ch;
}

const bytes = Buffer.from(out, 'latin1');
const decoded = bytes.toString('utf8');

if (decoded.includes('\uFFFD')) {
  console.error('REPAIR FAILED: result still contains U+FFFD — aborting, file not written.');
  process.exit(1);
}

fs.writeFileSync(FILE, decoded, 'utf8');

const check = fs.readFileSync(FILE, 'utf8');
const mojibake = (check.match(/[ÃÂ][\u0080-\u00BF\u2000-\u20BF\u00A0-\u00FF]/g) || []).length;
console.log(`repaired ${fixed} chars; mojibake remaining: ${mojibake}; U+FFFD: ${(check.match(/\uFFFD/g) || []).length}`);