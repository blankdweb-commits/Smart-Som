// Ad-hoc read-only SQL query helper for this session.
//
// Uses the same Supabase Management API /database/query endpoint as
// run-migration.mjs. Read-only queries only - nothing here writes.
//
// Usage: node scripts/_q.mjs "select 1"
//        node scripts/_q.mjs --file scripts/_something.sql
import fs from 'fs';
import path from 'path';

function env() {
  const out = {};
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[2]) out[m[1]] = m[2];
  }
  return out;
}

const e = env();
const projectRef = (e.VITE_SUPABASE_URL || '').replace('https://', '').split('.')[0];
const token = process.env.ACCESS_TOKEN || e.ACCESS_TOKEN || e.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('Set ACCESS_TOKEN (or SUPABASE_ACCESS_TOKEN) env var first.');
  process.exit(1);
}

const sql = process.argv[2] === '--file'
  ? fs.readFileSync(path.join(process.cwd(), process.argv[3]), 'utf8')
  : process.argv.slice(2).join(' ');

const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
let parsed;
try {
  parsed = JSON.parse(text);
} catch {
  console.error('non-JSON response:', text.slice(0, 800));
  process.exit(1);
}
if (!res.ok) {
  console.error('HTTP', res.status, JSON.stringify(parsed).slice(0, 800));
  process.exit(1);
}
console.log(JSON.stringify(parsed, null, 2));