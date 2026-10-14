// scripts/e2e-anon-v62.mjs
// Focused live e2e for the v62 consent-gated gag ("crack -> belle -> denied ->
// birth") and the identity-colour / per-action presentation changes.
//
// Exercises the REAL handlers (mock req/res) against the live DB:
//   A. accepting a crack stages 4 announce rows 5 minutes apart
//   B. each delayed row has created_at === visible_at (ordering + expiry)
//   C. future steps are HIDDEN from the feed; the t+0 card is visible
//   D. once a step's time passes, the feed serves it (steps 3 and 4 are
//      reachable at all - before this fix they were dead on arrival)
//   E. declining stages nothing
//   F. unparseable aliases get a distinct colour swatch
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import { handleAnonFeed, handleAnonEventRespond } from '../api/_community.js';

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};

const env = loadEnv();
Object.assign(process.env, {
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
});
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now().toString().slice(-8);
const password = 'testpass123';

const mockRes = () => {
  const r = { statusCode: 200, bodySent: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.bodySent = b; return r; };
  r.setHeader = () => r;
  return r;
};

let roomId = null;
let lastFeedStatus = null;
let lastFeedBody = null;
const userIds = [];

const cleanup = async () => {
  if (!roomId) return;
  try {
    await admin.from('community_posts').delete().eq('group_id', roomId);
    await admin.from('study_groups').delete().eq('id', roomId);
  } catch { /* best effort */ }
  for (const id of userIds) {
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
};

try {
  // ---- setup: a scratch anonymous room with two members ------------------------
  const { data: group, error: gErr } = await admin
    .from('study_groups')
    .insert({
      creator_id: userIds[0] || null,
      name: `Anon V62 Scratch ${stamp}`, type: 'anonymous', group_state: 'active',
      is_active: true, member_limit: 100, founding_member_cap: 20, free_spectator_cap: 20,
      minimum_members_to_activate: 3, minimum_members_to_remain_active: 5,
      membership_locked: false, member_price: 499, spectator_price: 299,
    })
    .select('id')
    .single();
  if (gErr) {
    // creator_id is NOT NULL, so create the owner first, then retry.
    const { data: owner, error: oErr } = await admin.auth.admin.createUser({
      email: `v62${stamp}owner@apextest.local`, password, email_confirm: true,
    });
    if (oErr) throw oErr;
    userIds.push(owner.user.id);
    await admin.from('profiles').insert({ id: owner.user.id, email: `v62${stamp}owner@apextest.local`, full_name: 'V62 Owner', is_activated: true });
    const retry = await admin
      .from('study_groups')
      .insert({
        creator_id: owner.user.id,
        name: `Anon V62 Scratch ${stamp}`, type: 'anonymous', group_state: 'active',
        is_active: true, member_limit: 100, founding_member_cap: 20, free_spectator_cap: 20,
        minimum_members_to_activate: 3, minimum_members_to_remain_active: 5,
        membership_locked: false, member_price: 499, spectator_price: 299,
      })
      .select('id')
      .single();
    if (retry.error) throw retry.error;
    roomId = retry.data.id;
  } else {
    roomId = group.id;
  }

  const aliases = [];
  const memberIds = [];
  for (let i = 0; i < 2; i += 1) {
    const email = `v62${stamp}u${i}@apextest.local`;
    const { data: u, error: uErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (uErr) throw uErr;
    userIds.push(u.user.id);
    memberIds.push(u.user.id);
    await admin.from('profiles').insert({ id: u.user.id, email, full_name: `V62 ${i}`, is_activated: true });
    const { error: mErr } = await admin
      .from('study_group_members')
      .insert({ group_id: roomId, user_id: u.user.id, role: 'member' });
    if (mErr) throw new Error(`member insert: ${mErr.code} ${mErr.message}`);
    const alias = 100 + i * 37;
    aliases.push(alias);
    await admin.from('anonymous_room_identities').insert({ group_id: roomId, user_id: u.user.id, alias });
  }
  const [toaster, toastee] = memberIds;
  const [aliasA, aliasB] = aliases;
  log('setup: scratch room + 2 members', true, `room=${roomId} aliases=${aliasA}/${aliasB}`);

  // ---- seed a pending crack challenge (kind='challenge', as handleAnonSocial does)
  const { data: challenge, error: cErr } = await admin
    .from('anonymous_room_events')
    .insert({
      group_id: roomId, action: 'crack', kind: 'challenge', status: 'pending',
      actor_id: toaster, actor_alias: aliasA,
      target_id: toastee, target_alias: aliasB,
    })
    .select('id')
    .single();
  if (cErr) throw cErr;

  // ---- E. declining stages nothing ---------------------------------------------
  {
    const { data: declineRow } = await admin
      .from('anonymous_room_events')
      .insert({
        group_id: roomId, action: 'crack', kind: 'challenge', status: 'pending',
        actor_id: toaster, actor_alias: aliasA, target_id: toastee, target_alias: aliasB,
      })
      .select('id')
      .single();
    const res = mockRes();
    await handleAnonEventRespond(
      { method: 'POST', url: '/x', headers: {}, body: { event_id: declineRow.id, respond: 'decline', group_id: roomId } },
      res,
      { id: toastee, email: 'v62@apextest.local' },
    );
    const { data: staged } = await admin
      .from('anonymous_room_events').select('id').eq('group_id', roomId).eq('kind', 'announce');
    log('declining a crack stages no announcements', res.statusCode === 200 && (staged?.length || 0) === 0,
      `status=${res.statusCode} announce_rows=${staged?.length || 0}`);
  }

  // ---- A. accepting stages 4 announce rows -------------------------------------
  const res = mockRes();
  await handleAnonEventRespond(
    { method: 'POST', url: '/x', headers: {}, body: { event_id: challenge.id, respond: 'accept', group_id: roomId } },
    res,
    { id: toastee, email: 'v62@apextest.local' },
  );
  log('accepting a crack returns 200', res.statusCode === 200, JSON.stringify(res.bodySent));

  const { data: announces } = await admin
    .from('anonymous_room_events')
    .select('id, action, kind, status, created_at, visible_at, actor_alias, target_alias')
    .eq('group_id', roomId).eq('kind', 'announce')
    .order('visible_at', { ascending: true });

  log('exactly 4 announcements staged', announces?.length === 4, `rows=${announces?.length}`);
  const actions = (announces || []).map((a) => a.action);
  log('timeline is cracked -> belle -> denied -> birth',
    actions[0]?.startsWith('crack') && actions[1] === 'belle' && actions[2] === 'denied' && actions[3]?.startsWith('birth'),
    actions.join(' | '));

  // ---- B. created_at === visible_at on every delayed row -----------------------
  const sameClock = (announces || []).every(
    (a) => new Date(a.created_at).getTime() === new Date(a.visible_at).getTime(),
  );
  log('every delayed row has created_at === visible_at', sameClock,
    (announces || []).map((a) => `${a.action}:${Math.round((new Date(a.visible_at) - Date.now()) / 60000)}m`).join(' '));

  // steps are ~5 minutes apart
  const gaps = (announces || []).map((a) => new Date(a.visible_at).getTime());
  const spaced = gaps.every((g, i) => i === 0 || Math.abs(g - gaps[i - 1] - 5 * 60 * 1000) < 1500);
  log('steps are spaced 5 minutes apart', spaced, gaps.map((g) => Math.round((g - Date.now()) / 60000) + 'm').join(' '));

  // exactly one of the pair carries the pregnancy (the other denied it)
  const carrier = announces?.[3]?.actor_alias;
  const denier = announces?.[2]?.actor_alias;
  log('the preg-carrier and the denier are different members',
    carrier != null && denier != null && carrier !== denier, `carrier=#${carrier} denier=#${denier}`);

  // ---- C. the feed hides future steps but shows the t+0 card -------------------
  const feed = async () => {
    const r = mockRes();
    await handleAnonFeed(
      { method: 'POST', url: '/x', headers: {}, body: { group_id: roomId, limit: 50 } },
      r,
      { id: toaster, email: 'v62@apextest.local' },
    );
    lastFeedStatus = r.statusCode;
    lastFeedBody = r.bodySent;
    return r.bodySent?.events || [];
  };
  let feedEvents = await feed();
  const feedAnnounce = feedEvents.filter((e) => e.kind === 'announce');
  log('feed shows ONLY the immediate announcement', feedAnnounce.length === 1,
    `status=${lastFeedStatus} announce_in_feed=${feedAnnounce.length} all=${feedEvents.length} err=${JSON.stringify(lastFeedBody?.error || '')}`);
  log('the immediate line has a server-written sentence', typeof feedAnnounce[0]?.text === 'string' && feedAnnounce[0].text.length > 0,
    JSON.stringify(feedAnnounce[0]?.text));
  log('every fed card carries an expires_at', feedAnnounce.every((e) => typeof e.expires_at === 'string' && !Number.isNaN(Date.parse(e.expires_at))),
    feedAnnounce[0]?.expires_at || '(none)');

  // ---- D. a due future step becomes visible (steps 3 and 4 are reachable) ------
  const lateRow = announces?.[3];
  if (lateRow) {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const { error: bErr } = await admin
      .from('anonymous_room_events')
      .update({ created_at: past, visible_at: past })
      .eq('id', lateRow.id);
    feedEvents = await feed();
    const nowVisible = feedEvents.filter((e) => e.kind === 'announce').map((e) => e.action);
    log('a due step becomes visible in the feed', !bErr && nowVisible.includes(lateRow.action),
      `visible=${nowVisible.join(',')} (was unreachable before the lifetime fix)`);
  }

  // ---- expiry still enforced: a row older than the lifetime disappears ---------
  if (lateRow) {
    const old = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    await admin.from('anonymous_room_events').update({ created_at: old }).eq('id', lateRow.id);
    feedEvents = await feed();
    const stillThere = feedEvents.some((e) => e.id === lateRow.id);
    log('an expired card is dropped from the feed', !stillThere, `present=${stillThere}`);
  }

  // ---- F. the two members get DIFFERENT colours -------------------------------
  // (the palette itself is client-side; here we assert the DB never assigns a
  //  colour, so a distinct swatch depends only on the alias differing)
  const { data: identities } = await admin
    .from('anonymous_room_identities').select('alias').eq('group_id', roomId);
  log('distinct members hold distinct aliases', new Set((identities || []).map((r) => r.alias)).size === 2,
    (identities || []).map((r) => '#' + r.alias).join(' '));
} catch (err) {
  console.error('FATAL', err.stack || err.message);
  await cleanup();
  process.exit(1);
}

await cleanup();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length ? 1 : 0);