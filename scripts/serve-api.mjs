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

const API_DIR = path.join(process.cwd(), 'api');

const handlers = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js') && entry.name !== '_utils.js') {
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
  const handler = handlers.find(h => pathname === h.route || pathname.startsWith(h.route + '/'));
  if (!handler) {
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
    await (mod.default || mod.handler)(req, resShim);
  } catch (err) {
    console.error(`[api] ${pathname} failed:`, err.stack || err.message);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal Server Error', detail: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`[serve-api] ${handlers.length} functions mounted on http://localhost:${PORT}`);
  handlers.forEach(h => console.log(`  ${h.route}  <-  ${path.relative(process.cwd(), h.file)}`));
});