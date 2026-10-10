// scripts/e2e-loan-shark.mjs
//
// Live verification of the Loan Shark economy (milestone S9) against the real
// project. Drives the SAME server handlers api/quiz.js dispatches to
// (handleLoanList/Request/Offer/Accept/Repay/Reject/Cancel/SharkBuy/Default)
// with real GoTrue tokens, and probes the DB + RLS with service-role and
// publishable clients.
//
// Contract proven (SC-only, PEER-TO-PEER):
//   1.  a request opens with 10% interest (principal 100 -> owe 110) and is
//       idempotent on client_request_id (one row)
//   2.  the marketplace lists open requests WITH the borrower's public default count
//   3.  a lender offers; the borrower accepts -> principal moves lender -> borrower
//       in the SAME profiles.smart_coins balance (no shadow wallet), due in ~48h
//   4.  accept/repay are idempotent (no double transfer)
//   5.  repayment moves principal + interest back to the lender (+10 net)
//   6.  self-lending is refused; insuffient balance is refused
//   7.  normal lender cap = 3 concurrent, 4th offer -> LENDER_LIMIT (409)
//   8.  Loan Shark licence: needs a >=1500 balance, charges 500 once, is
//       idempotent, and raises the cap to 10
//   9.  default before due -> NOT_DUE; a non-lender cannot recover
//   10. default after due sweeps only available SC (never negative), records
//       recovered/forfeited, and bumps the borrower's public defaults_count
//   11. RLS: clients read only their own loans and cannot insert; the loan RPCs
//       are NOT client-executable
//
// Requires a reachable Supabase project (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// + SUPABASE_SERVICE_ROLE_KEY in .env). Run:
//   npm run e2e:loan-shark
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import {
  handleLoanList, handleLoanRequest, handleLoanOffer, handleLoanAccept, handleLoanRepay,
  handleLoanReject, handleLoanCancel, handleLoanSharkBuy, handleLoanDefault,
} from '../api/_loans.js';

const env = loadEnv();
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const uuid = () => crypto.randomUUID();
const password = 'testpass123';

const call = async (fn, user, { method = 'POST', body = {}, url = '/api/loans/test' } = {}) => {
  const out = { status: 200, body: null };
  const req = { body, url, method, headers: { authorization: `Bearer ${user.token}` }, query: {} };
  const res = {
    _status: 200,
    status(code) { this._status = code; return this; },
    json(payload) { out.status = this._status; out.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  await fn(req, res);
  return out;
};

async function makeUser(tag, seedSc = 0) {
  const email = `loan-${tag}-${Date.now().toString().slice(-7)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const id = data.user.id;
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signin ${tag}: ${se.message}`);
  if (seedSc > 0) {
    const { error: scErr } = await admin.rpc('_sc_apply', {
      p_user_id: id, p_amount: seedSc, p_reason: 'e2e_loan_seed', p_source: 'e2e',
      p_transaction_type: 'earn', p_ref_type: 'e2e', p_ref_id: uuid(),
      p_metadata: { e2e: true }, p_client_request_id: uuid(),
    });
    if (scErr) throw new Error(`seed SC ${tag}: ${scErr.message}`);
  }
  return { id, email, token: s.session.access_token, pub };
}

const balanceOf = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).maybeSingle();
  return data?.smart_coins ?? null;
};
const defaultsOf = async (id) => {
  const { data } = await admin.from('loan_profiles').select('defaults_count, shark_license').eq('user_id', id).maybeSingle();
  return data || { defaults_count: 0, shark_license: false };
};

let users = [];

