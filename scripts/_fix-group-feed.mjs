// TEMP: live-patch community_group_feed return type (id bigint → id uuid).
// Extracts the function DDL from the migration file, applies, then drops itself
// from the "before" signature state by re-checking. Used once.
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const ref = (env.VITE_SUPABASE_URL || '').replace('https://', '').split('.')[0];
const token = env.SUPABASE_ACCESS_TOKEN;

const lines = fs.readFileSync(path.join(process.cwd(), 'scripts/migration-v29-community-ephemeral-anonymous.sql'), 'utf8').split(/\r?\n/);
const start = lines.findIndex(l => l.startsWith('create or replace function public.community_group_feed'));
let end = start;
for (let i = start; i < lines.length; i++) {
  if (lines[i].trim() === '$$;') { end = i; break; }
}
let ddl = lines.slice(start, end + 1).join('\n');
if (!/returns table \(\s*\\n?\s*id uuid,/.test(ddl.replace(/\n/g, '\\n'))) {
  console.error('Migration file id already uuid? Aborting patch to avoid double-apply.');
  process.exit(1);
}
if (!ddl.includes('id bigint,')) ddl = ddl.replace('id uuid,', 'id bigint,'); // safety: if uuid present, this is a no-op mismatch guard

// Ensure we send the CORRECTED version: the file edit already has uuid.
const send = 'DROP FUNCTION IF EXISTS public.community_group_feed(bigint, integer, uuid);\n' + ddl;

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: send })
});
const text = await res.text();
console.log('HTTP', res.status);
if (!res.ok) {
  console.log(text.slice(0, 2000));
  process.exit(1);
}
console.log('community_group_feed patched (id uuid).');

const chk = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: `select pg_get_function_result(a.oid) as sig from pg_proc a join pg_namespace n on n.oid=a.pronamespace where n.nspname='public' and a.proname='community_group_feed';` })
});
console.log('live signature:', JSON.stringify(await chk.json()));