// api/_loans.js
//
// Loan Shark (milestone S9) — support module for the api/quiz.js serverless
// function (underscore prefix -> NOT deployed as its own function, preserving
// the Vercel Hobby 12-function budget).
//
// Endpoints (dispatched by api/quiz.js on the original req.url):
//   GET  /api/loans/list                    -> my loans + open marketplace + profile + config
//   POST /api/loans/request  { amount, note, requestId }
//   POST /api/loans/offer    { loanId }
//   POST /api/loans/accept   { loanId, requestId }
//   POST /api/loans/repay    { loanId, requestId }
//   POST /api/loans/reject   { loanId }
//   POST /api/loans/cancel   { loanId }
//   POST /api/loans/shark-buy { requestId }
//   POST /api/loans/default  { loanId }
//
// PEER-TO-PEER, SC-only. Every balance change goes through the canonical
// _sc_apply ledger mutator inside the v50 RPCs, so:
//   * the lender's principal leaves their real balance on accept (cannot be
//     double-spent or double-wagered),
//   * the borrower receives it in the SAME profiles.smart_coins the duel/wager
//     system uses,
//   * default recovery sweeps only the borrower's available SC (never negative).
// No shadow wallet, no fiat, no client writes (RLS = read-own; the RPCs are
// service_role only). The server owns every amount, cap, interest and window.

import crypto from 'crypto';
import { authorizeRequest, getSupabaseAdmin } from './_utils.js';

const LOAN_CONFIG_KEY = 'loan';
const LOAN_CONFIG_FALLBACK = {
  normal_max_active_loans: 3,
  shark_max_active_loans: 10,
  interest_pct: 10,
  repayment_window_hours: 48,
  shark_license_fee_sc: 500,
  shark_require_balance_sc: 1500,
  min_principal_sc: 1,
  max_principal_sc: 100000,
};

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);

const LOAN_COLUMNS =
  'id, borrower_id, lender_id, principal_sc, interest_pct, interest_sc, total_due_sc, status, note, created_at, offered_at, accepted_at, due_at, repaid_at, defaulted_at, recovered_sc, forfeited_sc, updated_at';

async function readConfig(supabase) {
  try {
    const { data } = await supabase.rpc('server_config_get', { p_key: LOAN_CONFIG_KEY });
    if (data && typeof data === 'object') return { ...LOAN_CONFIG_FALLBACK, ...data };
  } catch {
    /* fall through */
  }
  return { ...LOAN_CONFIG_FALLBACK };
}

function exposedConfig(cfg) {
  return {
    normal_max_active_loans: Number(cfg.normal_max_active_loans) || LOAN_CONFIG_FALLBACK.normal_max_active_loans,
    shark_max_active_loans: Number(cfg.shark_max_active_loans) || LOAN_CONFIG_FALLBACK.shark_max_active_loans,
    interest_pct: Number(cfg.interest_pct) || LOAN_CONFIG_FALLBACK.interest_pct,
    repayment_window_hours: Number(cfg.repayment_window_hours) || LOAN_CONFIG_FALLBACK.repayment_window_hours,
    shark_license_fee_sc: Number(cfg.shark_license_fee_sc) || LOAN_CONFIG_FALLBACK.shark_license_fee_sc,
    shark_require_balance_sc: Number(cfg.shark_require_balance_sc) || LOAN_CONFIG_FALLBACK.shark_require_balance_sc,
    min_principal_sc: Number(cfg.min_principal_sc) || LOAN_CONFIG_FALLBACK.min_principal_sc,
    max_principal_sc: Number(cfg.max_principal_sc) || LOAN_CONFIG_FALLBACK.max_principal_sc,
  };
}

async function nameMap(supabase, ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return {};
  const { data } = await supabase.from('community_profiles').select('id, display_name').in('id', unique);
  const map = {};
  for (const row of data || []) map[row.id] = row.display_name || 'Scholar';
  return map;
}

