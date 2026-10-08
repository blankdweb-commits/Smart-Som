// scripts/e2e-anonymous-lifecycle.mjs
//
// RPC-level lifecycle + SPECTATOR verification of the ANONYMOUS study group
// against the live project (migrations v29/v39/v40 applied). Uses a THROWAWAY
// scratch group (never the seeded Anonymous room) and drives the same RPCs the
// /api/community router calls with the service role, plus a publishable-key
// client to prove the v39 RLS read-gate.
//
//   1.  seeded Anonymous room exists and its spectator price is ₦499
//   2.  public waitlist counter while 'waiting'
//   3.  activation at exactly the configured threshold (10; owner = member #1)
//   4.  the next member is refused (GROUP_ACTIVE)
//   5.  active room hides its count from outsiders (empty feed)
//   6.  member posts are masked (display_name/avatar/year)
//   7.  spectator pass (₦499): read-only role, cannot join as member,
//       does NOT change the member count, one pass per (group,user),
//       one pass per reference (idempotency)
//   8.  RLS: a signed-in member still cannot SELECT anonymous-room rows
//   9.  survival: 5 members + spectators stays active; below 5 wipes and
//       revokes every spectator pass
//
// Requires a reachable Supabase project (VITE_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_ANON_KEY in .env). Run:
//   npm run e2e:anonymous-lifecycle
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const env = loadEnv();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const THRESHOLD = 10;
const SURVIVE = 5;
const SPECTATOR_PRICE = 499;

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const stamp = Date.now().toString().slice(-8);
const password = 'testpass123';

let users = [];
let scratchGroupId = null;

