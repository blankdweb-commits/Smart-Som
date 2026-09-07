import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const s = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: rows, error: e2 } = await s.from('questions').select('course_id').limit(10000);
if (e2) { console.log('ERR', e2.message); process.exit(1); }
const map = {};
for (const r of rows) map[r.course_id] = (map[r.course_id] || 0) + 1;
console.log('total rows fetched:', rows.length);
console.log('course_id counts:', JSON.stringify(map, null, 1));