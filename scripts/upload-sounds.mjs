// scripts/upload-sounds.mjs
// Uploads the quiz sound-effect MP3s to the Supabase `sounds` public bucket.
//
// Source of truth: the downloaded MP3 clips on disk. A clip MUST be <= 4s;
// anything longer is skipped here so oversized clips never land. The client
// playQuizSound() also hard-stops playback at 4s regardless.
// Clips are keyed by filename (e.g. correct-0.mp3, wrong-0.mp3, timeout-0.mp3).
//
// Uses the Supabase JS SDK (handles key formats for both legacy JWTs and the
// new sb_publishable_/sb_secret_ keys). The `sounds` bucket is created here
// first if it does not exist yet.
//
// Usage:
//   node scripts/upload-sounds.mjs
//
// Reads VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const MAX_SECONDS = 4;
const require = createRequire(path.join(process.cwd(), 'package.json'));
const { parseFile } = require('music-metadata');
const { createClient } = require('@supabase/supabase-js');

function loadEnv() {
  const env = {};
  const p = path.join(process.cwd(), '.env');
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && m[2]) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const url = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.');
  process.exit(1);
}
const supabase = createClient(url, serviceKey);

const dir = process.argv[2] || path.join(process.cwd(), 'quiz-sounds');
if (!fs.existsSync(dir)) {
  console.error(`No sound directory at ${dir}. Drop the MP3 clips there first.`);
  process.exit(1);
}
const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp3')).sort();
if (files.length === 0) {
  console.error(`No .mp3 files found in ${dir}.`);
  process.exit(1);
}

// 1) Ensure the public `sounds` bucket exists.
{
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets || []).some((b) => b.name === 'sounds');
  if (!exists) {
    const { error } = await supabase.storage.createBucket('sounds', { public: true });
    if (error) console.error(`Bucket create failed: ${error.message}`);
    else console.log('Bucket sounds created (public).');
  } else {
    console.log('Bucket sounds already exists.');
  }
}

// 2) Upload every .mp3, skipping anything proven > 4s.
const results = [];
let failed = 0;
for (const name of files) {
  const abs = path.join(dir, name);
  const bytes = fs.statSync(abs).size;

  let dur = null;
  try {
    const meta = await parseFile(abs);
    dur = meta.format.duration ?? null;
  } catch {
    dur = null;
  }
  if (dur !== null && dur > MAX_SECONDS) {
    console.log(`SKIP ${name}: ${dur.toFixed(2)}s exceeds ${MAX_SECONDS}s cap`);
    continue;
  }

  const data = fs.readFileSync(abs);
  const { error } = await supabase.storage.from('sounds').upload(
    name,
    data,
    { contentType: 'audio/mpeg', upsert: true }
  );
  if (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.message}`);
    continue;
  }
  const { data: urlData } = supabase.storage.from('sounds').getPublicUrl(name);
  const publicUrl = urlData?.publicUrl;
  results.push({ name, size: bytes, duration: dur, url: publicUrl });
  console.log(`OK   ${name}${dur !== null ? ` (${dur.toFixed(2)}s)` : ''} -> ${publicUrl}`);
}

console.log(`\nUploaded ${results.length} clip(s), ${failed} failed.`);
if (results.length) {
  console.log('\nMap these into the SOUND_POOL in src/pages/Quiz.jsx:');
  for (const r of results) console.log(`  ${r.name}: '${r.url}',`);
}
process.exit(failed ? 1 : 0);
