// scripts/e2e-wallet-http.mjs — the wallet/PIN contract over REAL HTTP.
//
// The older e2e-economy suite calls the v81 RPCs directly with a service-role
// client. That proved the database rules but could not see the API layer, which
// is exactly where the `/api/api/economy/...` double-prefix and the broken
// `auth?.ok` contract lived. This suite boots scripts/serve-api.mjs on a private
// port and drives /api/economy/* with real bearer tokens.
//
// Preflight: migration v110 (wallet_pins) must be applied. Without it the PIN
// routes cannot work, so this exits with a clear MIGRATION v110 REQUIRED message
// instead of reporting a wall of misleading failures.
import { spawn } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const env = loadEnv();
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('Missing VITE_SUPABASE_URL / publishable key / service role key in .env (values are not printed).');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const PORT = Number(env.WALLET_E2E_PORT || (32000 + Math.floor(Math.random() * 2000)));
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = `Wallet-${crypto.randomBytes(6).toString('hex')}!`;
const stamp = Date.now().toString(36);

let pass = 0;
let fail = 0;
const users = [];

function log(label, ok, detail = '') {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function api(pathname, { method = 'GET', token, pin, body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (pin) h['X-Wallet-Pin'] = pin;
  let payload;
  if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${BASE}${pathname}`, { method, headers: h, body: payload, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
    return { status: res.status, headers: res.headers, json };
  } finally {
    clearTimeout(timer);
  }
}

async function balanceOf(id) {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).maybeSingle();
  return Number(data?.smart_coins) || 0;
}

async function mkUser(tag, seedSc) {
  const email = `wallet-${tag}-${stamp}@apextest.local`;
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw new Error(`createUser(${tag}): ${created.error.message}`);
  const id = created.data.user.id;
  users.push({ id, client });

  const activated = await admin.from('profiles').update({ is_activated: true }).eq('id', id);
  if (activated.error) throw new Error(`activate(${tag}): ${activated.error.message}`);

  const seeded = await admin.rpc('_sc_apply', {
    p_user_id: id,
    p_amount: seedSc,
    p_reason: 'e2e_wallet_http_seed',
    p_source: 'e2e',
    p_transaction_type: 'earn',
    p_client_request_id: crypto.randomUUID(),
  });
  if (seeded.error) throw new Error(`seed(${tag}): ${seeded.error.message}`);

  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error) throw new Error(`signIn(${tag}): ${signedIn.error.message}`);

  return { id, email, client, token: signedIn.data.session.access_token };
}

async function waitForApi(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/not-found`, { signal: AbortSignal.timeout?.(2000) });
      if (res.status) return true;
    } catch { /* not listening yet */ }
    await sleep(150);
  }
  return false;
}

async function preflight() {
  const probe = await admin.from('wallet_pins').select('user_id').limit(1);
  if (!probe.error) return true;
  const msg = probe.error.message || '';
  if (/wallet_pins|PGRST205|42P01|schema cache/i.test(msg)) {
    console.error('MIGRATION v110 REQUIRED — apply scripts/migration-v110-wallet-pins.sql, then re-run this suite.');
    return false;
  }
  console.error(`wallet_pins preflight failed: ${msg}`);
  return false;
}

if (!(await preflight())) {
  // Let the keep-alive sockets from the probe settle before exiting: a bare
  // process.exit releases with in-flight handles and libuv on Windows asserts.
  await sleep(250);
  process.exit(2);
}