async function ensureProfile(supabase, userId) {
  const { data } = await supabase
    .from('loan_profiles')
    .select('user_id, shark_license, defaults_count, loans_taken, loans_repaid')
    .eq('user_id', userId)
    .maybeSingle();
  return data || { user_id: userId, shark_license: false, defaults_count: 0, loans_taken: 0, loans_repaid: 0 };
}

// ============================================================
// GET /api/loans/list
// ============================================================
export async function handleLoanList(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  try {
    const supabase = getSupabaseAdmin();

    const [cfg, profile, mineRes, openRes] = await Promise.all([
      readConfig(supabase),
      ensureProfile(supabase, user.id),
      supabase
        .from('loans')
        .select(LOAN_COLUMNS)
        .or(`borrower_id.eq.${user.id},lender_id.eq.${user.id}`)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('loans')
        .select(LOAN_COLUMNS)
        .eq('status', 'requested')
        .neq('borrower_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    const mine = mineRes.data || [];
    const open = openRes.data || [];

    // Borrower default history is visible to prospective lenders.
    const openBorrowerIds = open.map((l) => l.borrower_id);
    const openProfiles = openBorrowerIds.length
      ? (await supabase
          .from('loan_profiles')
          .select('user_id, defaults_count, loans_repaid, loans_taken')
          .in('user_id', openBorrowerIds)).data || []
      : [];
    const debtorStats = {};
    for (const p of openProfiles) debtorStats[p.user_id] = p;

    const names = await nameMap(supabase, [
      ...mine.flatMap((l) => [l.borrower_id, l.lender_id]),
      ...open.map((l) => l.borrower_id),
      user.id,
    ]);

    const decorate = (l) => ({
      ...l,
      role: l.borrower_id === user.id ? 'borrower' : 'lender',
      borrower_name: names[l.borrower_id] || 'Scholar',
      lender_name: l.lender_id ? names[l.lender_id] || 'Scholar' : null,
      borrower_defaults: debtorStats[l.borrower_id]?.defaults_count ?? (l.borrower_id === user.id ? profile.defaults_count : 0),
    });

    const activeWhere = (l, uid, part) =>
      l.status === 'active' && (part === 'lender' ? l.lender_id === uid : l.borrower_id === uid);
    const asLenderActive = mine.filter((l) => activeWhere(l, user.id, 'lender')).length;
    const cap = profile.shark_license
      ? exposedConfig(cfg).shark_max_active_loans
      : exposedConfig(cfg).normal_max_active_loans;

    return res.status(200).json({
      ok: true,
      profile: {
        shark_license: !!profile.shark_license,
        defaults_count: profile.defaults_count || 0,
        loans_taken: profile.loans_taken || 0,
        loans_repaid: profile.loans_repaid || 0,
        active_as_lender: asLenderActive,
        lender_cap: cap,
      },
      config: exposedConfig(cfg),
      my_loans: mine.map(decorate),
      open_requests: open.map(decorate),
    });
  } catch (err) {
    console.error('[loans list] Error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to load loans.' });
  }
}

// Map a loan RPC error code -> HTTP status.
function rpcStatus(code) {
  switch (code) {
    case 'INSUFFICIENT_FUNDS':
    case 'BALANCE_TOO_LOW':
    case 'LENDER_INSUFFICIENT_FUNDS':
      return 402;
    case 'LENDER_LIMIT':
      return 409;
    case 'SELF_LENDING':
    case 'NOT_BORROWER':
    case 'NOT_LENDER':
    case 'LOAN_NOT_OPEN':
    case 'LOAN_NOT_OFFERED':
    case 'LOAN_NOT_ACTIVE':
    case 'NOT_ACTIONABLE':
    case 'NOT_DUE':
      return 409;
    case 'INVALID_AMOUNT':
      return 400;
    case 'NO_USER':
      return 401;
    default:
      return 400;
  }
}

async function runRpc(res, rpcName, args, successShape) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) {
    console.error(`[loans ${rpcName}] rpc error:`, error);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Loan operation failed.' });
  }
  if (!data || data.ok === false) {
    const code = data?.error || 'OPERATION_FAILED';
    return res.status(rpcStatus(code)).json({ error: code, message: code, ...data });
  }
  return res.status(200).json(successShape(data));
}

