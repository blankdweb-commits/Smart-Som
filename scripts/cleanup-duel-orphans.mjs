// Find duel-side rows whose player no longer exists (deleted test accounts).
// profiles rows cascade from auth.users, so "in duels but not in profiles" is
// exactly the orphan signature.
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const db = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const APPLY = process.argv.includes('--apply');

const PROBES = [
  ['duels', 'user_id'],
  ['competitive_matches', 'creator_id'],
  ['competitive_matches', 'opponent_id'],
  ['smart_coin_ledger', 'user_id'],
  ['competitive_stats', 'user_id'],
];

const orphans = {};
for (const [table, col] of PROBES) {
  const { data, error } = await db.from(table).select(col).not(col, 'is', null).limit(5000);
  if (error) { console.log(`${table}.${col}: ${error.message}`); continue; }
  const ids = [...new Set(data.map((r) => r[col]))];
  if (!ids.length) { console.log(`clean  ${table}.${col} (empty)`); continue; }

  const gone = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const { data: live } = await db.from('profiles').select('id').in('id', chunk);
    const liveIds = new Set((live || []).map((r) => r.id));
    for (const id of chunk) if (!liveIds.has(id)) gone.push(id);
  }
  orphans[`${table}.${col}`] = gone;
  console.log(`${gone.length ? 'ORPHANS' : 'clean '} ${table}.${col}` +
    `${gone.length ? ` (${gone.length} of ${ids.length})` : ''}`);
  if (gone.length) {
    const { data: rows } = await db.from(table).select('*').in(col, gone).limit(3);
    for (const r of rows || []) console.log(`   sample: ${JSON.stringify(r).slice(0, 220)}`);
  }
}

const total = Object.values(orphans).reduce((n, a) => n + a.length, 0);
if (!total) { console.log('\nnothing orphaned.'); process.exit(0); }
if (!APPLY) { console.log(`\nDRY RUN — ${total} orphaned id(s). Re-run with --apply.`); process.exit(0); }

// Delete only the rows whose player is gone. competitive_match_answers has no
// user FK any more (v63 dropped it so bots can hold graded rows), so its
// orphans are swept through the match delete cascade instead.
for (const [table, col] of PROBES) {
  const gone = orphans[`${table}.${col}`];
  if (!gone?.length) continue;
  if (table === 'competitive_matches' && col === 'opponent_id') continue; // set null by the creator delete
  const { error } = await db.from(table).delete().in(col, gone);
  console.log(`${error ? 'FAILED' : 'deleted'} ${gone.length} ${table}.${col}${error ? `: ${error.message}` : ''}`);
}