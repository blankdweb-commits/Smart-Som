// scripts/e2e-duel-lobby.mjs
//
// Live verification of the LEGACY competitive-match engine that still serves
// Triple Threat (format = 'sudden_death'), plus the v63 SEAL that keeps 1v1 on
// the arena economy.
//
// SCOPE CHANGE (v63): the 1v1 blitz coverage that used to live here — escrow,
// the ready handshake, grace/forfeit, the points formula, Double, bot parity,
// matchmaking — is now in scripts/e2e-arena.mjs (npm run e2e:arena), because
// those paths moved to the arena_* RPCs. What remains here is exactly what the
// arena deliberately did NOT take over.
//
// Contract proven:
//   1. Triple Threat (sudden_death) still creates, grades and settles.
//   2. No answer key leaks at serve time.
//   3. Settlement is replay-proof and moves coins exactly once.
//   4. RLS/ACL: anon refused; a non-participant cannot read or settle.
//   5. The legacy 1v1 blitz path is SEALED (42501 BLITZ_REQUIRES_ARENA) so
//      nobody can bypass the arena escrow by calling the old RPC.
//   6. Triple Threat is explicitly NOT sealed.
//
// Run: npm run e2e:duel
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const env = loadEnv();
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
  // Sign-in MUST happen on a separate publishable client: a service-role
  // client that has ever run signInWithPassword/getUser fails every later
  // PostgREST write with an RLS error (see AGENTS.md).
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
  const { error: actErr } = await admin.from('profiles').update({ is_activated: true }).eq('id', id);
  if (actErr) throw new Error(`activate ${tag}: ${actErr.message}`);
  return { id, email, token: s.session.access_token, headers: { apikey: ANON, Authorization: `Bearer ${s.session.access_token}`, 'Content-Type': 'application/json' } };
}

// RPCs are called over raw REST so a raised SQL error surfaces verbatim (the
// v63 seal is a 42501 RAISE inside a trigger, not a jsonb error body).
const rpc = async (u, fn, params = {}) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${u.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data = null; let error = null;
  try { data = text.length ? JSON.parse(text) : null; } catch { error = { message: text.slice(0, 200) }; }
  if (!error && !res.ok) error = { code: String(res.status), message: text.slice(0, 200) };
  return { data, error, msg: error?.message || '' };
};

const balanceOf = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).maybeSingle();
  return data?.smart_coins ?? null;
};
const matchRow = async (id) => {
  const { data } = await admin.from('competitive_matches').select('*').eq('id', id).maybeSingle();
  return data || null;
};

const users = [];
const matchIds = new Set();

