// End-to-end coverage for the v108/v109 money surfaces in the social hub.
//
// The original social-hub suite only proves the five tabs that existed before
// Requests and Wallet. This one drives both new tabs through their real forms
// and asserts the money legs in the database:
//
//   A asks B for 7 SC -> B accepts -> 7 moves once
//   B asks A for a 10 SC / 10% / 7-day rival loan -> A funds it
//   B repays 11 SC -> A ends at +8 net, B at -8 net
//   both sides get the notifications, and A's bell link opens the loans view
//
// Run against the dev server: npm run e2e:social-money

import { loadEnv, createBrowser, createLogger, loginFlow } from './e2e-utils.mjs';
import { createClient } from '@supabase/supabase-js';

const env = loadEnv();
const BASE = env.E2E_BASE_URL || 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const PASSWORD = 'testpass123';
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const tester = createLogger();
const browser = await createBrowser();

const A = { name: `Money Alpha ${stamp}`, email: `money${stamp}a@apextest.local` };
const B = { name: `Money Bravo ${stamp}`, email: `money${stamp}b@apextest.local` };
const users = {};

// CSS uppercases headings and labels, so textContent/innerText must be compared
// case-insensitively (the same reason the other suites use waitBody).
const waitText = (page, text, timeout = 20000) =>
  page.waitForFunction(
    (t) => document.body.innerText.toUpperCase().includes(t.toUpperCase()),
    text,
    { timeout, polling: 500 }
  );

const balance = async (id) => {
  const { data } = await admin.from('profiles').select('smart_coins').eq('id', id).single();
  return data?.smart_coins;
};

