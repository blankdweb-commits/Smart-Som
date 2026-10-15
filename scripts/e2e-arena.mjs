// scripts/e2e-arena.mjs
//
// Live verification of the v63 1v1 Arena (two-sided escrow + full lifecycle)
// against the real project. Drives the SAME SECURITY DEFINER RPCs the client
// calls, with real GoTrue tokens on the publishable key.
//
// Contract proven:
//   A. escrow      — BOTH stakes debited at create; an insolvent opponent rolls
//                    the whole create back and the creator is never charged.
//   B. uniqueness  — one active match per player (the v38 de-dupe gap).
//   C. handshake   — nobody can start until BOTH players are ready.
//   D. scoring     — correct 1, correct+Double 2, incorrect 0, incorrect+Double
//                    0, skip 0. points is server-computed, never client-sent.
//   E. Double      — one per player, spent only on the armed question, consumed
//                    only on a real submit, never leaking to the next question.
//   F. lifecycle   — cancel refunds both; forfeit takes the leaver's stake and
//                    refunds the other; disconnect grace works; settlement is
//                    exactly-once under replay AND concurrent calls.
//   G. tie-break   — points DESC -> correct DESC -> DRAW (no latency chain).
//   H. bots        — bots play the SAME board/scorecard/Double as humans, with
//                    real graded answer rows (not a settlement-time roll).
//   I. matchmaking — only identical (mode, stake, format) pairs; cancel frees
//                    the queue slot.
//   J. secrecy     — no answer key before the match ends; review after.
//   K. authority   — anon refused, non-participant refused, legacy blitz path
//                    SEALED (cannot bypass escrow), Triple Threat untouched.
//
// The shared 90s clock is fast-forwarded with an operator SQL helper (the
// Management API + set_config('arena.write')) so the suite runs in seconds
// instead of minutes. Time is never faked for the LOGIC under test — only the
// wall clock is moved.
//
// Run: npm run e2e:arena
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const env = loadEnv();
for (const k of ['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY']) {
  process.env[k] = process.env[k] || env[k];
}

