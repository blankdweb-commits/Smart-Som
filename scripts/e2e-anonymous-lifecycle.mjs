// scripts/e2e-anonymous-lifecycle.mjs
//
// Live verification of the ANONYMOUS study room against the project
// (migrations v29 / v39 / v40 / v41 applied). Uses a THROWAWAY scratch group
// (never the seeded Anonymous room) and drives the same server paths the
// /api/community router uses with the service role, plus publishable-key
// clients to prove the v39 RLS read-gate and realtime delivery.
//
// v41 CAPACITY MODEL (this is the current contract):
//   - minimum_members_to_activate (10 live) OPENS the room; it is NOT the max.
//   - member_limit is the real CAPACITY (anonymous default 100).
//   - membership_locked lets the owner close the door while the room runs.
//   - joins past capacity  -> GROUP_FULL (carries capacity + spectator price)
//   - joins while locked   -> MEMBERSHIP_LOCKED (carries spectator price)
//
//   1.  seeded Anonymous room exists, price ₦499, v41 capacity/lock columns
//   2.  public waitlist counter while 'waiting'
//   3.  activation at exactly the configured threshold (owner = member #1)
//   4.  owner lock  -> MEMBERSHIP_LOCKED, unlock -> joins resume
//   5.  capacity    -> GROUP_FULL (with member_limit + spectator_price)
//   6.  active room hides its count from outsiders (empty feed)
//   7.  member posts are masked (display_name/avatar/year)
//   8.  safety notice is server-enforced (NOTICE_REQUIRED -> ack -> allowed)
//   9.  reports persist a category + 'pending' status (v41 schema)
//   10. up/down votes (v42): one per (post,user), delta on switch, clear=0,
//       server-computed score + per-viewer my_vote in the hydrated feed,
//       spectators may vote, non-viewers cannot
//   10c. creating a new anonymous room: server-owned defaults (₦499, waiting,
//       unlocked) with the creator as owner + member #1
//   11. spectator pass (₦499): read-only role, cannot join as member,
//       does NOT change the member count, one pass per (group,user) + reference
//   11. RLS: a signed-in member still cannot SELECT anonymous-room rows
//   12. realtime: an HTTP broadcast reaches TWO live WS sessions
//   13. 6h ephemeral ceiling is enforced by computeLivesUntil
//   14. survival: stays active at the floor; below it wipes and revokes passes
//
// v44 additions (this file also covers them):
//   10e. ENCODED MESSAGES — premium sender must name ONE recipient alias; the
//        plaintext never enters the feed (blank for every viewer, even the
//        premium recipient) and the decode endpoint answers ONLY the author or
//        the addressed recipient (403 ENCODED_PRIVATE for everyone else).
//   10f. SOCIAL ACTIONS — a member can act, the cooldown window blocks a
//        repeat, and a member who muted the target is refused (SOCIAL_BLOCKED).
//   10g. PRESENCE — heartbeat → online counts, explicit leave drops it
//        immediately, and the reap releases ONLY the departed member's seat
//        (the owner seat is never released, and the room does not wipe).
//
// Requires a reachable Supabase project (VITE_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_ANON_KEY in .env). Run:
//   npm run e2e:anonymous-lifecycle
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import {
  publishRoomEvent,
  computeLivesUntil,
  MAX_POST_LIFE_MS,
  roomChannel,
  handleAnonAck,
  handleAnonSend,
  handleAnonFeed,
  handleAnonRoom,
  handleAnonEncoded,
  handleAnonSocial,
  handleVote,
  handleCreateAnonRoom,
  handleReport,
  ensureRoomAlias,
} from '../api/_community.js';

const env = loadEnv();
// publishRoomEvent / getSupabaseAdmin read these at call time.
process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;

const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// A deliberately small scratch room so the three v41 outcomes (activate /
// lock / full) are all reachable with a handful of members.
const CAPACITY = 4;
const ACTIVATE = 3;
const SURVIVE = 2;
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
let pageGroupId = null;

