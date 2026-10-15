// scripts/cleanup-test-users.mjs
//
// Deletes the accounts the e2e suites create, and only those. Every e2e user is
// minted on one of three throwaway domains, so the classifier keys on the DOMAIN
// and nothing else — `blankdweb@mark.com` and every real gmail account is
// outside that set by construction, not by a fragile local-part regex.
//
//   node scripts/cleanup-test-users.mjs            -> dry run, prints the plan
//   node scripts/cleanup-test-users.mjs --apply    -> deletes, then verifies
//
// Deleting an auth.users row cascades to profiles / duels / matches, but a few
// tables reference users with `on delete set null` and would leave orphans, so
// the apply path reports the residue afterwards.

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const APPLY = process.argv.includes('--apply');
const URL = env.VITE_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const TEST_DOMAINS = new Set(['test.local', 'apextest.local', 'apexscholars.test']);
const domainOf = (email) => (email || '').split('@').pop().toLowerCase();
const isTest = (email) => TEST_DOMAINS.has(domainOf(email));

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

// ---- enumerate every auth user ------------------------------------------------
const users = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error('listUsers failed:', error.message); process.exit(1); }
  users.push(...(data?.users || []));
  if (!data?.users?.length || users.length >= (data.total ?? 0)) break;
}

const tests = users.filter((u) => isTest(u.email));
const real = users.filter((u) => !isTest(u.email));

console.log(`auth users: ${users.length}`);
console.log(`  test (${[...TEST_DOMAINS].join(', ')}): ${tests.length}`);
console.log(`  real:                                      ${real.length}`);

const byDomain = {};
for (const u of users) {
  const d = domainOf(u.email);
  byDomain[d] = (byDomain[d] || 0) + 1;
}
console.log('\nby domain:');
for (const [d, n] of Object.entries(byDomain).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${isTest(`probe@${d}`) ? 'TEST' : 'KEEP'}  ${String(n).padStart(3)}  ${d}`);
}

if (real.length) {
  console.log('\nreal accounts that will be KEPT:');
  for (const u of real.slice(0, 40)) {
    console.log(`  ${u.email}  (created ${String(u.created_at).slice(0, 10)})`);
  }
  if (real.length > 40) console.log(`  …and ${real.length - 40} more`);
}

if (!APPLY) {
  console.log(`\nDRY RUN — ${tests.length} account(s) would be deleted. Re-run with --apply.`);
  process.exit(0);
}

// ---- delete -------------------------------------------------------------------
let deleted = 0;
const failed = [];
for (const u of tests) {
  const { error } = await db.auth.admin.deleteUser(u.id);
  if (error) failed.push(`${u.email}: ${error.message}`);
  else deleted += 1;
}

console.log(`\ndeleted ${deleted} test account(s)`);
if (failed.length) {
  console.log(`FAILED ${failed.length}:`);
  for (const f of failed) console.log(`  ${f}`);
}

// ---- verify + report residue ---------------------------------------------------
const after = [];
for (let page = 1; ; page += 1) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
  if (error) break;
  after.push(...(data?.users || []));
  if (!data?.users?.length || after.length >= (data.total ?? 0)) break;
}
const leftovers = after.filter((u) => isTest(u.email));
console.log(`\nremaining test accounts: ${leftovers.length}`);
for (const u of leftovers.slice(0, 20)) console.log(`  LEFTOVER ${u.email}`);

console.log('\nresidue check (rows still pointing at a deleted user):');
const ORPHAN_PROBES = [
  ['competitive_matches', 'creator_id'],
  ['competitive_matches', 'opponent_id'],
  ['competitive_match_answers', 'player_id'],
  ['duels', 'user_id'],
  ['arena_queue', 'user_id'],
  ['arena_presence', 'user_id'],
  ['smart_coin_ledger', 'user_id'],
];
const ids = tests.map((u) => u.id);
for (const [table, col] of ORPHAN_PROBES) {
  const { data, error } = await db.from(table).select(col).in(col, ids);
  if (error) { console.log(`  ${table}.${col}: ${error.message}`); continue; }
  const n = data?.length ?? 0;
  console.log(`  ${n === 0 ? 'clean' : 'ORPHANS'}  ${table}.${col}${n ? ` (${n})` : ''}`);
}