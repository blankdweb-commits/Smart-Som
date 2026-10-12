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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const MAX_RESTARTS = 5;
const RESTART_RESET_MS = 60_000;

const children = new Map(); // name -> { child, restarts, firstRestartAt }

function log(msg) {
  console.log(`[dev] ${msg}`);
}

function spawnChild(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (code, signal) => {
    const rec = children.get(name);
    if (!rec) return;
    const unexpected = children.size > 0 && rec.child === child;
    if (!unexpected) return;
    if (rec.intentionalKill) {
      // Triggered by the api/ file watcher — respawn without counting a crash.
      rec.intentionalKill = false;
      log(`Restarting ${name} after api/ file change...`);
      rec.child = spawnChild(name, args);
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
    rec.child = spawnChild(name, args);
  });
  children.set(name, { child, restarts: 0, firstRestartAt: Date.now() });
  return child;
}

// Watch api/*.js and restart the API child on change. serve-api.mjs cache-busts
// only each route's entry file (import(...?t=)), NOT its static imports like
// `./_community.js` / `./_utils.js` / `./_quiz-batches.js` — so editing a
// support module left the running server serving stale handlers (a 500 that
// only goes away on restart). Watching api/ makes the dev server self-heal.
let apiWatchTimer = null;
function watchApi() {
  const apiDir = path.join(ROOT, 'api');
  let watcher;
  try {
    watcher = fs.watch(apiDir, { recursive: true }, (_event, filename) => {
      if (filename && !String(filename).endsWith('.js')) return;
      clearTimeout(apiWatchTimer);
      apiWatchTimer = setTimeout(() => {
        const rec = children.get('api');
        if (!rec) return;
        rec.intentionalKill = true;
        try { killTree(rec.child.pid); } catch { /* already gone */ }
      }, 250);
    });
  } catch {
    return; // recursive watch unsupported on this platform — skip silently
  }
  watcher.on('error', () => { /* keep dev running if watching fails */ });
}

function shutdown() {
  for (const { child } of children.values()) {
    try { killTree(child.pid); } catch { /* already gone */ }
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
spawnChild('vite', ['node_modules/vite/bin/vite.js']);
watchApi();