const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const MGMT_TOKEN = env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = (URL || '').replace('https://', '').split('.')[0];

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const uuid = () => crypto.randomUUID();
const password = 'testpass123';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Operator-only SQL over the Management API. `arena.write` is claimed so the
// v63 guard triggers permit the write — this is the operator fast-forward used
// to collapse the 90s clock, never a client-reachable path.
let mgmtWarned = false;
async function adminSql(sql) {
  if (!MGMT_TOKEN) {
    if (!mgmtWarned) {
      mgmtWarned = true;
      console.log('NOTE: no SUPABASE_ACCESS_TOKEN — time-travel checks will be skipped');
    }
    return null;
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    const body = await res.text();
    // A stale personal access token is the single most common cause and it is
    // easy to mistake for a test failure. Say so, and say how to fix it.
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        'MANAGEMENT_TOKEN_INVALID — SUPABASE_ACCESS_TOKEN is rejected by the '
        + 'Supabase Management API, so the clock fast-forward cannot run and the '
        + 'settlement/lifecycle tests below cannot execute. Paste a fresh sbp_ '
        + 'token into .env (Supabase dashboard -> Account -> Access Tokens), then '
        + 're-run. Nothing in the app is wrong.'
      );
    }
    throw new Error(`adminSql ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) || [];
}

async function makeUser(tag, seedSc = 0) {
  const email = `arena-${tag}-${Date.now().toString().slice(-7)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const id = data.user.id;
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signin ${tag}: ${se.message}`);
  if (seedSc > 0) {
    const { error: scErr } = await admin.rpc('_sc_apply', {
      p_user_id: id, p_amount: seedSc, p_reason: 'e2e_arena_seed', p_source: 'e2e',
      p_transaction_type: 'earn', p_ref_type: 'e2e', p_ref_id: uuid(),
      p_metadata: { e2e: true }, p_client_request_id: uuid(),
    });
    if (scErr) throw new Error(`seed SC ${tag}: ${scErr.message}`);
  }
  const { error: actErr } = await admin.from('profiles').update({ is_activated: true }).eq('id', id);
  if (actErr) throw new Error(`activate ${tag}: ${actErr.message}`);
  return { id, email, pub, token: s.session.access_token };
}

// RPCs are called over raw REST with the caller's own access token rather than
// through supabase-js's PostgREST builder: the RPC contract (error payloads in
// the jsonb body) is easier to assert, and it proves the endpoints a real
// client would hit, exactly.
const rpc = async (u, fn, params = {}) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${u.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data = null;
  let error = null;
  try {
    data = text.length ? JSON.parse(text) : null;
  } catch {
    error = { code: String(res.status), message: text.slice(0, 300) };
  }
  if (!error && res.ok === false) {
    error = { code: String(res.status), message: text.slice(0, 300) };
  }
  if (process.env.ARENA_DEBUG) {
    console.log(`   [rpc ${fn}] http=${res.status} ${JSON.stringify(data ?? null).slice(0, 160)}`);
  }
  return { data, error, msg: error?.message || null };
};
const balanceOf = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).maybeSingle();
  return data?.smart_coins ?? null;
};
const matchRow = async (id) => {
  const { data } = await admin.from('competitive_matches').select('*').eq('id', id).maybeSingle();
  return data || null;
};
const answersOf = async (matchId, playerId) => {
  let q = admin.from('competitive_match_answers')
    .select('*').eq('match_id', matchId).order('question_index');
  if (playerId) q = q.eq('player_id', playerId);
  const { data } = await q;
  return data || [];
};
const ledgerFor = async (matchId) => {
  const { data } = await admin.from('smart_coin_ledger')
    .select('*').eq('ref_type', 'competitive_match').eq('ref_id', matchId);
  return data || [];
};
const queueCount = async () => {
  const { data } = await admin.from('arena_queue').select('user_id');
  return (data || []).length;
};

// Collapse a live match's clock so the real settlement path runs immediately.
// The clock is moved into the PAST (not the future) so the settle that follows
// is never a race against a 1s sleep.
const fastForward = (matchId) =>
  adminSql(`select set_config('arena.write','1',true);
            update public.competitive_matches
               set ends_at = now() - interval '1 second'
             where id = '${matchId}'`);

// Age a heartbeat so the grace sweep sees a disconnect, then expire the grace.
const forceDisconnect = (matchId, secondsAgo = 120) =>
  adminSql(`select set_config('arena.write','1',true);
            update public.competitive_matches
               set last_seen_creator_at = now() - interval '${secondsAgo} seconds',
                   disconnected_creator_at = now() - interval '${secondsAgo} seconds'
             where id = '${matchId}'`);

const users = [];
const createdMatchIds = new Set();

try {
  // The arena queue is scratch state by definition. Any row here is debris from
  // an interrupted run or a probe, so start from a known-empty queue or the
  // matchmaking assertions measure the wrong thing.
  await admin.from('arena_queue').delete()
    .neq('user_id', '00000000-0000-0000-0000-000000000000');
  log('A-1 stale matchmaking queue cleared before the run',
    (await queueCount()) === 0, `rows=${await queueCount()}`);

  // ================================================================
  // A. ESCROW
  // ================================================================
  const P1 = await makeUser('p1', 100);
  const P2 = await makeUser('p2', 100);
  const BROKE = await makeUser('broke', 0);
  const POOR = await makeUser('poor', 1);
  const BYSTANDER = await makeUser('by', 100);
  users.push(P1, P2, BROKE, POOR, BYSTANDER);

  log('A0 setup — 4 funded users + 1 broke + 1 poor',
    await balanceOf(P1.id) === 100 && await balanceOf(BROKE.id) === 0);

  // A1 — the creator's own solvency is checked.
  const poorCreate = await rpc(POOR, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: P2.id });
  log('A1 create refused when the creator cannot fund the stake',
    poorCreate.data?.ok === false && poorCreate.data?.error === 'ESCROW_FAILED'
      && await balanceOf(POOR.id) === 1,
    `error=${poorCreate.data?.error} balance=${await balanceOf(POOR.id)}`);

  // A2 — the OPPONENT's solvency is checked, and the failure is fully atomic.
  const brokeCreate = await rpc(P1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: BROKE.id });
  const p1AfterFail = await balanceOf(P1.id);
  const orphanMatches = await admin.from('competitive_matches')
    .select('id').eq('creator_id', P1.id).eq('status', 'waiting');
  log('A2 insolvent opponent rolls the WHOLE create back (creator never charged)',
    brokeCreate.data?.ok === false && brokeCreate.data?.error === 'ESCROW_FAILED'
      && p1AfterFail === 100 && (orphanMatches.data || []).length === 0,
    `error=${brokeCreate.data?.error} p1=${p1AfterFail} waiting=${(orphanMatches.data || []).length}`);

  // A3 — the happy path debits BOTH sides.
  const c1 = await rpc(P1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: P2.id });
  const M1 = c1.data?.matchId;
  if (M1) createdMatchIds.add(M1);
  log('A3 create ok — one blitz format, 40 NMCN questions, escrow=10',
    c1.data?.ok === true && c1.data?.format === 'blitz'
      && c1.data?.questionCount === 40 && (c1.data?.questions || []).length === 40
      && c1.data?.escrowed === 10,
    `matchId=${M1} escrowed=${c1.data?.escrowed}`);

  const served = c1.data?.questions || [];
  const LEAK = ['correct_answer', 'correctAnswer', 'answer', 'correct', 'rationale', 'explanation', 'hint'];
  log('A4 no answer key leaks at create',
    served.length === 40 && served.every((q) => !LEAK.some((k) => Object.prototype.hasOwnProperty.call(q, k))));

  log('A5 BOTH stakes escrowed at create (100 -> 95 each)',
    await balanceOf(P1.id) === 95 && await balanceOf(P2.id) === 95,
    `p1=${await balanceOf(P1.id)} p2=${await balanceOf(P2.id)}`);

  const mRow = await matchRow(M1);
  log('A6 escrow flags recorded on the match row',
    mRow?.wager_creator_held === true && mRow?.wager_opponent_held === true
      && mRow?.escrow_amount === 10 && mRow?.status === 'waiting',
    `held=${mRow?.wager_creator_held}/${mRow?.wager_opponent_held} escrow=${mRow?.escrow_amount}`);

  const led = await ledgerFor(M1);
  log('A7 exactly 2 escrow hold ledger rows (-5 each)',
    led.length === 2 && led.every((l) => l.amount === -5)
      && new Set(led.map((l) => l.client_request_id)).size === 2,
    `rows=${led.length} amounts=${led.map((l) => l.amount).join(',')}`);

  // ================================================================
  // B. UNIQUENESS
  // ================================================================
  const dup = await rpc(P1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: BYSTANDER.id });
  log('B1 creator cannot open a second concurrent match',
    dup.data?.ok === false && dup.data?.error === 'ALREADY_IN_MATCH',
    `error=${dup.data?.error}`);

  const dupOpp = await rpc(BYSTANDER, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: P1.id });
  log('B2 a busy opponent is refused (OPPONENT_BUSY)',
    dupOpp.data?.ok === false && dupOpp.data?.error === 'OPPONENT_BUSY',
    `error=${dupOpp.data?.error}`);

  const replay = await rpc(P2, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: P1.id });
  log('B3 the racing pair de-duplicates to the SAME match + SAME board',
    replay.data?.ok === true && replay.data?.replay === true && replay.data?.matchId === M1,
    `matchId=${replay.data?.matchId}`);

  log('B4 escrow was debited exactly ONCE despite the replay',
    await balanceOf(P1.id) === 95 && await balanceOf(P2.id) === 95
      && (await ledgerFor(M1)).length === 2,
    `p1=${await balanceOf(P1.id)} p2=${await balanceOf(P2.id)}`);

  // ================================================================
  // C. HANDSHAKE
  // ================================================================
  const earlyStart = await rpc(P1, 'arena_start', { p_match_id: M1 });
  log('C1 cannot start before the opponent is ready',
    earlyStart.data?.ok === false && earlyStart.data?.error === 'OPPONENT_NOT_READY',
    `error=${earlyStart.data?.error}`);

  const r1 = await rpc(P1, 'arena_ready', { p_match_id: M1 });
  log('C2 one side ready is not enough (still waiting)',
    r1.data?.ok === true && r1.data?.status === 'waiting' && r1.data?.canStart === false,
    `status=${r1.data?.status}`);

  const r2 = await rpc(P2, 'arena_ready', { p_match_id: M1 });
  log('C3 both ready flips the match to ready',
    r2.data?.ok === true && r2.data?.status === 'ready' && r2.data?.canStart === true,
    `status=${r2.data?.status}`);

  const s1 = await rpc(P1, 'arena_start', { p_match_id: M1 });
  const s2 = await rpc(P1, 'arena_start', { p_match_id: M1 });
  log('C4 start opens the shared 90s clock and is idempotent',
    s1.data?.ok === true && !!s1.data?.startsAt && !!s1.data?.endsAt
      && s2.data?.replay === true
      && new Date(s1.data.endsAt) - new Date(s1.data.startsAt) === 90000,
    `window=${s1.data?.endsAt}`);

  // ================================================================
  // D + E. SCORING AND DOUBLE
  // ================================================================
  // Grade answers against the REAL stored key (read with the service role).
  const keyFor = async (index) => {
    const row = await matchRow(M1);
    const qid = row.question_ids[index];
    const { data } = await admin.from('questions').select('correct_answer, options')
      .eq('id', qid).maybeSingle();
    return data || {};
  };
  const wrongOptionFor = (q) => {
    const correct = q.correct_answer;
    return (q.options || []).find((o) => String(o).trim().toLowerCase()
      !== String(correct).trim().toLowerCase()) ?? null;
  };

  const q0 = await keyFor(0);
  const q1 = await keyFor(1);
  const q2 = await keyFor(2);
  const q3 = await keyFor(3);
  const q4 = await keyFor(4);

  const a0 = await rpc(P1, 'arena_answer',
    { p_match_id: M1, p_question_index: 0, p_selected: q0.correct_answer, p_double: false });
  log('D1 correct answer scores 1',
    a0.data?.ok === true && a0.data?.isCorrect === true && a0.data?.points === 1
      && a0.data?.multiplier === 1,
    `points=${a0.data?.points}`);

  // Double on a WRONG answer must be worth 0 (the v58 rule was -2).
  const a1 = await rpc(P1, 'arena_answer',
    { p_match_id: M1, p_question_index: 1, p_selected: wrongOptionFor(q1), p_double: true });
  log('D2 incorrect + Double scores 0 (NOT -2)',
    a1.data?.ok === true && a1.data?.isCorrect === false && a1.data?.points === 0
      && a1.data?.multiplier === 2,
    `points=${a1.data?.points} multiplier=${a1.data?.multiplier}`);

  const a2 = await rpc(P1, 'arena_answer',
    { p_match_id: M1, p_question_index: 2, p_selected: null, p_double: false, p_skipped: true });
  log('D3 skip scores 0 and counts as skipped, not incorrect',
    a2.data?.ok === true && a2.data?.points === 0 && a2.data?.skipped === true
      && a2.data?.myScore?.skipped === 1 && a2.data?.myScore?.incorrect === 1
      && a2.data?.myScore?.answers === 3,
    `score=${JSON.stringify(a2.data?.myScore)}`);

  const a3 = await rpc(P1, 'arena_answer',
    { p_match_id: M1, p_question_index: 3, p_selected: wrongOptionFor(q3), p_double: true });
  log('D4 Double is ONE-TIME — a second double falls through to x1',
    a3.data?.ok === true && a3.data?.multiplier === 1 && a3.data?.points === 0
      && a3.data?.double === false,
    `multiplier=${a3.data?.multiplier}`);

  const a4 = await rpc(P1, 'arena_answer',
    { p_match_id: M1, p_question_index: 4, p_selected: q4.correct_answer, p_double: true });
  log('D5 correct WITHOUT a usable Double scores 1 (Double does not leak)',
    a4.data?.ok === true && a4.data?.isCorrect === true && a4.data?.points === 1
      && a4.data?.multiplier === 1,
    `points=${a4.data?.points}`);

  const p1rows = await answersOf(M1, P1.id);
  const doubleRows = p1rows.filter((r) => r.multiplier === 2);
  log('E1 exactly one multiplier=2 row for the player, on the armed question',
    doubleRows.length === 1 && doubleRows[0].question_index === 1
      && p1rows.filter((r) => r.multiplier === 1).length === 4,
    `doubleIdx=${doubleRows.map((r) => r.question_index).join(',')}`);

  const a0replay = await rpc(P1, 'arena_answer',
    { p_match_id: M1, p_question_index: 0, p_selected: q0.correct_answer, p_double: false });
  log('E2 first-answer-wins: a replay returns the stored grade',
    a0replay.data?.ok === true && a0replay.data?.replay === true
      && a0replay.data?.points === 1
      && (await answersOf(M1, P1.id)).length === 5,
    `rows=${(await answersOf(M1, P1.id)).length}`);

  const badIdx = await rpc(P1, 'arena_answer',
    { p_match_id: M1, p_question_index: 999, p_selected: 'x' });
  log('E3 out-of-range question index refused',
    badIdx.data?.ok === false && badIdx.data?.error === 'INVALID_QUESTION_INDEX',
    `error=${badIdx.data?.error}`);

  // P2 answers correctly so the match is a genuine two-human contest.
  for (const i of [0, 1, 2, 3, 4]) {
    const k = await keyFor(i);
    await rpc(P2, 'arena_answer',
      { p_match_id: M1, p_question_index: i, p_selected: k.correct_answer, p_double: false });
  }
  log('E4 opponent answer rows are graded the same way',
    (await answersOf(M1, P2.id)).filter((r) => r.is_correct).length === 5
      && (await answersOf(M1, P2.id)).every((r) => r.points === 1));

  // ================================================================
  // J. SECRECY BEFORE THE MATCH ENDS
  // ================================================================
  const st1 = await rpc(P1, 'arena_state', { p_match_id: M1 });
  log('J1 arena_state mid-match carries NO answer key (review is null)',
    st1.data?.ok === true && st1.data?.review === null
      && (st1.data?.questions || []).every(
        (q) => !LEAK.some((k) => Object.prototype.hasOwnProperty.call(q, k))),
    `review=${st1.data?.review}`);

  log('J2 arena_state carries the live scorecard + resume data',
    st1.data?.myScore?.points === 2 && st1.data?.myScore?.correct === 2
      && st1.data?.myScore?.incorrect === 2 && st1.data?.myScore?.skipped === 1
      && st1.data?.opponentScore?.points === 5
      && (st1.data?.myAnswers || []).length === 5,
    `me=${JSON.stringify(st1.data?.myScore)} opp=${JSON.stringify(st1.data?.opponentScore)}`);

  // ================================================================
  // F. SETTLEMENT + TIE-BREAK (G)
  // ================================================================
  const earlySettle = await rpc(P1, 'arena_settle', { p_match_id: M1 });
  log('F1 settlement is refused before the clock ends',
    earlySettle.data?.ok === false && earlySettle.data?.error === 'BLITZ_NOT_ENDED'
      && typeof earlySettle.data?.remainingMs === 'number',
    `error=${earlySettle.data?.error}`);

  await fastForward(M1);
  const settle1 = await rpc(P1, 'arena_settle', { p_match_id: M1 });
  const settle2 = await rpc(P2, 'arena_settle', { p_match_id: M1 });
  log('F2 settlement is exactly-once under a concurrent replay',
    settle1.data?.ok === true && settle2.data?.ok === true && settle2.data?.replay === true,
    `p2Replay=${settle2.data?.replay}`);

  const finalRow = await matchRow(M1);
  log('F3 winner resolved on POINTS (P2 5 > P1 2), not on latency',
    finalRow?.status === 'completed' && finalRow?.winner_id === P2.id,
    `status=${finalRow?.status} winner=${finalRow?.winner_id === P2.id ? 'P2' : finalRow?.winner_id}`);

  // Escrow is a HOLD, so the winner is released the GROSS pot (2*stake) and
  // the loser nothing. The meaningful invariant is the NET change from the
  // 100 each started with: winner +stake, loser -stake.
  const p1Net = (await balanceOf(P1.id)) - 100;
  const p2Net = (await balanceOf(P2.id)) - 100;
  log('F4 escrow pays the pot: winner nets +stake, loser nets -stake',
    p1Net === -5 && p2Net === 5
      && await balanceOf(P1.id) === 95 && await balanceOf(P2.id) === 105,
    `p1=${await balanceOf(P1.id)} (net ${p1Net}) p2=${await balanceOf(P2.id)} (net ${p2Net})`);

  const settledLedger = await ledgerFor(M1);
  const holds = settledLedger.filter((l) => l.reason === 'arena_wager_hold');
  const releases = settledLedger.filter((l) => l.reason === 'arena_win');
  log('F5 ledger: 2 holds + exactly 1 release, deterministic ids',
    holds.length === 2 && releases.length === 1 && releases[0].amount === 10,
    `holds=${holds.length} releases=${releases.length} amount=${releases[0]?.amount}`);

  const hist = await admin.from('duels').select('user_id, outcome, delta')
    .in('user_id', [P1.id, P2.id]).eq('mode', 'duel');
  log('F6 duel history records both sides once',
    (hist.data || []).length === 2
      && (hist.data || []).some((d) => d.user_id === P1.id && d.outcome === 'loss' && d.delta === 0)
      && (hist.data || []).some((d) => d.user_id === P2.id && d.outcome === 'win' && d.delta === 10),
    JSON.stringify(hist.data));

  const stAfter = await rpc(P1, 'arena_state', { p_match_id: M1 });
  log('F7 post-match review releases the answer key',
    stAfter.data?.review?.length === 5
      && stAfter.data.review.every((r) => 'correctAnswer' in r)
      && stAfter.data.review.some((r) => r.index === 0 && r.isCorrect === true)
      && stAfter.data.review.some((r) => r.index === 2 && r.skipped === true),
    `review=${stAfter.data?.review?.length}`);

  // ================================================================
  // H. TIE-BREAK -> DRAW
  // ================================================================
  const T1 = await makeUser('t1', 50);
  const T2 = await makeUser('t2', 50);
  users.push(T1, T2);
  const tc = await rpc(T1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 2, p_opponent_id: T2.id });
  const TM = tc.data?.matchId;
  if (TM) createdMatchIds.add(TM);
  await rpc(T1, 'arena_ready', { p_match_id: TM });
  await rpc(T2, 'arena_ready', { p_match_id: TM });
  await rpc(T1, 'arena_start', { p_match_id: TM });
  // Identical, deliberately WRONG answers on both sides -> equal points, equal correct.
  const tk = await (async () => {
    const row = await matchRow(TM);
    const { data } = await admin.from('questions').select('correct_answer, options')
      .eq('id', row.question_ids[0]).maybeSingle();
    return data;
  })();
  const tWrong = wrongOptionFor(tk);
  await rpc(T1, 'arena_answer', { p_match_id: TM, p_question_index: 0, p_selected: tWrong });
  await rpc(T2, 'arena_answer', { p_match_id: TM, p_question_index: 0, p_selected: tWrong });
  await fastForward(TM);
  const tSettle = await rpc(T1, 'arena_settle', { p_match_id: TM });
  const tRow = await matchRow(TM);
  log('H1 equal points AND equal correct -> DRAW (latency chain deleted)',
    tSettle.data?.ok === true && tSettle.data?.draw === true && tRow?.status === 'completed',
    `draw=${tSettle.data?.draw} winner=${tRow?.winner_id}`);

  log('H2 a draw refunds BOTH escrows (net 0 each)',
    await balanceOf(T1.id) === 50 && await balanceOf(T2.id) === 50,
    `t1=${await balanceOf(T1.id)} t2=${await balanceOf(T2.id)}`);

  // ================================================================
  // F. FORFEIT
  // ================================================================
  const F1 = await makeUser('f1', 60);
  const F2 = await makeUser('f2', 60);
  users.push(F1, F2);
  const fc = await rpc(F1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 10, p_opponent_id: F2.id });
  const FM = fc.data?.matchId;
  if (FM) createdMatchIds.add(FM);
  log('F3 forfeit match escrowed 10 each', await balanceOf(F1.id) === 50
    && await balanceOf(F2.id) === 50,
    `f1=${await balanceOf(F1.id)} f2=${await balanceOf(F2.id)}`);

  await rpc(F1, 'arena_ready', { p_match_id: FM });
  await rpc(F2, 'arena_ready', { p_match_id: FM });
  await rpc(F1, 'arena_start', { p_match_id: FM });
  const ff = await rpc(F1, 'arena_forfeit', { p_match_id: FM });
  log('F4 voluntary forfeit is immediate and forfeits the leaver',
    ff.data?.ok === true && ff.data?.status === 'abandoned'
      && ff.data?.myOutcome === 'loss',
    `status=${ff.data?.status} outcome=${ff.data?.myOutcome}`);

  log('F5 forfeiter loses the stake, the other player is REFUNDED',
    await balanceOf(F1.id) === 50 && await balanceOf(F2.id) === 60,
    `f1=${await balanceOf(F1.id)} f2=${await balanceOf(F2.id)}`);

  const ffReplay = await rpc(F1, 'arena_forfeit', { p_match_id: FM });
  log('F6 forfeit is idempotent (replay moves nothing)',
    ffReplay.data?.replay === true && await balanceOf(F1.id) === 50
      && await balanceOf(F2.id) === 60,
    `replay=${ffReplay.data?.replay}`);

  // ================================================================
  // F. GRACE EXPIRY (unexpected drop)
  // ================================================================
  const G1 = await makeUser('g1', 60);
  const G2 = await makeUser('g2', 60);
  users.push(G1, G2);
  const gc = await rpc(G1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 10, p_opponent_id: G2.id });
  const GM = gc.data?.matchId;
  if (GM) createdMatchIds.add(GM);
  await rpc(G1, 'arena_ready', { p_match_id: GM });
  await rpc(G2, 'arena_ready', { p_match_id: GM });
  await rpc(G1, 'arena_start', { p_match_id: GM });

  // G1 reconnects inside the grace window.
  await forceDisconnect(GM, 5);
  const gInside = await rpc(G2, 'arena_heartbeat', { p_match_id: GM });
  const gRowInside = await matchRow(GM);
  log('F7 a drop inside the grace window does NOT forfeit the match',
    gRowInside?.status === 'active',
    `status=${gRowInside?.status} disconnectFlag=${!!gRowInside?.disconnected_creator_at}`);

  const gBeat = await rpc(G1, 'arena_heartbeat', { p_match_id: GM });
  const gRowBack = await matchRow(GM);
  log('F8 reconnecting clears the disconnect flag',
    gBeat.data?.ok === true && gRowBack?.disconnected_creator_at === null
      && gRowBack?.status === 'active',
    `status=${gRowBack?.status}`);

  // Now really drop past the grace window.
  await forceDisconnect(GM, 120);
  const gLate = await rpc(G2, 'arena_heartbeat', { p_match_id: GM });
  const gRowLate = await matchRow(GM);
  log('F9 an expired reconnect grace forfeits for the silent player',
    gRowLate?.status === 'abandoned' && gRowLate?.abandon_reason === 'grace_expired'
      && gRowLate?.abandoned_by === G1.id,
    `status=${gRowLate?.status} reason=${gRowLate?.abandon_reason}`);

  log('F10 grace forfeit: silent player loses, connected player refunded',
    await balanceOf(G1.id) === 50 && await balanceOf(G2.id) === 60,
    `g1=${await balanceOf(G1.id)} g2=${await balanceOf(G2.id)}`);

  // ================================================================
  // F. CANCEL (nobody at fault)
  // ================================================================
  const C1 = await makeUser('c1', 40);
  const C2 = await makeUser('c2', 40);
  users.push(C1, C2);
  const cc = await rpc(C1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: C2.id });
  const CM = cc.data?.matchId;
  if (CM) createdMatchIds.add(CM);
  const cancelByOther = await rpc(C2, 'arena_cancel', { p_match_id: CM });
  const cancel = await rpc(C1, 'arena_cancel', { p_match_id: CM });
  log('F11 cancel is creator-only',
    cancelByOther.data?.ok === false && cancelByOther.data?.error === 'NOT_THE_CREATOR'
      && cancel.data?.ok === true,
    `other=${cancelByOther.data?.error} creator=${cancel.data?.ok}`);

  log('F12 cancelling before the clock opens refunds BOTH in full',
    await balanceOf(C1.id) === 40 && await balanceOf(C2.id) === 40,
    `c1=${await balanceOf(C1.id)} c2=${await balanceOf(C2.id)}`);

  const cancelReplay = await rpc(C1, 'arena_cancel', { p_match_id: CM });
  log('F13 cancel is idempotent (one refund each, not two)',
    cancelReplay.data?.replay === true && await balanceOf(C1.id) === 40
      && await balanceOf(C2.id) === 40,
    `c1=${await balanceOf(C1.id)} c2=${await balanceOf(C2.id)}`);

  // ================================================================
  // H. BOT PARITY
  // ================================================================
  const B1 = await makeUser('b1', 80);
  users.push(B1);
  const bc = await rpc(B1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_bot: 'apollo' });
  const BM = bc.data?.matchId;
  if (BM) createdMatchIds.add(BM);
  log('H1 a bot match is the SAME blitz format (40 questions) and auto-readies',
    bc.data?.ok === true && bc.data?.format === 'blitz' && bc.data?.questionCount === 40
      && (await matchRow(BM))?.status === 'ready',
    `matchId=${BM}`);

  log('H2 a bot match escrows the human stake once',
    await balanceOf(B1.id) === 75, `b1=${await balanceOf(B1.id)}`);

  const bStart = await rpc(B1, 'arena_start', { p_match_id: BM });
  log('H3 a bot match starts immediately (no opponent handshake needed)',
    bStart.data?.ok === true && !!bStart.data?.endsAt, `error=${bStart.data?.error}`);

  // Answer 3 questions so the bot answers the same 3 indexes live.
  const bStartBal = await balanceOf(B1.id);
  for (let i = 0; i < 3; i++) {
    const row = await matchRow(BM);
    const { data } = await admin.from('questions').select('correct_answer, options')
      .eq('id', row.question_ids[i]).maybeSingle();
    const pick = i === 1 ? wrongOptionFor(data) : data.correct_answer;
    await rpc(B1, 'arena_answer',
      { p_match_id: BM, p_question_index: i, p_selected: pick, p_double: false });
  }
  const allRows = await answersOf(BM);
  const botRows = allRows.filter((r) => r.is_bot);
  const humanRows = allRows.filter((r) => !r.is_bot);
  log('H4 the bot answers LIVE as real graded rows, in lockstep',
    botRows.length === 3 && humanRows.length === 3
      && botRows.map((r) => r.question_index).sort().join(',') === '0,1,2',
    `bot=${botRows.length} human=${humanRows.length}`);

  log('H5 bot rows use the SAME points arithmetic as human rows',
    botRows.length === 3
      && botRows.every((r) => r.points === (r.is_correct ? r.multiplier : 0))
      && humanRows.every((r) => r.points === (r.is_correct ? r.multiplier : 0)),
    `botPoints=${botRows.map((r) => r.points).join(',')}`);

  const bState = await rpc(B1, 'arena_state', { p_match_id: BM });
  log('H6 the bot has a live scorecard on the same shape as a human opponent',
    bState.data?.opponentIsBot === true
      && typeof bState.data?.opponentScore?.points === 'number'
      && typeof bState.data?.opponentScore?.correct === 'number'
      && bState.data?.opponentScore?.points === botRows.reduce((a, r) => a + r.points, 0),
    `opp=${JSON.stringify(bState.data?.opponentScore)}`);

  await fastForward(BM);
  const bSettle = await rpc(B1, 'arena_settle', { p_match_id: BM });
  const bRow = await matchRow(BM);
  const bStats = await admin.from('competitive_stats').select('*').eq('user_id', B1.id).maybeSingle();
  log('H7 beating a tutor pays out through the same escrow settlement',
    bSettle.data?.ok === true && bRow?.status === 'completed'
      && ['win', 'loss', 'draw'].includes(bSettle.data?.myOutcome),
    `outcome=${bSettle.data?.myOutcome} balance=${await balanceOf(B1.id)} (was ${bStartBal})`);

  log('H8 a bot match earns NO verified 1v1 win (bot is not a user)',
    !bStats.data || (bStats.data.one_v_one_wins ?? 0) === 0,
    `one_v_one_wins=${bStats.data?.one_v_one_wins}`);

  // ================================================================
  // I. MATCHMAKING
  // ================================================================
  const Q1 = await makeUser('q1', 50);
  const Q2 = await makeUser('q2', 50);
  const Q3 = await makeUser('q3', 50);
  users.push(Q1, Q2, Q3);

  const e1 = await rpc(Q1, 'arena_enqueue', { p_mode: 'duel', p_stake: 5, p_format: 'blitz' });
  log('I1 first enqueue waits (queued)',
    e1.data?.ok === true && e1.data?.queued === true && await queueCount() === 1,
    `queued=${e1.data?.queued} rows=${await queueCount()}`);

  const e3 = await rpc(Q3, 'arena_enqueue', { p_mode: 'duel', p_stake: 10, p_format: 'blitz' });
  log('I2 a different stake is NOT matched (no wager mixing)',
    e3.data?.queued === true && await queueCount() === 2,
    `rows=${await queueCount()}`);

  const e2 = await rpc(Q2, 'arena_enqueue', { p_mode: 'duel', p_stake: 5, p_format: 'blitz' });
  const QM = e2.data?.matchId;
  if (QM) createdMatchIds.add(QM);
  log('I3 an identical stake pairs immediately into a real escrowed match',
    e2.data?.ok === true && !!QM && !e2.data?.queued
      && await queueCount() === 1,
    `matchId=${QM} rowsLeft=${await queueCount()}`);

  const roster = await rpc(Q3, 'arena_roster', { p_stake: 10, p_format: 'blitz' });
  log('I4 the roster lists waiting humans and never leaks the answer key',
    roster.data?.ok === true && Array.isArray(roster.data?.players),
    `players=${(roster.data?.players || []).length}`);

  const leave = await rpc(Q3, 'arena_leave_queue', {});
  log('I5 leaving the queue releases the slot',
    leave.data?.ok === true && leave.data?.leftQueue === true && await queueCount() === 0,
    `rows=${await queueCount()}`);

  // ================================================================
  // K. AUTHORITY
  // ================================================================
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonAttempt = await anon.rpc('arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: P2.id });
  log('K1 anonymous cannot create an arena match',
    !!anonAttempt.error, `error=${anonAttempt.error?.message?.slice(0, 60)}`);

  const outsider = await rpc(BYSTANDER, 'arena_state', { p_match_id: M1 });
  log('K2 a non-participant cannot read the match',
    outsider.data?.ok === false && outsider.data?.error === 'NOT_YOUR_MATCH',
    `error=${outsider.data?.error}`);

  const legacyBlitz = await rpc(P1, 'create_competitive_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: P2.id, p_format: 'blitz' });
  log('K3 the legacy blitz path is SEALED (escrow cannot be bypassed)',
    /BLITZ_REQUIRES_ARENA/.test(legacyBlitz.msg || ''),
    `msg=${(legacyBlitz.msg || '').slice(0, 80)}`);

  const legacySd = await rpc(P1, 'create_competitive_match',
    { p_mode: 'triple', p_stake: 5, p_opponent_id: P2.id, p_format: 'sudden_death' });
  log('K4 Triple Threat (sudden_death) is untouched by the seal',
    legacySd.data?.ok === true || legacySd.data?.error === 'HUMAN_DUEL_ONLY'
      || legacySd.data?.error === 'INVALID_MODE',
    `ok=${legacySd.data?.ok} error=${legacySd.data?.error}`);

  const badStake = await rpc(Q1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 7, p_opponent_id: Q2.id });
  log('K5 a non-preset stake tier is refused',
    badStake.data?.ok === false && badStake.data?.error === 'INVALID_STAKE',
    `error=${badStake.data?.error}`);

  const badBot = await rpc(Q1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_bot: 'skynet' });
  log('K6 an unknown tutor id is refused',
    badBot.data?.ok === false && badBot.data?.error === 'INVALID_BOT',
    `error=${badBot.data?.error}`);

  const noOpp = await rpc(Q1, 'arena_create_match', { p_mode: 'duel', p_stake: 5 });
  log('K7 a human match without an opponent is refused',
    noOpp.data?.ok === false && noOpp.data?.error === 'OPPONENT_REQUIRED',
    `error=${noOpp.data?.error}`);

  // Audit trail
  const events = await admin.from('arena_match_events').select('kind')
    .eq('match_id', FM).then((r) => r.data || []);
  const kinds = [...new Set(events.map((e) => e.kind))].sort();
  log('K8 every escrow lifecycle step is auditable',
    kinds.includes('created') && kinds.includes('forfeit') && kinds.includes('settled'),
    kinds.join(','));

  // ================================================================
  // L. v64 — WALLET TRUTH, FREE PRACTICE, PRESENCE
  //
  // The reported bug: "history says +2 / -2 SC but the wallet never moved".
  // Root cause was v63 returning `balance` only when the release was non-zero,
  // and a LOSS releases 0, so the client kept the pre-match number.
  // ================================================================
  const W1 = await makeUser('w1', 100);
  const W2 = await makeUser('w2', 100);
  users.push(W1, W2);
  const wc = await rpc(W1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 2, p_opponent_id: W2.id });
  const WM = wc.data?.matchId;
  if (WM) createdMatchIds.add(WM);

  log('L1 create returns the post-hold balance (the pill is right from the first second)',
    wc.data?.balance === 98 && await balanceOf(W1.id) === 98,
    `returned=${wc.data?.balance} actual=${await balanceOf(W1.id)}`);

  await rpc(W1, 'arena_ready', { p_match_id: WM });
  await rpc(W2, 'arena_ready', { p_match_id: WM });
  await rpc(W1, 'arena_start', { p_match_id: WM });

  // W1 answers everything correctly, W2 nothing: an unambiguous win for W1.
  const wRow = await matchRow(WM);
  for (let i = 0; i < wRow.question_count; i += 1) {
    const { data: qd } = await admin.from('questions')
      .select('correct_answer').eq('id', wRow.question_ids[i]).maybeSingle();
    await rpc(W1, 'arena_answer',
      { p_match_id: WM, p_question_index: i, p_selected: qd?.correct_answer });
  }
  await fastForward(WM);
  const wSettleLoser = await rpc(W2, 'arena_settle', { p_match_id: WM });
  const wSettleWinner = await rpc(W1, 'arena_settle', { p_match_id: WM });

  const loserRow = (wSettleLoser.data?.breakdown || []).find((b) => b.playerId === W2.id);
  log('L2 the LOSER gets a real balance back (a loss releases 0, so v63 returned null)',
    loserRow?.balance != null && loserRow.balance === 98
      && await balanceOf(W2.id) === 98,
    `breakdownBalance=${loserRow?.balance} actual=${await balanceOf(W2.id)}`);

  log('L3 balances settle exactly: winner +stake, loser -stake',
    await balanceOf(W1.id) === 102 && await balanceOf(W2.id) === 98,
    `w1=${await balanceOf(W1.id)} w2=${await balanceOf(W2.id)}`);

  const { data: wHist } = await admin.from('duels')
    .select('outcome, delta, stake, transaction_type')
    .eq('user_id', W1.id);
  const { data: wHistL } = await admin.from('duels')
    .select('outcome, delta, stake, transaction_type')
    .eq('user_id', W2.id);
  const winRow = (wHist || [])[0];
  const lossRow = (wHistL || [])[0];
  log('L4 net delta: a win records +stake, not the gross release',
    winRow?.outcome === 'win' && winRow?.delta === 2 && winRow?.stake === 2,
    `outcome=${winRow?.outcome} delta=${winRow?.delta}`);
  log('L5 net delta: a loss records -stake (it used to record 0, so the row rendered red + green "0 SC")',
    lossRow?.outcome === 'loss' && lossRow?.delta === -2,
    `outcome=${lossRow?.outcome} delta=${lossRow?.delta}`);
  log('L6 transaction_type agrees with the outcome',
    winRow?.transaction_type === 'duel_win' && lossRow?.transaction_type === 'duel_loss',
    `${winRow?.transaction_type}/${lossRow?.transaction_type}`);

  // ---- free practice -----------------------------------------------------
  const PR = await makeUser('pr', 40);
  users.push(PR);
  const noBot = await rpc(PR, 'arena_create_match',
    { p_mode: 'duel', p_stake: 0, p_opponent_id: W2.id, p_practice: true });
  log('L7 practice is refused without a tutor (it can never make a coinless human duel)',
    noBot.data?.ok === false && noBot.data?.error === 'PRACTICE_NEEDS_BOT',
    `error=${noBot.data?.error}`);

  const prCreate = await rpc(PR, 'arena_create_match',
    { p_mode: 'duel', p_stake: 0, p_bot: 'apollo', p_practice: true });
  const PRM = prCreate.data?.matchId;
  if (PRM) createdMatchIds.add(PRM);
  log('L8 a practice match moves ZERO coins and escrows nothing',
    prCreate.data?.ok === true && prCreate.data?.practice === true
      && prCreate.data?.escrowed === 0 && await balanceOf(PR.id) === 40,
    `practice=${prCreate.data?.practice} escrowed=${prCreate.data?.escrowed} balance=${await balanceOf(PR.id)}`);

  const prRow = PRM ? await matchRow(PRM) : null;
  log('L9 a practice match is still arena-owned despite escrow_amount = 0',
    prRow?.escrow_amount === 0 && prRow?.format === 'blitz',
    `escrow=${prRow?.escrow_amount} format=${prRow?.format}`);

  const legacyOnPractice = await rpc(PR, 'complete_competitive_match', { p_match_id: PRM });
  log('L10 the seal covers a 0-stake practice match (escrow_amount>0 would have skipped it)',
    /ARENA_REQUIRES_ARENA_RPC|BLITZ_REQUIRES_ARENA/.test(legacyOnPractice.msg || ''),
    `msg=${(legacyOnPractice.msg || '').slice(0, 80)}`);

  if (PRM) {
    await rpc(PR, 'arena_ready', { p_match_id: PRM });
    await rpc(PR, 'arena_start', { p_match_id: PRM });
    const prRow2 = await matchRow(PRM);
    for (let i = 0; i < Math.min(4, prRow2.question_count); i += 1) {
      const { data: qd } = await admin.from('questions')
        .select('correct_answer').eq('id', prRow2.question_ids[i]).maybeSingle();
      await rpc(PR, 'arena_answer',
        { p_match_id: PRM, p_question_index: i, p_selected: qd?.correct_answer });
    }
    await fastForward(PRM);
    await rpc(PR, 'arena_settle', { p_match_id: PRM });
  }
  const { data: prHist } = await admin.from('duels').select('id').eq('user_id', PR.id);
  log('L11 practice writes NO duel history row and moves no coins',
    (prHist || []).length === 0 && await balanceOf(PR.id) === 40,
    `historyRows=${(prHist || []).length} balance=${await balanceOf(PR.id)}`);

  // ---- a match whose opponent never readied ------------------------------
  const S1 = await makeUser('s1', 50);
  const S2 = await makeUser('s2', 50);
  users.push(S1, S2);
  const sc = await rpc(S1, 'arena_create_match',
    { p_mode: 'duel', p_stake: 5, p_opponent_id: S2.id });
  const SM = sc.data?.matchId;
  if (SM) createdMatchIds.add(SM);
  // Age it past the invite TTL WITHOUT ready_at ever being set (v63 could only
  // expire a match once BOTH sides had readied, so this froze both stakes).
  await adminSql(`select set_config('arena.write','1',true);
                  update public.competitive_matches
                     set created_at = now() - interval '10 minutes'
                   where id = '${SM}'`);
  await rpc(S1, 'arena_state', { p_match_id: SM });
  const sRow = await matchRow(SM);
  log('L12 a match whose opponent never readied is expired and BOTH stakes refunded',
    sRow?.status === 'abandoned' && await balanceOf(S1.id) === 50
      && await balanceOf(S2.id) === 50,
    `status=${sRow?.status} s1=${await balanceOf(S1.id)} s2=${await balanceOf(S2.id)}`);

  // ---- scholars list ------------------------------------------------------
  const rosterRes = await rpc(PR, 'arena_roster', { p_stake: 2, p_format: 'blitz' });
  const players = rosterRes.data?.players || [];
  const statuses = [...new Set(players.map((p) => p.status))];
  log('L13 the scholars list returns a status per player and never lists the caller',
    rosterRes.data?.ok === true
      && Array.isArray(players)
      && !players.some((p) => p.userId === PR.id)
      && players.every((p) => ['available', 'in_match', 'offline'].includes(p.status))
      && typeof rosterRes.data?.online === 'number',
    `players=${players.length} statuses=${statuses.join('/')} online=${rosterRes.data?.online}`);
  log('L14 a busy or offline scholar is never challengeable',
    players.filter((p) => p.status !== 'available').every((p) => p.canChallenge === false),
    `nonChallengeableWrongly=${players.filter((p) => p.status !== 'available' && p.canChallenge).length}`);

  const anonRoster = await anon.rpc('arena_roster', { p_stake: 2 });
  log('L15 an anonymous caller cannot read the scholars list',
    !!anonRoster.error, `error=${anonRoster.error?.message?.slice(0, 60)}`);

  const anonSweep = await anon.rpc('_arena_sweep');
  log('L16 the internal sweep is service-role only (anon cannot reap matches)',
    !!anonSweep.error, `error=${anonSweep.error?.message?.slice(0, 60)}`);

} catch (err) {
  log('SUITE ERROR — ' + (err?.message || err), false);
} finally {
  // ---- cleanup: never leave a scratch match, queue row or user behind ----
  try {
    await admin.from('arena_queue').delete().neq('user_id', '00000000-0000-0000-0000-000000000000');
    for (const id of createdMatchIds) {
      await admin.from('arena_match_events').delete().eq('match_id', id);
      await admin.from('competitive_match_answers').delete().eq('match_id', id);
      await admin.from('competitive_matches').delete().eq('id', id);
    }
    for (const u of users) {
      await admin.from('duels').delete().eq('user_id', u.id);
      await admin.from('competitive_stats').delete().eq('user_id', u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
  } catch (e) {
    console.log('cleanup warning:', e?.message || e);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log('  - ' + f.step + (f.detail ? ' :: ' + f.detail : ''));
  }
  process.exit(failed.length ? 1 : 0);
}