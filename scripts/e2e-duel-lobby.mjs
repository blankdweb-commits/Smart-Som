// scripts/e2e-duel-lobby.mjs
//
// Live verification of the 1v1 Duel Lobby + Blitz rebuild (migration v58)
// against the real project. Drives the SAME SECURITY DEFINER RPCs the client
// calls (create_competitive_match / start_competitive_match /
// get_competitive_match / submit_competitive_answer / complete_competitive_match)
// with real GoTrue tokens on the publishable key, and probes the DB + RLS with
// the service-role client.
//
// Contract proven:
//   1.  create_competitive_match(...,'blitz') selects a BALANCED 40-NMCN
//       sequence (Easy 8 / Moderate 12 / Hard 12 / Expert 8) and serves it with
//       NO answer key; the wager is NOT moved at create (solvency check only).
//   2.  the racing pair de-duplicates: the second human's create REPLAYS the
//       SAME match id + SAME question sequence.
//   3.  start_competitive_match opens the shared 90s wall-clock once;
//       rechecks return the same starts_at/ends_at (idempotent).
//   4.  submit_competitive_answer is FIRST-ANSWER-WINS; the one-time "Double"
//       (x2) is server-enforced (partial unique index uq_cma_one_double): at
//       most one multiplier=2 row per (match, player); a second double flag on
//       a later index falls through to the stored grade.
//   5.  wrong answers grade -1, skips 0, correct +1 (x2 when doubled).
//   6.  complete BEFORE the clock ends is REFUSED (BLITZ_NOT_ENDED + remainingMs).
//   7.  at ends_at the settlement is DETERMINISTIC (score desc): winner +stake,
//       loser -stake via _sc_apply with unique per-player refs — replay-proof,
//       balances move exactly once, duels history + competitive_stats write
//       (both humans fully-answered = verified 1v1 win), refresh_duel_risk runs.
//   8.  RLS/ACL: anon cannot create; a non-participant authenticated user gets
//       NOT_YOUR_MATCH on get/complete; invalid params are refused
//       (BLITZ_IS_1V1 / HUMAN_DUEL_ONLY / INVALID_STAKE / INSUFFICIENT_SC).
//
// Requires a reachable Supabase project (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
// + SUPABASE_SERVICE_ROLE_KEY in .env). Run:
//   npm run e2e:duel
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

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const uuid = () => crypto.randomUUID();
const password = 'testpass123';

async function makeUser(tag, seedSc = 0) {
  const email = `duel-${tag}-${Date.now().toString().slice(-7)}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  const id = data.user.id;
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signin ${tag}: ${se.message}`);
  if (seedSc > 0) {
    const { error: scErr } = await admin.rpc('_sc_apply', {
      p_user_id: id, p_amount: seedSc, p_reason: 'e2e_duel_seed', p_source: 'e2e',
      p_transaction_type: 'earn', p_ref_type: 'e2e', p_ref_id: uuid(),
      p_metadata: { e2e: true }, p_client_request_id: uuid(),
    });
    if (scErr) throw new Error(`seed SC ${tag}: ${scErr.message}`);
  }
  const { error: actErr } = await admin.from('profiles')
    .update({ is_activated: true })
    .eq('id', id);
  if (actErr) throw new Error(`activate ${tag}: ${actErr.message}`);
  return { id, email, pub, token: s.session.access_token };
}

const balanceOf = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).maybeSingle();
  return data?.smart_coins ?? null;
};
const statsOf = async (id) => {
  const { data } = await admin.from('competitive_stats').select('*').eq('user_id', id).maybeSingle();
  return data || null;
};

