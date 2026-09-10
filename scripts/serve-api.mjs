// scripts/serve-api.mjs
// Mounts the Vercel serverless functions in api/ on a local HTTP server so the
// Vite dev proxy (/api -> http://localhost:3001) can exercise the real backend
// without `vercel dev`. Usage: node scripts/serve-api.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadEnv } from './e2e-utils.mjs';

const PORT = Number(process.env.API_PORT || 3001);

// Load .env into process.env so api/_utils.js can build the Supabase admin client.
Object.assign(process.env, loadEnv());

// Fail loudly at startup when the Supabase backend would be unusable, instead
// of every handler failing at request time with a confusing 500.
if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[serve-api] WARNING: VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env —');
  console.warn('[serve-api]   authenticated routes will 500 with "Server configuration error".');
}

const API_DIR = path.join(process.cwd(), 'api');

// Mirrors the `rewrites` table in vercel.json so the legacy nested paths behave
// identically on the local API server and on Vercel. Vercel only exposes
// TOP-LEVEL api/*.js files as functions, so /api/quiz/batch-* etc. are rewritten
// onto the flat route names here too.
const REWRITES = [
  { source: '/api/quiz/batch-create', destination: '/api/quiz-batch-create' },
  { source: '/api/quiz/batch-get', destination: '/api/quiz-batch-get' },
  { source: '/api/quiz/batch-answer', destination: '/api/quiz-batch-answer' },
  { source: '/api/quiz/batch-complete', destination: '/api/quiz-batch-complete' },
  { source: '/api/matches/create', destination: '/api/matches-create' },
  { source: '/api/payments/webhook', destination: '/api/payments-webhook' },
];

const handlers = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    // Skip support modules: Vercel ignores files starting with `_` in api/, so
    // they are never HTTP handlers (mirrored here for faithful local parity).
    else if (entry.name.endsWith('.js') && !entry.name.startsWith('_')) {
      const rel = path.relative(API_DIR, full).replace(/\\/g, '/').replace(/\.js$/, '');
      handlers.push({ route: `/api/${rel}`, file: full });
    }
  }
};
walk(API_DIR);
handlers.sort((a, b) => b.route.length - a.route.length);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  // Rewrite legacy nested paths onto their flat routes (same as Vercel). Only
  // the path is remapped; query strings and req.url are preserved for dispatch.
  const rewrite = REWRITES.find(r => pathname === r.source);
  const effectivePath = rewrite ? rewrite.destination : pathname;
  const handler = handlers.find(h => effectivePath === h.route || effectivePath.startsWith(h.route + '/'));
  if (!handler) {
    // Delegate unmatched /api/* to the SAME not-found.js handler Vercel routes
    // to via its `/api/:path* -> /api/not-found` rewrite, so local and prod
    // reply with an identical JSON 404 (never the SPA HTML).
    try {
      const mod = await import(pathToFileURL(path.join(API_DIR, 'not-found.js')).href + `?t=${Date.now()}`);
      const fn = mod.default || mod.handler;
      if (typeof fn === 'function') {
        const fallbackRes = {
          _status: 404,
          status(code) { this._status = code; return this; },
          json(payload) {
            if (!res.headersSent) res.writeHead(this._status || 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
          },
          setHeader: (k, v) => res.setHeader(k, v),
          end: (s) => res.end(s)
        };
        await fn(req, fallbackRes);
        return;
      }
    } catch { /* fall through to the lean fallback below */ }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found', path: pathname }));
  }

  let body = {};
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    try {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => { data += c; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  }

  const resShim = {
    json(payload) {
      if (!res.headersSent) {
        res.writeHead(resShim._status || 200, { 'Content-Type': 'application/json' });
      }
      res.end(JSON.stringify(payload));
    },
    status(code) {
      resShim._status = code;
      return resShim;
    },
    setHeader: (k, v) => res.setHeader(k, v),
    end: (s) => res.end(s)
  };
  req.body = body;
  req.query = Object.fromEntries(url.searchParams.entries());
  req.params = {};

  try {
    const mod = await import(pathToFileURL(handler.file).href + `?t=${Date.now()}`);
    const fn = mod.default || mod.handler;
    // Some files under api/ are service modules (e.g. questionSelectionService.js,
    // selectionConfig.js), not HTTP handlers. Don't crash on them — 404 instead.
    if (typeof fn !== 'function') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Not a handler', path: pathname }));
    }
    await fn(req, resShim);
  } catch (err) {
    console.error(`[api] ${req.method} ${pathname} failed:`, err.stack || err.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', detail: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[serve-api] ${handlers.length} functions mounted on http://localhost:${PORT}`);
  handlers.forEach(h => console.log(`  ${h.route}  <-  ${path.relative(process.cwd(), h.file)}`));
});