// scripts/backfill-push-vapid-key.mjs
//
// Stamps every push subscription with the SHA-256 of the CURRENT public VAPID
// key. Run this AFTER applying migration v111 and BEFORE rotating the VAPID
// keys, so existing browser subscriptions are known to belong to the old
// keypair. Once the server keys change, those rows are skipped instead of being
// retried forever; each browser silently re-subscribes on its next app open.
//
//   node scripts/backfill-push-vapid-key.mjs            -> dry run
//   node scripts/backfill-push-vapid-key.mjs --apply    -> writes the hash
//
// Never prints the VAPID keys or the service-role key.

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const URL = env.VITE_SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLIC_KEY = env.VAPID_PUBLIC_KEY;

if (!URL || !SERVICE) {
  console.error('VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.');
  process.exit(1);
}
if (!PUBLIC_KEY) {
  console.error('VAPID_PUBLIC_KEY must be set in .env.');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const hash = createHash('sha256').update(PUBLIC_KEY).digest('hex');

const db = createClient(URL, SERVICE, { auth: { persistSession: false } });

const { data: rows, error: readError } = await db
  .from('push_subscriptions')
  .select('id, vapid_key_hash');

if (readError) {
  console.error('Could not read push_subscriptions:', readError.message);
  if (/vapid_key_hash|column/i.test(readError.message)) {
    console.error('Apply scripts/migration-v111-push-vapid-hash.sql first.');
  }
  process.exit(1);
}

const pending = (rows || []).filter((row) => row.vapid_key_hash !== hash);
console.log(`subscriptions: ${rows?.length || 0}`);
console.log(`current key hash: ${hash.slice(0, 12)}…`);
console.log(`needing backfill: ${pending.length}`);

if (!APPLY) {
  console.log('\nDRY RUN — re-run with --apply to stamp these rows.');
  process.exit(0);
}

if (pending.length) {
  const ids = pending.map((row) => row.id);
  const { error: updateError } = await db
    .from('push_subscriptions')
    .update({ vapid_key_hash: hash })
    .in('id', ids);
  if (updateError) {
    console.error('Backfill failed:', updateError.message);
    process.exit(1);
  }
}

const { data: after, error: verifyError } = await db
  .from('push_subscriptions')
  .select('id, vapid_key_hash');
if (verifyError) {
  console.error('Verification read failed:', verifyError.message);
  process.exit(1);
}
const mismatched = (after || []).filter((row) => row.vapid_key_hash !== hash);
console.log(`updated: ${pending.length} · remaining mismatched: ${mismatched.length}`);
process.exit(mismatched.length ? 1 : 0);