try {
  const L = await makeUser('lender', 3000);   // lender
  const B = await makeUser('borrower', 500);  // borrower
  const R = await makeUser('rich', 2000);     // shark licence
  const D = await makeUser('default', 1);     // tiny balance -> partial recovery
  const L2 = await makeUser('lender2', 100);  // cap test
  users = [L, B, R, D, L2];

  // ------------------------------------------------------------------
  // 1. Config + request shape
  // ------------------------------------------------------------------
  const list0 = await call(handleLoanList, B, { method: 'GET' });
  const cfg = list0.body?.config || {};
  log('list 200 + config (cap 3/10, 10%, 48h, fee 500/1500)',
    list0.status === 200 && cfg.normal_max_active_loans === 3 && cfg.shark_max_active_loans === 10
      && cfg.interest_pct === 10 && cfg.repayment_window_hours === 48
      && cfg.shark_license_fee_sc === 500 && cfg.shark_require_balance_sc === 1500,
    JSON.stringify(cfg));

  const reqIdB = uuid();
  const reqB = await call(handleLoanRequest, B, { body: { amount: 100, note: 'need coins', requestId: reqIdB } });
  const loanB = reqB.body?.loan;
  log('request 200 -> requested, 10% interest (owe 110)',
    reqB.status === 200 && loanB?.status === 'requested' && loanB?.principal_sc === 100
      && loanB?.interest_sc === 10 && loanB?.total_due_sc === 110,
    JSON.stringify(loanB));

  const reqBReplay = await call(handleLoanRequest, B, { body: { amount: 100, note: 'need coins', requestId: reqIdB } });
  log('request is idempotent (replay, one row)', reqBReplay.body?.replay === true, `replay=${reqBReplay.body?.replay}`);
  const { data: rowsB } = await admin.from('loans').select('id').eq('borrower_id', B.id);
  log('exactly one loan row for borrower', (rowsB || []).length === 1, `n=${(rowsB || []).length}`);

  // ------------------------------------------------------------------
  // 2. Marketplace visibility + borrower default history
  // ------------------------------------------------------------------
  const listL = await call(handleLoanList, L, { method: 'GET' });
  const open = (listL.body?.open_requests || []).find((l) => l.id === loanB.id);
  log('marketplace shows the open request to lenders', !!open, `found=${!!open}`);
  log('open request shows borrower name + default count',
    !!open?.borrower_name && open?.borrower_defaults === 0,
    `name=${open?.borrower_name} defaults=${open?.borrower_defaults}`);

  // ------------------------------------------------------------------
  // 3. Offer + accept (peer-to-peer transfer) + idempotency
  // ------------------------------------------------------------------
  const selfOffer = await call(handleLoanOffer, B, { body: { loanId: loanB.id } });
  log('self-offer refused (SELF_LENDING)', selfOffer.status === 409 && selfOffer.body?.error === 'SELF_LENDING',
    `${selfOffer.status} ${selfOffer.body?.error || ''}`);

  const offer = await call(handleLoanOffer, L, { body: { loanId: loanB.id } });
  log('lender offer -> offered', offer.status === 200 && offer.body?.loan?.status === 'offered',
    `status=${offer.body?.loan?.status}`);

  const bBal0 = await balanceOf(B.id);
  const lBal0 = await balanceOf(L.id);
  const accReqId = uuid();
  const accept = await call(handleLoanAccept, B, { body: { loanId: loanB.id, requestId: accReqId } });
  log('borrower accepts -> active', accept.status === 200 && accept.body?.loan?.status === 'active',
    `status=${accept.body?.loan?.status}`);
  const bBal1 = await balanceOf(B.id);
  const lBal1 = await balanceOf(L.id);
  log('principal moved lender -> borrower in canonical balance',
    bBal1 === bBal0 + 100 && lBal1 === lBal0 - 100, `B ${bBal0}->${bBal1} L ${lBal0}->${lBal1}`);

  const dueHours = (Date.parse(accept.body.loan.due_at) - Date.now()) / 3600000;
  log('due ~48h out', dueHours > 47 && dueHours <= 49, `hours=${dueHours.toFixed(2)}`);

  const acceptReplay = await call(handleLoanAccept, B, { body: { loanId: loanB.id, requestId: accReqId } });
  log('accept replay flagged + no double transfer',
    acceptReplay.body?.replay === true && (await balanceOf(B.id)) === bBal1 && (await balanceOf(L.id)) === lBal1,
    `replay=${acceptReplay.body?.replay}`);

  // ------------------------------------------------------------------
  // 4. Repay (+10 net interest to lender), idempotent
  // ------------------------------------------------------------------
  const repayReqId = uuid();
  const repay = await call(handleLoanRepay, B, { body: { loanId: loanB.id, requestId: repayReqId } });
  log('borrower repays -> repaid', repay.status === 200 && repay.body?.loan?.status === 'repaid',
    `status=${repay.body?.loan?.status}`);
  const bBal2 = await balanceOf(B.id);
  const lBal2 = await balanceOf(L.id);
  log('repay moves principal+interest back (+10 net to lender)',
    bBal2 === bBal1 - 110 && lBal2 === lBal1 + 110 && lBal2 === lBal0 + 10,
    `B ${bBal1}->${bBal2} L ${lBal1}->${lBal2}`);

  const repayReplay = await call(handleLoanRepay, B, { body: { loanId: loanB.id, requestId: repayReqId } });
  log('repay replay flagged + no double payment',
    repayReplay.body?.replay === true && (await balanceOf(B.id)) === bBal2,
    `replay=${repayReplay.body?.replay}`);

  // ------------------------------------------------------------------
  // 5. Insufficient funds at repay
  // ------------------------------------------------------------------
  const thin = await call(handleLoanRequest, D, { body: { amount: 100, requestId: uuid() } });
  const thinLoan = thin.body?.loan;
  await call(handleLoanOffer, L, { body: { loanId: thinLoan.id } });
  await call(handleLoanAccept, D, { body: { loanId: thinLoan.id, requestId: uuid() } });
  const canPay = await balanceOf(D.id);
  log('D received principal (thin borrower)', canPay === 101, `balance=${canPay}`);
  // D owes 110 but has 101 now; drain to 5 to force an overdraft at repay.
  const { error: drainErr } = await admin.rpc('_sc_apply', {
    p_user_id: D.id, p_amount: -(canPay - 5), p_reason: 'e2e_drain', p_source: 'e2e',
    p_transaction_type: 'spend', p_ref_type: 'e2e', p_ref_id: uuid(),
    p_metadata: { e2e: true }, p_client_request_id: uuid(),
  });
  if (drainErr) throw new Error(`drain: ${drainErr.message}`);
  const repayPoor = await call(handleLoanRepay, D, { body: { loanId: thinLoan.id, requestId: uuid() } });
  log('repay with insufficient SC refused (402)', repayPoor.status === 402 && repayPoor.body?.error === 'INSUFFICIENT_FUNDS',
    `${repayPoor.status} ${repayPoor.body?.error || ''}`);

  // ------------------------------------------------------------------
  // 6. Normal lender cap = 3
  // ------------------------------------------------------------------
  const capLoanIds = [];
  for (let i = 0; i < 4; i += 1) {
    const r = await call(handleLoanRequest, B, { body: { amount: 10, requestId: uuid() } });
    capLoanIds.push(r.body.loan.id);
  }
  let capOffers = 0;
  for (const id of capLoanIds.slice(0, 3)) {
    const o = await call(handleLoanOffer, L2, { body: { loanId: id } });
    if (o.status === 200) capOffers += 1;
  }
  log('normal lender can hold 3 offers', capOffers === 3, `offers=${capOffers}`);
  const capBlocked = await call(handleLoanOffer, L2, { body: { loanId: capLoanIds[3] } });
  log('4th offer refused (LENDER_LIMIT 409)', capBlocked.status === 409 && capBlocked.body?.error === 'LENDER_LIMIT',
    `${capBlocked.status} ${capBlocked.body?.error || ''}`);

  // ------------------------------------------------------------------
  // 7. Loan Shark licence
  // ------------------------------------------------------------------
  const poorBuy = await call(handleLoanSharkBuy, B, { body: { requestId: uuid() } });
  log('licence refused below balance requirement (402)',
    poorBuy.status === 402 && poorBuy.body?.error === 'BALANCE_TOO_LOW', `${poorBuy.status} ${poorBuy.body?.error || ''}`);

  const rBal0 = await balanceOf(R.id);
  const buyReq = uuid();
  const buy = await call(handleLoanSharkBuy, R, { body: { requestId: buyReq } });
  log('licence purchase 200 + charges 500 once',
    buy.status === 200 && buy.body?.shark_license === true && (await balanceOf(R.id)) === rBal0 - 500,
    `balance ${rBal0} -> ${await balanceOf(R.id)}`);
  const buyReplay = await call(handleLoanSharkBuy, R, { body: { requestId: buyReq } });
  log('licence replay flagged + no double charge',
    buyReplay.body?.replay === true && (await balanceOf(R.id)) === rBal0 - 500,
    `replay=${buyReplay.body?.replay}`);
  log('profile reflects shark licence', (await defaultsOf(R.id)).shark_license === true);

  // ------------------------------------------------------------------
  // 8. Default recovery (partial, never negative)
  // ------------------------------------------------------------------
  const dLoanId = thinLoan.id; // D owes 110, holds 5
  const earlyDefault = await call(handleLoanDefault, L, { body: { loanId: dLoanId } });
  log('default before due refused (NOT_DUE 409)', earlyDefault.status === 409 && earlyDefault.body?.error === 'NOT_DUE',
    `${earlyDefault.status} ${earlyDefault.body?.error || ''}`);

  const notLender = await call(handleLoanDefault, R, { body: { loanId: dLoanId } });
  log('non-lender cannot recover (NOT_LENDER 409)', notLender.status === 409 && notLender.body?.error === 'NOT_LENDER',
    `${notLender.status} ${notLender.body?.error || ''}`);

  await admin.from('loans').update({ due_at: new Date(Date.now() - 3600000).toISOString() }).eq('id', dLoanId);
  const dBef = await balanceOf(D.id);   // 5
  const lBef = await balanceOf(L.id);
  const def = await call(handleLoanDefault, L, { body: { loanId: dLoanId } });
  const dAft = await balanceOf(D.id);
  log('default -> defaulted', def.status === 200 && def.body?.loan?.status === 'defaulted',
    `status=${def.body?.loan?.status}`);
  log('recovery swept only available SC (never below 0)',
    def.body?.recovered_sc === dBef && dAft === 0, `recovered=${def.body?.recovered_sc} D ${dBef}->${dAft}`);
  log('unrecovered remainder recorded as forfeited',
    def.body?.forfeited_sc === 110 - dBef, `forfeited=${def.body?.forfeited_sc}`);
  log('lender received the recovered SC', (await balanceOf(L.id)) === lBef + dBef, `L ${lBef} -> ${await balanceOf(L.id)}`);
  log('borrower public defaults_count incremented', (await defaultsOf(D.id)).defaults_count === 1,
    `defaults=${(await defaultsOf(D.id)).defaults_count}`);

  // ------------------------------------------------------------------
  // 9. RLS + client RPC lockdown
  // ------------------------------------------------------------------
  const { data: mine } = await B.pub.from('loans').select('borrower_id, lender_id');
  log('RLS: client reads only own loans', (mine || []).every((r) => r.borrower_id === B.id || r.lender_id === B.id),
    `n=${(mine || []).length}`);
  const { error: insErr } = await B.pub.from('loans').insert({ borrower_id: B.id, principal_sc: 5, client_request_id: uuid() });
  log('RLS: client cannot insert a loan', !!insErr, insErr ? insErr.code || 'denied' : 'ALLOWED (bad)');

  const { error: rpcErr } = await B.pub.rpc('loan_request', {
    p_borrower_id: B.id, p_principal: 1, p_client_request_id: uuid(), p_note: null,
  });
  log('loan RPC not client-executable', !!rpcErr, rpcErr ? rpcErr.code || 'denied' : 'ALLOWED (bad)');

  const { data: lpSeen } = await R.pub.from('loan_profiles').select('user_id');
  log('RLS: loan_profiles read-own only', (lpSeen || []).every((r) => r.user_id === R.id), `n=${(lpSeen || []).length}`);

  // ------------------------------------------------------------------
  // 10. Cancel / reject paths
  // ------------------------------------------------------------------
  const cancelReq = await call(handleLoanRequest, B, { body: { amount: 7, requestId: uuid() } });
  const cancelRes = await call(handleLoanCancel, B, { body: { loanId: cancelReq.body.loan.id } });
  log('borrower can cancel a request', cancelRes.status === 200 && cancelRes.body?.loan?.status === 'cancelled',
    `status=${cancelRes.body?.loan?.status}`);

  const rejectReq = await call(handleLoanRequest, B, { body: { amount: 8, requestId: uuid() } });
  await call(handleLoanOffer, L, { body: { loanId: rejectReq.body.loan.id } });
  const rejectRes = await call(handleLoanReject, B, { body: { loanId: rejectReq.body.loan.id } });
  log('borrower can reject an offer', rejectRes.status === 200 && rejectRes.body?.loan?.status === 'rejected',
    `status=${rejectRes.body?.loan?.status}`);

} catch (err) {
  log('FATAL', false, err?.message || String(err));
} finally {
  for (const u of users) {
    try { await admin.from('loans').delete().or(`borrower_id.eq.${u.id},lender_id.eq.${u.id}`); } catch { /* noop */ }
    try { await admin.from('loan_profiles').delete().eq('user_id', u.id); } catch { /* noop */ }
    try { await admin.auth.admin.deleteUser(u.id); } catch { /* noop */ }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}
