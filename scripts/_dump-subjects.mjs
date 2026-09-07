import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const s = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await s.from('questions').select('course_id, subject_id').eq('is_active', true).limit(100000);
if (error) { console.log('ERR', error.message); process.exit(1); }
const byCourse = {};
for (const r of data || []) { (byCourse[r.course_id] ??= new Set()).add(r.subject_id); }
for (const c of Object.keys(byCourse).sort()) {
  console.log(`\n[${c}]`);
  console.log([...byCourse[c]].sort().join(' | '));
}