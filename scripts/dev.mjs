// scripts/dev.mjs — run BOTH the local API server (serve-api.mjs on :3001) and
// Vite (:5173) together.
//
// This is the ONLY sensible dev entrypoint: the Vite proxy (/api ->
// http://localhost:3001, see vite.config.js) is dead unless serve-api is up.
// `npm run dev` therefore runs this file (see package.json); `dev:vite` is the
// Vite-only escape hatch for people who know /api won't work.
//
// Behaviors:
//   * children are spawned WITHOUT a shell (Windows-safe, no orphan cmd.exe)
//   * Ctrl+C / exit kills the whole process tree (taskkill on Windows)
//   * an unexpected child exit triggers a bounded auto-restart of just that
//     child so a transient crash can't take the other server down with it
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MAX_RESTARTS = 5;
const RESTART_RESET_MS = 60_000;
const API_PORT = Number(process.env.API_PORT || 3001);
const API_READY_TIMEOUT_MS = 15_000;

const children = new Map(); // name -> { child, restarts, firstRestartAt, restarting }
let shuttingDown = false;

function log(msg) {
  console.log(`[dev] ${msg}`);
}

function spawnChild(name, args, state = {}) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const rec = {
    child,
    restarts: state.restarts ?? 0,
    firstRestartAt: state.firstRestartAt ?? Date.now(),
    restarting: false,
  };
  children.set(name, rec);

  child.on('exit', (code, signal) => {
    if (children.get(name) !== rec) return; // a newer child owns this name
    clearTimeout(rec.restartTimer);
    if (shuttingDown) return;

    if (rec.restarting) {
      // Triggered by the api/ file watcher — respawn without counting a crash.
      rec.restarting = false;
      log(`Restarting ${name} after api/ file change...`);
      spawnChild(name, args, rec);
      if (name === 'api') finishApiRestart();
      return;
    }
    log(`${name} exited (code=${code}, signal=${signal ?? 'none'}).`);

    const now = Date.now();
    if (now - rec.firstRestartAt > RESTART_RESET_MS) {
      rec.restarts = 0;
      rec.firstRestartAt = now;
    }
    rec.restarts += 1;
    if (rec.restarts > MAX_RESTARTS) {
      log(`${name} crashed ${MAX_RESTARTS} times in a row — giving up. Stopping dev servers.`);
      shutdown();
      return;
    }
    log(`Restarting ${name} (attempt ${rec.restarts}/${MAX_RESTARTS})...`);
    spawnChild(name, args, rec);
  });
  return child;
}

// serve-api.mjs cache-busts only each route's entry file (import(...?t=)), NOT
// its static imports like `./_community.js` / `./_utils.js` / `./_quiz-batches.js`
// — so editing a support module left the running server serving stale handlers
// (a 500 that only goes away on restart). Watching api/ makes dev self-heal.
//
// The watcher used to restart on ANY fs event, including the spurious metadata
// events OneDrive and editors emit without changing a file. That opened a
// window where the Vite proxy answered 503 for requests nobody had triggered.
// Restarts are now content-hash gated, debounced, serialized, and the proxy is
// not exposed until the API has bound its port.
function hashApiTree() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(ROOT, 'api'));
  files.sort();

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(ROOT, file).replace(/\\/g, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function safeHashApiTree() {
  try {
    return hashApiTree();
  } catch (err) {
    log(`Could not hash api/ (${err?.code || err?.message || 'unknown error'}); keeping the last known hash.`);
    return null;
  }
}

let apiHash = safeHashApiTree();
let apiRestarting = false;
let apiPendingRestart = false;
let apiWatchTimer = null;

function waitForApi(timeoutMs = API_READY_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.connect({ port: API_PORT, host: '127.0.0.1' });
      let settled = false;
      const done = (ready) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (ready) resolve(true);
        else if (Date.now() >= deadline) resolve(false);
        else setTimeout(attempt, 120);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    };
    attempt();
  });
}

function finishApiRestart() {
  waitForApi().then((ready) => {
    if (ready) log(`API ready on :${API_PORT}.`);
    else log(`API did not bind :${API_PORT} within ${API_READY_TIMEOUT_MS / 1000}s — check the log above.`);
    apiRestarting = false;
    if (apiPendingRestart) {
      apiPendingRestart = false;
      restartApi();
    }
  });
}

function restartApi() {
  if (apiRestarting) {
    apiPendingRestart = true;
    return;
  }
  const rec = children.get('api');
  if (!rec) return;
  apiRestarting = true;

  const nextHash = safeHashApiTree();
  if (nextHash) apiHash = nextHash;

  // Mark intent BEFORE checking the exit state: if the child already exited,
  // the exit handler (or the next tick of it) will respawn intentionally.
  rec.restarting = true;
  if (rec.child.exitCode !== null || rec.child.signalCode !== null) return;

  rec.restartTimer = setTimeout(() => {
    if (children.get('api') !== rec || !rec.restarting) return;
    log('API did not stop within 5s — killing it again...');
    try { killTree(rec.child.pid); } catch { /* already gone */ }
  }, 5_000);

  try { killTree(rec.child.pid); } catch { rec.restarting = false; }
}

function watchApi() {
  const apiDir = path.join(ROOT, 'api');
  let watcher;
  try {
    watcher = fs.watch(apiDir, { recursive: true }, (_event, filename) => {
      if (filename && !String(filename).endsWith('.js')) return;
      clearTimeout(apiWatchTimer);
      apiWatchTimer = setTimeout(() => {
        const nextHash = safeHashApiTree();
        if (!nextHash) return; // transient read failure; keep the last known hash
        if (nextHash === apiHash) return; // spurious metadata event, no content change
        if (apiRestarting) {
          apiPendingRestart = true;
          return;
        }
        apiHash = nextHash;
        restartApi();
      }, 400);
    });
  } catch {
    return; // recursive watch unsupported on this platform — skip silently
  }
  watcher.on('error', () => { /* keep dev running if watching fails */ });
}

function shutdown() {
  shuttingDown = true;
  clearTimeout(apiWatchTimer);
  for (const rec of children.values()) {
    clearTimeout(rec.restartTimer);
    try { killTree(rec.child.pid); } catch { /* already gone */ }
  }
  setTimeout(() => process.exit(0), 400);
}

// Terminate a child and its descendants. On Windows, child.kill() only nukes
// the direct process; taskkill /T takes the whole tree so Vite/serve-api
// children don't survive and keep binding :5173/:3001.
function killTree(pid) {
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      return;
    } catch { /* fall through to direct kill */ }
  }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
}

process.on('SIGINT', () => { log('SIGINT — shutting down dev servers.'); shutdown(); });
process.on('SIGTERM', () => { log('SIGTERM — shutting down dev servers.'); shutdown(); });

spawnChild('api', ['scripts/serve-api.mjs']);
watchApi();

// Start Vite only after the API has bound its port. Otherwise the first page
// load can race ahead of the API and every /api call shows the proxy's 503.
const apiReady = await waitForApi();
if (apiReady) log(`API ready on :${API_PORT}. Starting Vite.`);
else log(`API did not bind :${API_PORT} within ${API_READY_TIMEOUT_MS / 1000}s — starting Vite anyway; check the log above.`);

spawnChild('vite', ['node_modules/vite/bin/vite.js']);