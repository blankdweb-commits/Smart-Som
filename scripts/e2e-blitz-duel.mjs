// scripts/e2e-blitz-duel.mjs
//
// Live verification of the Blitz Duel with Flow State (migration v101) against
// the real project. It drives the SAME handlers api/quiz.js dispatches to
// (handleBlitzCreate/State/Answer/Skip/Flow/Settle/Rematch) with real GoTrue
// tokens, and probes the DB + RLS with the service role and publishable clients.
//
// Contract proven:
//   1.  create places the 2 SC stake EXACTLY once and opens a 90s match with a
//       pre-selected, shuffled 32-question board
//   2.  the current question carries four options and NEVER the answer key
//   3.  a replay of create (live match exists) does NOT charge again
//   4.  the server grades (correct +1 / wrong 0), a wrong answer never reveals
//       the answer, and an answered/skipped question moves current_index
//   5.  a retried answer with the same clientRequestId is idempotent (no double
//       score, no second advance)
//   6.  QUESTION_NOT_CURRENT / INVALID_SELECTION / INVALID_PACE refusals
//   7.  skip counts as a skip and never awards
//   8.  Flow toggles are server-timestamped (client sends only true/false)
//   9.  the answer rate limiter returns RATE_LIMITED (429) once the window fills
//   10. settle before the whistle -> MATCH_NOT_ENDED; at/after the whistle the
//       server settles by score vs the bot (win +4 / draw +2 / loss +0), and a
//       settle replay moves no coins
//   11. an action after settlement -> MATCH_CLOSED (with the stored settlement)
//   12. rematch opens a fresh match and charges the stake again
//   13. INSUFFICIENT_FUNDS (402) when the balance cannot cover the stake
//   14. RLS: no client read of blitz_duels / blitz_duel_questions, and no client
//       EXECUTE on the blitz_duel_* RPCs
//
// Time is never faked: the tests advance the clock by moving the row's ends_at
// with the service role (a data state), so every rule still runs for real.
//
// Requires a reachable Supabase project (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// + SUPABASE_SERVICE_ROLE_KEY in .env). Run:
//   npm run e2e:blitz-duel
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import {
  handleBlitzCreate,
  handleBlitzState,
  handleBlitzAnswer,
  handleBlitzSkip,
  handleBlitzFlow,
  handleBlitzSettle,
  handleBlitzRematch,
} from '../api/_blitz-duel.js';

const env = loadEnv();
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

// Pure service-role client (never signs in — keeps PostgREST writes RLS-clean).
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const uuid = () => crypto.randomUUID();
const password = 'testpass123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimal req/res harness matching the handler contract.
const call = async (fn, user, { method = 'POST', body = {}, url = '/api/blitz-duel/test', query = {} } = {}) => {
  const out = { status: 200, body: null };
  const req = { body, url, method, headers: { authorization: `Bearer ${user.token}` }, query };
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

async function makeUser(tag) {
  const email = `blitz-${tag}-${Date.now().toString().slice(-7)}-${crypto.randomBytes(2).toString('hex')}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const id = data.user.id;
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signin ${tag}: ${se.message}`);
  return { id, email, token: s.session.access_token, pub };
}

// Seed a known balance through the canonical ledger mutator.
const seedSC = async (id, amount) => {
  const { error } = await admin.rpc('_sc_apply', {
    p_user_id: id,
    p_amount: amount,
    p_reason: 'e2e_blitz_seed',
    p_source: 'e2e',
    p_transaction_type: 'earn',
    p_ref_type: 'e2e',
    p_ref_id: uuid(),
    p_metadata: { e2e: true },
    p_client_request_id: uuid(),
  });
  if (error) throw new Error(`seed SC: ${error.message}`);
};

const balanceOf = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).maybeSingle();
  return data?.smart_coins ?? null;
};

