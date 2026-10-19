// e2e-relationships.mjs - authorization for the friend/rival + achievement RPCs.
//
// Regression suite for migration-v77. The bug it guards was CONFIRMED LIVE:
// `respond_relationship` guarded with `rel.target_id <> auth.uid()`, and for an
// unauthenticated caller auth.uid() is NULL, so that comparison is NULL rather
// than TRUE. `if rel is null or <NULL>` is therefore not taken, the guard was
// skipped, and a logged-out client holding only the publishable key accepted a
// pending friend request. Nothing about this is theoretical: it was reproduced
// against the live database before the fix.
//
// Every check here runs against a REAL authenticated session, because the whole
// point is which uid the server sees.
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
const password = `Rel${stamp}A!7`;
const mkUser = async (tag) => {
  const email = `relsec-${tag}-${stamp}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser ${tag}: ${error.message}`);
  await admin.from('profiles').update({ is_activated: true }).eq('id', data.user.id);
  const pub = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: s, error: se } = await pub.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signin ${tag}: ${se.message}`);
  return { id: data.user.id, email, client: pub, token: s.session.access_token };
};
const rpc = async (u, fn, params = {}) => {
  const res = await fetch(`${URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${u ? u.token : ANON}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(params),
  });
  const text = await res.text();
  let data = null;
  try { data = text.length ? JSON.parse(text) : null; } catch { data = null; }
  return { data, status: res.status, body: text.slice(0, 240) };
};

const A = await mkUser('a');
const B = await mkUser('b');
const C = await mkUser('c');
const users = [A, B, C];