try {
  const P1 = await makeUser('p1', 100);
  const P2 = await makeUser('p2', 100);
  const BYSTANDER = await makeUser('by', 100);
  users.push(P1, P2, BYSTANDER);

  // ------------------------------------------------------------------
  // A. Triple Threat (sudden_death) — the path v63 deliberately left alone
  // ------------------------------------------------------------------
  const c1 = await rpc(P1, 'create_competitive_match', {
    p_mode: 'triple', p_stake: 5, p_opponent_id: P2.id, p_format: 'sudden_death',
  });
  const M = c1.data?.matchId;
  if (M) matchIds.add(M);
  log('A1 Triple Threat creates a sudden_death match and serves questions',
    c1.data?.ok === true && c1.data?.format === 'sudden_death'
      && Array.isArray(c1.data?.questions) && c1.data.questions.length >= 1,
    `matchId=${M} q=${c1.data?.questions?.length}`);

  const LEAK = ['correct_answer', 'correctAnswer', 'answer', 'correct', 'rationale', 'explanation', 'hint'];
  log('A2 no answer key leaks at serve time',
    (c1.data?.questions || []).every((q) => !LEAK.some((k) => Object.prototype.hasOwnProperty.call(q, k))));

  const row = await matchRow(M);
  log('A3 the match row is duel-safe: blitz columns are zeroed (no escrow)',
    row?.format === 'sudden_death' && row?.escrow_amount === 0
      && row?.wager_creator_held === false && row?.wager_released === false,
    `format=${row?.format} escrow=${row?.escrow_amount}`);

  log('A4 sudden_death moves no coins at create (legacy engine is untouched)',
    await balanceOf(P1.id) === 100 && await balanceOf(P2.id) === 100,
    `p1=${await balanceOf(P1.id)} p2=${await balanceOf(P2.id)}`);

  // Grade P1 correctly using the real stored key.
  const qid = row.question_ids[0];
  const { data: qrow } = await admin.from('questions').select('correct_answer, options').eq('id', qid).maybeSingle();
  const a1 = await rpc(P1, 'submit_competitive_answer', {
    p_match_id: M, p_question_index: 0, p_selected: qrow.correct_answer,
  });
  log('A5 answers are graded server-side (the client never declares correct)',
    a1.data?.ok === true && a1.data?.isCorrect === true,
    `isCorrect=${a1.data?.isCorrect}`);

  const replay = await rpc(P1, 'submit_competitive_answer', {
    p_match_id: M, p_question_index: 0, p_selected: 'a deliberately wrong answer',
  });
  log('A6 first-answer-wins: a replay cannot flip the stored grade',
    replay.data?.ok === true && replay.data?.replay === true && replay.data?.isCorrect === true,
    `replay=${replay.data?.replay}`);

  const done = await rpc(P1, 'complete_competitive_match', { p_match_id: M });
  log('A7 Triple Threat settles and pays the pot',
    done.data?.ok === true && done.data?.status === 'completed' && done.data?.youWon === true,
    `outcome=${done.data?.outcome} delta=${done.data?.delta}`);

  log('A8 balances moved exactly once',
    await balanceOf(P1.id) === 110 && await balanceOf(P2.id) === 100,
    `p1=${await balanceOf(P1.id)} p2=${await balanceOf(P2.id)}`);

  const done2 = await rpc(P2, 'complete_competitive_match', { p_match_id: M });
  log('A9 settlement is replay-proof from the opponent too',
    done2.data?.ok === true && done2.data?.replay === true
      && await balanceOf(P1.id) === 110 && await balanceOf(P2.id) === 100,
    `p1=${await balanceOf(P1.id)} p2=${await balanceOf(P2.id)}`);

  const hist = await admin.from('duels').select('user_id, outcome, delta')
    .in('user_id', [P1.id, P2.id]);
  log('A10 duel history has one row per player',
    (hist.data || []).length === 2,
    JSON.stringify(hist.data));

  // ------------------------------------------------------------------
  // B. The v63 seal — 1v1 blitz can no longer bypass the arena escrow
  // ------------------------------------------------------------------
  const sealed = await rpc(P1, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: P2.id, p_format: 'blitz',
  });
  log('B1 legacy 1v1 blitz create is SEALED (escrow cannot be bypassed)',
    /BLITZ_REQUIRES_ARENA/.test(sealed.msg || ''),
    (sealed.msg || '').slice(0, 70));

  const sealedBot = await rpc(P1, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_opponent_id: null, p_format: 'blitz', p_bot: 'apollo',
  });
  log('B2 a blitz match cannot be created by any legacy call (bot or human)',
    sealedBot.data?.ok !== true
      && (/BLITZ_REQUIRES_ARENA/.test(sealedBot.msg || '')
        || sealedBot.data?.error === 'BOTS_ARE_1V1'
        || sealedBot.data?.error === 'HUMAN_DUEL_ONLY'),
    `error=${sealedBot.data?.error || (sealedBot.msg || '').slice(0, 60)}`);

  log('B3 sealing blitz created nothing',
    (await balanceOf(P1.id)) === 110,
    `p1=${await balanceOf(P1.id)}`);

  // ------------------------------------------------------------------
  // C. Guards / RLS / ACL on the surviving path
  // ------------------------------------------------------------------
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const anonAttempt = await anon.rpc('create_competitive_match', { p_mode: 'triple', p_stake: 5 });
  log('C1 anonymous cannot create a match', !!anonAttempt.error,
    anonAttempt.error?.message?.slice(0, 60));

  const outsider = await rpc(BYSTANDER, 'get_competitive_match', { p_match_id: M });
  log('C2 a non-participant cannot read a match',
    outsider.data?.ok === false && outsider.data?.error === 'NOT_YOUR_MATCH',
    `error=${outsider.data?.error}`);

  const badStake = await rpc(P1, 'create_competitive_match', { p_mode: 'triple', p_stake: 3 });
  log('C3 a non-preset stake is refused',
    badStake.data?.ok === false && badStake.data?.error === 'INVALID_STAKE',
    `error=${badStake.data?.error}`);

  const self = await rpc(P1, 'create_competitive_match', { p_mode: 'triple', p_stake: 5, p_opponent_id: P1.id });
  log('C4 challenging yourself is refused',
    self.data?.ok === false && self.data?.error === 'INVALID_OPPONENT',
    `error=${self.data?.error}`);

  const badBot = await rpc(P1, 'create_competitive_match', {
    p_mode: 'duel', p_stake: 5, p_bot: 'skynet', p_format: 'sudden_death',
  });
  log('C5 an unknown tutor id is refused',
    badBot.data?.ok === false && badBot.data?.error === 'INVALID_BOT',
    `error=${badBot.data?.error}`);

  // ------------------------------------------------------------------
  // D. The arena owns 1v1 now
  // ------------------------------------------------------------------
  const arenaMatch = await rpc(P1, 'arena_create_match', { p_mode: 'duel', p_stake: 5, p_bot: 'house' });
  const AM = arenaMatch.data?.matchId;
  if (AM) matchIds.add(AM);
  log('D1 1v1 goes through the arena (escrowed) and is the blitz format',
    arenaMatch.data?.ok === true && arenaMatch.data?.format === 'blitz'
      && arenaMatch.data?.escrowed === 5,
    `matchId=${AM} escrowed=${arenaMatch.data?.escrowed}`);

  const arenaRow = await matchRow(AM);
  log('D2 the arena match carries escrow flags the legacy path never set',
    arenaRow?.escrow_amount === 5 && arenaRow?.wager_creator_held === true
      && arenaRow?.status === 'ready',
    `escrow=${arenaRow?.escrow_amount} held=${arenaRow?.wager_creator_held} status=${arenaRow?.status}`);

  const cancelled = await rpc(P1, 'arena_cancel', { p_match_id: AM });
  log('D3 cancelling before the clock opens refunds in full',
    cancelled.data?.ok === true && await balanceOf(P1.id) === 110,
    `p1=${await balanceOf(P1.id)}`);

  log('D4 arena and legacy rows are distinguishable by escrow_amount',
    (await matchRow(M))?.escrow_amount === 0 && (await matchRow(AM))?.escrow_amount === 5);

} catch (err) {
  log('SUITE ERROR — ' + (err?.message || err), false);
} finally {
  try {
    await admin.from('arena_queue').delete()
      .neq('user_id', '00000000-0000-0000-0000-000000000000');
    for (const id of matchIds) {
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
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log('  - ' + f.step + (f.detail ? ' :: ' + f.detail : ''));
  }
  process.exit(failed.length ? 1 : 0);
}