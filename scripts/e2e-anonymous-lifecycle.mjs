// scripts/e2e-anonymous-lifecycle.mjs
//
// RPC-level lifecycle verification of the ANONYMOUS study group against the
// live project (migration v29 applied). Uses a THROWAWAY scratch group (never
// the seeded Anonymous room) and drives exactly the RPCs the /api/community
// router calls with the service role:
//
//   community_panel            → role + public waitlist count while 'waiting'
//   community_anonymous_join   → fills to 30, auto-activates at exactly 30,
//                                31st joiner refused (GROUP_ACTIVE)
//   community_group_feed       → masked identities, empty for outsiders /
//                                spectators only when gated
//   community_anonymous_leave  → count < 18 on an active group wipes it
//
// Requires a reachable Supabase project (VITE_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY in .env). Run:
//   npm run e2e:anonymous-lifecycle
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const env = loadEnv();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

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
    users.push(data.user);
    return data.user.id;
  };

  // ---------- 1. SEEDED ANONYMOUS ROOM EXISTS (untouched by this test) ----------
  const { data: seeded } = await admin
    .from('study_groups')
    .select('id, group_state, type, minimum_members_to_activate, minimum_members_to_remain_active')
    .eq('type', 'anonymous')
    .limit(1)
    .maybeSingle();
  log('seeded Anonymous room exists', !!seeded,
      seeded ? `state=${seeded.group_state} activate=${seeded.minimum_members_to_activate} floor=${seeded.minimum_members_to_remain_active}` : 'MISSING');

  // ---------- 2. THROWAWAY SCRATCH ROOM ----------
  const ownerId = await makeUser('owner');
  const { data: grp, error: gErr } = await admin
    .from('study_groups')
    .insert({
      name: `Anon Scratch ${stamp}`,
      description: 'E2E scratch anonymous room',
      creator_id: ownerId,
      is_verified: true,
      member_limit: 30,
      is_active: true,
      type: 'anonymous',
      privacy: 'restricted',
      spectator_price: 599,
      minimum_members_to_activate: 30,
      minimum_members_to_remain_active: 18,
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

  // ---------- 4. ACTIVATION AT EXACTLY minimum_members_to_activate ----------
  let activatedAt = null;
  let joinedStates = [];
  for (let i = 1; i <= 31; i++) {
    const uid = await makeUser(`u${i}`);
    const { data: join } = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: uid });
    if (join?.ok) {
      joinedStates.push({ i, count: join.member_count, state: join.group_state });
      if (join.group_state === 'active' && activatedAt === null) activatedAt = i;
    } else if (i >= 31) {
      joinedStates.push({ i, count: join?.member_count, refuse: join.code });
    }
  }
  log('room activates at exactly 30 joins', activatedAt === 30, `activated on join #${activatedAt}`);
  const activatedCount = joinedStates.find(s => s.i === activatedAt)?.count;
  log('activation join reports member_count = 30', activatedCount === 30, `count=${activatedCount}`);
  const refused31 = joinedStates.find(s => s.i === 31);
  log('31st joiner refused with GROUP_ACTIVE', refused31?.refuse === 'GROUP_ACTIVE', JSON.stringify(refused31));
  const staysOpenBeforeActivation = joinedStates.slice(0, 29).every(s => s.state === 'waiting');
  log('every join before #30 kept the room waiting', staysOpenBeforeActivation);

  // ---------- 5. ACTIVE: count hidden, outsiders blocked ----------
  const panelActive = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: outsiderId });
  log('panel during active hides member_count from non-members',
      panelActive.data?.member_count === null || panelActive.data?.member_count === undefined,
      `count=${panelActive.data?.member_count}`);
  const outsiderFeed = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: outsiderId });
  log('outsider gets an empty active-room feed', Array.isArray(outsiderFeed.data) && outsiderFeed.data.length === 0,
      `rows=${(outsiderFeed.data || []).length}`);

  // ---------- 6. MEMBER POSTS ARE MASKED IN THE FEED ----------
  const memberId = users[1]?.id || ownerId;
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

  // ---------- 7. SPECTATOR ACCESS WHILE ACTIVE ----------
  const spectatorId = await makeUser('spectator');
  const specInsert = await admin
    .from('anonymous_spectators')
    .insert({ group_id: scratchGroupId, user_id: spectatorId, status: 'active' });
  if (specInsert.error) throw specInsert.error;
  const panelSpec = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: spectatorId });
  log('spectator panel: can_view=true, my_role=spectator',
      panelSpec.data?.can_view === true && panelSpec.data?.my_role === 'spectator',
      `role=${panelSpec.data?.my_role}`);
  const specFeed = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: spectatorId });
  const specSeesPost = (specFeed.data || []).some(p => p.content === `masked msg ${stamp}`);
  log('spectator can read the active room feed', specSeesPost);
  const specJoin = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: spectatorId });
  log('spectator cannot become a member (ALREADY_SPECTATOR)',
      specJoin.data?.code === 'ALREADY_SPECTATOR', JSON.stringify(specJoin.data));

  // ---------- 8. WIPE BELOW minimum_members_to_remain_active ----------
  const memberUserIds = (users.slice(1, 31) || []).map(u => u.id); // u1..u30
  let wipedAt = null;
  for (let i = 0; i < memberUserIds.length; i++) {
    const { data: leave } = await admin.rpc('community_anonymous_leave', {
      p_group: scratchGroupId,
      p_user: memberUserIds[i]
    });
    if (leave?.wiped === true) { wipedAt = i + 1; break; }
  }
  log('leaving below 18 members wipes the room', !!wipedAt, `wiped after ${wipedAt} leaves`);
  const { data: wipedGrp } = await admin.from('study_groups').select('group_state, is_active').eq('id', scratchGroupId).single();
  log('group ends as wiped + inactive', wipedGrp?.group_state === 'wiped' && wipedGrp?.is_active === false,
      JSON.stringify(wipedGrp));
  const { data: specAfter } = await admin.from('anonymous_spectators').select('status').eq('group_id', scratchGroupId).eq('user_id', spectatorId).single();
  log('spectator pass revoked on wipe', specAfter?.status === 'revoked', specAfter?.status);
  const joinAfterWipe = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: outsiderId });
  log('joining a wiped room refused (GROUP_WIPED)', joinAfterWipe.data?.code === 'GROUP_WIPED', JSON.stringify(joinAfterWipe.data));
  const feedAfterWipe = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: ownerId });
  log('wiped-room feed is empty for everyone',
      Array.isArray(feedAfterWipe.data) && feedAfterWipe.data.length === 0, `rows=${(feedAfterWipe.data || []).length}`);
  const { data: hiddenPost } = await admin.from('community_posts').select('is_hidden, is_deleted').eq('id', postRow.id).maybeSingle();
  log('wipe soft-hides the room posts', hiddenPost?.is_hidden === true && hiddenPost?.is_deleted === true,
      JSON.stringify(hiddenPost));
} catch (e) {
  log('E2E anonymous lifecycle flow', false, e.message);
} finally {
  // ---------- CLEANUP: never mutate the seeded Anonymous room ----------
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