// e2e-economy.mjs - Smart Coin transfers + the World Bank (migration v81),
// and the passive-faucet shutdown + lifetime-earnings metric (migration v80).
//
// These paths move real coins, so every check asserts the BALANCE moved by
// exactly the right amount, not just that a call returned ok. The bank is a real
// wallet (the platform admin holds the capital), so the system is conserved:
// nothing is ever printed out of nothing.
import fs from 'fs';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const admin = createClient(URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const log = (label, ok, detail = '') => {
  if (ok) { pass++; console.log(`PASS  ${label}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
};

const stamp = Date.now();
const PASSWORD = `Ec${stamp}A!7`;
const users = [];
const mkUser = async (tag, seedSc) => {
  const email = `econ-${tag}-${stamp}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  await admin.from('profiles').update({ is_activated: true }).eq('id', data.user.id);
  if (seedSc > 0) {
    await admin.rpc('_sc_apply', {
      p_user_id: data.user.id, p_amount: seedSc, p_reason: 'e2e_seed',
      p_source: 'e2e', p_transaction_type: 'earn', p_client_request_id: crypto.randomUUID(),
    });
  }
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password: PASSWORD });
  if (se) throw new Error(`signin ${tag}: ${se.message}`);
  const u = { id: data.user.id, email, client: pub };
  users.push(u);
  return u;
};
const balanceOf = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).single();
  return Number(data?.smart_coins) || 0;
};

