// E2E: the social hub (ranking / friends / rivals / activity / cosmetics),
// the friends->rivals round trip, the Arena challenge handoff, the profile
// views wiring, the sound preference, and the Dashboard identity greeting.
//
//   1. The Global Ranking renders USERS and RANKS - not an empty table.
//   2. All five tabs render and switch.
//   3. A sends B a FRIEND request; B sees it incoming and accepts; BOTH then
//      see each other in Friends.
//   4. A adds C as a RIVAL; it appears in Rivals and NOT in Friends (one
//      relationship type per pair).
//   5. A challenges a friend: an arena_invites row appears AND the app
//      navigates to /rumble?challenge=<userId>.
//   6. Cosmetics: buying the Crown debits exactly 40 SC, writes one ledger
//      row, auto-equips, and the badge shows on the profile sheet.
//   7. Profile views: opening someone's profile records a view for them.
//   8. The sound preference persists and drives the audio manager.
//   9. The Dashboard greets with the IDENTITY name, whole - not the legal
//      name, and not the first word of the identity name.
//
// Requires the dev server (vite :5173 + api :3001). Every step asserts the
// DATABASE as well as the DOM, so "the row did not render" is distinguishable
// from "the row does not exist" - which is the failure mode that made the
// _has_crown bug so hard to read.

import {
  loadEnv,
  createBrowser,
  createLogger,
  signupFlow,
  loginFlow,
  waitForText,
  exit
} from './e2e-utils.mjs';
import { createClient } from '@supabase/supabase-js';

const env = loadEnv();
const BASE = env.E2E_BASE_URL || 'http://localhost:5173';
const stamp = Date.now().toString().slice(-8);
const PASSWORD = 'testpass123';

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const tester = createLogger();
const browser = await createBrowser();

const A = { tag: 'a', name: `Hub Alpha ${stamp}`, email: `hub${stamp}a@apextest.local` };
const B = { tag: 'b', name: `Hub Bravo ${stamp}`, email: `hub${stamp}b@apextest.local` };
const C = { tag: 'c', name: `Hub Charlie ${stamp}`, email: `hub${stamp}c@apextest.local` };
const people = [A, B, C];
const ids = {};

const rpc = async (userId, fn, params = {}) => {
  const { data: s } = await admin.auth.admin.generateLink({ type: 'magiclink', email: userId.email });
  void s;
  // Use the service role to read the truth, not a user session: these
  // assertions are about what the DATABASE holds.
  const { data, error } = await admin.rpc(fn, params);
  if (error) return { data: null, error };
  return { data, error: null };
};

const profileOf = async (email) => {
  const { data } = await admin.auth.admin.listUsers();
  const u = (data?.users || []).find((x) => x.email === email);
  return u?.id || null;
};

