import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);

const email = process.argv[2] || 'blankdweb@mark.com';

// Resolve user id
const { data: users, error: ue } = await supabase
  .from('user_course_quota')
  .select('id, course_key, questions_used, rounds_completed, window_expires_at, is_ready')
  .eq('user_id', (await supabase.from('profiles').select('id').eq('email', email).maybeSingle()).data?.id);

const { data: prof } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
const userId = prof?.id;
if (!userId) { console.log('NO USER FOUND for', email); process.exit(1); }

// Query existing quota rows
const { data: rows } = await supabase
  .from('user_course_quota')
  .select('course_key, questions_used, rounds_completed, last_round_completed_at, window_expires_at')
  .eq('user_id', userId);

console.log('User:', email, userId);
console.log('Existing course quota rows:');
for (const r of rows || []) {
  console.log(`  ${r.course_key} | used=${r.questions_used} rounds=${r.rounds_completed} win=${r.window_expires_at}`);
}

// Delete all quota rows to reset (fresh state)
if (process.argv[3] === 'reset') {
  const { data, error } = await supabase
    .from('user_course_quota')
    .delete()
    .eq('user_id', userId);
  console.log('RESET result:', error ? ('ERROR ' + error.message) : 'deleted ' + (data?.length ?? 0) + ' rows');
}
