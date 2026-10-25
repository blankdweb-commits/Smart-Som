// api/_economy.js
//
// Smart Coin transfers + the World Bank, mounted on the api/quiz.js serverless
// function (underscore prefix -> NOT deployed on its own, preserving the Vercel
// Hobby 12-function budget).
//
// Endpoints (dispatched by api/quiz.js on the original req.url):
//   GET  /api/economy/overview
//   POST /api/economy/transfer   { toUserId, amount, requestId }
//   GET  /api/economy/bank
//   POST /api/economy/borrow     { amount, requestId }
//   POST /api/economy/repay      { loanId, requestId }
//
// These are THIN wrappers. Every amount, cap, interest rate and window is
// decided inside the v81 SECURITY DEFINER RPCs (sc_transfer / worldbank_*),
// which read server_config and use the canonical _sc_apply ledger mutator. The
// server here adds the things an RPC cannot: session authorisation, a
// service-role connection, and validating the REQUEST shape before it reaches
// SQL. No amount is ever accepted from the client as authority - it is a
// request the database then validates against the real config.
//
// requestId is REQUIRED for every mutating call: it becomes the deterministic
// client_request_id, so a double-tap or a retry cannot move coins twice.

import crypto from 'crypto';
import { promisify } from 'util';
import { authorizeRequest, getSupabaseAdmin, getSupabaseUserFromRequest, getTokenFromRequest } from './_utils.js';

const scryptAsync = promisify(crypto.scrypt);
const PIN_RE = /^\d{6}$/;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;
const PIN_RECOVERY_MAX_AGE_SECONDS = 15 * 60;

const TRANSFER_CONFIG_FALLBACK = {
  min_sc: 1, max_sc: 200, daily_cap_sc: 500, hourly_count: 10, fee_sc: 0, enabled: true,
};
const BANK_CONFIG_FALLBACK = {
  min_sc: 10, max_sc: 200, interest_pct: 10, term_days: 7,
  max_outstanding_sc: 400, max_active_loans: 1, capital_sc: 10000, enabled: true,
};

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);

const readBody = (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
};

const intOr = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

const noStore = (res) => res.setHeader('Cache-Control', 'no-store');

const readPin = (req, body = {}) => {
  const raw = body?.pin ?? req.headers?.['x-wallet-pin'];
  return typeof raw === 'string' ? raw.trim() : '';
};

const pinFailure = (status, error, message, extra = {}) => ({
  ok: false,
  status,
  body: { ok: false, error, message, ...extra },
});

const hashPin = async (pin) => {
  const salt = crypto.randomBytes(16);
  const derived = await scryptAsync(pin, salt, 64);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
};

const verifyPinHash = async (pin, stored) => {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (!expected.length) return false;
  const derived = Buffer.from(await scryptAsync(pin, Buffer.from(saltHex, 'hex'), expected.length));
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
};

const getPinState = async (admin, userId) => {
  const { data, error } = await admin
    .from('wallet_pins')
    .select('locked_until')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;

  const lockedUntil = data?.locked_until ? new Date(data.locked_until).getTime() : 0;
  const locked = lockedUntil > Date.now();
  return {
    exists: !!data,
    locked,
    retryAfterSeconds: locked ? Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000)) : 0,
  };
};