try {
  const A = await mkUser('a', 600);
  const B = await mkUser('b', 100);

  // ---- v80: lifetime earnings vs balance -------------------------------
  {
    const earned = await A.client.rpc('sc_earned_total');
    const bal = await balanceOf(A.id);
    log('sc_earned_total reports EARNED (600 from the seed), not a zero balance',
      Number(earned.data) === bal && bal > 0, `earned=${earned.data} balance=${bal}`);

    // Spend some: earned must NOT fall with the balance.
    await A.client.rpc('sc_transfer', { p_to_user: B.id, p_amount: 200, p_request: crypto.randomUUID() });
    const earned2 = await A.client.rpc('sc_earned_total');
    const bal2 = await balanceOf(A.id);
    log('spending reduces the BALANCE but not lifetime earned (the v80 fix)',
      Number(earned2.data) === 600 && bal2 === 400, `earned=${earned2.data} balance=${bal2}`);

    // Put it back so later checks start from a known state.
    await B.client.rpc('sc_transfer', { p_to_user: A.id, p_amount: 200, p_request: crypto.randomUUID() });
  }

  // ---- v80: passive faucets are off -------------------------------------
  {
    const daily = await A.client.rpc('sc_claim_daily');
    const before = await balanceOf(A.id);
    log('the daily faucet is OFF and says why',
      daily.data?.ok === false && daily.data?.error === 'FAUCETS_DISABLED' && before === 600,
      `res=${JSON.stringify(daily.data)} balance=${before}`);

    const challenge = await A.client.rpc('claim_challenge_reward', { p_challenge_key: 'daily-drive' });
    log('challenge rewards are OFF',
      challenge.data?.ok === false && ['FAUCETS_DISABLED', 'CHALLENGE_REWARD_DISABLED'].includes(challenge.data?.error),
      `res=${JSON.stringify(challenge.data)}`);

    const penalty = await A.client.rpc('sc_record_fail_penalty', { p_ref_type: 'quiz', p_ref_id: 'x' });
    log('a failed quiz no longer costs coins',
      penalty.data?.ok === true && penalty.data?.amount === 0 && await balanceOf(A.id) === 600,
      `res=${JSON.stringify(penalty.data)} balance=${await balanceOf(A.id)}`);
  }

  // ---- v80: the loan shark licence is reachable ------------------------
  {
    const cfg = await admin.from('server_config').select('value').eq('key', 'loan').single();
    const gate = cfg.data?.value?.shark_require_balance_sc;
    const fee = cfg.data?.value?.shark_license_fee_sc;
    const richest = await balanceOf(A.id);
    log('the lender licence gate is affordable (it was 1,500 SC = unreachable)',
      gate === 250 && fee === 500 && richest >= gate,
      `gate=${gate} fee=${fee} balance=${richest}`);
  }

  // ---- v81: transfers ---------------------------------------------------
  {
    const req = crypto.randomUUID();
    const t = await A.client.rpc('sc_transfer', { p_to_user: B.id, p_amount: 100, p_request: req });
    log('a transfer moves exactly the amount to each side',
      t.data?.ok === true && await balanceOf(A.id) === 500 && await balanceOf(B.id) === 200,
      `res=${JSON.stringify(t.data)} A=${await balanceOf(A.id)} B=${await balanceOf(B.id)}`);
    log('the sender is told their new balance (balanceAfter, not a null key)',
      Number(t.data?.balance) === 500, `balance=${JSON.stringify(t.data?.balance)}`);

    const replay = await A.client.rpc('sc_transfer', { p_to_user: B.id, p_amount: 100, p_request: req });
    log('replaying the same request id moves NOTHING',
      replay.data?.ok === true && await balanceOf(A.id) === 500 && await balanceOf(B.id) === 200,
      `A=${await balanceOf(A.id)} B=${await balanceOf(B.id)}`);

    const over = await A.client.rpc('sc_transfer', { p_to_user: B.id, p_amount: 500 });
    log('the 200 SC per-transfer cap is enforced',
      over.data?.ok === false && over.data?.error === 'INVALID_AMOUNT' && over.data?.max === 200,
      `res=${JSON.stringify(over.data)}`);

    const zero = await A.client.rpc('sc_transfer', { p_to_user: B.id, p_amount: 0 });
    log('a 0 SC transfer is refused (min is 1)',
      zero.data?.ok === false && zero.data?.error === 'INVALID_AMOUNT',
      `res=${JSON.stringify(zero.data)}`);

    const self = await A.client.rpc('sc_transfer', { p_to_user: A.id, p_amount: 5 });
    log('you cannot transfer to yourself',
      self.data?.ok === false && self.data?.error === 'SELF_TRANSFER',
      `res=${JSON.stringify(self.data)}`);

    const short = await mkUser('short', 10);
    const tooPoor = await short.client.rpc('sc_transfer', { p_to_user: B.id, p_amount: 50 });
    log('a transfer beyond the balance fails and moves nothing',
      tooPoor.data?.ok === false && await balanceOf(short.id) === 10 && await balanceOf(B.id) === 200,
      `res=${JSON.stringify(tooPoor.data)}`);
  }

  // ---- v81: World Bank ---------------------------------------------------
  {
    // A is at 500 SC here (600 seeded, minus the 100 SC transfer above), so
    // the borrow/repay expectations below are relative to that, not to 600.
    const aBeforeBorrow = await balanceOf(A.id);
    const bankBefore = await admin.from('profiles')
      .select('smart_coins').eq('role', 'super_admin').order('created_at').limit(1).single();

    const borrow = await A.client.rpc('worldbank_borrow',
      { p_amount: 200, p_request: crypto.randomUUID() });
    log('borrowing 200 credits the principal and quotes 10% interest',
      borrow.data?.ok === true && borrow.data?.principal === 200
        && borrow.data?.interestSc === 20
        && await balanceOf(A.id) === aBeforeBorrow + 200,
      `res=${JSON.stringify(borrow.data)} A=${await balanceOf(A.id)} (expected ${aBeforeBorrow + 200})`);

    const bankAfter = await admin.from('profiles')
      .select('smart_coins').eq('role', 'super_admin').order('created_at').limit(1).single();
    log('the principal came OUT of the bank wallet (nothing is printed)',
      bankBefore.data.smart_coins - bankAfter.data.smart_coins === 200,
      `bank ${bankBefore.data.smart_coins} -> ${bankAfter.data.smart_coins}`);

    const second = await A.client.rpc('worldbank_borrow', { p_amount: 50 });
    log('only ONE active loan at a time',
      second.data?.ok === false && second.data?.error === 'LOAN_LIMIT_REACHED',
      `res=${JSON.stringify(second.data)}`);

    const tooSmall = await B.client.rpc('worldbank_borrow', { p_amount: 5 });
    log('the 10 SC minimum is enforced',
      tooSmall.data?.ok === false && tooSmall.data?.error === 'INVALID_AMOUNT' && tooSmall.data?.min === 10,
      `res=${JSON.stringify(tooSmall.data)}`);

    const aAfterBorrow = await balanceOf(A.id);
    const repay = await A.client.rpc('worldbank_repay',
      { p_loan: borrow.data?.loanId, p_request: crypto.randomUUID() });
    log('repaying costs principal + interest (200 + 20 = 220)',
      repay.data?.ok === true && repay.data?.paid === 220
        && await balanceOf(A.id) === aAfterBorrow - 220,
      `res=${JSON.stringify(repay.data)} A=${await balanceOf(A.id)} (expected ${aAfterBorrow - 220})`);

    const bankBack = await admin.from('profiles')
      .select('smart_coins').eq('role', 'super_admin').order('created_at').limit(1).single();
    log('the bank is made whole plus interest (conserved, and earns)',
      bankBack.data.smart_coins === bankBefore.data.smart_coins + 20,
      `bank ${bankBefore.data.smart_coins} -> ${bankBack.data.smart_coins}`);

    const aAfterRepay = await balanceOf(A.id);
    const repayAgain = await A.client.rpc('worldbank_repay',
      { p_loan: borrow.data?.loanId, p_request: crypto.randomUUID() });
    log('a settled loan cannot be repaid twice',
      repayAgain.data?.ok === false && repayAgain.data?.error === 'LOAN_ALREADY_SETTLED'
        && await balanceOf(A.id) === aAfterRepay,
      `res=${JSON.stringify(repayAgain.data)}`);

    const stranger = await B.client.rpc('worldbank_repay',
      { p_loan: borrow.data?.loanId, p_request: crypto.randomUUID() });
    log('you cannot repay someone else\'s loan',
      stranger.data?.ok === false && stranger.data?.error === 'NOT_YOUR_LOAN',
      `res=${JSON.stringify(stranger.data)}`);

    const canAgain = await A.client.rpc('worldbank_borrow',
      { p_amount: 100, p_request: crypto.randomUUID() });
    log('a new loan is allowed once the previous one is settled',
      canAgain.data?.ok === true, `res=${JSON.stringify(canAgain.data)}`);
    if (canAgain.data?.ok) {
      await A.client.rpc('worldbank_repay', { p_loan: canAgain.data.loanId, p_request: crypto.randomUUID() });
    }
  }

  // ---- ACLs -------------------------------------------------------------
  {
    const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const a = await anonClient.rpc('sc_transfer', { p_to_user: B.id, p_amount: 5, p_request: crypto.randomUUID() });
    log('anon cannot transfer', !!a.error, `err=${a.error?.message?.slice(0, 50)}`);
    const b = await anonClient.rpc('worldbank_borrow', { p_amount: 10, p_request: crypto.randomUUID() });
    log('anon cannot borrow from the bank', !!b.error, `err=${b.error?.message?.slice(0, 50)}`);
    // Read through a genuine ANON client: the admin client bypasses RLS, so
    // querying with it would "pass" even if the table were world-readable.
    const anonRead = await anonClient.from('worldbank_loans').select('id').limit(1);
    log('the loans table is not readable by anon',
      !!anonRead.error, `err=${anonRead.error?.message?.slice(0, 60) || 'none'}`);
  }
} catch (err) {
  log('SUITE ERROR - ' + (err?.message || err), false);
} finally {
  for (const u of users) {
    try { await admin.from('worldbank_loans').delete().eq('user_id', u.id); } catch { /* ignore */ }
    await admin.auth.admin.deleteUser(u.id);
  }
  const left = await admin.from('worldbank_loans').select('id')
    .in('user_id', users.map((u) => u.id));
  log('cleanup: no loan rows left', (left.data || []).length === 0,
    `rows=${(left.data || []).length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);