const matchRow = async (id) => {
  const { data } = await admin
    .from('blitz_duels')
    .select('id, status, pace_seconds, stake_sc, payout_sc, question_ids, question_count, current_index, score, correct_count, wrong_count, skip_count, flow_active, ends_at, settlement')
    .eq('id', id)
    .maybeSingle();
  return data;
};

const forceWhistle = async (id) => {
  const past = new Date(Date.now() - 1500).toISOString();
  const { error } = await admin.from('blitz_duels').update({ ends_at: past }).eq('id', id);
  if (error) throw new Error(`forceWhistle: ${error.message}`);
};

const LEAK_KEYS = ['correct_answer', 'explanation', 'rationale'];
const leaks = (payload) => {
  const s = JSON.stringify(payload ?? {});
  return LEAK_KEYS.some((k) => s.includes(`"${k}"`));
};

let users = [];

try {
  // ------------------------------------------------------------------
  // 0. Preconditions
  // ------------------------------------------------------------------
  const { count: bankCount } = await admin
    .from('blitz_duel_questions')
    .select('id', { count: 'exact', head: true });
  log('question bank has at least 32 rows', (bankCount || 0) >= 32, `rows=${bankCount}`);

  const a = await makeUser('a');
  users.push(a);
  await seedSC(a.id, 500);
  const bal0 = await balanceOf(a.id);
  log('seeded SC balance (500)', bal0 === 500, `balance=${bal0}`);

  // ------------------------------------------------------------------
  // 1. Create: stake placed once, 90s match, clean question
  // ------------------------------------------------------------------
  const created = await call(handleBlitzCreate, a, { body: { pace: 7 } });
  log('create 200', created.status === 200, `status=${created.status} ${created.body?.error || ''}`);
  const c = created.body || {};
  const match = c.match || {};
  const matchId = match.id;
  log('create is not a replay', c.replay === false, `replay=${c.replay}`);
  log('match is active', match.status === 'active', `status=${match.status}`);
  log('pace honoured (7)', match.pace === 7, `pace=${match.pace}`);
  log('stake/payout are 2/4', match.stake_sc === 2 && match.payout_sc === 4, `${match.stake_sc}/${match.payout_sc}`);
  log('board is 32 questions at index 0', match.question_count === 32 && match.index === 0, `count=${match.question_count} index=${match.index}`);
  log('clock is open with ~90s left', Number(match.remaining_ms) > 85000 && Number(match.remaining_ms) <= 90000, `remaining=${match.remaining_ms}`);
  log('server_now is present', !!match.server_now, `server_now=${match.server_now}`);

  const q0 = match.question;
  log('current question present', !!q0?.id && typeof q0.text === 'string' && q0.text.length >= 8, `q=${q0?.id}`);
  log('question has exactly four options A-D', ['A', 'B', 'C', 'D'].every((k) => typeof q0?.options?.[k] === 'string' && q0.options[k].length > 0), JSON.stringify(Object.keys(q0?.options || {})));
  log('create payload leaks no answer key', !leaks(c));

  const bal1 = await balanceOf(a.id);
  log('stake debited exactly once (-2)', bal1 === 498, `balance=${bal1}`);
  log('create reports the post-stake balance', Number(c.balance_after) === 498, `balance_after=${c.balance_after}`);

  const row0 = await matchRow(matchId);
  log('row persisted with 32 unique question ids', Array.isArray(row0?.question_ids) && row0.question_ids.length === 32 && new Set(row0.question_ids).size === 32, `n=${row0?.question_ids?.length}`);
  const ids = row0.question_ids;

  // ------------------------------------------------------------------
  // 2. Replay create (live match) must not charge again
  // ------------------------------------------------------------------
  const replayCreate = await call(handleBlitzCreate, a, { body: { pace: 7 } });
  log('replayed create is flagged replay', replayCreate.status === 200 && replayCreate.body?.replay === true, `status=${replayCreate.status} replay=${replayCreate.body?.replay}`);
  log('replayed create returns the SAME match', replayCreate.body?.match?.id === matchId, `id=${replayCreate.body?.match?.id}`);
  log('replayed create did NOT charge again', (await balanceOf(a.id)) === 498, `balance=${await balanceOf(a.id)}`);

  // ------------------------------------------------------------------
  // 3. State resume + no leak + invalid id
  // ------------------------------------------------------------------
  const state1 = await call(handleBlitzState, a, { method: 'GET', query: { matchId } });
  log('state 200', state1.status === 200, `status=${state1.status}`);
  log('state returns the same match at the same index', state1.body?.match?.id === matchId && state1.body?.match?.index === 0, `id=${state1.body?.match?.id}`);
  log('state payload leaks no answer key', !leaks(state1.body));

  const stateBad = await call(handleBlitzState, a, { method: 'GET', query: { matchId: 'not-a-uuid' } });
  log('state with a non-uuid id is 400', stateBad.status === 400 && stateBad.body?.error === 'INVALID_REQUEST', `status=${stateBad.status}`);

  // ------------------------------------------------------------------
  // 4. Grading: wrong then correct — never reveals the key
  // ------------------------------------------------------------------
  const correctFor = async (qid) => {
    const { data } = await admin.from('blitz_duel_questions').select('correct_answer').eq('id', qid).maybeSingle();
    return data?.correct_answer || null;
  };

  const qid0 = ids[0];
  const key0 = await correctFor(qid0);
  const wrong0 = ['A', 'B', 'C', 'D'].find((l) => l !== key0) || 'A';

  const ansWrong = await call(handleBlitzAnswer, a, {
    body: { matchId, questionIndex: 0, selected: wrong0, clientRequestId: uuid() },
  });
  log('wrong answer 200', ansWrong.status === 200, `status=${ansWrong.status}`);
  log('wrong answer grades false / 0 points', ansWrong.body?.action?.correct === false && ansWrong.body?.action?.points === 0, JSON.stringify(ansWrong.body?.action));
  log('wrong answer advances the index to 1', ansWrong.body?.action?.next_index === 1 && ansWrong.body?.match?.index === 1, `next=${ansWrong.body?.action?.next_index}`);
  log('wrong answer never exposes the key', !leaks(ansWrong.body));

  const qid1 = ids[1];
  const key1 = await correctFor(qid1);
  const rid1 = uuid();
  const ansRight = await call(handleBlitzAnswer, a, {
    body: { matchId, questionIndex: 1, selected: key1, clientRequestId: rid1 },
  });
  log('correct answer grades true / +1', ansRight.body?.action?.correct === true && ansRight.body?.action?.points === 1, JSON.stringify(ansRight.body?.action));
  log('score reflects two graded answers', ansRight.body?.match?.mine?.score === 1 && ansRight.body?.match?.mine?.correct === 1 && ansRight.body?.match?.mine?.wrong === 1, JSON.stringify(ansRight.body?.match?.mine));

  // ------------------------------------------------------------------
  // 5. Idempotency + refusals
  // ------------------------------------------------------------------
  const ansReplay = await call(handleBlitzAnswer, a, {
    body: { matchId, questionIndex: 1, selected: key1, clientRequestId: rid1 },
  });
  log('retried answer is flagged replay', ansReplay.status === 200 && ansReplay.body?.replay === true, `status=${ansReplay.status} replay=${ansReplay.body?.replay}`);
  log('retried answer did NOT double the score', ansReplay.body?.match?.mine?.score === 1, `score=${ansReplay.body?.match?.mine?.score}`);
  log('retried answer did NOT advance again', ansReplay.body?.match?.index === 2, `index=${ansReplay.body?.match?.index}`);

  const ansStale = await call(handleBlitzAnswer, a, {
    body: { matchId, questionIndex: 0, selected: key0, clientRequestId: uuid() },
  });
  log('stale index refused 409 QUESTION_NOT_CURRENT', ansStale.status === 409 && ansStale.body?.error === 'QUESTION_NOT_CURRENT', `status=${ansStale.status} ${ansStale.body?.error || ''}`);

  const ansBadSel = await call(handleBlitzAnswer, a, {
    body: { matchId, questionIndex: 2, selected: 'Z', clientRequestId: uuid() },
  });
  log('invalid selection refused 400 INVALID_SELECTION', ansBadSel.status === 400 && ansBadSel.body?.error === 'INVALID_SELECTION', `status=${ansBadSel.status} ${ansBadSel.body?.error || ''}`);

  const createBadPace = await call(handleBlitzCreate, a, { body: { pace: 99 } });
  log('invalid pace refused 400 INVALID_PACE', createBadPace.status === 400 && createBadPace.body?.error === 'INVALID_PACE', `status=${createBadPace.status} ${createBadPace.body?.error || ''}`);

  // ------------------------------------------------------------------
  // 6. Skip (counts as a skip; never awards)
  // ------------------------------------------------------------------
  const skipped = await call(handleBlitzSkip, a, {
    body: { matchId, questionIndex: 2, clientRequestId: uuid() },
  });
  log('skip advances and is flagged', skipped.status === 200 && skipped.body?.action?.skipped === true && skipped.body?.action?.next_index === 3, JSON.stringify(skipped.body?.action));
  log('skip records a skip and adds no score', skipped.body?.match?.mine?.skips === 1 && skipped.body?.match?.mine?.score === 1, JSON.stringify(skipped.body?.match?.mine));

  // ------------------------------------------------------------------
  // 7. Flow State toggle is server-timestamped
  // ------------------------------------------------------------------
  const flowOn = await call(handleBlitzFlow, a, { body: { matchId, active: true, clientRequestId: uuid() } });
  log('flow on accepted', flowOn.status === 200 && flowOn.body?.action?.flow_active === true && flowOn.body?.action?.changed === true, JSON.stringify(flowOn.body?.action));
  log('flow state reflected on the match', flowOn.body?.match?.mine?.flow_active === true, `flow_active=${flowOn.body?.match?.mine?.flow_active}`);
  await sleep(300);
  const flowOff = await call(handleBlitzFlow, a, { body: { matchId, active: false, clientRequestId: uuid() } });
  log('flow off accepted', flowOff.status === 200 && flowOff.body?.action?.flow_active === false, JSON.stringify(flowOff.body?.action));
  log('flow time accumulated is positive', Number(flowOff.body?.match?.mine?.flow_on_ms) > 0, `flow_on_ms=${flowOff.body?.match?.mine?.flow_on_ms}`);

  // ------------------------------------------------------------------
  // 8. Answer rate limiter (30/min) — burn it with refused stale indexes
  // ------------------------------------------------------------------
  let sawNotCurrent = false;
  let rateLimited = null;
  for (let i = 0; i < 45 && !rateLimited; i += 1) {
    const r = await call(handleBlitzAnswer, a, {
      body: { matchId, questionIndex: 0, selected: 'A', clientRequestId: uuid() },
    });
    if (r.status === 409 && r.body?.error === 'QUESTION_NOT_CURRENT') sawNotCurrent = true;
    if (r.status === 429) rateLimited = r;
  }
  log('answer limiter fired 429 RATE_LIMITED', rateLimited?.body?.error === 'RATE_LIMITED', `status=${rateLimited?.status} ${rateLimited?.body?.error || ''}`);
  log('limiter retry hint is present', Number(rateLimited?.body?.retry_after_ms) >= 0, `retry_after_ms=${rateLimited?.body?.retry_after_ms}`);
  log('stale index was refused before the limiter', sawNotCurrent);

  // ------------------------------------------------------------------
  // 9. Settle before the whistle -> MATCH_NOT_ENDED
  // ------------------------------------------------------------------
  const earlySettle = await call(handleBlitzSettle, a, { body: { matchId } });
  log('settle before whistle refused 409 MATCH_NOT_ENDED', earlySettle.status === 409 && earlySettle.body?.error === 'MATCH_NOT_ENDED', `status=${earlySettle.status} ${earlySettle.body?.error || ''}`);

  // ------------------------------------------------------------------
  // 10. Force the whistle (data state, not a faked clock) and settle
  // ------------------------------------------------------------------
  const balBeforeSettle = await balanceOf(a.id);
  const myScore = (await matchRow(matchId)).score;
  await forceWhistle(matchId);

  const settled = await call(handleBlitzSettle, a, { body: { matchId } });
  log('settle 200', settled.status === 200, `status=${settled.status} ${settled.body?.error || ''}`);
  // blitz_duel_settle folds its result under `match.settlement` (the RPC merges
  // _blitz_state, which nests the settlement), unlike MATCH_ENDED at the top level.
  const st = settled.body?.match?.settlement || {};
  log('settlement outcome is one of win/draw/loss', ['win', 'draw', 'loss'].includes(st.outcome), `outcome=${st.outcome}`);
  log('settlement score equals the server-graded score', st.score === myScore, `score=${st.score} mine=${myScore}`);
  log('settlement bot_score is a non-negative integer', Number.isInteger(st.bot_score) && st.bot_score >= 0, `bot_score=${st.bot_score}`);
  const expectedDelta = st.outcome === 'win' ? 4 : st.outcome === 'draw' ? 2 : 0;
  log('settlement delta matches the outcome', st.delta === expectedDelta, `delta=${st.delta} expected=${expectedDelta}`);
  const balAfterSettle = await balanceOf(a.id);
  log('balance moved by exactly the delta', balAfterSettle === balBeforeSettle + expectedDelta, `${balBeforeSettle} -> ${balAfterSettle} (delta=${expectedDelta})`);
  log('settlement reports the post-settle balance', st.balance_after === balAfterSettle, `balance_after=${st.balance_after}`);
  log('settlement has a settled_at timestamp', !!st.settled_at, `settled_at=${st.settled_at}`);
  log('match is completed', settled.body?.match?.status === 'completed', `status=${settled.body?.match?.status}`);

  // ------------------------------------------------------------------
  // 11. Settle replay moves no coins; post-settle actions are MATCH_CLOSED
  // ------------------------------------------------------------------
  const settleReplay = await call(handleBlitzSettle, a, { body: { matchId } });
  log('settle replay 200 + replay flag', settleReplay.status === 200 && settleReplay.body?.replay === true, `status=${settleReplay.status} replay=${settleReplay.body?.replay}`);
  log('settle replay moved no coins', (await balanceOf(a.id)) === balAfterSettle, `balance=${await balanceOf(a.id)}`);

  const afterSettle = await call(handleBlitzAnswer, a, {
    body: { matchId, questionIndex: 3, selected: 'A', clientRequestId: uuid() },
  });
  log('answer after settlement 409 MATCH_CLOSED', afterSettle.status === 409 && afterSettle.body?.error === 'MATCH_CLOSED', `status=${afterSettle.status} ${afterSettle.body?.error || ''}`);
  log('MATCH_CLOSED carries the stored settlement', !!afterSettle.body?.settlement, JSON.stringify(afterSettle.body?.settlement?.outcome));

  // ------------------------------------------------------------------
  // 12. Rematch charges the stake again and opens a fresh match
  // ------------------------------------------------------------------
  const rematched = await call(handleBlitzRematch, a, { body: { pace: 5 } });
  log('rematch 200 with a fresh active match', rematched.status === 200 && rematched.body?.match?.status === 'active' && rematched.body?.match?.id !== matchId, `status=${rematched.status} id=${rematched.body?.match?.id}`);
  log('rematch honours the new pace (5)', rematched.body?.match?.pace === 5, `pace=${rematched.body?.match?.pace}`);
  log('rematch charged the stake again (-2)', (await balanceOf(a.id)) === balAfterSettle - 2, `balance=${await balanceOf(a.id)}`);
  const matchId2 = rematched.body?.match?.id;

  // ------------------------------------------------------------------
  // 13. Insufficient funds
  // ------------------------------------------------------------------
  const poor = await makeUser('poor');
  users.push(poor);
  await seedSC(poor.id, 1);
  const poorCreate = await call(handleBlitzCreate, poor, { body: { pace: 6 } });
  log('create with 1 SC refused 402 INSUFFICIENT_FUNDS', poorCreate.status === 402 && poorCreate.body?.error === 'INSUFFICIENT_FUNDS', `status=${poorCreate.status} ${poorCreate.body?.error || ''}`);
  log('refused create moved no coins', (await balanceOf(poor.id)) === 1, `balance=${await balanceOf(poor.id)}`);
  const { data: poorActive } = await admin.from('blitz_duels').select('id').eq('user_id', poor.id).eq('status', 'active');
  log('refused create left no active match behind', (poorActive || []).length === 0, `active=${(poorActive || []).length}`);

  // ------------------------------------------------------------------
  // 14. RLS / ACL: no client read, no client EXECUTE
  // ------------------------------------------------------------------
  const { data: readDuels, error: readDuelsErr } = await a.pub.from('blitz_duels').select('id');
  log('RLS: client cannot read blitz_duels', !!readDuelsErr || (readDuels || []).length === 0, readDuelsErr ? readDuelsErr.code : `rows=${(readDuels || []).length}`);

  const { data: readBank, error: readBankErr } = await a.pub.from('blitz_duel_questions').select('id');
  log('RLS: client cannot read the question bank', !!readBankErr || (readBank || []).length === 0, readBankErr ? readBankErr.code : `rows=${(readBank || []).length}`);

  const { data: rpcData, error: rpcErr } = await a.pub.rpc('blitz_duel_create', { p_user_id: a.id, p_pace: 6 });
  log('client cannot EXECUTE blitz_duel_create', !!rpcErr, rpcErr ? rpcErr.code || rpcErr.message : `ALLOWED (bad) data=${JSON.stringify(rpcData)}`);

  // ------------------------------------------------------------------
  // 15. Idempotent once more: two parallel settles move coins once
  // ------------------------------------------------------------------
  await forceWhistle(matchId2);
  const balBeforeParallel = await balanceOf(a.id);
  const [s1, s2] = await Promise.all([
    call(handleBlitzSettle, a, { body: { matchId: matchId2 } }),
    call(handleBlitzSettle, a, { body: { matchId: matchId2 } }),
  ]);
  const d2 = s1.body?.match?.settlement?.outcome || s2.body?.match?.settlement?.outcome;
  const expected2 = d2 === 'win' ? 4 : d2 === 'draw' ? 2 : 0;
  log('concurrent settles both 200', s1.status === 200 && s2.status === 200, `${s1.status}/${s2.status}`);
  log('concurrent settles moved coins exactly once', (await balanceOf(a.id)) === balBeforeParallel + expected2, `${balBeforeParallel} -> ${await balanceOf(a.id)} (expected +${expected2})`);
  const { data: settledRows } = await admin.from('blitz_duels').select('id, status, settlement').eq('id', matchId2);
  log('rematched match ends completed with one settlement', settledRows?.[0]?.status === 'completed' && !!settledRows[0]?.settlement, JSON.stringify(settledRows?.[0]?.status));

} catch (err) {
  log('FATAL', false, err?.message || String(err));
} finally {
  for (const u of users) {
    try { await admin.from('blitz_duel_rate_limits').delete().eq('user_id', u.id); } catch { /* noop */ }
    try { await admin.from('blitz_duels').delete().eq('user_id', u.id); } catch { /* noop */ }
    // FK on delete cascade also removes blitz_duels.
    try { await admin.auth.admin.deleteUser(u.id); } catch { /* noop */ }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}