const reqIdOf = (v) => (isUuid(v) ? v : crypto.randomUUID());

// ============================================================
// POST handlers
// ============================================================
export async function handleLoanRequest(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: 'INVALID_AMOUNT', message: 'A positive whole SC amount is required.' });
  }
  const note = typeof req.body?.note === 'string' ? req.body.note.slice(0, 200) : null;
  return runRpc(res, 'loan_request', {
    p_borrower_id: user.id,
    p_principal: amount,
    p_client_request_id: reqIdOf(req.body?.requestId),
    p_note: note,
  }, (d) => ({ ok: true, replay: d.replay === true, loan: d.loan }));
}

export async function handleLoanOffer(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);
  if (!isUuid(req.body?.loanId)) return res.status(400).json({ error: 'INVALID_REQUEST', message: 'loanId is required.' });
  return runRpc(res, 'loan_offer', { p_lender_id: user.id, p_loan_id: req.body.loanId }, (d) => ({ ok: true, loan: d.loan }));
}

export async function handleLoanAccept(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);
  if (!isUuid(req.body?.loanId)) return res.status(400).json({ error: 'INVALID_REQUEST', message: 'loanId is required.' });
  return runRpc(res, 'loan_accept', {
    p_user_id: user.id,
    p_loan_id: req.body.loanId,
    p_client_request_id: reqIdOf(req.body?.requestId),
  }, (d) => ({ ok: true, replay: d.replay === true, loan: d.loan, borrower_balance: d.borrower_balance ?? null }));
}

export async function handleLoanRepay(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);
  if (!isUuid(req.body?.loanId)) return res.status(400).json({ error: 'INVALID_REQUEST', message: 'loanId is required.' });
  return runRpc(res, 'loan_repay', {
    p_user_id: user.id,
    p_loan_id: req.body.loanId,
    p_client_request_id: reqIdOf(req.body?.requestId),
  }, (d) => ({ ok: true, replay: d.replay === true, loan: d.loan, borrower_balance: d.borrower_balance ?? null }));
}

export async function handleLoanReject(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);
  if (!isUuid(req.body?.loanId)) return res.status(400).json({ error: 'INVALID_REQUEST', message: 'loanId is required.' });
  return runRpc(res, 'loan_reject', { p_user_id: user.id, p_loan_id: req.body.loanId }, (d) => ({ ok: true, loan: d.loan, withdrawn: d.withdrawn === true }));
}

export async function handleLoanCancel(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);
  if (!isUuid(req.body?.loanId)) return res.status(400).json({ error: 'INVALID_REQUEST', message: 'loanId is required.' });
  return runRpc(res, 'loan_cancel', { p_user_id: user.id, p_loan_id: req.body.loanId }, (d) => ({ ok: true, loan: d.loan }));
}

export async function handleLoanSharkBuy(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);
  return runRpc(res, 'loan_shark_buy', {
    p_user_id: user.id,
    p_client_request_id: reqIdOf(req.body?.requestId),
  }, (d) => ({ ok: true, replay: d.replay === true, shark_license: true, balance_after: d.balance_after ?? null }));
}

export async function handleLoanDefault(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);
  if (!isUuid(req.body?.loanId)) return res.status(400).json({ error: 'INVALID_REQUEST', message: 'loanId is required.' });
  return runRpc(res, 'loan_mark_default', { p_caller_id: user.id, p_loan_id: req.body.loanId }, (d) => ({
    ok: true, replay: d.replay === true, loan: d.loan,
    recovered_sc: d.recovered_sc ?? 0, forfeited_sc: d.forfeited_sc ?? 0,
  }));
}
