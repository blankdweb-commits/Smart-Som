import fs from 'fs';
import path from 'path';

// Runs SUPABASE_SETUP.sql against the project using a Supabase Management API
// personal access token passed as ACCESS_TOKEN env var.
// Usage: $env:ACCESS_TOKEN='sbp_...'; node scripts/run-migration.mjs

const PROJECT_REF = (() => {
  const env = {};
  for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[2]) env[m[1]] = m[2];
  }
  const url = env.VITE_SUPABASE_URL || '';
  return url.replace('https://', '').split('.')[0];
})();

const token = process.env.ACCESS_TOKEN;
if (!token) {
  console.error('Set ACCESS_TOKEN env var first.');
  process.exit(1);
}

const sqlFile = process.argv[2] || 'SUPABASE_SETUP.sql';
const sql = fs.readFileSync(path.join(process.cwd(), sqlFile), 'utf8');

console.log(`Running ${sqlFile} (${sql.length} chars) against project ${PROJECT_REF}...`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ query: sql })
});

const text = await res.text();
console.log('HTTP status:', res.status);

let parsed;
try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 2000); }

if (res.ok) {
  console.log('SUCCESS.');
  if (Array.isArray(parsed) && parsed.length === 0) console.log('(no rows returned — expected for DDL)');
  else console.log(JSON.stringify(parsed).slice(0, 1000));
} else {
  console.log('ERROR RESPONSE:');
  console.log(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2).slice(0, 3000));
  process.exit(1);
}