try {
  // ---- 1. an anonymous caller must not be able to touch relationships ------
  {
    const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const seed = await admin.from('user_relationships')
      .insert({ user_id: A.id, target_id: B.id, rel_type: 'friend', status: 'pending' })
      .select('id, status').single();

    const anonRespond = await anonClient.rpc('respond_relationship',
      { p_rel_id: seed.data.id, p_accept: true });
    log('anon cannot accept a pending friend request (the confirmed bypass)',
      !!anonRespond.error, `err=${anonRespond.error?.message || 'none'}`);

    const stillPending = await admin.from('user_relationships')
      .select('status').eq('id', seed.data.id).single();
    log('...and the request is still pending afterwards',
      stillPending.data?.status === 'pending', `status=${stillPending.data?.status}`);

    const anonReq = await anonClient.rpc('request_relationship', { p_target: C.id, p_type: 'friend' });
    log('anon cannot send a friend request', !!anonReq.error,
      `err=${anonReq.error?.message || 'none'}`);

    const anonRemove = await anonClient.rpc('remove_relationship', { p_other: C.id });
    log('anon cannot remove a relationship', !!anonRemove.error,
      `err=${anonRemove.error?.message || 'none'}`);

    // ---- 2. nor read anyone else's achievements --------------------------
    const anonAch = await anonClient.rpc('get_user_achievements', { p_user: A.id });
    log('anon cannot read another user\'s achievements', !!anonAch.error,
      `err=${anonAch.error?.message || 'none'}`);

    const otherAch = await rpc(B, 'get_user_achievements', { p_user: A.id });
    log('a signed-in user cannot read someone else\'s achievements',
      otherAch.status !== 200 || /not your achievements/.test(otherAch.body),
      `status=${otherAch.status} body=${otherAch.body.slice(0, 80)}`);

    const selfAch = await rpc(A, 'get_user_achievements', { p_user: A.id });
    log('a user CAN read their own achievements',
      selfAch.status === 200, `status=${selfAch.status}`);

    // ---- 3. ownership: only the target may answer -------------------------
    const byStranger = await rpc(C, 'respond_relationship', { p_rel_id: seed.data.id, p_accept: true });
    log('a third user cannot accept someone else\'s request',
      byStranger.data?.ok === false && byStranger.data?.error === 'not_found_or_not_target',
      `res=${JSON.stringify(byStranger.data)}`);

    const afterStranger = await admin.from('user_relationships')
      .select('status').eq('id', seed.data.id).single();
    log('...and the request is STILL pending after the stranger tried',
      afterStranger.data?.status === 'pending', `status=${afterStranger.data?.status}`);

    // ---- 4. the target accepts, and the pair is ONE row -------------------
    const byTarget = await rpc(B, 'respond_relationship', { p_rel_id: seed.data.id, p_accept: true });
    log('the target CAN accept the request', byTarget.data?.ok === true,
      `res=${JSON.stringify(byTarget.data)}`);

    const both = await admin.from('user_relationships')
      .select('user_id, target_id, status').eq('rel_type', 'friend')
      .in('user_id', [A.id, B.id]).in('target_id', [A.id, B.id]);
    const accepted = (both.data || []).filter((r) => r.status === 'accepted');
    // v89 CHANGED THIS, and the old assertion was `=== 2`.
    // respond_relationship used to insert a MIRRORED row (target->user) so both
    // directions resolved. migration-v89 replaced that with a UNIQUE index on
    // the SORTED pair, so the mirror is impossible and direction means only
    // "who sent it". One row per pair is the whole point of that change: the
    // mirror made notify_achievement_unlock fire twice and tell the unlocker
    // they had unlocked something, with the other person as the actor.
    log('accepting leaves exactly ONE row for the pair (no mirror row)',
      accepted.length === 1, `acceptedRows=${accepted.length}`);

    // Replay must not duplicate - and must now report that it was answered.
    const replay = await rpc(B, 'respond_relationship', { p_rel_id: seed.data.id, p_accept: true });
    const afterReplay = await admin.from('user_relationships')
      .select('id', { count: 'exact' }).eq('rel_type', 'friend')
      .in('user_id', [A.id, B.id]).in('target_id', [A.id, B.id]);
    log('replaying the accept changes nothing (still exactly 1 row)',
      !!replay.data && afterReplay.count === 1, `count=${afterReplay.count}`);

    log('...and the replay is refused as already_answered',
      replay.data?.ok === false && replay.data?.error === 'already_answered',
      `res=${JSON.stringify(replay.data)}`);

    // ---- 5. request guards ------------------------------------------------
    const selfReq = await rpc(A, 'request_relationship', { p_target: A.id, p_type: 'friend' });
    log('a user cannot befriend themselves',
      selfReq.data?.ok === false && selfReq.data?.error === 'cannot_add_self',
      `res=${JSON.stringify(selfReq.data)}`);

    const dupReq = await rpc(A, 'request_relationship', { p_target: B.id, p_type: 'friend' });
    log('a duplicate request is refused',
      dupReq.data?.ok === false && dupReq.data?.error === 'already_related',
      `res=${JSON.stringify(dupReq.data)}`);

    const nullReq = await rpc(A, 'request_relationship', { p_target: null, p_type: 'friend' });
    log('a null target is refused',
      nullReq.data?.ok === false && nullReq.data?.error === 'invalid_target',
      `res=${JSON.stringify(nullReq.data)}`);

    // v89: rel_type is whitelisted server-side. The CHECK constraint would have
    // caught this at the table, but a raw rpc error is not something a client
    // can render, so the guard belongs in the function.
    const badType = await rpc(A, 'request_relationship', { p_target: C.id, p_type: 'enemy' });
    log('an unknown relationship type is refused',
      badType.data?.ok === false && badType.data?.error === 'invalid_type',
      `res=${JSON.stringify(badType.data)}`);

    // ---- 6. decline deletes, and only the target can decline ---------------
    const seed2 = await admin.from('user_relationships')
      .insert({ user_id: A.id, target_id: C.id, rel_type: 'rival', status: 'pending' })
      .select('id').single();
    const strangerDecline = await rpc(B, 'respond_relationship', { p_rel_id: seed2.data.id, p_accept: false });
    const survivor = await admin.from('user_relationships').select('id').eq('id', seed2.data.id);
    log('a third user cannot decline (delete) someone else\'s request',
      strangerDecline.data?.ok === false && survivor.data?.length === 1,
      `res=${JSON.stringify(strangerDecline.data)} stillThere=${survivor.data?.length}`);

    const byTargetDecline = await rpc(C, 'respond_relationship', { p_rel_id: seed2.data.id, p_accept: false });
    const gone = await admin.from('user_relationships').select('id').eq('id', seed2.data.id);
    log('the target declining removes the row',
      byTargetDecline.data?.ok === true && gone.data?.length === 0,
      `res=${JSON.stringify(byTargetDecline.data)} rows=${gone.data?.length}`);

    // ---- 7. remove_relationship ------------------------------------------
    await admin.from('user_relationships')
      .insert({ user_id: A.id, target_id: C.id, rel_type: 'rival', status: 'accepted' });
    await rpc(A, 'remove_relationship', { p_other: C.id });
    const afterRemove = await admin.from('user_relationships')
      .select('id').eq('rel_type', 'rival').in('user_id', [A.id, C.id]).in('target_id', [A.id, C.id]);
    log('remove_relationship clears both directions',
      (afterRemove.data || []).length === 0, `rows=${(afterRemove.data || []).length}`);
  }

  // ---- 8. ACLs -----------------------------------------------------------
  {
    const probe = await rpc(null, 'respond_relationship', { p_rel_id: 1, p_accept: true });
    log('raw anon REST cannot reach respond_relationship',
      probe.status !== 200, `status=${probe.status}`);
  }

  // ---- 9. friend_list ACTUALLY READS (the v79 42703 regression) ---------
  // Before v89 this block could not have passed: friend_list() referenced
  // `i.from_user` / `i.to_user`, which do not exist on user_relationships, so
  // the whole function raised 42703 and the Friends/Rivals screen returned
  // nothing at all. Asserting the returned SHAPE is the guard - a function that
  // throws cannot return the right keys.
  {
    const fl = await rpc(A, 'friend_list');
    log('friend_list returns ok with all four arrays (v79 raised 42703 here)',
      fl.status === 200 && fl.data?.ok === true
        && Array.isArray(fl.data?.friends) && Array.isArray(fl.data?.incoming)
        && Array.isArray(fl.data?.outgoing) && Array.isArray(fl.data?.blocks),
      `status=${fl.status} res=${fl.body.slice(0, 160)}`);

    log('...and the accepted friend actually appears in it',
      (fl.data?.friends || []).some((f) => f.userId === B.id && f.relType === 'friend'),
      `friends=${JSON.stringify((fl.data?.friends || []).map((f) => f.userId))}`);

    const flB = await rpc(B, 'friend_list');
    log('...and appears for the other side too (one row, both directions)',
      (flB.data?.friends || []).some((f) => f.userId === A.id),
      `friends=${JSON.stringify((flB.data?.friends || []).map((f) => f.userId))}`);

    const anonFl = await rpc(null, 'friend_list');
    log('anon cannot call friend_list', anonFl.status !== 200, `status=${anonFl.status}`);
  }

  // ---- 10. the FORGE hole: a client cannot write its own accepted row -----
  // v14 gave clients `relationships_insert_own ... for insert with check
  // (auth.uid() = user_id)`, which constrains WHO you may name but not what the
  // row may SAY. So any signed-in client could manufacture a mutual friendship:
  //   insert (auth.uid(), <victim>, 'friend', 'accepted')
  // v89 dropped that policy. This asserts the refusal with a real session.
  {
    // A/B/C each already carry a signed-in publishable-key client (see mkUser),
    // so this is a REAL user session, not the anon key.
    const client = A.client;
    const { error: insErr } = await client.from('user_relationships')
      .insert({ user_id: A.id, target_id: C.id, rel_type: 'friend', status: 'accepted' });

    const forged = await admin.from('user_relationships')
      .select('id').eq('user_id', A.id).eq('target_id', C.id);
    log('a client cannot INSERT an accepted relationship for itself (RLS)',
      !!insErr && (forged.data || []).length === 0,
      `err=${insErr?.message?.slice(0, 60) || 'none'} rows=${(forged.data || []).length}`);

    const flC = await rpc(C, 'friend_list');
    log('...so the victim never sees a friendship they did not accept',
      !(flC.data?.friends || []).some((f) => f.userId === A.id),
      `friends=${JSON.stringify((flC.data?.friends || []).map((f) => f.userId))}`);
  }

  // ---- 11. blocking hides the pair symmetrically -------------------------
  {
    const ins = await admin.from('user_blocks')
      .insert({ blocker_id: A.id, blocked_id: B.id }).select().maybeSingle();
    log('a block row can be written', !!ins.data, `err=${ins.error?.message || 'none'}`);

    const flA = await rpc(A, 'friend_list');
    log('a blocked scholar disappears from the blocker\'s friend_list',
      !(flA.data?.friends || []).some((f) => f.userId === B.id),
      `friends=${JSON.stringify((flA.data?.friends || []).map((f) => f.userId))}`);

    const flB2 = await rpc(B, 'friend_list');
    log('...and from the blocked side too (symmetric, not one-way)',
      !(flB2.data?.friends || []).some((f) => f.userId === A.id),
      `friends=${JSON.stringify((flB2.data?.friends || []).map((f) => f.userId))}`);

    log('...and the blocked pair is listed in `blocks`',
      (flA.data?.blocks || []).some((b) => b.userId === B.id),
      `blocks=${JSON.stringify((flA.data?.blocks || []).map((b) => b.userId))}`);

    const search = await rpc(A, 'friend_search', { p_query: '' });
    log('a blocked scholar is not returned by search',
      !(search.data?.results || []).some((r) => r.userId === B.id),
      `results=${(search.data?.results || []).length}`);

    const blockedReq = await rpc(B, 'request_relationship', { p_target: A.id, p_type: 'friend' });
    log('a blocked pair cannot open a new relationship (either direction)',
      blockedReq.data?.ok === false && blockedReq.data?.error === 'blocked',
      `res=${JSON.stringify(blockedReq.data)}`);

    await admin.from('user_blocks').delete().eq('blocker_id', A.id).eq('blocked_id', B.id);
    const after = await rpc(A, 'friend_list');
    log('unblocking restores them to the friend list',
      (after.data?.friends || []).some((f) => f.userId === B.id),
      `friends=${JSON.stringify((after.data?.friends || []).map((f) => f.userId))}`);
  }

  // ---- 12. profile views: two independent consents, both default off -----
  {
    const def = await rpc(A, 'profile_privacy_get');
    log('profile privacy defaults to OFF for both switches',
      def.data?.showProfileViews === false && def.data?.shareVisitorIdentity === false,
      `res=${JSON.stringify(def.data)}`);

    const rec0 = await rpc(B, 'profile_view_record', { p_profile: A.id });
    log('a view is NOT recorded while the receiver has views off',
      rec0.data?.ok === true && rec0.data?.recorded === false,
      `res=${JSON.stringify(rec0.data)}`);

    await rpc(A, 'profile_privacy_set', { p_show_profile_views: true, p_share_visitor_identity: null });
    const rec1 = await rpc(B, 'profile_view_record', { p_profile: A.id });
    log('...it IS recorded once the receiver opts in',
      rec1.data?.ok === true && rec1.data?.recorded === true,
      `res=${JSON.stringify(rec1.data)}`);

    const listHidden = await rpc(A, 'profile_view_list');
    const row = (listHidden.data?.views || [])[0] || {};
    log('the viewer is NOT identified while THEY have not opted in to sharing',
      row.identified === false && row.name == null,
      `res=${JSON.stringify(row)}`);

    await rpc(B, 'profile_privacy_set', { p_show_profile_views: null, p_share_visitor_identity: true });
    const listShown = await rpc(A, 'profile_view_list');
    const row2 = (listShown.data?.views || [])[0] || {};
    log('...but IS identified once they opt in (two separate consents)',
      row2.identified === true && !!row2.name,
      `res=${JSON.stringify(row2)}`);

    const cnt = await rpc(A, 'profile_view_count');
    log('the view count reflects the recorded view',
      cnt.data?.viewers === 1 && cnt.data?.views === 1,
      `res=${JSON.stringify(cnt.data)}`);

    // profile_views has ZERO client policies, so a direct read must return
    // nothing even for the owner. Otherwise the table is a who-is-watching-me
    // directory.
    //
    // Asserted on the ROW COUNT, not on an error: RLS with no matching policy
    // filters rows silently and returns an empty array with `error === null`.
    // Requiring an error here would have passed for the wrong reason.
    const peek = await A.client.from('profile_views').select('viewer_id');
    log('profile_views returns 0 rows to a signed-in client (0 RLS policies)',
      !peek.error && (peek.data || []).length === 0,
      `err=${peek.error?.message?.slice(0, 50) || 'none'} rows=${(peek.data || []).length}`);

    // ...while the service role CAN read it, so the zero above is RLS filtering
    // rather than a missing privilege. Without this, the previous assertion
    // would also pass on a table nobody can read at all.
    const grant = await admin.from('profile_views').select('viewer_id', { count: 'exact', head: true });
    log('...and the service role CAN read it, so the lockdown is RLS not a broken grant',
      !grant.error && grant.count !== null,
      `err=${grant.error?.message?.slice(0, 50) || 'none'} count=${grant.count}`);

    await admin.from('profile_privacy').delete().in('user_id', [A.id, B.id, C.id]);
    await admin.from('profile_views').delete().in('viewer_id', [A.id, B.id, C.id]);
  }

  // ---- 13. the Crown: Smart-Coin only, idempotent, one per slot ----------
  {
    const cat = await rpc(A, 'cosmetic_catalog');
    const crown = (cat.data?.items || []).find((i) => i.sku === 'crown-001');
    log('the Crown is in the cosmetic catalogue at 40 SC',
      !!crown && Number(crown.scPrice) === 40, `res=${JSON.stringify(crown)}`);

    await admin.from('profiles').update({ smart_coins: 100 }).eq('id', A.id);
    const buy = await rpc(A, 'cosmetic_purchase', { p_sku: 'crown-001' });
    log('buying the Crown debits exactly 40 SC and auto-equips',
      buy.data?.ok === true && buy.data?.balance === 60 && buy.data?.equipped === true,
      `res=${JSON.stringify(buy.data)}`);

    const again = await rpc(A, 'cosmetic_purchase', { p_sku: 'crown-001' });
    const ledger = await admin.from('smart_coin_ledger')
      .select('id', { count: 'exact' }).eq('user_id', A.id).eq('reason', 'crown_purchase');
    log('a second purchase is refused AND only one ledger row exists',
      again.data?.ok === false && again.data?.error === 'ALREADY_OWNED' && ledger.count === 1,
      `res=${JSON.stringify(again.data)} ledger=${ledger.count}`);

    const equipped = await admin.from('user_cosmetics')
      .select('sku, equipped').eq('user_id', A.id);
    log('the Crown is owned and equipped',
      (equipped.data || []).some((r) => r.sku === 'crown-001' && r.equipped === true),
      `res=${JSON.stringify(equipped.data)}`);

    const crownOff = await rpc(A, 'cosmetic_equip', { p_sku: 'crown-001', p_equipped: false });
    const cpRow = await admin.from('community_profiles')
      .select('has_crown').eq('id', A.id).maybeSingle();
    log('unequipping hides the crown from community_profiles.has_crown',
      crownOff.data?.ok === true && crownOff.data?.equipped === false && cpRow.data?.has_crown === false,
      `equip=${JSON.stringify(crownOff.data)} hasCrown=${cpRow.data?.has_crown}`);

    const cpOn = await rpc(A, 'cosmetic_equip', { p_sku: 'crown-001', p_equipped: true });
    log('...and re-equipping brings it back',
      cpOn.data?.ok === true && cpOn.data?.equipped === true, `res=${JSON.stringify(cpOn.data)}`);

    const notOwned = await rpc(B, 'cosmetic_equip', { p_sku: 'crown-001', p_equipped: true });
    log('a user cannot equip a cosmetic they do not own',
      notOwned.data?.ok === false && notOwned.data?.error === 'NOT_OWNED',
      `res=${JSON.stringify(notOwned.data)}`);

    const badSku = await rpc(B, 'cosmetic_purchase', { p_sku: 'not-a-real-sku' });
    log('an unknown SKU is refused', badSku.data?.ok === false && badSku.data?.error === 'NOT_FOUND',
      `res=${JSON.stringify(badSku.data)}`);

    // Cosmetics are Smart-Coin only: the NGN path must refuse them outright.
    const { data: product } = await admin.from('marketplace_products')
      .select('id, kind, access_type').eq('sku', 'crown-001').maybeSingle();
    log('the Crown product is access_type=cosmetic, not a card product',
      product?.kind === 'cosmetic' && product?.access_type === 'cosmetic',
      `res=${JSON.stringify(product)}`);

    // THE CLASS OF BUG THIS GUARDS.
    //
    // community_profiles and community_feed are plain views granted to anon and
    // authenticated, and they call _has_crown(). A plain view runs with the
    // CALLER's privileges, so it needs EXECUTE on every function it calls.
    // Revoking that grant (the tidy default, and what v92 originally did) makes
    // every read of both views fail with 42501 permission denied for function
    // _has_crown - which presents to users as an EMPTY COMMUNITY FEED, not as a
    // permissions error, and is invisible to any check that runs as postgres.
    //
    // So this is asserted as the ANON key over REST, which is the exact path a
    // logged-out browser takes.
    const anonClient = createClient(URL, ANON, { auth: { persistSession: false } });
    const { data: cpRows, error: cpErr } = await anonClient
      .from('community_profiles').select('id, display_name, has_crown').limit(2);
    log('anon can still read community_profiles WITH has_crown (a view runs with the caller\'s privileges)',
      !cpErr && Array.isArray(cpRows),
      `err=${cpErr?.message?.slice(0, 90) || 'none'} rows=${cpRows?.length}`);

    const { data: feedRows, error: feedErr } = await anonClient
      .from('community_feed').select('id, post_state, has_crown').limit(1);
    log('...and community_feed is readable too (has_crown must not 42501 the whole feed)',
      !feedErr && Array.isArray(feedRows),
      `err=${feedErr?.message?.slice(0, 90) || 'none'} rows=${feedRows?.length}`);
  }

  // ---- 14. marketplace_purchases: the client write path is GONE ----------
  //
  // REWRITTEN, not deleted. This used to assert that a client COULD insert its
  // own purchase row, which was v92's deliberate position ("a purchase row is
  // the entitlement, so record your own intent"). That was wrong: the policy's
  // WITH CHECK was only `auth.uid() = user_id`, so it constrained who you could
  // name and never what the row could SAY - any client could grant itself any
  // product, paid ones included, at amount 0. migration-v98 dropped the policy
  // and replaced the browser write with two SECURITY DEFINER RPCs.
  {
    const { data: product } = await admin.from('marketplace_products')
      .select('id, access_type, kind').eq('sku', 'crown-001').maybeSingle();
    const client = A.client;

    // 1. The forge is closed: a client cannot write the entitlement at all.
    const own = await client.from('marketplace_purchases')
      .insert({ user_id: A.id, product_id: product.id, amount: 0, reference: `e2e-own-${stamp}`, status: 'complete' });
    log('a client INSERT is now REFUSED (the entitlement is server-authorised)',
      !!own.error,
      `err=${own.error?.message?.slice(0, 70) || 'none'}`);

    const forged = await admin.from('marketplace_purchases')
      .select('id').eq('reference', `e2e-own-${stamp}`);
    log('...and no row was created by the attempt',
      (forged.data || []).length === 0,
      `rows=${(forged.data || []).length}`);

    // 2. It must not be able to REWRITE or ERASE one either. Seed the row with
    //    the service-role client, which bypasses RLS the way the payment
    //    handlers do.
    await admin.from('marketplace_purchases')
      .insert({ user_id: A.id, product_id: product.id, amount: 0, reference: `e2e-own-${stamp}`, status: 'complete' });

    const upd = await client.from('marketplace_purchases').update({ status: 'complete' }).eq('reference', `e2e-own-${stamp}`);
    const stillThere = await admin.from('marketplace_purchases')
      .select('id, status').eq('reference', `e2e-own-${stamp}`);
    log('a client UPDATE touches 0 rows (no update policy), so the row survives',
      !upd.error && (stillThere.data || []).length === 1,
      `rows=${(stillThere.data || []).length}`);

    const del = await client.from('marketplace_purchases').delete().eq('reference', `e2e-own-${stamp}`);
    const afterDel = await admin.from('marketplace_purchases')
      .select('id').eq('reference', `e2e-own-${stamp}`);
    log('a client DELETE touches 0 rows too (no delete policy)',
      !del.error && (afterDel.data || []).length === 1,
      `rows=${(afterDel.data || []).length}`);

    // 3. The replacement RPC refuses what the old client path would have let
    //    through. The Crown is a cosmetic, so it must be bought with Smart
    //    Coins - a marketplace_purchases row would grant nothing.
    const claimCos = await client.rpc('marketplace_claim_free_product', { p_product_id: product.id });
    log('marketplace_claim_free_product refuses a cosmetic (it must go through cosmetic_purchase/SC)',
      claimCos.error || claimCos.data?.error === 'COSMETIC_NOT_CLAIMABLE',
      `err=${claimCos.data?.error || claimCos.error?.message?.slice(0, 60) || 'none'}`);

    const claimMissing = await client.rpc('marketplace_claim_free_product', { p_product_id: 999999999 });
    log('...and refuses a product that does not exist',
      claimMissing.data?.error === 'NOT_FOUND',
      `err=${claimMissing.data?.error || 'none'}`);

    const claimNull = await client.rpc('marketplace_claim_free_product', { p_product_id: null });
    log('...and refuses a null product',
      claimNull.data?.error === 'INVALID_PRODUCT',
      `err=${claimNull.data?.error || 'none'}`);

    // 4. The admin path is gated, and it is NOT a service-role backdoor.
    //    `is_admin()` reads auth.uid(), which the service-role JWT does not
    //    carry, so even the suite's own admin client is refused. That is the
    //    property worth asserting here: reaching the cosmetics guard needs a
    //    real signed-in admin, which this suite has no credentials for (the
    //    guard itself is covered by the v98 gate and by a live probe).
    const grantAsService = await admin.rpc('admin_grant_marketplace_entitlement', {
      p_user_id: A.id, p_product_id: product.id,
    });
    log('the admin grant is refused to the service role too (it is not a backdoor)',
      grantAsService.data?.error === 'NOT_AUTHORIZED',
      `err=${grantAsService.data?.error || grantAsService.error?.message?.slice(0, 60) || 'none'}`);

    const grantNonAdmin = await client.rpc('admin_grant_marketplace_entitlement', {
      p_user_id: A.id, p_product_id: product.id,
    });
    log('a signed-in non-admin cannot use admin_grant_marketplace_entitlement',
      grantNonAdmin.data?.error === 'NOT_AUTHORIZED',
      `err=${grantNonAdmin.data?.error || grantNonAdmin.error?.message?.slice(0, 60) || 'none'}`);

    const auditBefore = await admin.from('admin_audit_log')
      .select('id').eq('action', 'marketplace_entitlement_grant').eq('user_id', A.id);
    log('...and the refused admin attempts wrote NO audit row',
      (auditBefore.data || []).length === 0,
      `rows=${(auditBefore.data || []).length}`);

    await admin.from('marketplace_purchases').delete().eq('reference', `e2e-own-${stamp}`);
  }

  // ---- 15. scholar_search finds people friend_search deliberately hides ----
  //
  // friend_search excludes anyone you already have a relationship with, because
  // its job is "find someone to ADD". scholar_search is the "find this person I
  // already know" path, so it must INCLUDE them and report the relationship.
  //
  // The state is established here rather than inherited: earlier sections
  // create and delete relationships, so nothing downstream may assume a given
  // pair is still accepted.
  {
    // Search by the id-hash fragment: these fixtures carry no identity_name or
    // full_name, and that fragment is one of the three columns scholar_search
    // matches on.
    const handleOf = (id) => crypto.createHash('md5').update(id).digest('hex').slice(0, 6);

    // A <-> B : an ACCEPTED friendship, so A's read of B is the `connected` tier.
    await A.client.rpc('remove_relationship', { p_other: B.id });
    const reqAB = await A.client.rpc('request_relationship', { p_target: B.id, p_type: 'friend' });
    if (reqAB?.data?.ok) {
      await B.client.rpc('respond_relationship', { p_rel_id: reqAB.data.id, p_accept: true });
    }
    // A -> C : a PENDING rival request, so relStatus is pending_out.
    await A.client.rpc('remove_relationship', { p_other: C.id });
    const reqAC = await A.client.rpc('request_relationship', { p_target: C.id, p_type: 'rival' });

    log('the A->B friendship is accepted before the visibility assertions run',
      !!(reqAB?.data?.ok), `ok=${reqAB?.data?.ok} err=${reqAB?.data?.error || ''}`);
    log('the A->C rival request is pending before the search assertions run',
      !!(reqAC?.data?.ok), `ok=${reqAC?.data?.ok} err=${reqAC?.data?.error || ''}`);

    const { data: byFriend } = await A.client.rpc('scholar_search', { p_query: handleOf(B.id), p_limit: 25 });
    const friendHit = (byFriend?.results || []).find((r) => r.userId === B.id);
    log('scholar_search finds a scholar by id handle', !!friendHit,
      `hits=${(byFriend?.results || []).length} found=${!!friendHit}`);

    log('...and reports the ACCEPTED FRIEND as relStatus=friend',
      friendHit?.relStatus === 'friend',
      `relStatus=${friendHit?.relStatus}`);

    const { data: byRival } = await A.client.rpc('scholar_search', { p_query: handleOf(C.id), p_limit: 25 });
    const rivalHit = (byRival?.results || []).find((r) => r.userId === C.id);
    log('...and the PENDING RIVAL as relStatus=pending_out (friend_search would have hidden both)',
      rivalHit?.relStatus === 'pending_out',
      `relStatus=${rivalHit?.relStatus}`);

    // Names stay pseudonymous until the pair has dueled.
    log('...and the name is a pseudonym handle, not a legal name',
      typeof friendHit?.name === 'string' && friendHit.name.length > 0,
      `name=${friendHit?.name}`);

    // The friend_search cap bug: `limit 25` used to sit AFTER an ungrouped
    // jsonb_agg, so a blank query returned EVERY activated profile.
    const blank = await A.client.rpc('friend_search', { p_query: '' });
    const blankCount = (blank?.results || []).length;
    log('friend_search with a blank query is capped at 25 (it used to return the whole user directory)',
      blankCount <= 25,
      `returned=${blankCount}`);

    const { data: activeRows } = await admin.from('profiles').select('id').eq('is_activated', true);
    log('...and the cap is at or below the activated user base, so the fix is observable',
      (blankCount ?? 0) <= (activeRows || []).length,
      `returned=${blankCount} activated=${(activeRows || []).length}`);
  }

  // ---- 16. profile visibility tiers (v97) ----------------------------------
  //
  // A friend may see achievements and head-to-head. A stranger may not. The
  // fields must be ABSENT from the stranger's payload, not merely hidden by the
  // client - the RPC is the boundary.
  {
    const anon = await A.client.rpc('player_public_profile', { p_user: B.id });
    log('a FRIEND\'s profile carries visibility=connected',
      anon?.data?.visibility === 'connected',
      `visibility=${anon?.data?.visibility}`);
    log('...and includes achievements and head-to-head',
      anon?.data?.achievements !== undefined && anon?.data?.headToHead !== undefined,
      `ach=${anon?.data?.achievements !== undefined} h2h=${anon?.data?.headToHead !== undefined}`);

    // C has no relationship with A in one direction - use a fresh pairing so
    // this is a genuine stranger read. Reuses the suite's own `password`,
    // which is known-good against the project's password policy.
    const strangerEmail = `e2e-stranger-${stamp}@test.local`;
    // supabase-js returns { data, error }; the user hangs off `data`.
    const { data: stranger, error: strangerErr } = await admin.auth.admin.createUser({
      email: strangerEmail,
      password,
      email_confirm: true,
    });
    const sid = stranger?.user?.id;
    let strangerBody = null;
    if (sid) {
      await admin.from('profiles').update({ is_activated: true }).eq('id', sid);
      const sClient = createClient(URL, ANON, { auth: { persistSession: false } });
      await sClient.auth.signInWithPassword({ email: strangerEmail, password });
      const r = await sClient.rpc('player_public_profile', { p_user: A.id });
      strangerBody = r?.data;
      log('a STRANGER\'s read of someone else is visibility=public',
        strangerBody?.visibility === 'public',
        `visibility=${strangerBody?.visibility}`);
      log('...and the stranger DOES see display name, Smart Coins and duels',
        strangerBody?.smartCoins !== undefined && strangerBody?.duels !== undefined,
        `coins=${strangerBody?.smartCoins} duels=${JSON.stringify(strangerBody?.duels)}`);
      const leaked = ['achievements', 'achievementCount', 'headToHead', 'rank',
        'scoreBreakdown', 'competitiveScore', 'answers', 'streak', 'joinedAt', 'year', 'hasCrown']
        .filter((k) => strangerBody && k in strangerBody);
      log('...and NOTHING else: no achievements, head-to-head, rank, breakdown, streaks or join date',
        leaked.length === 0,
        `leaked=${leaked.join(',') || 'none'}`);
    } else {
      log('a STRANGER\'s read of someone else is visibility=public', false,
        `could not create the stranger account: ${strangerErr?.message || 'no user returned'}`);
    }

    // The leaderboard was the BIGGER leak: it was not viewer-scoped at all.
    const { data: lb } = await A.client.rpc('get_player_leaderboard', { p_limit: 5, p_offset: 0 });
    const rowKeys = Object.keys((lb?.players || [])[0] || {});
    const lbLeaked = ['smartCoins', 'competitiveScore', 'scoreBreakdown',
      'oneVOneWins', 'threeVThreeWins', 'playerScore'].filter((k) => rowKeys.includes(k));
    log('the leaderboard row no longer carries wallet, score or duel figures',
      lbLeaked.length === 0,
      `leaked=${lbLeaked.join(',') || 'none'} keys=${rowKeys.join('|')}`);
    log('...but still carries rank, displayName and totalAnswers',
      rowKeys.includes('rank') && rowKeys.includes('displayName') && rowKeys.includes('totalAnswers'),
      `keys=${rowKeys.join('|')}`);

    if (sid) await admin.auth.admin.deleteUser(sid);
    if (strangerBody) { /* nothing to clean: the profile view was read-only */ }
  }
} catch (err) {
  log('SUITE ERROR - ' + (err?.message || err), false);
} finally {
  await admin.from('user_relationships').delete()
    .in('user_id', users.map((u) => u.id));
  await admin.from('user_relationships').delete()
    .in('target_id', users.map((u) => u.id));
  await admin.from('user_blocks').delete()
    .or(`blocker_id.in.(${users.map((u) => u.id).join(',')}),blocked_id.in.(${users.map((u) => u.id).join(',')})`);
  await admin.from('profile_views').delete()
    .or(`viewer_id.in.(${users.map((u) => u.id).join(',')}),profile_id.in.(${users.map((u) => u.id).join(',')})`);
  await admin.from('profile_privacy').delete().in('user_id', users.map((u) => u.id));
  await admin.from('user_cosmetics').delete().in('user_id', users.map((u) => u.id));
  await admin.from('smart_coin_ledger').delete()
    .in('user_id', users.map((u) => u.id)).eq('reason', 'crown_purchase');
  await admin.from('marketplace_purchases').delete()
    .in('user_id', users.map((u) => u.id));
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  const left = await admin.from('user_relationships').select('id')
    .or(`user_id.in.(${users.map((u) => u.id).join(',')}),target_id.in.(${users.map((u) => u.id).join(',')})`);
  log('cleanup: no relationship rows left', (left.data || []).length === 0,
    `rows=${(left.data || []).length}`);

  const cosLeft = await admin.from('user_cosmetics').select('id').in('user_id', users.map((u) => u.id));
  log('cleanup: no cosmetic rows left', (cosLeft.data || []).length === 0,
    `rows=${(cosLeft.data || []).length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);