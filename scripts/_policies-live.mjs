// TEMP probe: exact policy names on community tables (delete after use).
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const ref = (env.VITE_SUPABASE_URL || '').replace('https://', '').split('.')[0];
const token = env.SUPABASE_ACCESS_TOKEN;

const q = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return { status: res.status, body: await res.json() };
};

const r = await q(`select tablename, policyname, cmd, roles from pg_policies
  where schemaname = 'public'
    and tablename in ('community_posts','community_comments','community_post_likes','community_reports')
  order by tablename, cmd, policyname;`);
for (const row of r.body) {
  console.log(`${row.tablename}\t[${row.cmd}]\t${row.policyname}\troles=${row.roles}`);
}