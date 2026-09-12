// TEMP verification probe for migration-v29 (delete after use).
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const token = env.SUPABASE_ACCESS_TOKEN;
const ref = (env.VITE_SUPABASE_URL || '').replace('https://', '').split('.')[0];

const q = async (query) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });
  return { status: res.status, body: await res.json() };
};

const checks = [];
const log = (label, rows) => checks.push({ label, rows });

// 1. community_* RPCs present (SECURITY DEFINER bodies in pg_proc)
try {
  const r = await q(`select p.proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'community_%' order by 1;`);
  log('community_* functions', r.body.map(x => x.proname));
} catch (e) { log('community_* functions', 'ERR ' + e.message); }

// 2. anonymous_spectators table + indexes + RLS
try {
  const r = await q(`select c.relname, c.relrowsecurity from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('anonymous_spectators','community_posts','community_comments','community_post_likes','community_reports')
    order by 1;`);
  log('tables + RLS enabled', r.body.map(x => `${x.relname}(rls=${x.relrowsecurity})`));
} catch (e) { log('tables + RLS enabled', 'ERR ' + e.message); }

// 3. community_posts ephemeral columns
try {
  const r = await q(`select column_name, data_type from information_schema.columns
    where table_schema = 'public' and table_name = 'community_posts'
    and column_name in ('last_interaction_at','last_interaction_by','grace_until') order by 1;`);
  log('community_posts ephemeral columns', r.body.map(x => `${x.column_name}:${x.data_type}`));
} catch (e) { log('community_posts ephemeral columns', 'ERR ' + e.message); }

// 4. study_groups anonymous columns + check + seeded row
try {
  const r = await q(`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'study_groups'
    and column_name in ('type','privacy','spectator_price','minimum_members_to_activate','minimum_members_to_remain_active','group_state','member_limit')
    order by 1;`);
  log('study_groups anonymous columns', r.body.map(x => x.column_name));
  const s = await q(`select id, name, type, privacy, group_state, is_active, spectator_price,
    minimum_members_to_activate, minimum_members_to_remain_active
    from public.study_groups where type = 'anonymous';`);
  log('seeded Anonymous row', s.body.map(x => `${x.name} | state=${x.group_state} | price=${x.spectator_price} | ${x.minimum_members_to_activate}/${x.minimum_members_to_remain_active} | active=${x.is_active}`));
} catch (e) { log('study_groups checks', 'ERR ' + e.message); }

// 5. RLS write lockdown: client write policies gone on community_posts/comments/likes
try {
  const r = await q(`select tablename, policyname, cmd from pg_policies
    where schemaname = 'public'
      and tablename in ('community_posts','community_comments','community_post_likes','community_reports','study_group_members')
    order by tablename, cmd, policyname;`);
  log('policies (post-v29)', r.body.map(x => `${x.tablename}[${x.cmd}] ${x.policyname}`));
} catch (e) { log('policies (post-v29)', 'ERR ' + e.message); }

// 6. community_feed view columns (expiry + post_state + anon exclusion)
try {
  const r = await q(`select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'community_feed'
    and column_name in ('lives_until','post_state','last_interaction_at','liked_by_current_user')
    order by 1;`);
  log('community_feed ephemeral columns', r.body.map(x => x.column_name));
} catch (e) { log('community_feed ephemeral columns', 'ERR ' + e.message); }

// 7. grant on community_member_count to authenticated
try {
  const r = await q(`select has_function_privilege('authenticated', 'public.community_member_count(bigint)', 'EXECUTE') as mcount;`);
  log('community_member_count EXECUTE → authenticated', JSON.stringify(r.body));
} catch (e) { log('community_member_count grant', 'ERR ' + e.message); }

for (const c of checks) {
  console.log('## ' + c.label);
  console.log('  ', JSON.stringify(c.rows));
}