const verifyWalletPin = async (admin, userId, pin) => {
  if (!pin) return pinFailure(428, 'PIN_REQUIRED', 'Enter your wallet PIN.');
  if (!PIN_RE.test(pin)) return pinFailure(400, 'INVALID_PIN', 'Wallet PIN must be exactly 6 digits.');

  const { data: row, error } = await admin
    .from('wallet_pins')
    .select('pin_hash, locked_until')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return pinFailure(500, 'PIN_LOOKUP_FAILED', 'Could not check your wallet PIN.');
  if (!row) return pinFailure(428, 'PIN_NOT_SET', 'Set a wallet PIN first.');

  const lockedUntil = row.locked_until ? new Date(row.locked_until).getTime() : 0;
  if (lockedUntil > Date.now()) {
    return pinFailure(423, 'PIN_LOCKED', 'Too many wrong attempts. Try again shortly.', {
      retryAfterSeconds: Math.max(1, Math.ceil((lockedUntil - Date.now()) / 1000)),
    });
  }

  if (!(await verifyPinHash(pin, row.pin_hash))) {
    const { data, error: failureError } = await admin.rpc('wallet_pin_record_failure', {
      p_user: userId,
      p_max_attempts: PIN_MAX_ATTEMPTS,
      p_lock_minutes: PIN_LOCK_MINUTES,
    });
    if (failureError) return pinFailure(500, 'PIN_CHECK_FAILED', 'Could not verify your wallet PIN.');

    const result = data || {};
    if (result.error === 'LOCKED') {
      return pinFailure(423, 'PIN_LOCKED', 'Too many wrong attempts. Try again shortly.', {
        retryAfterSeconds: Number(result.retryAfterSeconds) || PIN_LOCK_MINUTES * 60,
      });
    }
    return pinFailure(403, 'PIN_INCORRECT', 'That wallet PIN is not correct.', {
      attemptsRemaining: Math.max(0, Number(result.attemptsRemaining) || 0),
    });
  }

  await admin
    .from('wallet_pins')
    .update({ failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  return { ok: true };
};

const authorizeEconomy = async (req, res) => {
  noStore(res);
  const auth = await authorizeRequest(req);
  if (auth.status !== 200) {
    res.status(auth.status).json(auth.body);
    return null;
  }
  return auth;
};

const requireWalletPin = async (req, res, auth, body = {}) => {
  const check = await verifyWalletPin(getSupabaseAdmin(), auth.user.id, readPin(req, body));
  if (!check.ok) {
    res.status(check.status).json(check.body);
    return false;
  }
  return true;
};

const decodeJwtPayload = (token) => {
  const part = String(token || '').split('.')[1];
  if (!part) return null;
  try {
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

const hasFreshRecoveryProof = (req) => {
  const payload = decodeJwtPayload(getTokenFromRequest(req));
  const amr = Array.isArray(payload?.amr) ? payload.amr : [];
  const now = Math.floor(Date.now() / 1000);

  return amr.some((entry) => {
    const method = typeof entry === 'string' ? entry : entry?.method;
    if (!['recovery', 'otp', 'magiclink'].includes(method)) return false;
    const rawTs = Number(entry?.timestamp);
    if (!Number.isFinite(rawTs) || rawTs <= 0) return false;
    const ts = rawTs > 1e12 ? Math.floor(rawTs / 1000) : rawTs;
    return ts <= now + 60 && now - ts <= PIN_RECOVERY_MAX_AGE_SECONDS;
  });
};

export const ECONOMY_ERRORS = {
  INVALID_AMOUNT: 'Enter an amount inside the allowed range.',
  INVALID_RECIPIENT: 'Choose who you are sending to.',
  SELF_TRANSFER: 'You cannot send coins to yourself.',
  RECIPIENT_NOT_ELIGIBLE: 'That person cannot receive coins yet.',
  DAILY_CAP_REACHED: 'You have hit your daily transfer limit.',
  HOURLY_CAP_REACHED: 'Too many transfers in the last hour. Try again shortly.',
  INSUFFICIENT_FUNDS: 'You do not have enough Smart Coins.',
  INSUFFICIENT_SC: 'You do not have enough Smart Coins to repay that loan.',
  TRANSFERS_DISABLED: 'Transfers are switched off right now.',
  WORLD_BANK_DISABLED: 'The World Bank is closed right now.',
  LOAN_LIMIT_REACHED: 'You already have a bank loan running. Repay it first.',
  OUTSTANDING_CAP_REACHED: 'That would put you over your bank limit.',
  LOAN_ALREADY_SETTLED: 'That loan has already been repaid.',
  NOT_YOUR_LOAN: 'That loan is not yours.',
  BANK_EMPTY: 'The bank has run out of capital.',
  MISSING_REQUEST_ID: 'Missing requestId. Send one so a retry cannot double-spend.',
};

export async function handleEconomyOverview(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;
  if (!(await requireWalletPin(req, res, auth))) return;
  const admin = getSupabaseAdmin();

  const [cfgRes, bankRes, earnedRes, balRes] = await Promise.all([
    admin.from('server_config').select('key, value').in('key', ['transfers', 'world_bank', 'economy', 'loan']),
    admin.rpc('worldbank_status'),
    admin.rpc('sc_earned_total', { p_user: auth.user.id }),
    admin.from('profiles').select('smart_coins').eq('id', auth.user.id).maybeSingle(),
  ]);

  const cfg = {};
  for (const row of cfgRes.data || []) cfg[row.key] = row.value;

  return res.status(200).json({
    ok: true,
    balance: Number(balRes.data?.smart_coins) || 0,
    earned: Number(earnedRes.data) || 0,
    transfers: cfg.transfers || TRANSFER_CONFIG_FALLBACK,
    worldBank: cfg.world_bank || BANK_CONFIG_FALLBACK,
    loan: cfg.loan || null,
    economy: cfg.economy || null,
    bank: bankRes.data || { ok: true, loans: [], outstanding: 0 },
  });
}

export async function handleTransfer(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;
  const body = readBody(req);

  // The request id is what makes this idempotent, so it is mandatory rather
  // than generated here: a client-generated id survives a retry, a
  // server-generated one does not.
  if (!isUuid(body.requestId)) {
    return res.status(400).json({ ok: false, error: 'MISSING_REQUEST_ID', message: ECONOMY_ERRORS.MISSING_REQUEST_ID });
  }
  if (!isUuid(body.toUserId)) {
    return res.status(400).json({ ok: false, error: 'INVALID_RECIPIENT', message: ECONOMY_ERRORS.INVALID_RECIPIENT });
  }

  const amount = intOr(body.amount, 0);
  if (!(await requireWalletPin(req, res, auth, body))) return;
  const user = getSupabaseUserFromRequest(req);
  if (!user) return res.status(502).json({ ok: false, error: 'ECONOMY_UNAVAILABLE', message: 'Could not reach the economy service.' });

  const { data, error } = await user.rpc('sc_transfer', {
    p_to_user: body.toUserId,
    p_amount: amount,
    p_request: body.requestId,
  });

  if (error) return res.status(500).json({ ok: false, error: 'TRANSFER_FAILED', message: error.message });

  const result = data || {};
  if (!result.ok) {
    return res.status(400).json({
      ok: false,
      error: result.error,
      message: ECONOMY_ERRORS[result.error] || 'That transfer could not go through.',
      cap: result.cap,
      min: result.min,
      max: result.max,
    });
  }
  return res.status(200).json(result);
}

export async function handleBankStatus(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;
  if (!(await requireWalletPin(req, res, auth))) return;
  const user = getSupabaseUserFromRequest(req);
  if (!user) return res.status(502).json({ ok: false, error: 'BANK_UNAVAILABLE', message: 'Could not reach the bank.' });
  const { data, error } = await user.rpc('worldbank_status');
  if (error) return res.status(500).json({ ok: false, error: 'BANK_FAILED', message: error.message });
  return res.status(200).json(data || { ok: false, error: 'BANK_FAILED' });
}

export async function handleBorrow(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;
  const body = readBody(req);

  if (!isUuid(body.requestId)) {
    return res.status(400).json({ ok: false, error: 'MISSING_REQUEST_ID', message: ECONOMY_ERRORS.MISSING_REQUEST_ID });
  }
  if (!(await requireWalletPin(req, res, auth, body))) return;

  const user = getSupabaseUserFromRequest(req);
  if (!user) return res.status(502).json({ ok: false, error: 'BORROW_FAILED', message: 'Could not reach the bank.' });
  const { data, error } = await user.rpc('worldbank_borrow', {
    p_amount: intOr(body.amount, 0),
    p_request: body.requestId,
  });

  if (error) return res.status(500).json({ ok: false, error: 'BORROW_FAILED', message: error.message });

  const result = data || {};
  if (!result.ok) {
    return res.status(400).json({
      ok: false,
      error: result.error,
      message: ECONOMY_ERRORS[result.error] || 'The bank could not lend to you right now.',
      min: result.min,
      max: result.max,
      outstanding: result.outstanding,
      cap: result.cap,
    });
  }
  return res.status(200).json(result);
}

export async function handleRepay(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;
  const body = readBody(req);

  if (!isUuid(body.requestId)) {
    return res.status(400).json({ ok: false, error: 'MISSING_REQUEST_ID', message: ECONOMY_ERRORS.MISSING_REQUEST_ID });
  }
  const loanId = Number(body.loanId);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return res.status(400).json({ ok: false, error: 'NOT_YOUR_LOAN', message: ECONOMY_ERRORS.NOT_YOUR_LOAN });
  }
  if (!(await requireWalletPin(req, res, auth, body))) return;

  const user = getSupabaseUserFromRequest(req);
  if (!user) return res.status(502).json({ ok: false, error: 'REPAY_FAILED', message: 'Could not reach the bank.' });
  const { data, error } = await user.rpc('worldbank_repay', {
    p_loan: loanId,
    p_request: body.requestId,
  });

  if (error) return res.status(500).json({ ok: false, error: 'REPAY_FAILED', message: error.message });

  const result = data || {};
  if (!result.ok) {
    return res.status(400).json({
      ok: false,
      error: result.error,
      message: ECONOMY_ERRORS[result.error] || 'That loan could not be repaid.',
      due: result.due,
      balance: result.balance,
    });
  }
  return res.status(200).json(result);
}

export async function handlePinStatus(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;

  try {
    const state = await getPinState(getSupabaseAdmin(), auth.user.id);
    return res.status(200).json({ ok: true, ...state });
  } catch {
    return res.status(500).json({ ok: false, error: 'PIN_STATUS_FAILED', message: 'Could not read your wallet PIN status.' });
  }
}

export async function handlePinSetup(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;
  const body = readBody(req);
  const pin = readPin(req, body);

  if (!PIN_RE.test(pin)) {
    return res.status(400).json({ ok: false, error: 'INVALID_PIN', message: 'Wallet PIN must be exactly 6 digits.' });
  }
  if (typeof body.confirmPin === 'string' && body.confirmPin !== pin) {
    return res.status(400).json({ ok: false, error: 'PIN_MISMATCH', message: 'The PINs do not match.' });
  }

  const admin = getSupabaseAdmin();
  const { data: existing, error: lookupError } = await admin
    .from('wallet_pins')
    .select('user_id')
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (lookupError) {
    return res.status(500).json({ ok: false, error: 'PIN_LOOKUP_FAILED', message: 'Could not set your wallet PIN.' });
  }
  if (existing) {
    return res.status(409).json({ ok: false, error: 'PIN_ALREADY_SET', message: 'A wallet PIN is already set.' });
  }

  const { error } = await admin.from('wallet_pins').insert({
    user_id: auth.user.id,
    pin_hash: await hashPin(pin),
  });
  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'PIN_ALREADY_SET', message: 'A wallet PIN is already set.' });
    }
    return res.status(500).json({ ok: false, error: 'PIN_SETUP_FAILED', message: 'Could not set your wallet PIN.' });
  }

  return res.status(200).json({ ok: true, exists: true });
}

