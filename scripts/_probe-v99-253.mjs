import fs from 'fs';
const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const ref = env.VITE_SUPABASE_PROJECT_REF || 'urhcvdcpxhxmmnavkcvd';
const q = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'select id, name, group_state, minimum_members_to_activate, member_limit, is_active from public.study_groups where id in (12, 253) order by id;' }),
})).text();
console.log(q);
