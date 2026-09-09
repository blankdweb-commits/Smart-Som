// scripts/verify-runtime.mjs
// One-shot runtime verification: starts the API server + Vite dev server as
// children, runs an end-to-end browser/HTTP verification of the P0 + Phases
// 1-4 features, then tears everything down. Keep all children alive for the
// lifetime of this single process (background servers don't survive across
// shell invocations on this environment).
import { spawn } from 'child_process';
import { chromium } from '@playwright/test';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const API_PORT = 3001;
const WEB_PORT = 5173;

const wait = (ms) => new Promise(r => setTimeout(r, ms));

function httpGet(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET' }, (res) => {
      let d = '';
      res.on('data', c => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'] || '', body: d }));
    });
    req.on('error', () => resolve({ status: 0, ct: '', body: '' }));
    req.end();
  });
}

async function waitReady(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { status } = await httpGet(url);
    if (status > 0) return true;
    await wait(500);
  }
  return false;
}

const children = [];
let pass = 0, fail = 0;
const report = (label, ok, evidence) => {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${evidence ? '  | ' + evidence : ''}`);
};

// --

// 1. Start API server
const api = spawn('node', ['scripts/serve-api.mjs'], { cwd: ROOT, stdio: 'ignore' });
children.push(api);
const apiReady = await waitReady(`http://localhost:${API_PORT}/`);
report('API server starts (serve-api.mjs)', apiReady, `port ${API_PORT}`);

// 2. Start Vite dev server
const vite = spawn('node', ['node_modules/vite/bin/vite.js'], { cwd: ROOT, stdio: 'ignore' });
children.push(vite);
const webReady = await waitReady(`http://localhost:${WEB_PORT}/`);
report('Vite dev server starts', webReady, `port ${WEB_PORT}`);

if (!apiReady) { console.log('\nABORT: API server did not start'); cleanup(children); process.exit(1); }
if (!webReady) { console.log('\nABORT: Vite did not start'); cleanup(children); process.exit(1); }

// 3. API route audit (P0)
const apiRoutes = [
  ['POST', '/api/session/register'], ['GET', '/api/quota/course-status'],
  ['GET', '/api/progress/difficulty'], ['GET', '/api/progress/history'],
  ['GET', '/api/quiz-batch-get'], ['POST', '/api/quiz-batch-create'],
  ['POST', '/api/matches-create'], ['GET', '/api/daily-challenge'],
];
for (const [method, p] of apiRoutes) {
  const { status, ct } = await httpGet(`http://localhost:${API_PORT}${p}`);
  report(`API ${method} ${p} returns JSON (not HTML/405)`, ct.includes('json') && status !== 405,
    `status=${status ?? 'ERR'} ct=${ct.split(';')[0]}`);
}

// 4. SEO / metadata (P0)
const robots = await httpGet(`http://localhost:${WEB_PORT}/robots.txt`);
report('robots.txt served', robots.status === 200 && robots.body.includes('Sitemap: https://www.polynurse.com.ng/sitemap.xml'), `status=${robots.status}`);
const sitemap = await httpGet(`http://localhost:${WEB_PORT}/sitemap.xml`);
report('sitemap.xml served (public urls)', sitemap.status === 200 && sitemap.body.includes('<urlset') && !sitemap.body.includes('/dashboard'), `status=${sitemap.status}`);
const manifest = await httpGet(`http://localhost:${WEB_PORT}/manifest.webmanifest`);
report('manifest.webmanifest served', manifest.status === 200 && manifest.body.includes('"short_name": "Polynurse"'), `status=${manifest.status}`);
const idx = await httpGet(`http://localhost:${WEB_PORT}/`);
report('index.html has Polynurse title + OG', idx.status === 200 && idx.body.includes('Polynurse Exam Center') && idx.body.includes('og:title'), `status=${idx.status}`);

// 5. Browser checks (brand, routing, no runtime errors)
try {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('favicon')) pageErrors.push(m.text().slice(0, 200)); });

  // Signup (public) loads + brand
  await page.goto(`http://localhost:${WEB_PORT}/signup`, { timeout: 20000 });
  await page.waitForTimeout(6000);
  const signupTitle = await page.title().catch(() => '');
  const signupBody = ((await page.textContent('body').catch(() => '')) || '').replace(/\s+/g, ' ');
  report('Signup page mounts + brand renders', signupTitle.includes('Polynurse') && signupBody.includes('Polynurse Exam Center'), `title=${JSON.stringify(signupTitle)}`);
  report('No "Apex Scholars" on signup page', !signupBody.includes('Apex Scholars'));

  // Root redirect (unauth)
  await page.goto(`http://localhost:${WEB_PORT}/`, { timeout: 20000 });
  await page.waitForTimeout(2500);
  report('Root redirects (unauth)', /signup|login/.test(page.url()), `url=${page.url()}`);

  // Protected route requires auth + adds noindex
  await page.goto(`http://localhost:${WEB_PORT}/quiz`, { timeout: 20000 });
  await page.waitForTimeout(2500);
  report('/quiz redirects to login when unauth (RequireAuth protects quiz)', /login/.test(page.url()), `url=${page.url()}`);

  await page.goto(`http://localhost:${WEB_PORT}/dashboard`, { timeout: 20000 });
  await page.waitForTimeout(2500);
  report('/dashboard redirects to login when unauth', /login/.test(page.url()), `url=${page.url()}`);

  await browser.close();
  report('No uncaught page errors during public navigation', pageErrors.length === 0, pageErrors.slice(0, 3).join('; ').slice(0, 200));
} catch (e) {
  report('Browser verification ran', false, e.message.slice(0, 200));
}

console.log(`\n=== RUNTIME VERIFICATION: ${pass} PASS / ${fail} FAIL ===`);

function cleanup(list) {
  for (const c of list) { try { c.kill(); } catch {} }
}
cleanup(children);
process.exit(fail === 0 ? 0 : 1);
