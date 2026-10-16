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
import { authorizeRequest, getSupabaseAdmin } from './_utils.js';

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
  const auth = await authorizeRequest(req, res);
  if (!auth?.ok) return;
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
  const auth = await authorizeRequest(req, res);
  if (!auth?.ok) return;
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
  const admin = getSupabaseAdmin();

  const { data, error } = await admin.rpc('sc_transfer', {
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
  const auth = await authorizeRequest(req, res);
  if (!auth?.ok) return;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('worldbank_status');
  if (error) return res.status(500).json({ ok: false, error: 'BANK_FAILED', message: error.message });
  return res.status(200).json(data || { ok: false, error: 'BANK_FAILED' });
}

export async function handleBorrow(req, res) {
  const auth = await authorizeRequest(req, res);
  if (!auth?.ok) return;
  const body = readBody(req);

  if (!isUuid(body.requestId)) {
    return res.status(400).json({ ok: false, error: 'MISSING_REQUEST_ID', message: ECONOMY_ERRORS.MISSING_REQUEST_ID });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('worldbank_borrow', {
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
  const auth = await authorizeRequest(req, res);
  if (!auth?.ok) return;
  const body = readBody(req);

  if (!isUuid(body.requestId)) {
    return res.status(400).json({ ok: false, error: 'MISSING_REQUEST_ID', message: ECONOMY_ERRORS.MISSING_REQUEST_ID });
  }
  const loanId = Number(body.loanId);
  if (!Number.isFinite(loanId) || loanId <= 0) {
    return res.status(400).json({ ok: false, error: 'NOT_YOUR_LOAN', message: ECONOMY_ERRORS.NOT_YOUR_LOAN });
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc('worldbank_repay', {
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

// Exported for the test/dev surfaces that need a stable id generator.
export const newRequestId = () => crypto.randomUUID();