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

    // ---- 4. the target accepts, and the mirror row is created -------------
    const byTarget = await rpc(B, 'respond_relationship', { p_rel_id: seed.data.id, p_accept: true });
    log('the target CAN accept the request', byTarget.data?.ok === true,
      `res=${JSON.stringify(byTarget.data)}`);

    const both = await admin.from('user_relationships')
      .select('user_id, target_id, status').eq('rel_type', 'friend')
      .in('user_id', [A.id, B.id]).in('target_id', [A.id, B.id]);
    const accepted = (both.data || []).filter((r) => r.status === 'accepted');
    log('accepting creates the mirror row (mutual relationship)',
      accepted.length === 2, `acceptedRows=${accepted.length}`);

    // Replay must not duplicate.
    const replay = await rpc(B, 'respond_relationship', { p_rel_id: seed.data.id, p_accept: true });
    const afterReplay = await admin.from('user_relationships')
      .select('id', { count: 'exact' }).eq('rel_type', 'friend')
      .in('user_id', [A.id, B.id]).in('target_id', [A.id, B.id]);
    log('replaying the accept is idempotent (still exactly 2 rows)',
      !!replay.data && afterReplay.count === 2, `count=${afterReplay.count}`);

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
} catch (err) {
  log('SUITE ERROR - ' + (err?.message || err), false);
} finally {
  await admin.from('user_relationships').delete()
    .in('user_id', users.map((u) => u.id));
  for (const u of users) await admin.auth.admin.deleteUser(u.id);
  const left = await admin.from('user_relationships').select('id')
    .in('user_id', users.map((u) => u.id));
  log('cleanup: no relationship rows left', (left.data || []).length === 0,
    `rows=${(left.data || []).length}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);