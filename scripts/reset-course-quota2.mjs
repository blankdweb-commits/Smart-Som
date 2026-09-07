import fs from 'fs';
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const ref = env.VITE_SUPABASE_URL.replace('https://', '').split('.')[0];
const token = env.SUPABASE_ACCESS_TOKEN;
const email = process.argv[2] || 'blankdweb@mark.com';
const action = process.argv[3] || 'show';

const run = async (sql) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql })
  });
  return { s: r.status, t: await r.text() };
};

console.log('user', email);

if (action === 'reset') {
  const del = await run(`delete from public.user_course_quota
    where user_id = (select id from auth.users where email = '${email}');`);
  console.log('RESET delete:', del.s, del.t.slice(0, 200));
}

const sel = await run(`select q.course_key, q.questions_used, q.rounds_completed, q.window_expires_at
  from public.user_course_quota q
  join auth.users u on u.id = q.user_id
  where u.email = '${email}'
  order by q.course_key;`);
console.log('QUOTA after:', sel.s, sel.t.slice(0, 600));
