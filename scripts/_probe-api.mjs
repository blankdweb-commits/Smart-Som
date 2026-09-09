import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function request(method, url, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'] || '', body: d }));
    });
    req.on('error', e => resolve({ status: 0, ct: '', body: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

// Splice .env ourselves (serve-api does the same via loadEnv, but we want stdout NET of log noise)
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}

const api = spawn('node', ['scripts/serve-api.mjs'], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
let apiLog = '';
api.stdout.on('data', d => apiLog += d);
api.stderr.on('data', d => apiLog += d);

const PORT = Number(env.API_PORT || 3001);
const BASE = `http://localhost:${PORT}`;

// Poll until the port answers (serve-api can take several seconds to bind).
async function waitReady(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await request('GET', BASE + '/api/definitely-not-a-route', null);
      if (r.status !== 0) return r;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}
const first = await waitReady();
console.log('=== probe first response (proves server bound) ===', first ? `${first.status} ${first.body.slice(0,60)}` : 'NOT READY');

const routes = [
  ['POST', '/api/session/touch', {}],
  ['POST', '/api/session/register', { device_identifier: 'probe' }],
  ['GET', '/api/quota/course-status', null],
  ['POST', '/api/quota/course-consume', { course_key: 'clinical-challenge:nclex' }],
  ['POST', '/api/quiz-batch-create', {}],
  ['GET', '/api/progress/difficulty', null],
];

console.log('=== API route reachability probe (expect 401/400/422 — NOT 404 or refused) ===');
for (const [method, p, body] of routes) {
  const { status, ct, body: b } = await request(method, BASE + p, body);
  const reachable = status !== 0 && status !== 404 && !/^ECONN/i.test(b);
  console.log(`${reachable ? 'REACH' : 'FAIL '}  ${method} ${p} -> status=${status} ct=${ct.split(';')[0]} body=${b.slice(0, 90)}`);
}

console.log('\n=== serve-api log (mounted routes + any startup error) ===');
console.log(apiLog.split('\n').filter(Boolean).slice(0, 40).join('\n'));

api.kill();
