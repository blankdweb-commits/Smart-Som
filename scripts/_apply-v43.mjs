import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const ref = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || '').replace('https://', '').split('.')[0];
const token = env.SUPABASE_ACCESS_TOKEN || process.env.ACCESS_TOKEN;
if (!ref || !token) { console.error('Missing ref/token'); process.exit(1); }

const file = process.argv[2];
const sql = fs.readFileSync(file, 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log('HTTP', res.status);
console.log(text.slice(0, 2000));
process.exit(res.ok ? 0 : 1);