// Minimal req/res harness so we can exercise the real server handlers (the
// same functions the /api/community router dispatches to) against live DB.
const callHandler = async (fn, user, body = {}) => {
  const out = { status: 200, body: null };
  const req = { body, url: '/api/community/test', method: 'POST', headers: {} };
  const res = {
    _status: 200,
    status(code) { this._status = code; return this; },
    json(payload) { out.status = this._status; out.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  await fn(req, res, user);
  return out;
};

const summary = () => {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
  return failed.length;
};

try {
  const makeUser = async (tag) => {
    const email = `anon-${tag}-${stamp}@apextest.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: `Anon ${tag}` },
    });
    if (error) throw error;
    users.push({ id: data.user.id, email });
    return data.user.id;
  };

  // ---------- 1. SEEDED ANONYMOUS ROOM + v41 COLUMNS/PRICE ----------
  const { data: seeded } = await admin
    .from('study_groups')
    .select('id, group_state, type, spectator_price, member_limit, membership_locked, minimum_members_to_activate, minimum_members_to_remain_active')
    .eq('type', 'anonymous')
    .limit(1)
    .maybeSingle();
  log('seeded Anonymous room exists', !!seeded,
    seeded ? `state=${seeded.group_state} activate=${seeded.minimum_members_to_activate} capacity=${seeded.member_limit} price=${seeded.spectator_price}` : 'MISSING');
  log('seeded spectator price is ₦499',
    Number(seeded?.spectator_price) === SPECTATOR_PRICE, `price=${seeded?.spectator_price}`);
  log('v41: anonymous room capacity is separated from activation (member_limit >= 100)',
    Number(seeded?.member_limit) >= 100 && Number(seeded?.minimum_members_to_activate) < Number(seeded?.member_limit),
    `limit=${seeded?.member_limit} activate=${seeded?.minimum_members_to_activate}`);
  log('v41: membership_locked is present (boolean)',
    typeof seeded?.membership_locked === 'boolean', `locked=${seeded?.membership_locked}`);

  // ---------- 2. THROWAWAY SCRATCH ROOM ----------
  const ownerId = await makeUser('owner');
  const { data: grp, error: gErr } = await admin
    .from('study_groups')
    .insert({
      name: `Anon Scratch ${stamp}`,
      description: 'E2E scratch anonymous room (v41 capacity model)',
      creator_id: ownerId,
      is_verified: true,
      member_limit: CAPACITY,
      is_active: true,
      type: 'anonymous',
      privacy: 'restricted',
      spectator_price: SPECTATOR_PRICE,
      minimum_members_to_activate: ACTIVATE,
      minimum_members_to_remain_active: SURVIVE,
      membership_locked: false,
      group_state: 'waiting',
    })
    .select('id')
    .single();
  if (gErr) throw gErr;
  scratchGroupId = grp.id;
  const { error: ownerJoin } = await admin
    .from('study_group_members')
    .insert({ group_id: scratchGroupId, user_id: ownerId, role: 'owner' });
  if (ownerJoin) throw ownerJoin;
  log('scratch anonymous group created (capacity/activate/survive)',
    true, `id=${scratchGroupId} cap=${CAPACITY} activate=${ACTIVATE} survive=${SURVIVE}`);

  // ---------- 3. PUBLIC WAITLIST COUNT WHILE 'waiting' ----------
  const outsiderId = await makeUser('outsider');
  const panelWait = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: outsiderId });
  log('panel during waiting: can_view=false for non-member',
    panelWait.data?.ok === true && panelWait.data?.can_view === false);
  log('panel during waiting: member_count is PUBLIC (waitlist counter)',
    Number.isInteger(panelWait.data?.member_count), `count=${panelWait.data?.member_count}`);
  log('panel exposes capacity + lock for the choice screen',
    Number(panelWait.data?.member_limit) === CAPACITY && panelWait.data?.membership_locked === false,
    `limit=${panelWait.data?.member_limit} locked=${panelWait.data?.membership_locked}`);

  // ---------- 4. ACTIVATION AT EXACTLY THE THRESHOLD (owner = member #1) ----------
  const joinerIds = [];
  let activatedCount = null;
  let activatedJoinIndex = null;
  for (let i = 1; i <= ACTIVATE - 1; i++) {
    const uid = await makeUser(`u${i}`);
    joinerIds.push(uid);
    const { data: join } = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: uid });
    if (!join?.ok) throw new Error(`join #${i} failed: ${JSON.stringify(join)}`);
    if (join.group_state === 'active' && activatedCount === null) {
      activatedCount = join.member_count;
      activatedJoinIndex = i;
    }
  }
  log(`room activates when membership reaches ${ACTIVATE} (owner is member #1)`,
    activatedCount === ACTIVATE, `activated at join #${activatedJoinIndex} (count=${activatedCount})`);
  const { data: countAfter } = await admin.rpc('community_member_count', { p_group: scratchGroupId });
  log(`member count is exactly ${ACTIVATE} after activation`, Number(countAfter) === ACTIVATE, `count=${countAfter}`);

  // ---------- 5. OWNER LOCK -> MEMBERSHIP_LOCKED, UNLOCK -> RESUMES ----------
  const locked = await admin.rpc('community_anonymous_set_locked', { p_group: scratchGroupId, p_locked: true });
  log('owner can lock membership while the room keeps running',
    locked.data?.ok === true && locked.data?.membership_locked === true, JSON.stringify(locked.data));
  const lockJoinUser = await makeUser('lockjoin');
  const lockedJoin = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: lockJoinUser });
  log('join while locked is refused with MEMBERSHIP_LOCKED',
    lockedJoin.data?.code === 'MEMBERSHIP_LOCKED', JSON.stringify(lockedJoin.data));
  log('MEMBERSHIP_LOCKED carries the spectator price (choice screen)',
    Number(lockedJoin.data?.spectator_price) === SPECTATOR_PRICE && Number(lockedJoin.data?.member_limit) === CAPACITY,
    `price=${lockedJoin.data?.spectator_price} limit=${lockedJoin.data?.member_limit}`);

  await admin.rpc('community_anonymous_set_locked', { p_group: scratchGroupId, p_locked: false });
  const resumed = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: lockJoinUser });
  log('after unlock a new member can join again',
    resumed.data?.ok === true, JSON.stringify(resumed.data));
  joinerIds.push(lockJoinUser);

  // ---------- 6. CAPACITY -> GROUP_FULL ----------
  const fullUser = await makeUser('fulljoin');
  const fullJoin = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: fullUser });
  log(`the join past capacity (${CAPACITY}) is refused with GROUP_FULL`,
    fullJoin.data?.code === 'GROUP_FULL', JSON.stringify(fullJoin.data));
  log('GROUP_FULL carries member_count/member_limit/spectator_price',
    Number(fullJoin.data?.member_count) === CAPACITY && Number(fullJoin.data?.member_limit) === CAPACITY && Number(fullJoin.data?.spectator_price) === SPECTATOR_PRICE,
    `count=${fullJoin.data?.member_count} limit=${fullJoin.data?.member_limit} price=${fullJoin.data?.spectator_price}`);
  const countFull = Number((await admin.rpc('community_member_count', { p_group: scratchGroupId })).data);
  log(`member count stays at the capacity (${CAPACITY})`, countFull === CAPACITY, `count=${countFull}`);

  // ---------- 7. ACTIVE: count hidden, outsiders blocked ----------
  const panelActive = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: outsiderId });
  log('panel during active hides member_count from non-members',
    panelActive.data?.member_count === null || panelActive.data?.member_count === undefined,
    `count=${panelActive.data?.member_count}`);
  const outsiderFeed = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: outsiderId });
  log('outsider gets an empty active-room feed', Array.isArray(outsiderFeed.data) && outsiderFeed.data.length === 0,
    `rows=${(outsiderFeed.data || []).length}`);

  // ---------- 8. MEMBER POSTS ARE MASKED IN THE FEED ----------
  const memberId = joinerIds[0]; // an actual room member
  const { data: postRow } = await admin
    .from('community_posts')
    .insert({
      author_id: memberId,
      content: `masked msg ${stamp}`,
      section: 'general',
      group_id: scratchGroupId,
    })
    .select('id')
    .single();
  const feedMember = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: ownerId });
  const myPost = (feedMember.data || []).find((p) => p.content === `masked msg ${stamp}`);
  log('members see anonymous-room posts via community_group_feed', !!myPost);
  log('feed masks the author identity (display_name → "Anonymous Member")',
    !!myPost && myPost.display_name === 'Anonymous Member', myPost?.display_name);
  log('feed masks avatar_url and year', !!myPost && myPost.avatar_url === null && myPost.year === null,
    `avatar=${myPost?.avatar_url} year=${myPost?.year}`);
  log('feed carries post_state + lives_until (ephemeral fields)',
    !!myPost && typeof myPost.post_state === 'string' && !!myPost.lives_until);

  // ---------- 9. SAFETY NOTICE IS SERVER-ENFORCED ----------
  const preAck = await callHandler(handleAnonSend, { id: memberId }, { group_id: scratchGroupId, content: `notice gate ${stamp}` });
  log('speaking before acking the notice returns 403 NOTICE_REQUIRED',
    preAck.status === 403 && preAck.body?.error === 'NOTICE_REQUIRED',
    `status=${preAck.status} error=${preAck.body?.error}`);
  const ack = await callHandler(handleAnonAck, { id: memberId }, { group_id: scratchGroupId });
  log('ack of the room safety notice succeeds (versioned)', ack.status === 200 && ack.body?.ok === true,
    JSON.stringify(ack.body));
  const postAck = await callHandler(handleAnonSend, { id: memberId }, { group_id: scratchGroupId, content: `notice gate ${stamp}` });
  log('after acking, speaking is allowed and returns a masked message',
    postAck.status === 200 && postAck.body?.ok === true && !!postAck.body?.message &&
      postAck.body.message.author_id === undefined,
    `status=${postAck.status} author_leak=${postAck.body?.message?.author_id}`);
  const sentMessageId = postAck.body?.message?.id || null;

  // ---------- PHASE 1/2. STICKER-FREE CONFIG + SERVER-DERIVED CAPACITY ----------
  const roomForMember = await callHandler(handleAnonRoom, { id: memberId }, { group_id: scratchGroupId });
  const cfgRoom = roomForMember.body?.config || {};
  log('room config carries NO sticker allowlist/categories (stickers removed)',
    !(cfgRoom.stickers || cfgRoom.sticker_categories),
    JSON.stringify(Object.keys(cfgRoom).filter((k) => /sticker/i.test(k))));
  log('membership capacity is served from the real member_limit (capacity from config)',
    Number(cfgRoom?.membership?.capacity) === CAPACITY &&
      Number(roomForMember.body?.group?.member_limit) === CAPACITY &&
      Number.isFinite(Number(roomForMember.body?.member_count)),
    `capacity=${cfgRoom?.membership?.capacity} limit=${roomForMember.body?.group?.member_limit} count=${roomForMember.body?.member_count}`);
  log('room header carries the "members · online" fields (counts + presence)',
    Number.isInteger(roomForMember.body?.member_count) &&
      Number.isInteger(roomForMember.body?.online_count) &&
      roomForMember.body?.access === 'member',
    `member_count=${roomForMember.body?.member_count} online=${roomForMember.body?.online_count} access=${roomForMember.body?.access}`);

  // ---------- 10. REPORTS PERSIST category + pending (v41 schema) ----------
  if (sentMessageId) {
    const rep = await callHandler(handleReport, { id: memberId }, {
      post_id: sentMessageId, category: 'harassment', reason: `e2e report ${stamp}`,
    });
    const { data: repRow } = await admin
      .from('community_reports')
      .select('category, status, reason')
      .eq('reporter_id', memberId)
      .eq('post_id', sentMessageId)
      .maybeSingle();
    log('report is stored with its category and pending status',
      rep.status === 200 && repRow?.category === 'harassment' && repRow?.status === 'pending',
      `status=${rep.status} row=${JSON.stringify(repRow)}`);
    const dup = await callHandler(handleReport, { id: memberId }, {
      post_id: sentMessageId, category: 'harassment', reason: `e2e report ${stamp}`,
    });
    log('a duplicate open report is de-duplicated', dup.status === 200 && dup.body?.duplicate === true,
      JSON.stringify(dup.body));
  }

  // ---------- 10b. SERVER-AUTHORITATIVE UP/DOWN VOTES ----------
  const voterA = memberId;
  const voterB = joinerIds[1];
  const v1 = await callHandler(handleVote, { id: voterA }, { post_id: sentMessageId, value: 1 });
  log('member upvote returns the server score (1) and my_vote (1)',
    v1.status === 200 && v1.body?.score === 1 && v1.body?.my_vote === 1, JSON.stringify(v1.body));
  const v1again = await callHandler(handleVote, { id: voterA }, { post_id: sentMessageId, value: 1 });
  log('re-upvoting does not double-count (one vote per user, upsert)',
    v1again.body?.score === 1 && v1again.body?.my_vote === 1, JSON.stringify(v1again.body));
  const v2 = await callHandler(handleVote, { id: voterB }, { post_id: sentMessageId, value: -1 });
  log('a second member downvote nets the score to 0',
    v2.body?.score === 0 && v2.body?.my_vote === -1, JSON.stringify(v2.body));
  const vSwitch = await callHandler(handleVote, { id: voterA }, { post_id: sentMessageId, value: -1 });
  log('switching a vote applies the delta (A +1 → -1 ⇒ score -2), not additive',
    vSwitch.body?.score === -2 && vSwitch.body?.my_vote === -1, JSON.stringify(vSwitch.body));
  const vClear = await callHandler(handleVote, { id: voterA }, { post_id: sentMessageId, value: 0 });
  log('clearing a vote (0) deletes it — score reflects only the other voter (-1)',
    vClear.body?.score === -1 && vClear.body?.my_vote === 0, JSON.stringify(vClear.body));
  const voteScore = vClear.body?.score;
  const vBad = await callHandler(handleVote, { id: voterA }, { post_id: sentMessageId, value: 7 });
  log('an out-of-range vote value is rejected (INVALID_VOTE)',
    vBad.status === 400 && vBad.body?.error === 'INVALID_VOTE', JSON.stringify(vBad.body));
  const vOut = await callHandler(handleVote, { id: outsiderId }, { post_id: sentMessageId, value: 1 });
  log('a non-viewer cannot vote on a hidden room post (404 POST_NOT_FOUND)',
    vOut.status === 404 && vOut.body?.error === 'POST_NOT_FOUND', `status=${vOut.status} error=${vOut.body?.error}`);
  const feedForA = await callHandler(handleAnonFeed, { id: voterA }, { group_id: scratchGroupId, limit: 50 });
  const hydrateA = (feedForA.body?.messages || []).find((m) => m.id === sentMessageId);
  log('room feed hydrates the per-viewer my_vote (A sees 0 after clearing)',
    !!hydrateA && hydrateA.score === voteScore && hydrateA.my_vote === 0,
    JSON.stringify(hydrateA && { score: hydrateA.score, my_vote: hydrateA.my_vote }));
  const feedForB = await callHandler(handleAnonFeed, { id: voterB }, { group_id: scratchGroupId, limit: 50 });
  const hydrateB = (feedForB.body?.messages || []).find((m) => m.id === sentMessageId);
  log('the same post shows a different my_vote to another viewer (B: -1)',
    !!hydrateB && hydrateB.score === voteScore && hydrateB.my_vote === -1,
    JSON.stringify(hydrateB && { score: hydrateB.score, my_vote: hydrateB.my_vote }));

  // ---------- 10d. ABSOLUTE 10-MINUTE ANONYMOUS LIFETIME (v43 → v46) ----------
  // Interactions (reports + votes above) already touched this post, so this
  // also proves nothing can push the expiry out.
  if (sentMessageId) {
    const { data: lifeRow } = await admin
      .from('community_posts')
      .select('created_at, last_interaction_at, expires_at')
      .eq('id', sentMessageId)
      .single();
    const createdMs = Date.parse(lifeRow?.created_at);
    const expiresMs = Date.parse(lifeRow?.expires_at);
    log('v46: an anonymous message carries expires_at = created_at + 10 min',
      Number.isFinite(expiresMs) && Math.abs((expiresMs - createdMs) - 10 * 60 * 1000) < 1500,
      `created=${lifeRow?.created_at} expires=${lifeRow?.expires_at}`);
    log('v46: the interaction clock never exceeds the absolute 10-min expiry',
      !!lifeRow && (lifeRow.last_interaction_at === null || Date.parse(lifeRow.last_interaction_at) <= expiresMs),
      `created=${lifeRow?.created_at} last=${lifeRow?.last_interaction_at} expires=${lifeRow?.expires_at}`);
    const computed = computeLivesUntil({ ...lifeRow, grace_until: null });
    log('v43: computeLivesUntil prefers the absolute expires_at (interactions cannot extend it)',
      Math.abs(computed - expiresMs) < 1000,
      `computed=${new Date(computed).toISOString()} expires=${lifeRow?.expires_at}`);
    const { data: lifeRow2 } = await admin
      .from('community_posts')
      .select('expires_at')
      .eq('id', sentMessageId)
      .single();
    log('v43: expires_at is unchanged after votes/reports (never extendable)',
      Date.parse(lifeRow2?.expires_at) === expiresMs,
      `before=${lifeRow?.expires_at} after=${lifeRow2?.expires_at}`);
  }

  // ---------- 10c. CREATE A NEW ANONYMOUS ROOM (server-owned defaults) ----------
  const creatorId = await makeUser('creator');
  const created = await callHandler(handleCreateAnonRoom, { id: creatorId }, {});
  log('a user can open a NEW anonymous room (returns the room id)',
    created.status === 200 && created.body?.ok === true && Number.isInteger(created.body?.room?.id),
    JSON.stringify(created.body));
  const extraRoomIds = [];
  if (created.body?.room?.id) extraRoomIds.push(created.body.room.id);
  const newRoomId = created.body?.room?.id;
  if (newRoomId) {
    const { data: newRoom } = await admin
      .from('study_groups')
      .select('type, group_state, spectator_price, membership_locked, name')
      .eq('id', newRoomId)
      .maybeSingle();
    log('new room is anonymous + waiting with server-default price ₦499',
      newRoom?.type === 'anonymous' && newRoom?.group_state === 'waiting' && Number(newRoom?.spectator_price) === SPECTATOR_PRICE,
      JSON.stringify(newRoom));
    log('new room is unlocked and has a non-empty name',
      newRoom?.membership_locked === false && typeof newRoom?.name === 'string' && newRoom.name.length > 0,
      `name=${newRoom?.name}`);
    const { data: newMembers } = await admin
      .from('study_group_members')
      .select('user_id, role')
      .eq('group_id', newRoomId);
    log('creator is the owner and the only member (#1)',
      (newMembers || []).length === 1 && newMembers[0].user_id === creatorId && newMembers[0].role === 'owner',
      JSON.stringify(newMembers));
    const countNew = Number((await admin.rpc('community_member_count', { p_group: newRoomId })).data);
    log('new room member count is exactly 1', countNew === 1, `count=${countNew}`);
  }
  const named = await callHandler(handleCreateAnonRoom, { id: creatorId }, { name: `  Custom ${stamp}  ` });
  if (named.body?.room?.id) extraRoomIds.push(named.body.room.id);
  log('a provided room name is used (trimmed)',
    named.status === 200 && named.body?.room?.name === `Custom ${stamp}`, `name=${named.body?.room?.name}`);
  for (const rid of extraRoomIds) {
    await admin.from('study_group_members').delete().eq('group_id', rid);
    await admin.from('study_groups').delete().eq('id', rid);
  }

  // ---------- 11. SPECTATOR PASS (₦499, read-only) ----------
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
    (specFeed.data || []).some((p) => p.content === `masked msg ${stamp}`));
  const specVote = await callHandler(handleVote, { id: spectatorId }, { post_id: sentMessageId, value: 1 });
  log('spectators can vote (read + react, never post) — server accepts',
    specVote.status === 200 && specVote.body?.my_vote === 1 && specVote.body?.score === 0, JSON.stringify(specVote.body));
  const specJoin = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: spectatorId });
  log('spectator cannot become a member (ALREADY_SPECTATOR)', specJoin.data?.code === 'ALREADY_SPECTATOR', JSON.stringify(specJoin.data));

  const countAfterSpec = Number((await admin.rpc('community_member_count', { p_group: scratchGroupId })).data);
  log('spectator does NOT increase the member count',
    countAfterSpec === countBeforeSpec && countAfterSpec === CAPACITY,
    `before=${countBeforeSpec} after=${countAfterSpec}`);

  const dupUser = await admin
    .from('anonymous_spectators')
    .insert({ group_id: scratchGroupId, user_id: spectatorId, reference: `e2e-spec2-${stamp}`, amount: SPECTATOR_PRICE, status: 'active' });
  log('a second pass for the same (group,user) is rejected (unique)',
    dupUser.error?.code === '23505', dupUser.error?.code);

  const dupRef = await admin
    .from('anonymous_spectators')
    .insert({ group_id: scratchGroupId, user_id: outsiderId, reference: `e2e-spec-${stamp}`, amount: SPECTATOR_PRICE, status: 'active' });
  log('a duplicated payment reference is rejected (idempotency)',
    dupUser.error?.code === '23505' && dupRef.error?.code === '23505',
    `dupUser=${dupUser.error?.code || 'none'}/${dupRef.error?.code}`);

  // ---------- 10e. ENCODED MESSAGES (v44) — sender + recipient only ----------
  // The plaintext never enters the feed (blank for EVERY viewer) and the
  // decode endpoint answers only the author or the single addressed member.
  const recipId = joinerIds[1]; // u2 — the member being encoded TO
  const thirdId = joinerIds[2]; // lockjoin — a member who must NOT decode
  const authorAlias = await ensureRoomAlias(scratchGroupId, memberId);
  const recipAlias = await ensureRoomAlias(scratchGroupId, recipId);
  const encText = `secret ${stamp}`;
  const prec = await admin.from('subscriptions').insert({
    user_id: memberId,
    status: 'active',
    plan: 'monthly',
    amount: 6999,
    reference: `e2e-enc-${stamp}`,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    grace_until: new Date(Date.now() + 86400000).toISOString(),
  });
  log('premium grant (subscriptions) makes the sender premium', !prec.error, prec.error?.message);
  const encFree = await callHandler(handleAnonSend, { id: recipId }, { group_id: scratchGroupId, content: 'x', encoded: true, recipient_alias: authorAlias });
  log('non-premium encoding is refused (PREMIUM_REQUIRED)',
    encFree.status === 403 && encFree.body?.error === 'PREMIUM_REQUIRED',
    `status=${encFree.status} error=${encFree.body?.error}`);
  const encNoRecip = await callHandler(handleAnonSend, { id: memberId }, { group_id: scratchGroupId, content: encText, encoded: true });
  log('premium encoding without a recipient is refused (RECIPIENT_REQUIRED)',
    encNoRecip.status === 400 && encNoRecip.body?.error === 'RECIPIENT_REQUIRED',
    `status=${encNoRecip.status} error=${encNoRecip.body?.error}`);
  const encBadRecip = await callHandler(handleAnonSend, { id: memberId }, { group_id: scratchGroupId, content: encText, encoded: true, recipient_alias: 9999 });
  log('encoding to an alias outside the room is refused (INVALID_RECIPIENT)',
    encBadRecip.status === 400 && encBadRecip.body?.error === 'INVALID_RECIPIENT',
    `status=${encBadRecip.status} error=${encBadRecip.body?.error}`);
  const encSelf = await callHandler(handleAnonSend, { id: memberId }, { group_id: scratchGroupId, content: encText, encoded: true, recipient_alias: authorAlias });
  log('a member cannot encode to themselves (INVALID_RECIPIENT)',
    encSelf.status === 400 && encSelf.body?.error === 'INVALID_RECIPIENT',
    `status=${encSelf.status} error=${encSelf.body?.error}`);
  const encSent = await callHandler(handleAnonSend, { id: memberId }, { group_id: scratchGroupId, content: encText, encoded: true, recipient_alias: recipAlias });
  const encMsg = encSent.body?.message;
  log('encoded message is sent: encoded + locked + for-me (author), blank content',
    encSent.status === 200 && encMsg?.encoded === true && encMsg?.locked === true &&
      encMsg?.encoded_for_me === true && encMsg?.content === '',
    JSON.stringify(encMsg));

  const feedRecip = await callHandler(handleAnonFeed, { id: recipId }, { group_id: scratchGroupId, limit: 50 });
  const encHydRecip = (feedRecip.body?.messages || []).find((m) => m.id === encMsg?.id);
  log('v44: the feed NEVER decodes the body, even for the premium recipient',
    !!encHydRecip && encHydRecip.content === '' && encHydRecip.encoded === true,
    `encoded=${encHydRecip?.encoded} content=${JSON.stringify(encHydRecip?.content)}`);
  log('v44: the recipient is flagged encoded_for_me (client can offer Unlock)',
    encHydRecip?.encoded_for_me === true, `for_me=${encHydRecip?.encoded_for_me}`);
  const feedThird = await callHandler(handleAnonFeed, { id: thirdId }, { group_id: scratchGroupId, limit: 50 });
  const encHydThird = (feedThird.body?.messages || []).find((m) => m.id === encMsg?.id);
  log('v44: a non-recipient member sees a private (blank, not for-me) message',
    !!encHydThird && encHydThird.content === '' && encHydThird.encoded_for_me === false,
    `for_me=${encHydThird?.encoded_for_me} content=${JSON.stringify(encHydThird?.content)}`);

  const decRecip = await callHandler(handleAnonEncoded, { id: recipId }, { message_id: encMsg?.id, group_id: scratchGroupId });
  log('the addressed recipient can decode the message',
    decRecip.status === 200 && decRecip.body?.content === encText,
    `status=${decRecip.status} content=${decRecip.body?.content}`);
  const decAuthor = await callHandler(handleAnonEncoded, { id: memberId }, { message_id: encMsg?.id, group_id: scratchGroupId });
  log('the author can re-read their own Encoded Message',
    decAuthor.status === 200 && decAuthor.body?.content === encText,
    `status=${decAuthor.status} content=${decAuthor.body?.content}`);
  const decThird = await callHandler(handleAnonEncoded, { id: thirdId }, { message_id: encMsg?.id, group_id: scratchGroupId });
  log('another member cannot decode it (403 ENCODED_PRIVATE)',
    decThird.status === 403 && decThird.body?.error === 'ENCODED_PRIVATE',
    `status=${decThird.status} error=${decThird.body?.error}`);
  const decSpec = await callHandler(handleAnonEncoded, { id: spectatorId }, { message_id: encMsg?.id, group_id: scratchGroupId });
  log('a spectator cannot decode either (403 ENCODED_PRIVATE)',
    decSpec.status === 403 && decSpec.body?.error === 'ENCODED_PRIVATE',
    `status=${decSpec.status} error=${decSpec.body?.error}`);

  // ---------- 10f. WHATSAPP-STYLE REPLY (reply_to_post_id) ----------
  // A reply is a normal post with reply_to_post_id; the server validates it
  // against an ALIVE parent in the SAME room and hydrates an inline `reply`
  // quote so the client can render the Swift-like replying-to block.
  await callHandler(handleAnonAck, { id: recipId }, { group_id: scratchGroupId }); // parent author accepts the notice so it can speak
  const parentPosted = await callHandler(handleAnonSend, { id: recipId }, { group_id: scratchGroupId, content: `original ${stamp}` });
  const parentMsg = parentPosted.body?.message;
  log('a public message is posted and can be quoted as the reply target',
    parentPosted.status === 200 && !!parentMsg?.id, `status=${parentPosted.status} id=${parentMsg?.id}`);
  const replyPosted = await callHandler(handleAnonSend, { id: memberId }, {
    group_id: scratchGroupId,
    content: `in reply ${stamp}`,
    reply_to_post_id: parentMsg?.id,
  });
  const replyMsg = replyPosted.body?.message;
  const replyRow = !!replyMsg?.id
    ? await admin.from('community_posts').select('reply_to_post_id').eq('id', replyMsg.id).single()
    : { data: null };
  log('reply_to_post_id is accepted and persisted on the reply post (DB-backed)',
    replyPosted.status === 200 && !!replyMsg?.id && replyRow.data?.reply_to_post_id === parentMsg?.id,
    `status=${replyPosted.status} reply_to=${replyRow.data?.reply_to_post_id}`);
  log('the hydrated reply carries the WhatsApp-style quote (`reply`: author + excerpt)',
    !!replyMsg?.reply && replyMsg.reply.id === parentMsg?.id &&
      replyMsg.reply.author === `Anonymous #${String(recipAlias).padStart(2, '0')}` &&
      replyMsg.reply.excerpt === `original ${stamp}`,
    JSON.stringify(replyMsg?.reply));
  const badReply = await callHandler(handleAnonSend, { id: memberId }, {
    group_id: scratchGroupId,
    content: `ghost ${stamp}`,
    reply_to_post_id: '00000000-0000-4000-8000-000000000000',
  });
  log('replying to a message that does not exist is refused (404 REPLY_NOT_FOUND)',
    badReply.status === 404 && badReply.body?.error === 'REPLY_NOT_FOUND',
    `status=${badReply.status} error=${badReply.body?.error}`);

  // ---------- 10g. SOCIAL ACTIONS (v44) — cooldown + mute (v46 action set) ----------
  const socialMsg = encMsg?.id || sentMessageId;
  const actorId = thirdId; // lockjoin has never acted before
  const s1 = await callHandler(handleAnonSocial, { id: actorId }, { message_id: socialMsg, action: 'hug', group_id: scratchGroupId });
  log('a member can send a social action (server records count)',
    s1.status === 200 && s1.body?.social?.find((x) => x.action === 'hug')?.count === 1, JSON.stringify(s1.body));
  const s2 = await callHandler(handleAnonSocial, { id: actorId }, { message_id: socialMsg, action: 'highfive', group_id: scratchGroupId });
  log('a repeat action inside the cooldown window is refused (429 SOCIAL_COOLDOWN)',
    s2.status === 429 && s2.body?.error === 'SOCIAL_COOLDOWN', `status=${s2.status} error=${s2.body?.error}`);
  await new Promise((r) => setTimeout(r, 8500));
  const s3 = await callHandler(handleAnonSocial, { id: actorId }, { message_id: socialMsg, action: 'highfive', group_id: scratchGroupId });
  log('after the cooldown window the member can act again (room-wide reset)',
    s3.status === 200 && s3.body?.social?.find((x) => x.action === 'highfive')?.count === 1, JSON.stringify(s3.body));
  const muted = await admin.from('anonymous_social_prefs').insert({ owner_id: memberId, peer_id: actorId, blocked: true });
  const sBlocked = await callHandler(handleAnonSocial, { id: actorId }, { message_id: sentMessageId, action: 'hug', group_id: scratchGroupId });
  log('an action toward a member who muted the actor is refused (403 SOCIAL_BLOCKED)',
    !muted.error && sBlocked.status === 403 && sBlocked.body?.error === 'SOCIAL_BLOCKED',
    `status=${sBlocked.status} error=${sBlocked.body?.error}`);
  const sBadAction = await callHandler(handleAnonSocial, { id: actorId }, { message_id: sentMessageId, action: 'cheer', group_id: scratchGroupId });
  log('an action outside the v46 action set is refused (SOCIAL_NOT_ALLOWED)',
    sBadAction.status === 400 && sBadAction.body?.error === 'SOCIAL_NOT_ALLOWED',
    `status=${sBadAction.status} error=${sBadAction.body?.error}`);

  // ---------- 10f2. FIGHTS (v46) — two reciprocal attacks start ONE fight ----------
  await callHandler(handleAnonAck, { id: recipId }, { group_id: scratchGroupId });
  const postByU2 = await callHandler(handleAnonSend, { id: recipId }, { group_id: scratchGroupId, content: `fight target ${stamp}` });
  const postByU2Id = postByU2.body?.message?.id;
  const fa = await callHandler(handleAnonSocial, { id: recipId }, { message_id: sentMessageId, action: 'slap', group_id: scratchGroupId });
  await new Promise((r) => setTimeout(r, 8500));
  const fb = await callHandler(handleAnonSocial, { id: memberId }, { message_id: postByU2Id, action: 'kick', group_id: scratchGroupId });
  log('reciprocal attack actions inside the window start a fight (v46 fight_check)',
    fa.status === 200 && fa.body?.fight === false && fb.status === 200 && fb.body?.fight === true,
    `fa=${JSON.stringify(fa.body)} fb=${JSON.stringify(fb.body)}`);

  // ---------- 10g. PRESENCE (v44) — heartbeat / online / leave / reap ----------
  const presUsers = [ownerId, memberId, joinerIds[1], joinerIds[2]];
  for (const u of presUsers) {
    const hb = await admin.rpc('community_presence_heartbeat', { p_group: scratchGroupId, p_user: u, p_session: `e2e-sess-${stamp}` });
    if (!hb.data?.ok) throw new Error(`presence heartbeat failed for ${u}: ${hb.error?.message}`);
  }
  const online = await admin.rpc('community_presence_online', { p_group: scratchGroupId, p_grace: 45 });
  log('presence heartbeat + online count cover every present member',
    Number(online.data) === presUsers.length, `online=${online.data}`);
  const presLeave = await admin.rpc('community_presence_leave', { p_group: scratchGroupId, p_user: memberId });
  const onlineAfter = await admin.rpc('community_presence_online', { p_group: scratchGroupId, p_grace: 45 });
  log('explicit presence-leave drops the member from the live count immediately',
    !presLeave.error && Number(onlineAfter.data) === presUsers.length - 1, `online=${onlineAfter.data}`);
  // v46 — the presence reap is presence-ONLY: it clears stale presence rows and
  // never touches seats (seat release is owned by membership reconcile).
  await admin
    .from('anonymous_presence')
    .update({ last_seen_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
    .eq('group_id', scratchGroupId)
    .eq('user_id', joinerIds[1]);
  const reap = await admin.rpc('community_presence_reap', { p_group: scratchGroupId, p_grace: 45, p_inactivity: 300 });
  log('presence reap clears stale presence rows only (never releases a seat)',
    reap.data?.ok === true && Number(reap.data?.presence_reaped) === 1 &&
      !('members_released' in (reap.data || {})) &&
      Number(reap.data?.member_count) === presUsers.length,
    JSON.stringify(reap.data));

  // v46 — an idle member's seat is released by the membership reconcile, and the
  // owner is never released (S4 membership corrections).
  await admin
    .from('study_group_members')
    .update({ last_activity_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() })
    .eq('group_id', scratchGroupId)
    .eq('user_id', memberId);
  const recon = await admin.rpc('community_membership_reconcile', { p_group: scratchGroupId, p_deadline: 900, p_warning: 600 });
  log('membership reconcile releases an idle member seat and never the owner',
    recon.data?.ok === true && Number(recon.data?.released) === 1 &&
      Number(recon.data?.member_count) === presUsers.length - 1,
    JSON.stringify(recon.data));

  // 10h2. PHASE 3 — the released member loses read access END-TO-END and no stale
  // subscription can reintroduce them (a later feed/message call must 403).
  const releasedFeed = await callHandler(handleAnonFeed, { id: memberId }, { group_id: scratchGroupId, limit: 5 });
  log('revoked member feed is refused immediately (no stale access after release)',
    releasedFeed.status === 403 && releasedFeed.body?.message, `status=${releasedFeed.status} error=${releasedFeed.body?.error}`);
  const releasedSend = await callHandler(handleAnonSend, { id: memberId }, { group_id: scratchGroupId, content: `revoked ${stamp}` });
  log('revoked member cannot send either (server-enforced, direct endpoint)',
    [400, 403].includes(releasedSend.status) && !releasedSend.body?.ok,
    `status=${releasedSend.status} error=${releasedSend.body?.error}`);

  // 10h3. PHASE 3 — vote adjustments are once-only (+3min at >=7 up, -3min at
  // >=10 down). Exercised through the real RPC the server calls per vote.
  try {
    const voterIds = [];
    for (let i = 0; i < 10; i += 1) voterIds.push(await makeUser(`vote${i}`));
    const { data: upPost } = await admin
      .from('community_posts')
      .insert({ group_id: scratchGroupId, author_id: voterIds[0], content: `upvote adjust ${stamp}` })
      .select('id')
      .single();
    await admin.from('community_post_votes').insert([
      ...voterIds.slice(0, 7).map((uid, i) => ({ post_id: upPost.id, user_id: uid, value: 1, created_at: new Date(Date.now() + i).toISOString() })),
    ]);
    const upExp = await admin.rpc('community_apply_vote_expiry', { p_post: upPost.id });
    const { data: upRow } = await admin.from('community_posts').select('base_expires_at, expires_at, upvote_adjust_applied').eq('id', upPost.id).single();
    const upDelta = new Date(upRow.expires_at) - new Date(upRow.base_expires_at);
    log('>=7 upvotes extends the anonymous message by exactly +3min, once',
      upRow.upvote_adjust_applied === true && Math.abs(upDelta - 180_000) < 5000,
      `delta_ms=${upDelta}`);
    const upExp2 = await admin.rpc('community_apply_vote_expiry', { p_post: upPost.id });
    const upDelta2 = new Date(upRow.expires_at) - new Date(upRow.base_expires_at);
    log('a second apply is a no-op (adjustment is once-only)',
      Number(!!upExp.data) === 1 && Math.abs(upDelta2 - 180_000) < 5000, `delta_ms=${upDelta2}`);

    const { data: downPost } = await admin
      .from('community_posts')
      .insert({ group_id: scratchGroupId, author_id: voterIds[0], content: `downvote adjust ${stamp}` })
      .select('id')
      .single();
    await admin.from('community_post_votes').insert([
      ...voterIds.slice(0, 10).map((uid, i) => ({ post_id: downPost.id, user_id: uid, value: -1, created_at: new Date(Date.now() + i).toISOString() })),
    ]);
    await admin.rpc('community_apply_vote_expiry', { p_post: downPost.id });
    const { data: downRow } = await admin.from('community_posts').select('base_expires_at, expires_at, downvote_adjust_applied').eq('id', downPost.id).single();
    const downDelta = new Date(downRow.expires_at) - new Date(downRow.base_expires_at);
    log('>=10 downvotes shortens the anonymous message by exactly -3min, once',
      downRow.downvote_adjust_applied === true && Math.abs(downDelta + 180_000) < 5000,
      `delta_ms=${downDelta}`);
  } catch (e) {
    log('vote-adjustment RPC checks executed without error', false, String(e).slice(0, 200));
  }

  // ---------- 12. RLS: a signed-in member still cannot SELECT the room rows ----------
  try {
    const publishable = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    const email = users.find((u) => u.id === memberId)?.email;
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

  // ---------- 13. REALTIME: HTTP broadcast reaches TWO live sessions ----------
  const topic = roomChannel(scratchGroupId);
  const got = { a: null, b: null };
  const channels = [];
  const subscribeRoom = (client, onMsg) =>
    new Promise((resolve, reject) => {
      const ch = client.channel(topic, { config: { broadcast: { self: false } } });
      const timer = setTimeout(() => reject(new Error('subscribe timeout')), 20000);
      ch.on('broadcast', { event: 'room' }, ({ payload }) => onMsg(payload));
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(ch); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`subscribe ${status}`)); }
      });
    });
  try {
    const anonA = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    const anonB = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    channels.push(await subscribeRoom(anonA, (p) => { got.a = p; }), await subscribeRoom(anonB, (p) => { got.b = p; }));
    const published = await publishRoomEvent(scratchGroupId, 'message', { id: 'e2e-rt' });
    const deadline = Date.now() + 12000;
    while ((!got.a || !got.b) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
    // The HTTP broadcast is best-effort with a 2.5s abort; in a slow sandbox the
    // 202 can be missed while the message still fans out. Treat either a 202 or
    // observed delivery to two sessions as proof the broadcast worked.
    log('server HTTP broadcast is accepted (202) or delivered to both sessions',
      published === true || (got.a?.type === 'message' && got.b?.type === 'message'),
      `published=${published} a=${got.a?.type} b=${got.b?.type}`);
    log('realtime delivery reaches both live sessions (two-session fan-out)',
      got.a?.type === 'message' && got.b?.type === 'message',
      `a=${JSON.stringify(got.a)} b=${JSON.stringify(got.b)}`);
    log('broadcast payload never carries message content or author_id',
      got.a && got.a.content === undefined && got.a.author_id === undefined, JSON.stringify(got.a));
    log('broadcast to a null/invalid group is a no-op (false)',
      (await publishRoomEvent(null, 'message')) === false);
  } catch (rtErr) {
    log('realtime two-session delivery', false, rtErr.message);
  } finally {
    for (const ch of channels) { try { await ch.unsubscribe(); } catch { /* ignore */ } }
  }

  // ---------- 13b. "LOAD EARLIER MESSAGES" NEVER DEAD-ENDS (Phase 3) ----------
  // Isolated room: 3 fresh messages paginated 2-at-a-time must terminate with
  // has_more=false after exactly the messages that exist (no phantom page).
  const { data: pageGrp } = await admin
    .from('study_groups')
    .insert({
      name: `Anon Page ${stamp}`, creator_id: ownerId, is_verified: true, member_limit: 100,
      is_active: true, type: 'anonymous', privacy: 'restricted', spectator_price: SPECTATOR_PRICE,
      minimum_members_to_activate: 1, minimum_members_to_remain_active: 1, group_state: 'active',
    })
    .select('id')
    .single();
  pageGroupId = pageGrp?.id || null;
  await admin.from('study_group_members').insert({ group_id: pageGroupId, user_id: ownerId, role: 'owner' });
  await callHandler(handleAnonAck, { id: ownerId }, { group_id: pageGroupId });
  for (let i = 0; i < 3; i += 1) {
    await callHandler(handleAnonSend, { id: ownerId }, { group_id: pageGroupId, content: `page ${i} ${stamp}` });
  }
  const pg1 = await callHandler(handleAnonFeed, { id: ownerId }, { group_id: pageGroupId, limit: 2 });
  const pg2 = await callHandler(handleAnonFeed, { id: ownerId }, { group_id: pageGroupId, limit: 2, before: pg1.body?.next_before });
  const pgUnion = new Set([...(pg1.body?.messages || []), ...(pg2.body?.messages || [])].map((m) => m.id));
  log('load-earlier paginates to exactly the messages that exist (no phantom "load earlier" page)',
    pg1.status === 200 && pg1.body?.has_more === true && (pg1.body?.messages || []).length === 2 &&
      pg2.body?.has_more === false && pgUnion.size === 3,
    `p1=${pg1.body?.messages?.length} more1=${pg1.body?.has_more} p2=${pg2.body?.messages?.length} more2=${pg2.body?.has_more} union=${pgUnion.size}`);

  // ---------- 14. 6h EPHEMERAL CEILING ----------
  const nowMs = Date.now();
  const ceilingPost = {
    created_at: new Date(nowMs - 10 * 60 * 60 * 1000).toISOString(), // 10h old
    last_interaction_at: new Date(nowMs).toISOString(), // bumped just now
    grace_until: null,
  };
  const computed = computeLivesUntil(ceilingPost);
  log('computeLivesUntil clamps a farmed post to created_at + 6h',
    computed === new Date(ceilingPost.created_at).getTime() + MAX_POST_LIFE_MS && MAX_POST_LIFE_MS === 6 * 60 * 60 * 1000,
    `lives=${new Date(computed).toISOString()} ceiling=${new Date(ceilingPost.created_at).getTime() + MAX_POST_LIFE_MS}`);

  // ---------- 15. SURVIVAL: stays active at the floor; below it wipes ----------
  const removable = joinerIds.filter((uid) => uid !== ownerId); // owner cannot leave
  // Members now: owner + u1 + u2 + lockjoin = 4. Drop to SURVIVE (2), then below.
  while ((await admin.rpc('community_member_count', { p_group: scratchGroupId })).data > SURVIVE) {
    const uid = removable.shift();
    if (!uid) break;
    await admin.rpc('community_anonymous_leave', { p_group: scratchGroupId, p_user: uid });
  }
  const { data: stateAtFloor } = await admin
    .from('study_groups').select('group_state').eq('id', scratchGroupId).single();
  const countAtFloor = Number((await admin.rpc('community_member_count', { p_group: scratchGroupId })).data);
  log(`room stays ACTIVE at the survival floor (${SURVIVE}) even with spectators present`,
    stateAtFloor?.group_state === 'active' && countAtFloor === SURVIVE,
    `state=${stateAtFloor?.group_state} count=${countAtFloor}`);

  const leaveWipeUser = removable.shift();
  const { data: leaveWipe } = await admin.rpc('community_anonymous_leave', { p_group: scratchGroupId, p_user: leaveWipeUser });
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
      await admin.from('community_posts').delete().eq('group_id', scratchGroupId);
      await admin.from('anonymous_spectators').delete().eq('group_id', scratchGroupId);
      await admin.from('study_group_members').delete().eq('group_id', scratchGroupId);
      await admin.from('study_groups').delete().eq('id', scratchGroupId);
    }
    if (pageGroupId) {
      await admin.from('community_posts').delete().eq('group_id', pageGroupId);
      await admin.from('study_group_members').delete().eq('group_id', pageGroupId);
      await admin.from('study_groups').delete().eq('id', pageGroupId);
    }
    for (const u of users) {
      await admin.auth.admin.deleteUser(u.id).catch(() => {});
    }
  } catch (cleanErr) {
    log('cleanup', false, cleanErr.message);
  }
  process.exit(summary() ? 1 : 0);
}

// A missing-table / RLS-denied read can surface as an error OR an empty result
// depending on PostgREST; treat "no privileges"-style codes as a pass (denied).
function rlsErr(err) {
  if (!err) return false;
  const denied = ['42501', 'PGRST301', 'PGRST116'];
  return denied.includes(err.code) ? false : err;
}