try {
  for (const p of [A, B]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email, password: PASSWORD, email_confirm: true,
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    users[p.name] = data.user.id;
    await admin.from('profiles').update({
      is_activated: true, identity_name: p.name, full_name: `Legal ${p.name}`, smart_coins: 100,
    }).eq('id', data.user.id);
  }
  const idA = users[A.name];
  const idB = users[B.name];

  const { error: relErr } = await admin.from('user_relationships').insert({
    user_id: idA, target_id: idB, rel_type: 'friend', status: 'accepted',
  });
  tester.log('accepted friendship fixture created', !relErr, relErr?.message || '');

  const pageA = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await loginFlow(pageA, BASE, A.email, PASSWORD);
  await pageA.goto(`${BASE}/leaderboard?tab=requests`, { waitUntil: 'domcontentloaded' });
  await waitText(pageA, 'Ask for Smart Coins');
  tester.log('the Requests tab renders its composer', true, '');
  await pageA.locator('select').first().selectOption(idB);
  await pageA.locator('input[type="number"]').first().fill('7');
  await pageA.getByRole('button', { name: 'Send request', exact: true }).click();
  await waitText(pageA, `Asked ${B.name} for 7 SC.`);
  tester.log('A sent a 7 SC request from the UI', true, '');

  const { data: scReq } = await admin.from('social_sc_requests')
    .select('id, amount, status').eq('requester_id', idA).eq('recipient_id', idB).single();
  tester.log('the SC request is pending in the database',
    scReq?.amount === 7 && scReq?.status === 'pending', JSON.stringify(scReq));

  const pageB = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await loginFlow(pageB, BASE, B.email, PASSWORD);
  await pageB.goto(`${BASE}/leaderboard?tab=requests`, { waitUntil: 'domcontentloaded' });
  await waitText(pageB, A.name);
  await pageB.getByRole('button', { name: 'Send 7 SC', exact: true }).click();
  await waitText(pageB, `Sent 7 SC to ${A.name}.`);
  tester.log('B accepted the request from the UI', true, '');

  const { data: scDone } = await admin.from('social_sc_requests')
    .select('status').eq('id', scReq.id).single();
  tester.log('the SC request is accepted in the database', scDone?.status === 'accepted', JSON.stringify(scDone));
  tester.log('the coins moved exactly once', (await balance(idA)) === 107 && (await balance(idB)) === 93,
    `A=${await balance(idA)} B=${await balance(idB)}`);

  await pageB.goto(`${BASE}/leaderboard?tab=wallet&view=loans`, { waitUntil: 'domcontentloaded' });
  await waitText(pageB, 'Borrow from a scholar');
  await pageB.locator('select').first().selectOption(idA);
  const nums = pageB.locator('input[type="number"]');
  await nums.nth(0).fill('10');
  await nums.nth(1).fill('10');
  await nums.nth(2).fill('7');
  await pageB.getByRole('button', { name: 'Send loan request', exact: true }).click();
  await waitText(pageB, `Asked ${A.name} for 10 SC.`);
  tester.log('B sent a 10 SC loan request from the UI', true, '');

  const { data: loan } = await admin.from('social_loans')
    .select('id, principal_sc, interest_pct, term_days, status').eq('borrower_id', idB).single();
  tester.log('the loan request has the chosen terms',
    loan?.principal_sc === 10 && loan?.interest_pct === 10 && loan?.term_days === 7 && loan?.status === 'pending',
    JSON.stringify(loan));

  await pageA.goto(`${BASE}/leaderboard?tab=wallet&view=loans`, { waitUntil: 'domcontentloaded' });
  await waitText(pageA, B.name);
  await pageA.getByRole('button', { name: 'Fund 10 SC', exact: true }).click();
  await waitText(pageA, `Funded ${B.name}'s 10 SC loan.`);
  tester.log('A funded the loan from the UI', true, '');
  tester.log('funding debited the lender', (await balance(idA)) === 97 && (await balance(idB)) === 103,
    `A=${await balance(idA)} B=${await balance(idB)}`);

  await pageB.goto(`${BASE}/leaderboard?tab=wallet&view=loans`, { waitUntil: 'domcontentloaded' });
  await waitText(pageB, `You borrowed from ${A.name}`);
  await pageB.getByRole('button', { name: 'Repay 11 SC', exact: true }).click();
  await waitText(pageB, `Repaid 11 SC to ${A.name}.`);
  tester.log('B repaid principal plus interest from the UI', true, '');

  const { data: repaid } = await admin.from('social_loans').select('status').eq('id', loan.id).single();
  tester.log('the loan is repaid in the database', repaid?.status === 'repaid', JSON.stringify(repaid));
  tester.log('repayment moved principal plus 1 SC interest back',
    (await balance(idA)) === 108 && (await balance(idB)) === 92,
    `A=${await balance(idA)} B=${await balance(idB)}`);

  const { data: notes } = await admin.from('notifications')
    .select('user_id, kind').in('user_id', [idA, idB]);
  const kinds = new Set((notes || []).map((n) => n.kind));
  tester.log('both sides got request/loan notifications',
    kinds.has('sc_request') && kinds.has('sc_request_accepted') && kinds.has('loan_request')
      && kinds.has('loan_accepted') && kinds.has('loan_repaid'),
    [...kinds].join(','));

  await pageA.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  const bell = pageA.getByRole('button', { name: /notifications?/i }).last();
  await bell.click();
  await waitText(pageA, 'repaid a loan');
  const noteBody = (await pageA.textContent('body')) || '';
  tester.log('A sees the server loan notification in the bell',
    noteBody.includes('repaid a loan') && noteBody.includes('accepted your request'),
    noteBody.includes('repaid a loan') ? 'loan copy rendered' : 'loan copy missing');
  const repaidRow = pageA.locator('div.cursor-pointer').filter({ hasText: 'repaid a loan' }).last();
  await repaidRow.click();
  await pageA.waitForURL((url) => url.searchParams.get('tab') === 'wallet'
    && url.searchParams.get('view') === 'loans', { timeout: 10000 });
  tester.log('the notification links to the loans view', true, pageA.url());
} catch (err) {
  tester.log('probe crashed', false, err?.message || String(err));
} finally {
  try {
    const { data } = await admin.auth.admin.listUsers();
    for (const u of data?.users || []) {
      if (u.email === A.email || u.email === B.email) await admin.auth.admin.deleteUser(u.id);
    }
    const after = await admin.auth.admin.listUsers();
    tester.log('cleanup: no test accounts left',
      !(after.data?.users || []).some((u) => u.email === A.email || u.email === B.email), '');
  } catch { /* cleanup best effort */ }
  await browser.close();
  const failed = tester.results.filter((r) => !r.ok);
  console.log(`\n=== ${tester.results.length - failed.length}/${tester.results.length} checks passed ===`);
  process.exitCode = failed.length ? 1 : 0;
}
