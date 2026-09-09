import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function request(url, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers: { 'Content-Type': 'application/json', ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'] || '', body: d }));
    });
    req.on('error', e => resolve({ status: 0, ct: '', body: e.message }));
    if (data) req.write(data);
    req.end();
  });
}

// boot both servers directly (same as dev:full)
const env = {};
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const kids = [];
const boot = (name, cmd, args) => {
  const c = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  kids.push(c);
  return c;
};
boot('api', 'node', ['scripts/serve-api.mjs']);
boot('vite', 'node', ['node_modules/vite/bin/vite.js']);

async function waitPort(url, t = 40000) {
  const s = Date.now();
  while (Date.now() - s < t) {
    const r = await request(url);
    if (r.status !== 0) return r.status;
    await new Promise(r2 => setTimeout(r2, 700));
  }
  return 0;
}

await waitPort('http://localhost:3001/api/session/status');
const webStatus = await waitPort('http://localhost:5173/');
console.log(`Vite on :5173 answered status=${webStatus}`);

// The CRITICAL test: proxy /api through 5173 -> 3001
const tests = [
  ['GET',  '/api/session/status'],
  ['POST', '/api/session/touch'],
  ['GET',  '/api/quota/course-status'],
  ['POST', '/api/quota/course-consume'],
  ['POST', '/api/quiz-batch-create'],
];
console.log('\n=== Via VITE PROXY :5173/api/*  (proves /api is usable from the browser origin) ===');
for (const [method, p] of tests) {
  const r = await request(`http://localhost:5173${p}`, method, p === '/api/quota/course-consume' ? { course_key: 'clinical-challenge:nclex' } : p === '/api/quiz-batch-create' ? {} : null);
  const okJson = r.status !== 0 && (r.ct.includes('json'));
  const notRefused = r.status !== 0;
  console.log(`${notRefused && okJson ? 'PASS' : 'FAIL'}  ${method} :5173${p} -> status=${r.status} ct=${r.ct.split(';')[0]} body=${r.body.slice(0, 70)}`);
}

for (const c of kids) { try { c.kill(); } catch {} }
setTimeout(() => { for (const c of kids) { try { c.kill(); } catch {} } }, 500);