const child = spawn(process.execPath, ['scripts/serve-api.mjs'], {
  cwd: ROOT,
  env: { ...process.env, API_PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });

const ready = await waitForApi();
if (!ready) {
  console.error(`serve-api did not become ready on :${PORT}.`);
  const tail = childOutput.trim().split(/\r?\n/).slice(-12).join('\n');
  if (tail) console.error(tail);
  child.kill();
  process.exit(1);
}

const PIN = '123456';
const NEW_PIN = '654321';
let A;
let B;
let C;

try {
  A = await mkUser('a', 500);
  B = await mkUser('b', 100);
  C = await mkUser('c', 50);

  log('users start at 500 / 100 / 50 SC', await balanceOf(A.id) === 500 && await balanceOf(B.id) === 100 && await balanceOf(C.id) === 50);

  // ---- PIN lifecycle -----------------------------------------------------
  {
    const noPin = await api('/api/economy/overview', { token: A.token });
    log('overview without a PIN is 428 PIN_REQUIRED',
      noPin.status === 428 && noPin.json?.error === 'PIN_REQUIRED', `status=${noPin.status} error=${noPin.json?.error}`);

    const status0 = await api('/api/economy/pin/status', { token: A.token });
    log('pin/status reports no PIN yet',
      status0.status === 200 && status0.json?.exists === false, `status=${status0.status} exists=${status0.json?.exists}`);

    const short = await api('/api/economy/pin/setup', { method: 'POST', token: A.token, body: { pin: '12345', confirmPin: '12345' } });
    log('a 5-digit PIN is refused',
      short.status === 400 && short.json?.error === 'INVALID_PIN', `status=${short.status} error=${short.json?.error}`);

    const mismatch = await api('/api/economy/pin/setup', { method: 'POST', token: A.token, body: { pin: PIN, confirmPin: '000000' } });
    log('mismatched setup PINs are refused',
      mismatch.status === 400 && mismatch.json?.error === 'PIN_MISMATCH', `status=${mismatch.status} error=${mismatch.json?.error}`);

    const setup = await api('/api/economy/pin/setup', { method: 'POST', token: A.token, body: { pin: PIN, confirmPin: PIN } });
    log('a 6-digit PIN is accepted',
      setup.status === 200 && setup.json?.ok === true, `status=${setup.status}`);

    const again = await api('/api/economy/pin/setup', { method: 'POST', token: A.token, body: { pin: '111111', confirmPin: '111111' } });
    log('a second setup is refused with 409',
      again.status === 409 && again.json?.error === 'PIN_ALREADY_SET', `status=${again.status} error=${again.json?.error}`);

    const status1 = await api('/api/economy/pin/status', { token: A.token });
    log('pin/status now reports the PIN exists',
      status1.status === 200 && status1.json?.exists === true, `status=${status1.status} exists=${status1.json?.exists}`);
  }

  // ---- overview / bank / CORS -------------------------------------------
  {
    const wrong = await api('/api/economy/overview', { token: A.token, pin: '000000' });
    log('a wrong PIN is 403 and reports the remaining attempts',
      wrong.status === 403 && wrong.json?.error === 'PIN_INCORRECT' && wrong.json?.attemptsRemaining === 4,
      `status=${wrong.status} error=${wrong.json?.error} remaining=${wrong.json?.attemptsRemaining}`);

    const good = await api('/api/economy/overview', { token: A.token, pin: PIN });
    log('overview with the right PIN returns the real balance',
      good.status === 200 && good.json?.ok === true && good.json?.balance === 500,
      `status=${good.status} balance=${good.json?.balance}`);

    const bank = await api('/api/economy/bank', { token: A.token, pin: PIN });
    log('bank status requires and accepts the PIN header',
      bank.status === 200 && bank.json?.ok === true, `status=${bank.status} error=${bank.json?.error} body=${JSON.stringify(bank.json).slice(0, 200)}`);

    const preflightCors = await api('/api/economy/overview', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:5173',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'x-wallet-pin',
      },
    });
    const allowHeaders = String(preflightCors.headers.get('access-control-allow-headers') || '').toLowerCase();
    log('CORS preflight allows the X-Wallet-Pin header',
      preflightCors.status === 200
        && preflightCors.headers.get('access-control-allow-origin') === 'http://localhost:5173'
        && allowHeaders.includes('x-wallet-pin'),
      `status=${preflightCors.status} allowHeaders=${allowHeaders}`);
  }

  // ---- transfer (money must move exactly once) --------------------------
  {
    const requestId = crypto.randomUUID();
    const noPin = await api('/api/economy/transfer', {
      method: 'POST', token: A.token,
      body: { requestId, toUserId: B.id, amount: 25 },
    });
    log('transfer without a PIN is refused before any money moves',
      noPin.status === 428 && noPin.json?.error === 'PIN_REQUIRED' && await balanceOf(A.id) === 500,
      `status=${noPin.status} A=${await balanceOf(A.id)}`);

    const wrong = await api('/api/economy/transfer', {
      method: 'POST', token: A.token, pin: '000000',
      body: { requestId, toUserId: B.id, amount: 25 },
    });
    log('transfer with a wrong PIN is 403 and moves nothing',
      wrong.status === 403 && wrong.json?.error === 'PIN_INCORRECT' && await balanceOf(A.id) === 500,
      `status=${wrong.status} A=${await balanceOf(A.id)}`);

    const ok = await api('/api/economy/transfer', {
      method: 'POST', token: A.token, pin: PIN,
      body: { requestId, toUserId: B.id, amount: 25 },
    });
    log('transfer with the right PIN moves 25 SC',
      ok.status === 200 && await balanceOf(A.id) === 475 && await balanceOf(B.id) === 125,
      `status=${ok.status} error=${ok.json?.error} A=${await balanceOf(A.id)} B=${await balanceOf(B.id)}`);

    const replay = await api('/api/economy/transfer', {
      method: 'POST', token: A.token, pin: PIN,
      body: { requestId, toUserId: B.id, amount: 25 },
    });
    log('replaying the same requestId does not double-spend',
      replay.status === 200 && await balanceOf(A.id) === 475 && await balanceOf(B.id) === 125,
      `status=${replay.status} error=${replay.json?.error} A=${await balanceOf(A.id)} B=${await balanceOf(B.id)}`);
  }

  // ---- World Bank (borrow/repay through the same HTTP contract) ----------
  {
    const requestId = crypto.randomUUID();
    const noPin = await api('/api/economy/borrow', {
      method: 'POST', token: A.token, body: { requestId, amount: 20 },
    });
    log('borrow without a PIN is refused',
      noPin.status === 428 && noPin.json?.error === 'PIN_REQUIRED', `status=${noPin.status} error=${noPin.json?.error}`);

    const borrow = await api('/api/economy/borrow', {
      method: 'POST', token: A.token, pin: PIN, body: { requestId, amount: 20 },
    });
    log('borrow with the PIN credits the principal',
      borrow.status === 200 && borrow.json?.ok === true && await balanceOf(A.id) === 495,
      `status=${borrow.status} error=${borrow.json?.error} A=${await balanceOf(A.id)} loan=${borrow.json?.loanId}`);

    const loanId = borrow.json?.loanId;
    const repayNoPin = await api('/api/economy/repay', {
      method: 'POST', token: A.token, body: { requestId: crypto.randomUUID(), loanId },
    });
    log('repay without a PIN is refused',
      repayNoPin.status === 428 && repayNoPin.json?.error === 'PIN_REQUIRED' && await balanceOf(A.id) === 495,
      `status=${repayNoPin.status} error=${repayNoPin.json?.error} A=${await balanceOf(A.id)}`);

    const repay = await api('/api/economy/repay', {
      method: 'POST', token: A.token, pin: PIN, body: { requestId: crypto.randomUUID(), loanId },
    });
    log('repay with the PIN debits principal + interest (22)',
      repay.status === 200 && repay.json?.ok === true && await balanceOf(A.id) === 473,
      `status=${repay.status} error=${repay.json?.error} A=${await balanceOf(A.id)}`);
  }

  // ---- the exact regression that caused the incident --------------------
  {
    const doubled = await api('/api/api/economy/overview', { token: A.token, pin: PIN });
    log('the old double-prefixed path is a JSON 404, not a live route',
      doubled.status === 404 && doubled.json?.error, `status=${doubled.status} error=${doubled.json?.error}`);
  }

  // ---- PIN change --------------------------------------------------------
  {
    const wrongCurrent = await api('/api/economy/pin/change', {
      method: 'POST', token: A.token,
      body: { currentPin: '000000', pin: NEW_PIN, confirmPin: NEW_PIN },
    });
    log('pin/change refuses a wrong current PIN',
      wrongCurrent.status === 403 && wrongCurrent.json?.error === 'PIN_INCORRECT',
      `status=${wrongCurrent.status} error=${wrongCurrent.json?.error}`);

    const changed = await api('/api/economy/pin/change', {
      method: 'POST', token: A.token,
      body: { currentPin: PIN, pin: NEW_PIN, confirmPin: NEW_PIN },
    });
    log('pin/change accepts the right current PIN',
      changed.status === 200 && changed.json?.ok === true, `status=${changed.status}`);

    const oldPin = await api('/api/economy/overview', { token: A.token, pin: PIN });
    log('the old PIN no longer works',
      oldPin.status === 403 && oldPin.json?.error === 'PIN_INCORRECT', `status=${oldPin.status} error=${oldPin.json?.error}`);

    const newPin = await api('/api/economy/overview', { token: A.token, pin: NEW_PIN });
    log('the new PIN works',
      newPin.status === 200 && newPin.json?.balance === 473, `status=${newPin.status} balance=${newPin.json?.balance}`);
  }

  // ---- reset is not a PIN-less backdoor ---------------------------------
  {
    const reset = await api('/api/economy/pin/reset', {
      method: 'POST', token: A.token,
      body: { pin: '777777', confirmPin: '777777' },
    });
    log('pin/reset without a fresh recovery session is 403 REAUTH_REQUIRED',
      reset.status === 403 && reset.json?.error === 'REAUTH_REQUIRED',
      `status=${reset.status} error=${reset.json?.error}`);
  }

  // ---- lockout -----------------------------------------------------------
  {
    const setup = await api('/api/economy/pin/setup', {
      method: 'POST', token: C.token, body: { pin: PIN, confirmPin: PIN },
    });
    log('lockout user can set a PIN', setup.status === 200, `status=${setup.status}`);

    const remaining = [];
    for (let i = 0; i < 4; i += 1) {
      const attempt = await api('/api/economy/overview', { token: C.token, pin: '000000' });
      remaining.push(attempt.json?.attemptsRemaining);
      log(`wrong attempt ${i + 1}/4 is 403 with ${4 - i} left`,
        attempt.status === 403 && attempt.json?.attemptsRemaining === 4 - i,
        `status=${attempt.status} remaining=${attempt.json?.attemptsRemaining}`);
    }

    const fifth = await api('/api/economy/overview', { token: C.token, pin: '000000' });
    log('the fifth wrong attempt locks the PIN (423)',
      fifth.status === 423 && fifth.json?.error === 'PIN_LOCKED',
      `status=${fifth.status} error=${fifth.json?.error} remaining=${JSON.stringify(remaining)}`);

    const correctWhileLocked = await api('/api/economy/overview', { token: C.token, pin: PIN });
    log('even the correct PIN is refused while locked',
      correctWhileLocked.status === 423 && correctWhileLocked.json?.error === 'PIN_LOCKED',
      `status=${correctWhileLocked.status} error=${correctWhileLocked.json?.error}`);
  }
} catch (err) {
  log('SUITE ERROR - ' + (err?.message || err), false);
} finally {
  for (const u of users) {
    try { await admin.from('worldbank_loans').delete().eq('user_id', u.id); } catch { /* ignore */ }
    try { await admin.auth.admin.deleteUser(u.id); } catch { /* ignore */ }
  }
  child.kill();
  await sleep(300);
  if (!child.killed) {
    try { child.kill('SIGKILL'); } catch { /* gone */ }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