export async function handlePinChange(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;
  const body = readBody(req);
  const newPin = readPin(req, body);
  const currentPin = typeof body.currentPin === 'string' ? body.currentPin.trim() : '';

  if (!PIN_RE.test(newPin)) {
    return res.status(400).json({ ok: false, error: 'INVALID_PIN', message: 'Wallet PIN must be exactly 6 digits.' });
  }
  if (typeof body.confirmPin === 'string' && body.confirmPin !== newPin) {
    return res.status(400).json({ ok: false, error: 'PIN_MISMATCH', message: 'The PINs do not match.' });
  }

  const admin = getSupabaseAdmin();
  const check = await verifyWalletPin(admin, auth.user.id, currentPin);
  if (!check.ok) return res.status(check.status).json(check.body);

  const { data, error } = await admin
    .from('wallet_pins')
    .update({
      pin_hash: await hashPin(newPin),
      failed_attempts: 0,
      locked_until: null,
      last_failed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', auth.user.id)
    .select('user_id')
    .maybeSingle();

  if (error) {
    return res.status(500).json({ ok: false, error: 'PIN_CHANGE_FAILED', message: 'Could not change your wallet PIN.' });
  }
  if (!data) {
    return res.status(428).json({ ok: false, error: 'PIN_NOT_SET', message: 'Set a wallet PIN first.' });
  }

  return res.status(200).json({ ok: true, exists: true });
}

export async function handlePinReset(req, res) {
  const auth = await authorizeEconomy(req, res);
  if (!auth) return;

  if (!hasFreshRecoveryProof(req)) {
    return res.status(403).json({
      ok: false,
      error: 'REAUTH_REQUIRED',
      message: 'Open the password-reset link from your email before resetting the wallet PIN.',
    });
  }

  const body = readBody(req);
  const pin = readPin(req, body);
  if (!PIN_RE.test(pin)) {
    return res.status(400).json({ ok: false, error: 'INVALID_PIN', message: 'Wallet PIN must be exactly 6 digits.' });
  }
  if (typeof body.confirmPin === 'string' && body.confirmPin !== pin) {
    return res.status(400).json({ ok: false, error: 'PIN_MISMATCH', message: 'The PINs do not match.' });
  }

  const { error } = await getSupabaseAdmin().from('wallet_pins').upsert({
    user_id: auth.user.id,
    pin_hash: await hashPin(pin),
    failed_attempts: 0,
    locked_until: null,
    last_failed_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });

  if (error) {
    return res.status(500).json({ ok: false, error: 'PIN_RESET_FAILED', message: 'Could not reset your wallet PIN.' });
  }

  return res.status(200).json({ ok: true, exists: true, reset: true });
}

// Exported for the test/dev surfaces that need a stable id generator.
export const newRequestId = () => crypto.randomUUID();