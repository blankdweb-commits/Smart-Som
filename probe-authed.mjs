// Authenticated endpoint probe — verifies JSON shapes with a real student session.
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));

const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const stamp = Date.now();
const email = `probe-a11y-${stamp}@apextest.local`;
const password = 'testpass123';
const { data: cu, error: ce } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Phase1 Probe' } });
if (ce) { console.error('createUser failed:', ce.message); process.exit(1); }

const pub = createClient(URL, ANON, { auth: { persistSession: false } });
const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
if (se) { console.error('signIn failed:', se.message); process.exit(1); }
const token = s.session.access_token;
const uid = s.session.user.id;

const targets = [
  ['/api/session/status', 'GET'],
  ['/api/session/touch', 'POST'],
  ['/api/quota/course-status', 'GET'],
  ['/api/progress/difficulty', 'GET'],
  ['/api/daily-challenge', 'GET'],
  ['/api/quiz/license-status', 'GET'],
  ['/api/community/groups/join', 'POST'],
];
let pass = 0, fail = 0;
for (const base of [['direct', 'http://localhost:3001'], ['proxy', 'http://localhost:5173']]) {
  for (const [path, method] of targets) {
    try {
      const r = await fetch(base[1] + path, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
        body: method === 'POST' ? '{}' : undefined,
        signal: AbortSignal.timeout(8000),
      });
      const ct = r.headers.get('content-type') || '';
      const body = await r.text();
      let shape = 'OTHER';
      try { JSON.parse(body); shape = 'JSON'; } catch { }
      const ok = ct.includes('json') && r.status !== 503 && shape === 'JSON';
      console.log(`${ok ? 'PASS' : 'FAIL'} ${base[0]} ${method} ${path} -> ${r.status} ${shape} | ${body.slice(0, 110)}`);
      ok ? pass++ : fail++;
    } catch (e) {
      console.log(`FAIL ${base[0]} ${method} ${path} -> ERROR ${e.message}`);
      fail++;
    }
  }
}
console.log(`\nprobe result: ${pass} pass, ${fail} fail`);
await admin.auth.admin.deleteUser(uid);
process.exit(fail ? 1 : 0);