try {
  const makeUser = async (tag) => {
    const email = `anon-${tag}-${stamp}@apextest.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Anon ${tag}` }
    });
    if (error) throw error;
    users.push({ id: data.user.id, email });
    return data.user.id;
  };

  // ---------- 1. SEEDED ANONYMOUS ROOM EXISTS + PRICE IS ₦499 ----------
  const { data: seeded } = await admin
    .from('study_groups')
    .select('id, group_state, type, spectator_price, minimum_members_to_activate, minimum_members_to_remain_active')
    .eq('type', 'anonymous')
    .limit(1)
    .maybeSingle();
  log('seeded Anonymous room exists', !!seeded,
      seeded ? `state=${seeded.group_state} activate=${seeded.minimum_members_to_activate} floor=${seeded.minimum_members_to_remain_active} price=${seeded.spectator_price}` : 'MISSING');
  log('seeded spectator price is ₦499',
      Number(seeded?.spectator_price) === SPECTATOR_PRICE, `price=${seeded?.spectator_price}`);

  // ---------- 2. THROWAWAY SCRATCH ROOM (threshold 10 / survive 5) ----------
  const ownerId = await makeUser('owner');
  const { data: grp, error: gErr } = await admin
    .from('study_groups')
    .insert({
      name: `Anon Scratch ${stamp}`,
      description: 'E2E scratch anonymous room',
      creator_id: ownerId,
      is_verified: true,
      member_limit: THRESHOLD,
      is_active: true,
      type: 'anonymous',
      privacy: 'restricted',
      spectator_price: SPECTATOR_PRICE,
      minimum_members_to_activate: THRESHOLD,
      minimum_members_to_remain_active: SURVIVE,
      group_state: 'waiting'
    })
    .select('id')
    .single();
  if (gErr) throw gErr;
  scratchGroupId = grp.id;
  const { error: ownerJoin } = await admin
    .from('study_group_members')
    .insert({ group_id: scratchGroupId, user_id: ownerId, role: 'owner' });
  if (ownerJoin) throw ownerJoin;
  log('scratch anonymous group created', true, String(scratchGroupId));

  // ---------- 3. PUBLIC WAITLIST COUNT WHILE 'waiting' ----------
  const outsiderId = await makeUser('outsider');
  const panelWait = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: outsiderId });
  log('panel during waiting: can_view=false for non-member',
      panelWait.data?.ok === true && panelWait.data?.can_view === false);
  log('panel during waiting: member_count is PUBLIC (waitlist counter)',
      Number.isInteger(panelWait.data?.member_count), `count=${panelWait.data?.member_count}`);
  log('panel during waiting: my_role none',
      (panelWait.data?.my_role || 'none') === 'none');

  // ---------- 4. ACTIVATION AT EXACTLY THE THRESHOLD (owner = member #1) ----------
  const joinerIds = [];
  let activatedCount = null;
  let activatedJoinIndex = null;
  let firstRefusal = null;
  for (let i = 1; i <= THRESHOLD + 1; i++) {
    const uid = await makeUser(`u${i}`);
    joinerIds.push(uid);
    const { data: join } = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: uid });
    if (join?.ok) {
      if (join.group_state === 'active' && activatedCount === null) {
        activatedCount = join.member_count;
        activatedJoinIndex = i;
      }
    } else if (firstRefusal === null) {
      firstRefusal = { i, ...join };
    }
  }
  log(`room activates when membership reaches ${THRESHOLD} (owner is member #1)`,
      activatedCount === THRESHOLD, `activated at join #${activatedJoinIndex} (count=${activatedCount})`);
  log(`the ${THRESHOLD + 1}th member (join #${THRESHOLD}) is refused with GROUP_ACTIVE`,
      firstRefusal?.i === THRESHOLD && firstRefusal?.code === 'GROUP_ACTIVE', JSON.stringify(firstRefusal));
  const { data: countAfter } = await admin.rpc('community_member_count', { p_group: scratchGroupId });
  log(`member count is exactly ${THRESHOLD} after activation`, Number(countAfter) === THRESHOLD, `count=${countAfter}`);

  // ---------- 5. ACTIVE: count hidden, outsiders blocked ----------
  const panelActive = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: outsiderId });
  log('panel during active hides member_count from non-members',
      panelActive.data?.member_count === null || panelActive.data?.member_count === undefined,
      `count=${panelActive.data?.member_count}`);
  const outsiderFeed = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: outsiderId });
  log('outsider gets an empty active-room feed', Array.isArray(outsiderFeed.data) && outsiderFeed.data.length === 0,
      `rows=${(outsiderFeed.data || []).length}`);

  // ---------- 6. MEMBER POSTS ARE MASKED IN THE FEED ----------
  const memberId = joinerIds[0]; // an actual room member
  const { data: postRow } = await admin
    .from('community_posts')
    .insert({
      author_id: memberId,
      content: `masked msg ${stamp}`,
      section: 'general',
      group_id: scratchGroupId
    })
    .select('id')
    .single();
  const feedMember = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: ownerId });
  const myPost = (feedMember.data || []).find(p => p.content === `masked msg ${stamp}`);
  log('members see anonymous-room posts via community_group_feed', !!myPost);
  log('feed masks the author identity (display_name → "Anonymous Member")',
      !!myPost && myPost.display_name === 'Anonymous Member', myPost?.display_name);
  log('feed masks avatar_url and year', !!myPost && myPost.avatar_url === null && myPost.year === null,
      `avatar=${myPost?.avatar_url} year=${myPost?.year}`);
  log('feed carries post_state + lives_until (ephemeral fields)',
      !!myPost && typeof myPost.post_state === 'string' && !!myPost.lives_until);

  // ---------- 7. SPECTATOR PASS (₦499, read-only) ----------
  const countBeforeSpec = Number((await admin.rpc('community_member_count', { p_group: scratchGroupId })).data);
  const spectatorId = await makeUser('spectator');
  const specInsert = await admin
    .from('anonymous_spectators')
    .insert({ group_id: scratchGroupId, user_id: spectatorId, reference: `e2e-spec-${stamp}`, amount: SPECTATOR_PRICE, status: 'active' });
  log('spectator pass (₦499) can be granted', !specInsert.error, specInsert.error?.message);

  const panelSpec = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: spectatorId });
  log('spectator panel: can_view=true, my_role=spectator',
      panelSpec.data?.can_view === true && panelSpec.data?.my_role === 'spectator',
      `role=${panelSpec.data?.my_role}`);
  const specFeed = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: spectatorId });
  log('spectator can read the active room feed',
      (specFeed.data || []).some(p => p.content === `masked msg ${stamp}`));
  const specJoin = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: spectatorId });
  log('spectator cannot become a member (ALREADY_SPECTATOR)', specJoin.data?.code === 'ALREADY_SPECTATOR', JSON.stringify(specJoin.data));

  const countAfterSpec = Number((await admin.rpc('community_member_count', { p_group: scratchGroupId })).data);
  log('spectator does NOT increase the member count', countAfterSpec === countBeforeSpec && countAfterSpec === THRESHOLD,
      `before=${countBeforeSpec} after=${countAfterSpec}`);

  // One pass per (group,user): a second active row must violate the unique key.
  const dupUser = await admin
    .from('anonymous_spectators')
    .insert({ group_id: scratchGroupId, user_id: spectatorId, reference: `e2e-spec2-${stamp}`, amount: SPECTATOR_PRICE, status: 'active' });
  log('a second pass for the same (group,user) is rejected (unique)',
      dupUser.error?.code === '23505', dupUser.error?.code);

  // One pass per reference: the same reference for a different user must fail.
  const dupRef = await admin
    .from('anonymous_spectators')
    .insert({ group_id: scratchGroupId, user_id: outsiderId, reference: `e2e-spec-${stamp}`, amount: SPECTATOR_PRICE, status: 'active' });
  log('a duplicated payment reference is rejected (idempotency)',
      dupUser.error?.code === '23505' && dupRef.error?.code === '23505', `dupRef=${dupUser.error?.code || 'none'}/${dupRef.error?.code}`);

  // ---------- 8. RLS: a signed-in member still cannot SELECT the room rows ----------
  try {
    const publishable = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    const email = users.find(u => u.id === memberId)?.email;
    await publishable.auth.signInWithPassword({ email, password });
    const { data: leak, error: leakErr } = await publishable
      .from('community_posts')
      .select('id')
      .eq('group_id', scratchGroupId);
    log('RLS: a signed-in member cannot SELECT anonymous-room posts directly',
        !rlsErr(leakErr) && Array.isArray(leak) && leak.length === 0,
        rlsErr(leakErr) ? `error=${leakErr.code}` : `rows=${(leak || []).length}`);
    const { data: specLeak, error: specErr } = await publishable
      .from('anonymous_spectators')
      .select('id')
      .eq('group_id', scratchGroupId);
    log('RLS: anonymous_spectators is not directly readable by clients',
        !rlsErr(specErr) && Array.isArray(specLeak) && specLeak.length === 0,
        rlsErr(specErr) ? `error=${specErr.code}` : `rows=${(specLeak || []).length}`);
    await publishable.auth.signOut().catch(() => {});
  } catch (rlsProbeErr) {
    log('RLS read-gate probe', false, rlsProbeErr.message);
  }

  // ---------- 8b. SURVIVAL: 5 members + spectators stays ACTIVE ----------
  // Remove 5 of the 9 joiners: 10 → 5, which is NOT below the floor.
  const removable = joinerIds.filter((uid) => uid !== ownerId);
  let wipedAtCount = null;
  for (let i = 0; i < 5 && i < removable.length; i++) {
    const { data: leave } = await admin.rpc('community_anonymous_leave', { p_group: scratchGroupId, p_user: removable[i] });
    if (leave?.wiped) wipedAtCount = leave.member_count;
  }
  const { data: stateAtFive } = await admin
    .from('study_groups').select('group_state').eq('id', scratchGroupId).single();
  const countAtFive = Number((await admin.rpc('community_member_count', { p_group: scratchGroupId })).data);
  log('room stays ACTIVE at 5 members even with spectators present',
      stateAtFive?.group_state === 'active' && countAtFive === SURVIVE,
      `state=${stateAtFive?.group_state} count=${countAtFive}`);

  // ---------- 8c. DROP BELOW 5 → WIPE + REVOKE SPECTATORS ----------
  const { data: leaveWipe } = await admin.rpc('community_anonymous_leave', { p_group: scratchGroupId, p_user: removable[5] });
  log('dropping below the survival floor wipes the room',
      leaveWipe?.wiped === true, `count=${leaveWipe?.member_count} state=${leaveWipe?.group_state}`);
  const { data: wipedState } = await admin
    .from('study_groups').select('group_state, is_active').eq('id', scratchGroupId).single();
  log('wiped group is closed (is_active=false)',
      wipedState?.group_state === 'wiped' && wipedState?.is_active === false, JSON.stringify(wipedState));
  const { data: specAfter } = await admin
    .from('anonymous_spectators').select('status').eq('group_id', scratchGroupId).eq('user_id', spectatorId).single();
  log('spectator pass revoked on wipe (room-lifecycle expiry)',
      specAfter?.status === 'revoked', specAfter?.status);
} catch (err) {
  log('anonymous lifecycle/spectator e2e', false, err.message);
} finally {
  try {
    if (scratchGroupId) {
      await admin.from('study_group_members').delete().eq('group_id', scratchGroupId);
      await admin.from('anonymous_spectators').delete().eq('group_id', scratchGroupId);
      await admin.from('community_posts').delete().eq('group_id', scratchGroupId);
      await admin.from('study_groups').delete().eq('id', scratchGroupId);
    }
    for (const u of users) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  } catch (cleanErr) {
    log('cleanup', false, cleanErr.message);
  }
  const failed = results.filter(r => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  process.exit(failed.length ? 1 : 0);
}

// A missing-table / RLS-denied read can surface as an error OR an empty result
// depending on PostgREST; treat "no privileges"-style codes as a pass (denied).
function rlsErr(err) {
  if (!err) return false;
  const denied = ['42501', 'PGRST301', 'PGRST116'];
  return denied.includes(err.code) ? false : err;
}