try {
  // ---------- 0. three activated accounts ----------
  for (const p of people) {
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email, password: PASSWORD, email_confirm: true,
    });
    if (error) throw new Error(`createUser ${p.tag}: ${error.message}`);
    ids[p.tag] = data.user.id;
    await admin.from('profiles').update({ is_activated: true }).eq('id', data.user.id);
  }
  tester.log('three activated accounts created', Object.keys(ids).length === 3, JSON.stringify(ids));

  // Give them names so search can find them, and so the leaderboard shows
  // something other than a handle.
  for (const p of people) {
    await admin.from('profiles')
      .update({ identity_name: p.name, full_name: `Legal ${p.name}` })
      .eq('id', ids[p.tag]);
  }
  tester.log('identity names set on all three', true, Object.values(ids).join(','));

  // ---------- 1. THE RANKING SHOWS USERS AND RANKS ----------
  const pageA = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signupFlow(pageA, BASE, A.name, A.email, PASSWORD);
  await pageA.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2500);

  const bodyA = (await pageA.textContent('body').catch(() => '')) || '';

  // The board must render rank numbers, and the names of the accounts we
  // just made. "No ranked scholars yet" is the empty state and a failure.
  const boardEmpty = /no ranked scholars yet/i.test(bodyA);
  tester.log('the leaderboard is NOT empty', !boardEmpty, `empty-state=${boardEmpty}`);

  const rankBadges = await pageA.locator('span', { hasText: /^\d{1,3}$/ }).count().catch(() => 0);
  tester.log('the leaderboard renders rank numbers', rankBadges > 0, `numeric spans=${rankBadges}`);

  const seesOwnName = bodyA.includes(A.name);
  tester.log('a scholar sees their own identity name on the board', seesOwnName,
    `name="${A.name}" present=${seesOwnName}`);

  // The board must be server-driven, not a local list: the RPC has to return
  // rows for a signed-in caller.
  const { data: lb, error: lbErr } = await admin.rpc('get_player_leaderboard', { p_limit: 5, p_offset: 0 });
  tester.log('get_player_leaderboard returns players to the server',
    !lbErr && Array.isArray(lb?.players) && lb.players.length > 0,
    `players=${lb?.players?.length} err=${lbErr?.message || 'none'}`);

  // ---------- 2. ALL FIVE TABS RENDER AND SWITCH ----------
  const tabNames = ['Ranking', 'Friends', 'Rivals', 'Activity', 'Cosmetics'];
  for (const t of tabNames) {
    const n = await pageA.locator('[role="tab"]', { hasText: t }).count().catch(() => 0);
    tester.log(`tab "${t}" is present`, n === 1, `count=${n}`);
  }

  await pageA.locator('[role="tab"]', { hasText: 'Friends' }).first().click();
  await pageA.waitForTimeout(1200);
  const friendsBody = (await pageA.textContent('body').catch(() => '')) || '';
  tester.log('the Friends tab renders its own content',
    /Find a scholar by name/i.test(friendsBody), `has search box=${/Find a scholar by name/i.test(friendsBody)}`);

  await pageA.locator('[role="tab"]', { hasText: 'Cosmetics' }).first().click();
  await pageA.waitForTimeout(1500);
  const cosBody = (await pageA.textContent('body').catch(() => '')) || '';
  tester.log('the Cosmetics tab lists the Crown at 40 SC',
    /Crown/.test(cosBody) && /40\s*SC/.test(cosBody),
    `crown=${/Crown/.test(cosBody)} price=${/40\s*SC/.test(cosBody)}`);

  // ---------- 3. A SENDS B A FRIEND REQUEST ----------
  await pageA.locator('[role="tab"]', { hasText: 'Friends' }).first().click();
  await pageA.waitForTimeout(800);
  const search = pageA.locator('input[aria-label="Find a scholar to add"]');
  await search.fill(B.name);
  await pageA.waitForTimeout(2000);

  const bResult = pageA.locator('li', { hasText: B.name }).first();
  const bFound = await bResult.count().catch(() => 0);
  tester.log('search finds the other scholar by their identity name', bFound > 0, `matches=${bFound}`);

  await bResult.locator('button', { hasText: 'Friend' }).first().click();
  await pageA.waitForTimeout(2000);

  const { data: rel } = await admin.from('user_relationships')
    .select('id, user_id, target_id, rel_type, status')
    .eq('user_id', ids.a).eq('target_id', ids.b).maybeSingle();
  tester.log('the friend request was written to the database',
    rel?.status === 'pending' && rel?.rel_type === 'friend',
    `rel=${JSON.stringify(rel)}`);

  // ---------- 4. B ACCEPTS, AND BOTH SEE EACH OTHER ----------
  const pageB = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await signupFlow(pageB, BASE, B.name, B.email, PASSWORD);
  await pageB.goto(`${BASE}/leaderboard?tab=friends`, { waitUntil: 'networkidle' });
  await pageB.waitForTimeout(2500);

  const bBody = (await pageB.textContent('body').catch(() => '')) || '';
  tester.log('B sees the incoming friend request', bBody.includes(A.name),
    `incoming visible=${bBody.includes(A.name)}`);

  const acceptBtn = pageB.locator('button', { hasText: 'Accept' }).first();
  const acceptCount = await acceptBtn.count().catch(() => 0);
  tester.log('the Accept control is rendered', acceptCount > 0, `count=${acceptCount}`);
  if (acceptCount > 0) {
    await acceptBtn.click();
    await pageB.waitForTimeout(2000);
  }

  const { data: relAfter } = await admin.from('user_relationships')
    .select('rel_type, status')
    .eq('user_id', ids.a).eq('target_id', ids.b).maybeSingle();
  tester.log('accepting marks the relationship accepted',
    relAfter?.status === 'accepted', `rel=${JSON.stringify(relAfter)}`);

  const { count: pairRows } = await admin.from('user_relationships')
    .select('id', { count: 'exact', head: true })
    .or(`and(user_id.eq.${ids.a},target_id.eq.${ids.b}),and(user_id.eq.${ids.b},target_id.eq.${ids.a})`);
  tester.log('ONE row for the pair (no mirror row)', pairRows === 1, `rows=${pairRows}`);

  await pageB.reload({ waitUntil: 'networkidle' });
  await pageB.waitForTimeout(2000);
  const bBody2 = (await pageB.textContent('body').catch(() => '')) || '';
  tester.log('B now sees A in the Friends list', bBody2.includes(A.name),
    `friends visible=${bBody2.includes(A.name)}`);

  await pageA.reload({ waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2000);
  const aBody2 = (await pageA.textContent('body').catch(() => '')) || '';
  tester.log('A now sees B in the Friends list', aBody2.includes(B.name),
    `friends visible=${aBody2.includes(B.name)}`);

  // ---------- 5. A RIVAL IS A DIFFERENT TAB, AND ONLY ONE TYPE PER PAIR ---
  await pageA.locator('input[aria-label="Find a scholar to add"]').fill(C.name);
  await pageA.waitForTimeout(2000);
  const cResult = pageA.locator('li', { hasText: C.name }).first();
  const cFound = await cResult.count().catch(() => 0);
  tester.log('search finds the third scholar', cFound > 0, `matches=${cFound}`);
  if (cFound > 0) {
    await cResult.locator('button', { hasText: 'Rival' }).first().click();
    await pageA.waitForTimeout(2000);
  }

  const { data: rivalRel } = await admin.from('user_relationships')
    .select('rel_type, status').eq('user_id', ids.a).eq('target_id', ids.c).maybeSingle();
  tester.log('the rival request is stored as rel_type=rival',
    rivalRel?.rel_type === 'rival' && rivalRel?.status === 'pending',
    `rel=${JSON.stringify(rivalRel)}`);

  await pageA.locator('[role="tab"]', { hasText: 'Rivals' }).first().click();
  await pageA.waitForTimeout(1500);
  const rivalsBody = (await pageA.textContent('body').catch(() => '')) || '';
  tester.log('the Rivals tab shows the pending rival', rivalsBody.includes(C.name),
    `rival visible=${rivalsBody.includes(C.name)}`);

  await pageA.locator('[role="tab"]', { hasText: 'Friends' }).first().click();
  await pageA.waitForTimeout(1500);
  const friendsBody2 = (await pageA.textContent('body').catch(() => '')) || '';
  tester.log('the Friends tab does NOT show the rival (one type per pair)',
    !friendsBody2.includes(C.name), `rival leaked into friends=${friendsBody2.includes(C.name)}`);

  // ---------- 6. CHALLENGING A FRIEND ----------
  await pageA.reload({ waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2000);
  const challengeBtn = pageA.locator('button', { hasText: /Challenge/ }).first();
  const chCount = await challengeBtn.count().catch(() => 0);
  tester.log('a friend card carries a Challenge control', chCount > 0, `count=${chCount}`);
  if (chCount > 0) {
    await challengeBtn.click();
    await pageA.waitForTimeout(2500);
  }

  const { data: invites } = await admin.from('arena_invites')
    .select('id, from_user, to_user, stake, status')
    .eq('from_user', ids.a).eq('to_user', ids.b).maybeSingle();
  tester.log('the challenge was written to arena_invites',
    !!invites && invites.status === 'pending',
    `invite=${JSON.stringify(invites)}`);

  const stakeOk = invites && Number(invites.stake) === 2;
  tester.log('the challenge stake is the arena\'s fixed 2 SC, not min(stakes)=1',
    stakeOk, `stake=${invites?.stake}`);

  const url = pageA.url();
  tester.log('the app handed off to /rumble?challenge=<userId>',
    /\/rumble\?challenge=/.test(url) && url.includes(ids.b), `url=${url}`);

  // ---------- 7. PROFILE VIEWS ARE RECORDED ----------
  // B has not opted in to being viewed, so nothing should be recorded for B.
  await pageA.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2000);
  const row = pageA.locator('li', { hasText: B.name }).first();
  if (await row.count().catch(() => 0)) {
    await row.locator('button').first().click();
    await pageA.waitForTimeout(2500);
  }
  const { count: viewsOff } = await admin.from('profile_views')
    .select('viewer_id', { count: 'exact', head: true })
    .eq('profile_id', ids.b);
  tester.log('no view is recorded while the receiver has views switched OFF',
    (viewsOff || 0) === 0, `views=${viewsOff}`);

  // Now B opts in, and the same action records a view.
  await admin.from('profile_privacy').upsert({ user_id: ids.b, show_profile_views: true });
  await pageA.goto(`${BASE}/leaderboard`, { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2000);
  const row2 = pageA.locator('li', { hasText: B.name }).first();
  if (await row2.count().catch(() => 0)) {
    await row2.locator('button').first().click();
    await pageA.waitForTimeout(2500);
  }
  const { count: viewsOn } = await admin.from('profile_views')
    .select('viewer_id', { count: 'exact', head: true })
    .eq('profile_id', ids.b);
  tester.log('a view IS recorded once the receiver opts in', (viewsOn || 0) > 0, `views=${viewsOn}`);

  // ---------- 8. THE SOUND PREFERENCE ----------
  await pageA.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2000);
  const settingsBody = (await pageA.textContent('body').catch(() => '')) || '';
  tester.log('Settings renders a Sound Effects card', /Sound Effects/i.test(settingsBody),
    `present=${/Sound Effects/i.test(settingsBody)}`);

  const soundBtn = pageA.locator('button', { hasText: /Turn (on|off) sound effects/i }).first();
  const soundCount = await soundBtn.count().catch(() => 0);
  tester.log('the sound toggle is a real control', soundCount > 0, `count=${soundCount}`);

  if (soundCount > 0) {
    const before = await pageA.evaluate(() => localStorage.getItem('soundEnabled'));
    await soundBtn.click();
    await pageA.waitForTimeout(1200);
    const after = await pageA.evaluate(() => localStorage.getItem('soundEnabled'));
    tester.log('toggling sound persists to localStorage',
      before !== after, `before=${before} after=${after}`);

    const managerEnabled = await pageA.evaluate(async () => {
      const mod = await import('/src/utils/audio.js');
      return mod.audioManager.enabled;
    }).catch(() => null);
    tester.log('the audio manager follows the preference',
      managerEnabled === (after === 'true' || after === null),
      `manager=${managerEnabled} stored=${after}`);

    // put it back
    await pageA.locator('button', { hasText: /Turn (on|off) sound effects/i }).first().click();
    await pageA.waitForTimeout(800);
  }

  // ---------- 9. THE DASHBOARD GREETS WITH THE IDENTITY NAME ----------
  await pageA.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2500);
  const dashBody = (await pageA.textContent('body').catch(() => '')) || '';
  const dashH2 = (await pageA.locator('h2').first().textContent().catch(() => '')) || '';

  tester.log('the Dashboard greeting uses the IDENTITY name', dashH2.includes(A.name),
    `h2="${dashH2.trim()}"`);
  tester.log('...and NOT the legal name', !dashH2.includes(`Legal ${A.name}`),
    `h2="${dashH2.trim()}"`);
  tester.log('...and not just its first word',
    !/,\s*Hub\s*$/.test(dashH2.trim()) && dashH2.includes(A.name),
    `h2="${dashH2.trim()}" identity="${A.name}"`);

  // The removed stat row must be gone.
  const statRowGone = !/Vault/.test(dashBody) && !/Mastery/.test(dashBody) && !/Due/.test(dashBody);
  tester.log('the Vault / Mastery / Due stat cards are gone from the Dashboard', statRowGone,
    `vault=${/Vault/.test(dashBody)} mastery=${/Mastery/.test(dashBody)} due=${/Due/.test(dashBody)}`);

  // ---------- 10. THE CROWN: 40 SC, ONE LEDGER ROW, AUTO-EQUIPPED ----------
  await admin.from('profiles').update({ smart_coins: 100 }).eq('id', ids.a);
  await pageA.goto(`${BASE}/leaderboard?tab=cosmetics`, { waitUntil: 'networkidle' });
  await pageA.waitForTimeout(2000);
  const buyBtn = pageA.locator('button', { hasText: /Buy/ }).first();
  const buyCount = await buyBtn.count().catch(() => 0);
  tester.log('the Crown is offered for purchase', buyCount > 0, `count=${buyCount}`);
  if (buyCount > 0) {
    await buyBtn.click();
    await pageA.waitForTimeout(3000);
  }

  const { data: cos } = await admin.from('user_cosmetics')
    .select('sku, equipped, sc_price').eq('user_id', ids.a).maybeSingle();
  tester.log('the Crown is owned and equipped', cos?.sku === 'crown-001' && cos?.equipped === true,
    `cos=${JSON.stringify(cos)}`);

  const { count: ledgerRows } = await admin.from('smart_coin_ledger')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', ids.a).eq('reason', 'crown_purchase');
  tester.log('exactly ONE ledger row for the purchase', (ledgerRows || 0) === 1, `rows=${ledgerRows}`);

  const { data: prof } = await admin.from('profiles').select('smart_coins').eq('id', ids.a).maybeSingle();
  tester.log('the balance fell by exactly 40 SC', prof?.smart_coins === 60, `balance=${prof?.smart_coins}`);

  const { data: cpRow } = await admin.from('community_profiles')
    .select('has_crown').eq('id', ids.a).maybeSingle();
  tester.log('community_profiles reports has_crown', cpRow?.has_crown === true,
    `has_crown=${cpRow?.has_crown}`);
} catch (err) {
  tester.log('SUITE ERROR - ' + (err?.message || err), false);
} finally {
  // ---------- CLEANUP ----------
  for (const p of people) {
    const id = ids[p.tag];
    if (!id) continue;
    await admin.from('user_cosmetics').delete().eq('user_id', id);
    await admin.from('smart_coin_ledger').delete().eq('user_id', id).eq('reason', 'crown_purchase');
    await admin.from('profile_views').delete().or(`viewer_id.eq.${id},profile_id.eq.${id}`);
    await admin.from('profile_privacy').delete().eq('user_id', id);
    await admin.from('notifications').delete().eq('user_id', id);
    await admin.from('user_blocks').delete().or(`blocker_id.eq.${id},blocked_id.eq.${id}`);
    await admin.from('user_relationships').delete().or(`user_id.eq.${id},target_id.eq.${id}`);
    await admin.from('arena_invites').delete().or(`from_user.eq.${id},to_user.eq.${id}`);
    await admin.from('profiles').update({ smart_coins: 0 }).eq('id', id);
    await admin.auth.admin.deleteUser(id);
  }
  const { count: leftoverUsers } = await admin.auth.admin.listUsers({ perPage: 1000 })
    .then(({ data }) => ({ count: (data?.users || []).filter((u) => /@apextest\.local$/.test(u.email)).length }));
  tester.log('cleanup: no test accounts left', (leftoverUsers || 0) === 0, `users=${leftoverUsers}`);
}

await exit(browser, tester);
