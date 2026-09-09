// scripts/audit-api-routes.mjs
// P0 repository/deployment architecture audit.
// Verifies every API route is served as JSON (never HTML/405 SPA-fallback) —
// the root cause of the earlier 405/HTML failures documented in docs/API_405_AUDIT.md.
// Usage: node scripts/audit-api-routes.mjs [baseUrl]   (default http://localhost:3001)
import http from 'http';

const BASE = process.argv[2] || 'http://localhost:3001';

// [method, path, sendBody] — unauthenticated calls should return JSON 401/400/200,
// but crucially the Content-Type must be JSON, NOT text/html.
const ROUTES = [
  ['POST', '/api/session/register', true],
  ['POST', '/api/session/touch', true],
  ['POST', '/api/session/revoke', true],
  ['GET', '/api/session/devices', false],
  ['GET', '/api/quota/course-status', false],
  ['POST', '/api/quota/course-consume', true],
  ['GET', '/api/progress/difficulty', false],
  ['POST', '/api/progress/difficulty', true],
  ['GET', '/api/progress/history', false],
  ['GET', '/api/daily-challenge', false],
  ['POST', '/api/feedback', true],
  ['POST', '/api/initiate-payment', true],
  ['GET', '/api/quiz-batch-get', false],
  ['POST', '/api/quiz-batch-create', true],
  ['POST', '/api/quiz-batch-answer', true],
  ['POST', '/api/quiz-batch-complete', true],
  ['POST', '/api/matches-create', true],
];

const call = (method, path, sendBody) => new Promise((resolve) => {
  const url = new URL(path, BASE);
  const body = sendBody ? JSON.stringify({}) : null;
  const req = http.request({
    hostname: url.hostname,
    port: url.port,
    path,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
    },
  }, (res) => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      const ct = res.headers['content-type'] || '';
      let isJson = ct.includes('application/json');
      let json = null;
      if (isJson) { try { json = JSON.parse(data); } catch { isJson = false; } }
      resolve({ status: res.statusCode, isJson, json, ct });
    });
  });
  req.on('error', (e) => resolve({ status: 0, isJson: false, error: e.message }));
  if (body) req.write(body);
  req.end();
});

let pass = 0, fail = 0;
console.log(`\n=== API Route Audit against ${BASE} ===\n`);
for (const [method, path, sendBody] of ROUTES) {
  const r = await call(method, path, sendBody);
  const ok = r.status !== 0 && r.isJson && r.status !== 405 && r.ct.includes('json');
  if (ok) pass++; else fail++;
  const note = r.status === 401 ? 'auth required (correct)' :
               r.status === 400 ? 'validation' :
               r.status === 0 ? `ERR ${r.error}` :
               r.status === 200 ? 'ok' : `status ${r.status}`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${method.padEnd(4)} ${path.padEnd(38)} -> ${r.status} [${r.ct.split(';')[0] || 'NONE'}] (${note})`);
}

console.log(`\n=== RESULT: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