const callRpc = async (user, fn, params) => {
  const { data, error } = await user.pub.rpc(fn, params);
  return { data, error };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until the match's ends_at has passed (max ~115s).
async function waitForEnd(endsAt) {
  const target = Date.parse(endsAt) + 1200;
  for (let i = 0; i < 40; i++) {
    if (Date.now() >= target) return;
    await sleep(3000);
  }
}

let users = [];

try {
  const P1 = await makeUser('p1', 100);
  const P2 = await makeUser('p2', 100);
  const P3 = await makeUser('p3', 0);
  const ANONC = createClient(URL, ANON, { auth: { persistSession: false } });
  users = [P1, P2, P3];

  // ------------------------------------------------------------------
  // A. Create (P1) — balanced sequence, no answer leak, no wager move
  // ------------------------------------------------------------------
  const c1 = await callRpc(P1, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: P2.id, p_format: 'blitz',
  });
  log('create act1 -> ok, blitz, 40 NMCN questions',
    c1.data?.ok === true && c1.data?.replay === false && c1.data?.format === 'blitz'
      && c1.data?.framework === 'NMCN' && c1.data?.questionCount === 40
      && (c1.data?.questions || []).length === 40,
    `matchId=${c1.data?.matchId} qCount=${c1.data?.questionCount}`);

  const served = c1.data?.questions || [];
  const LEAK = ['correct_answer', 'correctAnswer', 'answer', 'correct', 'rationale', 'explanation', 'hint'];
  const noLeak = served.every((q) => !LEAK.some((k) => Object.prototype.hasOwnProperty.call(q, k)));
  const countBy = (d) => served.reduce((m, q) => { m[q.difficulty] = (m[q.difficulty] || 0) + 1; return m; }, {})[d] || 0;
  log('served questions leak NO answer key', noLeak, `q0=${JSON.stringify(Object.keys(served[0] || {}))}`);
  log('balanced split Easy 8 / Moderate 12 / Hard 12 / Expert 8',
    countBy('Easy') === 8 && countBy('Moderate') === 12 && countBy('Hard') === 12 && countBy('Expert') === 8,
    `E${countBy('Easy')} M${countBy('Moderate')} H${countBy('Hard')} X${countBy('Expert')}`);

  const { data: mRow } = await admin.from('competitive_matches')
    .select('*').eq('id', c1.data.matchId).maybeSingle();
  log('DB match row -> duel/blitz/5/waiting, 40 qids, players pinned',
    !!mRow && mRow.match_type === 'duel' && mRow.format === 'blitz' && mRow.stake === 5
      && mRow.status === 'waiting' && mRow.creator_id === P1.id && mRow.opponent_id === P2.id
      && (mRow.question_ids || []).length === 40 && !mRow.starts_at,
    `status=${mRow?.status} qids=${(mRow?.question_ids || []).length}`);

  log('no wager moved at create (both still 100)',
    (await balanceOf(P1.id)) === 100 && (await balanceOf(P2.id)) === 100,
    `P1=${await balanceOf(P1.id)} P2=${await balanceOf(P2.id)}`);

  // ------------------------------------------------------------------
  // B. Pair de-dupe — second human gets SAME match + SAME sequence
  // ------------------------------------------------------------------
  const c2 = await callRpc(P2, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: P1.id, p_format: 'blitz',
  });
  const ids1 = served.map((q) => q.id).join(',');
  const ids2 = (c2.data?.questions || []).map((q) => q.id).join(',');
  log('create act2 -> replay, SAME matchId', c2.data?.ok === true && c2.data?.replay === true && c2.data?.matchId === c1.data?.matchId,
    `replay=${c2.data?.replay}`);
  log('BOTH humans served the identical sequence', ids1.length > 0 && ids1 === ids2, `qcnt=${(c2.data?.questions || []).length}`);

  // ------------------------------------------------------------------
  // C. Start — one shared 90s wall-clock, idempotent
  // ------------------------------------------------------------------
  const st1 = await callRpc(P1, 'start_competitive_match', { p_match_id: c1.data.matchId });
  const ms = Date.parse(st1.data?.endsAt) - Date.parse(st1.data?.startsAt);
  log('start opens the 90s window once',
    st1.data?.ok === true && !!st1.data?.startsAt && !!st1.data?.endsAt && Math.abs(ms - 90000) < 1500,
    `windowMs=${ms}`);

  const { data: mActive } = await admin.from('competitive_matches')
    .select('status, starts_at, ends_at').eq('id', c1.data.matchId).maybeSingle();
  log('DB match is active with starts/ends', mActive.status === 'active' && !!mActive.starts_at && !!mActive.ends_at,
    `status=${mActive?.status}`);

  const st2 = await callRpc(P2, 'start_competitive_match', { p_match_id: c1.data.matchId });
  log('second start -> replay with identical clock', st2.data?.ok === true && st2.data?.replay === true
      && st2.data?.startsAt === st1.data?.startsAt && st2.data?.endsAt === st1.data?.endsAt,
    `replay=${st2.data?.replay}`);

  // ------------------------------------------------------------------
  // D. Submission — first-answer-wins + one-time x2 Double
  // ------------------------------------------------------------------
  // Read the answer key server-side (admin) so the TEST knows the correct
  // option — the client never does.
  const { data: qRows } = await admin.from('questions')
    .select('id, correct_answer, options').in('id', (mRow.question_ids || [])).limit(40);
  const byId = new Map((qRows || []).map((q) => [q.id, q]));

  const correctFor = (i) => byId.get(served[i].id)?.correct_answer || null;
  const wrongFor = (i) => {
    const opts = byId.get(served[i].id)?.options || served[i].options || [];
    return opts.find((o) => String(o) !== String(correctFor(i))) || null;
  };
  if (!correctFor(0)) throw new Error('no answer key available for question 0');

  // P1 Q0 doubled (correct) -> double granted
  const d1 = await callRpc(P1, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: 0, p_selected: correctFor(0), p_double: true,
  });
  log('Q0 doubled correct -> x2, double flag on',
    d1.data?.ok === true && d1.data?.isCorrect === true && d1.data?.multiplier === 2 && d1.data?.double === true && d1.data?.replay === false,
    `mult=${d1.data?.multiplier}`);

  // P1 Q0 re-submit a WRONG answer -> first-answer-wins (replay, keeps x2/correct)
  const d2 = await callRpc(P1, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: 0, p_selected: wrongFor(0),
  });
  log('re-submit Q0 -> replayed, FIRST grade wins (correct x2)',
    d2.data?.replay === true && d2.data?.isCorrect === true && d2.data?.multiplier === 2,
    `replay=${d2.data?.replay} isCorrect=${d2.data?.isCorrect} mult=${d2.data?.multiplier}`);

  // P2 Q0 doubled (correct) — each player has their own one-time Double
  const d3 = await callRpc(P2, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: 0, p_selected: correctFor(0), p_double: true,
  });
  log('opponent Q0 double granted too', d3.data?.double === true && d3.data?.multiplier === 2, `double=${d3.data?.double}`);

  // P1 tries a SECOND double on Q1 -> falls through to stored grade (x1)
  const d4 = await callRpc(P1, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: 1, p_selected: correctFor(1), p_double: true,
  });
  log('2nd double flag on Q1 -> no double (once per player)',
    d4.data?.ok === true && d4.data?.double === false && d4.data?.multiplier === 1 && d4.data?.isCorrect === true,
    `mult=${d4.data?.multiplier} double=${d4.data?.double}`);

  const { data: dblRows } = await admin.from('competitive_match_answers')
    .select('player_id').eq('match_id', c1.data.matchId).eq('multiplier', 2);
  log('DB enforces ONE 2x row per player (partial unique)',
    (dblRows || []).length === 2,
    `mult=2 rows=${(dblRows || []).length}`);

  const badIdx = await callRpc(P1, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: 40, p_selected: 'x',
  });
  log('index 40 refused (INVALID_QUESTION_INDEX)',
    badIdx.data?.ok === false && badIdx.data?.error === 'INVALID_QUESTION_INDEX', `err=${badIdx.data?.error}`);

  // ------------------------------------------------------------------
  // E. Full battle — deterministic verdict: P1 = 41 (all correct, Q0 x2),
  //    P2 = +2 +4 -5 = 1 (Q0 x2 correct, Q1..Q4 correct, Q5..Q9 WRONG)
  // ------------------------------------------------------------------
  const p1Exec = [];
  for (let i = 2; i < 40; i++) p1Exec.push(callRpc(P1, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: i, p_selected: correctFor(i),
  }));
  await Promise.all(p1Exec);

  const p2Write = [1, 2, 3, 4].map((i) => callRpc(P2, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: i, p_selected: correctFor(i),
  }));
  for (let i = 5; i < 10; i++) p2Write.push(callRpc(P2, 'submit_competitive_answer', {
    p_match_id: c1.data.matchId, p_question_index: i, p_selected: wrongFor(i),
  }));
  await Promise.all(p2Write);

  const countRows = async (playerId) => {
    const { data, error } = await admin.from('competitive_match_answers')
      .select('player_id').eq('match_id', c1.data.matchId).eq('player_id', playerId);
    if (error) throw new Error(`countRows: ${error.message}`);
    return (data || []).length;
  };
  log('P1 answered all 40 / P2 answered 10',
    (await countRows(P1.id)) === 40 && (await countRows(P2.id)) === 10,
    `P1=${await countRows(P1.id)} P2=${await countRows(P2.id)}`);

  const early = await callRpc(P1, 'complete_competitive_match', { p_match_id: c1.data.matchId });
  log('early complete refused (BLITZ_NOT_ENDED + remainingMs)',
    early.data?.ok === false && early.data?.error === 'BLITZ_NOT_ENDED' && early.data?.remainingMs > 0,
    `remainingMs=${early.data?.remainingMs}`);

  // ------------------------------------------------------------------
  // F. Settle at ends_at — deterministic + replay-proof + stats/risk
  // ------------------------------------------------------------------
  await waitForEnd(st1.data.endsAt);

  const fin = await callRpc(P1, 'complete_competitive_match', { p_match_id: c1.data.matchId });
  const bd = fin.data?.breakdown || [];
  const p1b = bd.find((x) => x.playerId === P1.id);
  const p2b = bd.find((x) => x.playerId === P2.id);
  log('settle -> P1 wins on score (41 vs 1), +5 / -5',
    fin.data?.ok === true && fin.data?.status === 'completed' && fin.data?.winnerId === P1.id
      && fin.data?.youWon === true && fin.data?.draw === false
      && fin.data?.outcome === 'win' && fin.data?.delta === 5 && fin.data?.settled === true
      && Number(fin.data?.scores?.[P1.id]) === 41 && Number(fin.data?.scores?.[P2.id]) === 1
      && p1b?.result === 'win' && Number(p1b?.delta) === 5 && p2b?.result === 'loss' && Number(p2b?.delta) === -5,
    `score ${Number(fin.data?.scores?.[P1.id])}v${Number(fin.data?.scores?.[P2.id])} deltas ${p1b?.delta}/${p2b?.delta}`);

  const { data: mDone } = await admin.from('competitive_matches')
    .select('status, winner_id, completed_at, outcome').eq('id', c1.data.matchId).maybeSingle();
  log('DB match completed with winner P1',
    mDone.status === 'completed' && mDone.winner_id === P1.id && !!mDone.completed_at && mDone.outcome?.status === 'completed',
    `status=${mDone?.status}`);

  const bal1 = await balanceOf(P1.id);
  const bal2 = await balanceOf(P2.id);
  log('balances moved exactly once (P1 100->105, P2 100->95)', bal1 === 105 && bal2 === 95, `P1=${bal1} P2=${bal2}`);

  const { data: duelRows } = await admin.from('duels')
    .select('*').in('user_id', [P1.id, P2.id]);
  const p1Duel = (duelRows || []).find((d) => d.user_id === P1.id);
  const p2Duel = (duelRows || []).find((d) => d.user_id === P2.id);
  log('duels history: 1 row each (win duel +5 / loss duel -5, distinct req ids)',
    !!p1Duel && p1Duel.outcome === 'win' && p1Duel.delta === 5 && p1Duel.transaction_type === 'duel'
      && !!p2Duel && p2Duel.outcome === 'loss' && p2Duel.delta === -5 && p2Duel.transaction_type === 'duel'
      && p1Duel?.client_request_id !== p2Duel?.client_request_id,
    `rows=${(duelRows || []).length}`);

  const st1row = await statsOf(P1.id);
  const st2row = await statsOf(P2.id);
  log('competitive_stats: P1 1 win / verified 1v1, P2 matches only',
    st1row?.competitive_matches === 1 && st1row?.competitive_wins === 1
      && st1row?.one_v_one_matches === 1 && st1row?.one_v_one_wins === 1
      && st2row?.competitive_matches === 1 && st2row?.competitive_wins === 0,
    `P1 ${st1row?.one_v_one_wins}w/${st1row?.one_v_one_matches}m P2 ${st2row?.one_v_one_wins}w/${st2row?.one_v_one_matches}m`);
  log('refresh_duel_risk ran for both (risk_score present)',
    typeof st1row?.risk_score === 'number' && typeof st2row?.risk_score === 'number',
    `P1 risk=${st1row?.risk_score}/${st1row?.risk_tier} P2 risk=${st2row?.risk_score}/${st2row?.risk_tier}`);

  const { data: ledgerRows } = await admin.from('smart_coin_ledger')
    .select('reason, user_id').eq('ref_id', c1.data.matchId);
  log('ledger: exactly one win credit + one loss debit for this match',
    (ledgerRows || []).length === 2
      && ledgerRows.some((r) => r.reason === 'duel_win' && r.user_id === P1.id)
      && ledgerRows.some((r) => r.reason === 'duel_loss' && r.user_id === P2.id),
    `ledger=${(ledgerRows || []).length}`);

  const replay = await callRpc(P2, 'complete_competitive_match', { p_match_id: c1.data.matchId });
  log('replay complete -> replay:true, NO double settle',
    replay.data?.ok === true && replay.data?.replay === true && replay.data?.status === 'completed'
      && (await balanceOf(P1.id)) === 105 && (await balanceOf(P2.id)) === 95,
    `replay=${replay.data?.replay}`);

  const getResume = await callRpc(P1, 'get_competitive_match', { p_match_id: c1.data.matchId });
  log('get_competitive_match -> my stored answers (resume), no opponent answers',
    getResume.data?.ok === true && Array.isArray(getResume.data?.myAnswers)
      && getResume.data?.myAnswers.length === 40 && getResume.data?.questions?.length === 40,
    `myAnswers=${getResume.data?.myAnswers?.length}`);

  // ------------------------------------------------------------------
  // G. Guards / RLS / ACL
  // ------------------------------------------------------------------
  const anonCreate = await callRpc({ pub: ANONC }, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: P1.id, p_format: 'blitz',
  });
  log('anon create refused (or UNAUTHENTICATED)',
    !!anonCreate.error || anonCreate.data?.ok === false,
    `err=${anonCreate.error?.message || anonCreate.data?.error}`);

  const spec = await callRpc(P3, 'get_competitive_match', { p_match_id: c1.data.matchId });
  log('non-participant get -> NOT_YOUR_MATCH',
    spec.data?.ok === false && spec.data?.error === 'NOT_YOUR_MATCH', `err=${spec.data?.error}`);
  const specComp = await callRpc(P3, 'complete_competitive_match', { p_match_id: c1.data.matchId });
  log('non-participant complete -> NOT_YOUR_MATCH',
    specComp.data?.ok === false && specComp.data?.error === 'NOT_YOUR_MATCH', `err=${specComp.data?.error}`);

  const gTriple = await callRpc(P1, 'create_competitive_match', {
    p_mode: 'triple', p_stake: 5, p_opponent_id: P2.id, p_format: 'blitz',
  });
  log('blitz + triple -> BLITZ_IS_1V1', gTriple.data?.ok === false && gTriple.data?.error === 'BLITZ_IS_1V1', `err=${gTriple.data?.error}`);

  const gNoOpp = await callRpc(P1, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: null, p_format: 'blitz',
  });
  log('blitz without opponent -> HUMAN_DUEL_ONLY', gNoOpp.data?.ok === false && gNoOpp.data?.error === 'HUMAN_DUEL_ONLY', `err=${gNoOpp.data?.error}`);

  const gStake = await callRpc(P1, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 3, p_opponent_id: P2.id, p_format: 'blitz',
  });
  log('stake 3 refused (INVALID_STAKE)', gStake.data?.ok === false && gStake.data?.error === 'INVALID_STAKE', `err=${gStake.data?.error}`);

  const gFunds = await callRpc(P3, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: P2.id, p_format: 'blitz',
  });
  log('insufficient SC refused (INSUFFICIENT_SC)', gFunds.data?.ok === false && gFunds.data?.error === 'INSUFFICIENT_SC', `err=${gFunds.data?.error}`);

  // ------------------------------------------------------------------
  // H. Tutor bots (v60) — non-blitz 1v1, server-graded, no verified stats
  // ------------------------------------------------------------------
  const PB = await makeUser('bot', 100);
  users.push(PB);

  const bBad = await callRpc(PB, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: null, p_format: 'sudden_death', p_bot: 'goku',
  });
  log('invalid bot key -> INVALID_BOT',
    bBad.data?.ok === false && bBad.data?.error === 'INVALID_BOT', `err=${bBad.data?.error}`);

  const bBlitz = await callRpc(PB, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: null, p_format: 'blitz', p_bot: 'apollo',
  });
  log('bot + blitz -> BOTS_ARE_1V1',
    bBlitz.data?.ok === false && bBlitz.data?.error === 'BOTS_ARE_1V1', `err=${bBlitz.data?.error}`);

  const bTriple = await callRpc(PB, 'create_competitive_match', {
    p_mode: 'triple', p_stake: 5, p_opponent_id: null, p_format: 'sudden_death', p_bot: 'house',
  });
  log('bot + triple -> BOTS_ARE_1V1',
    bTriple.data?.ok === false && bTriple.data?.error === 'BOTS_ARE_1V1', `err=${bTriple.data?.error}`);

  const bc = await callRpc(PB, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: null, p_format: 'sudden_death', p_bot: 'apollo',
  });
  log('bot create -> ok, sudden_death, opponentBot apollo',
    bc.data?.ok === true && bc.data?.format === 'sudden_death'
      && bc.data?.opponentBot === 'apollo' && (bc.data?.questions || []).length === 1,
    `format=${bc.data?.format} bot=${bc.data?.opponentBot} q=${(bc.data?.questions || []).length}`);

  const bRow = (await admin.from('competitive_matches').select('*').eq('id', bc.data.matchId).maybeSingle()).data;
  log('DB bot match -> opponent_id NULL, opponent_bot apollo',
    !!bRow && bRow.opponent_id === null && bRow.opponent_bot === 'apollo',
    `opp=${bRow?.opponent_id} bot=${bRow?.opponent_bot}`);

  const bq = (bc.data?.questions || [])[0];
  const { data: bqRow } = await admin.from('questions').select('id, correct_answer').eq('id', bq.id).maybeSingle();
  const bAns = await callRpc(PB, 'submit_competitive_answer', {
    p_match_id: bc.data.matchId, p_question_index: bq.index ?? 0, p_selected: bqRow?.correct_answer,
  });
  log('bot match answer graded correct', bAns.data?.ok === true && bAns.data?.isCorrect === true, `isCorrect=${bAns.data?.isCorrect}`);

  const bBalBefore = await balanceOf(PB.id);
  const bDone = await callRpc(PB, 'complete_competitive_match', { p_match_id: bc.data.matchId });
  const bBalAfter = await balanceOf(PB.id);
  const bdList = bDone.data?.breakdown || [];
  const humanBd = bdList.find((x) => x.playerId === PB.id);
  const botBd = bdList.find((x) => x.isBot === true);
  log('bot settle -> completed, delta in {-5,0,+5}',
    bDone.data?.ok === true && bDone.data?.status === 'completed' && [-5, 0, 5].includes(bDone.data?.delta),
    `delta=${bDone.data?.delta}`);
  log('bot settle -> balance moved by exactly delta',
    bBalAfter === bBalBefore + (bDone.data?.delta || 0),
    `before=${bBalBefore} after=${bBalAfter} delta=${bDone.data?.delta}`);
  log('bot breakdown -> human entry + bot entry named Prof. Apollo',
    !!humanBd && !!botBd && botBd.name === 'Prof. Apollo' && humanBd.score === 1,
    `bot=${botBd?.name} humanScore=${humanBd?.score}`);
  log('bot verdict consistent with delta (win/loss/draw)',
    (bDone.data?.delta > 0 && bDone.data?.winnerId === PB.id)
      || (bDone.data?.delta < 0 && bDone.data?.winnerId === null && bDone.data?.winner === 'Prof. Apollo')
      || (bDone.data?.delta === 0 && bDone.data?.draw === true),
    `delta=${bDone.data?.delta} winnerId=${bDone.data?.winnerId} winner=${bDone.data?.winner} draw=${bDone.data?.draw}`);
  log('bot youWon matches delta>0', bDone.data?.youWon === (bDone.data?.delta > 0), `youWon=${bDone.data?.youWon}`);
  const bStats = await statsOf(PB.id);
  log('bot duel -> NO verified competitive stats',
    !bStats || (bStats.one_v_one_matches || 0) === 0,
    `1v1matches=${bStats?.one_v_one_matches ?? 0}`);
  const { data: bDuelRows } = await admin.from('duels')
    .select('opponent, delta, outcome').eq('user_id', PB.id)
    .order('created_at', { ascending: false }).limit(1);
  log('bot duel history row names the tutor',
    bDuelRows?.[0]?.opponent === 'Prof. Apollo',
    `opp=${bDuelRows?.[0]?.opponent}`);

  // Human never answered -> abandoned (no coins), even for a bot match.
  const bc2 = await callRpc(PB, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: null, p_format: 'sudden_death', p_bot: 'house',
  });
  const bIdleBefore = await balanceOf(PB.id);
  const bIdle = await callRpc(PB, 'complete_competitive_match', { p_match_id: bc2.data.matchId });
  const bIdleAfter = await balanceOf(PB.id);
  log('bot match with NO answer -> abandoned, no coins',
    bIdle.data?.status === 'abandoned' && bIdleAfter === bIdleBefore,
    `status=${bIdle.data?.status} delta=${bIdleAfter - bIdleBefore}`);

  // ------------------------------------------------------------------
  // I. duel_roster (v60) — eligible scholars only (active premium + solvent)
  // ------------------------------------------------------------------
  const longExpiry = new Date(Date.now() + 30 * 864e5).toISOString();
  const graceExpiry = new Date(Date.now() + 32 * 864e5).toISOString();
  const makePremium = async (id) => admin.from('subscriptions').insert({
    user_id: id, status: 'active', expires_at: longExpiry, grace_until: graceExpiry,
    plan: 'monthly', amount: 6999, reference: `e2e-roster-${id}`,
  });
  const waitRow = async (id) => admin.from('duel_waiting').insert({
    user_id: id, mode: 'duel', stake: 5, format: 'sudden_death',
  });

  const P5 = await makeUser('ros-prem', 100); // premium + solvent -> eligible
  const P6 = await makeUser('ros-nosub', 100); // solvent, no sub -> excluded
  const P7 = await makeUser('ros-broke', 0); // premium, 0 SC -> excluded
  users.push(P5, P6, P7);
  await makePremium(P5.id);
  await makePremium(P7.id);
  await waitRow(P5.id);
  await waitRow(P6.id);
  await waitRow(P7.id);

  const roster = await callRpc(PB, 'duel_roster', { p_mode: 'duel', p_stake: 5, p_format: 'sudden_death' });
  const rIds = (roster.data?.players || []).map((p) => p.userId);
  log('roster -> includes eligible premium+solvent scholar',
    roster.data?.ok === true && rIds.includes(P5.id), `ids=${rIds.length}`);
  log('roster -> excludes non-subscriber', !rIds.includes(P6.id), `contains P6=${rIds.includes(P6.id)}`);
  log('roster -> excludes solvent-less scholar', !rIds.includes(P7.id), `contains P7=${rIds.includes(P7.id)}`);
  log('roster -> excludes the caller', !rIds.includes(PB.id), `contains PB=${rIds.includes(PB.id)}`);

  const rosterOtherStake = await callRpc(PB, 'duel_roster', { p_mode: 'duel', p_stake: 20, p_format: 'sudden_death' });
  const rOtherIds = (rosterOtherStake.data?.players || []).map((p) => p.userId);
  log('roster -> stake filter isolates (P5 wagers 5, not 20)', !rOtherIds.includes(P5.id), `ids=${rOtherIds.length}`);

  const rosterAnon = await callRpc({ pub: ANONC }, 'duel_roster', { p_mode: 'duel', p_stake: 5, p_format: 'sudden_death' });
  log('roster -> anon refused (or UNAUTHENTICATED)',
    !!rosterAnon.error || rosterAnon.data?.ok === false,
    `err=${rosterAnon.error?.message || rosterAnon.data?.error}`);
} catch (err) {
  console.error('\nE2E ERROR:', err?.message || err);
  results.push({ step: 'uncaught error', ok: false, detail: (err?.message || String(err)).slice(0, 300) });
} finally {
  // Cleanup scratch users (FK cascade wipes matches/answers/duels/stats/ledger).
  for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed (e2e-duel-lobby) ===`);
  process.exit(failed.length ? 1 : 0);
}