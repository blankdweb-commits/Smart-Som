// API-level e2e for the Anonymous Live Events router (LE-0 .. LE-5).
//
// Exercises api/community.js's REAL router (mock req/res) against the live DB:
//   LE-0  every refusal is { error: <CODE>, message: <text> }
//   LE-1  deadlines live on a minute grid, and are frozen once an event is live
//   LE-2  `status` is NOT editable through update
//   LE-3  a draft is invisible to non-admins; a busy room shows the NEWEST 50
//   LE-4  the lifecycle only moves through publish / start / cancel / close
//   LE-5  a missing server key is 503 SERVER_CONFIG; a failed admin lookup is
//         503 ADMIN_LOOKUP_UNAVAILABLE (never a misleading 403)
//
// The service-role client is kept PURE (no GoTrue sign-in on it).
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import communityHandler from '../api/community.js';
import { handleListLiveEvents } from '../api/_community.js';

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' — ' + detail : ''}`);
};
const section = (t) => console.log(`\n--- ${t} ---`);

const env = loadEnv();
// LE-5 — either the legacy service_role JWT or the new secret key.
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const URL = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;

// The handlers read process.env at call time, so the whole app sees the same
// environment the suite runs in.
process.env.VITE_SUPABASE_URL = URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;

const admin = createClient(URL, SERVICE_KEY);
const pub = createClient(URL, PUBLISHABLE);
const stamp = Date.now().toString(36).slice(-6);
const createdUserIds = [];
const createdEventIds = [];

const mockRes = () => {
  const r = { statusCode: 200, bodySent: null, headers: {} };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (body) => { r.bodySent = body; return r; };
  r.end = (body) => { if (body) r.bodySent = body; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
};

// Calls the real community router for a Live Events sub-path.
const call = async (path, token, body = {}) => {
  const req = {
    method: 'POST',
    url: `/api/community/live-events${path}`,
    headers: { authorization: token ? `Bearer ${token}` : '' },
    body,
  };
  const res = mockRes();
  try {
    await communityHandler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.bodySent = { error: err?.message || String(err) };
  }
  return { status: res.statusCode, body: res.bodySent };
};

const makeUser = async (role) => {
  const email = `lev${role}${stamp}${Math.random().toString(36).slice(2, 5)}@apextest.local`;
  const password = 'E2E-Live-Events-Pass!1';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${role}): ${error.message}`);
  createdUserIds.push(data.user.id);
  const { error: upErr } = await admin
    .from('profiles')
    .update({ role, is_activated: true })
    .eq('id', data.user.id);
  if (upErr) throw new Error(`set role ${role}: ${upErr.message}`);
  const { data: prof } = await admin.from('profiles').select('id, role').eq('id', data.user.id).maybeSingle();
  if (!prof) throw new Error(`no profiles row for ${data.user.id} — cannot verify the admin gate`);
  if (prof.role !== role) throw new Error(`role not applied for ${data.user.id}: ${prof.role} != ${role}`);
  const client = createClient(URL, PUBLISHABLE);
  const { error: siErr } = await client.auth.signInWithPassword({ email, password });
  if (siErr) throw new Error(`signIn(${role}): ${siErr.message}`);
  const token = client.auth.getSession()?.data?.session?.access_token
    || (await client.auth.getSession()).data.session.access_token;
  return { id: data.user.id, email, token };
};

// A window that starts in the future — `effectiveStatus` promotes a scheduled
// event whose start_at has passed to 'live', which would change the contract
// under test.
const futureWindow = (minutesFromNow = 60) => {
  const start = new Date(Date.now() + minutesFromNow * 60 * 1000);
  const end = new Date(Date.now() + (minutesFromNow + 30) * 60 * 1000);
  const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { start_at: iso(start), end_at: iso(end) };
};

const cleanup = async () => {
  // Prefix-based on purpose: a crashed run still leaves its events behind, and
  // the next run must not inherit them.
  const { data: events } = await admin.from('live_events').select('id').like('title', 'LE-E2E %');
  for (const ev of events || []) {
    try {
      const { data: msgs } = await admin.from('live_event_messages').select('id').eq('event_id', ev.id);
      const ids = (msgs || []).map((m) => m.id);
      if (ids.length) await admin.from('live_event_reactions').delete().in('message_id', ids);
      await admin.from('live_event_messages').delete().eq('event_id', ev.id);
      await admin.from('live_events').delete().eq('id', ev.id);
    } catch (err) {
      console.error('cleanup error', err?.message || err);
    }
  }
  for (const id of createdUserIds) {
    try {
      await admin.auth.admin.deleteUser(id);
    } catch (err) {
      console.error('cleanup user error', err?.message || err);
    }
  }
};

try {
  // =====================================================================
  section('P1  preflight: the service key and the schema must both work');

  const preflight = await fetch(`${URL}/rest/v1/live_events?select=id&limit=1`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!preflight.ok) {
    const body = await preflight.text().catch(() => '');
    console.error('\nFATAL: the service key cannot read the Live Events schema.');
    console.error(`  URL:  ${URL}`);
    console.error(`  Key:  ${String(SERVICE_KEY).slice(0, 12)}… (${String(SERVICE_KEY).length} chars)`);
    console.error(`  HTTP: ${preflight.status} ${preflight.statusText}`);
    console.error(`  Body: ${body.slice(0, 400)}`);
    console.error('\nThe key is rejected by PostgREST. A Supabase secret key (sb_secret_…)');
    console.error('and the legacy service_role JWT are different credentials — one of');
    console.error('them was revoked or rotated. Put a working key back in .env and re-run.');
    console.error('Everything below needs that key, so there is nothing to prove without it.');
    process.exit(1);
  }
  log('the service key can read live_events (REST 200)', true);

  const { data: rpcCheck, error: rpcErr } = await admin.rpc('live_event_close', { p_event: '00000000-0000-0000-0000-000000000000' });
  log(
    'the live_event_close RPC exists (schema applied)',
    !rpcErr,
    rpcErr ? `${rpcErr.code || ''} ${rpcErr.message}`.slice(0, 160) : `not_found=${rpcCheck?.code === 'NOT_FOUND'}`,
  );

  // =====================================================================
  section('P2  LE-0: the error contract');

  const adminUser = await makeUser('admin');
  const memberUser = await makeUser('student');
  log('an admin and a plain member exist', !!adminUser.token && !!memberUser.token);

  const unauth = await call('/list', null);
  log(
    'unauthenticated list = 401 with a code and a message',
    unauth.status === 401 && !!unauth.body?.error && !!unauth.body?.message,
    `status=${unauth.status} error=${unauth.body?.error}`,
  );
  log('the refusal code is canonical (not a free-text string)', /^[A-Z][A-Z0-9_]*$/.test(unauth.body?.error || ''), unauth.body?.error);

  const badPath = await call('/nope', adminUser.token);
  log(
    'an unknown live-events endpoint = 404 with a code',
    badPath.status === 404 && !!badPath.body?.error,
    `status=${badPath.status} error=${badPath.body?.error}`,
  );

  // =====================================================================
  section('P3  LE-5: the admin gate');

  const memberCreate = await call('/create', memberUser.token, { title: 'LE member draft', description: 'must be refused' });
  log(
    'a non-admin create = 403 NOT_AUTHORIZED',
    memberCreate.status === 403 && memberCreate.body?.error === 'NOT_AUTHORIZED',
    `status=${memberCreate.status} error=${memberCreate.body?.error}`,
  );

  const memberPublish = await call('/publish', memberUser.token, { event_id: '00000000-0000-0000-0000-000000000000' });
  log(
    'a non-admin publish = 403 NOT_AUTHORIZED (checked BEFORE the event exists)',
    memberPublish.status === 403 && memberPublish.body?.error === 'NOT_AUTHORIZED',
    `status=${memberPublish.status} error=${memberPublish.body?.error}`,
  );

  // =====================================================================
  section('P4  LE-2/LE-3: creation, draft visibility, status is not editable');

  const draftRes = await call('/create', adminUser.token, {
    title: `LE-E2E ${stamp} main`,
    description: 'created by the live-events e2e',
  });
  const draftId = draftRes.body?.event?.id;
  createdEventIds.push(draftId);
  log(
    'an admin create = 200 and the event is a DRAFT',
    draftRes.status === 200 && draftRes.body?.event?.status === 'draft',
    `status=${draftRes.status} event=${draftRes.body?.event?.status}`,
  );

  const statusEdit = await call('/update', adminUser.token, { event_id: draftId, title: 'LE-E2E renamed', status: 'live' });
  log(
    'update with status:"live" does NOT move the event (status is not editable)',
    statusEdit.status === 200 && statusEdit.body?.event?.status === 'draft',
    `status=${statusEdit.status} event=${statusEdit.body?.event?.status}`,
  );

  const adminList = await call('/list', adminUser.token);
  log(
    'an admin list CONTAINS the draft',
    adminList.status === 200 && (adminList.body?.events || []).some((e) => e.id === draftId),
    `events=${(adminList.body?.events || []).length}`,
  );
  const memberList = await call('/list', memberUser.token);
  log(
    'a non-admin list does NOT contain the draft',
    memberList.status === 200 && !(memberList.body?.events || []).some((e) => e.id === draftId),
    `events=${(memberList.body?.events || []).length}`,
  );

  const invalidTime = await call('/update', adminUser.token, { event_id: draftId, start_at: 'not-a-time' });
  log(
    'an unreadable deadline = 400 INVALID_TIME',
    invalidTime.status === 400 && invalidTime.body?.error === 'INVALID_TIME',
    `status=${invalidTime.status} error=${invalidTime.body?.error}`,
  );

  const publishNoWindow = await call('/publish', adminUser.token, { event_id: draftId });
  log(
    'publish without a window = 400 SCHEDULE_WINDOW_REQUIRED',
    publishNoWindow.status === 400 && publishNoWindow.body?.error === 'SCHEDULE_WINDOW_REQUIRED',
    `status=${publishNoWindow.status} error=${publishNoWindow.body?.error}`,
  );

  const win = futureWindow();
  const withWindow = await call('/update', adminUser.token, { event_id: draftId, ...win });
  log(
    'update with a window = 200 and both deadlines land on a minute',
    withWindow.status === 200
      && new Date(withWindow.body?.event?.start_at || 0).getUTCSeconds() === 0
      && new Date(withWindow.body?.event?.end_at || 0).getUTCSeconds() === 0,
    `start=${withWindow.body?.event?.start_at} end=${withWindow.body?.event?.end_at}`,
  );

  const publishRes = await call('/publish', adminUser.token, { event_id: draftId });
  log(
    'publish = 200 and the event is scheduled',
    publishRes.status === 200 && publishRes.body?.event?.status === 'scheduled',
    `status=${publishRes.status} event=${publishRes.body?.event?.status}`,
  );

  const memberList2 = await call('/list', memberUser.token);
  log(
    'a non-admin list now CONTAINS the scheduled event (only drafts are hidden)',
    memberList2.status === 200 && (memberList2.body?.events || []).some((e) => e.id === draftId),
    `events=${(memberList2.body?.events || []).length}`,
  );

  // =====================================================================
  section('P4b  LE-6: the writes are LIVE-ONLY, and the server decides');

  // The event is SCHEDULED right now (start_at is 60 minutes out). The room
  // read advertises can_write=false for it, so the server must refuse the
  // write too - the client is not an authority.
  const scheduledSend = await call('/send', memberUser.token, { event_id: draftId, content: 'too early' });
  log(
    'sending to a SCHEDULED event = 403 EVENT_NOT_LIVE',
    scheduledSend.status === 403 && scheduledSend.body?.error === 'EVENT_NOT_LIVE',
    `status=${scheduledSend.status} error=${scheduledSend.body?.error}`,
  );
  log(
    'the refusal carries a human message, not a bare code',
    typeof scheduledSend.body?.message === 'string' && scheduledSend.body.message.length > 10,
    scheduledSend.body?.message,
  );

  const scheduledGet = await call('/get', memberUser.token, { event_id: draftId });
  log(
    'the refused write wrote NOTHING (the scheduled event has no messages)',
    (scheduledGet.body?.messages || []).length === 0,
    `messages=${(scheduledGet.body?.messages || []).length}`,
  );
  log(
    'get reports can_write=false for a scheduled event',
    scheduledGet.body?.can_write === false,
    `can_write=${scheduledGet.body?.can_write}`,
  );

  // A reaction is a write too: plant a message directly (service role) so the
  // reaction path has a parent message to refuse.
  const { data: planted, error: plantErr } = await admin
    .from('live_event_messages')
    .insert({ event_id: draftId, author_id: memberUser.id, author_alias: 'Plant', content: 'planted' })
    .select('id')
    .maybeSingle();
  log('a message was planted into the scheduled event (service role)', !plantErr && !!planted?.id, plantErr?.message || '');

  if (planted?.id) {
    const scheduledReact = await call('/react', memberUser.token, { message_id: planted.id, emoji: '👍', active: true });
    log(
      'reacting inside a SCHEDULED event = 403 EVENT_NOT_LIVE',
      scheduledReact.status === 403 && scheduledReact.body?.error === 'EVENT_NOT_LIVE',
      `status=${scheduledReact.status} error=${scheduledReact.body?.error}`,
    );
    const { data: reactionRows } = await admin
      .from('live_event_reactions')
      .select('id')
      .eq('message_id', planted.id);
    log(
      'the refused reaction wrote NOTHING',
      (reactionRows || []).length === 0,
      `reactions=${(reactionRows || []).length}`,
    );
    // Remove the planted row so the P6 window check keeps its own arithmetic.
    await admin.from('live_event_messages').delete().eq('id', planted.id);
  }

  // =====================================================================
  section('P5  LE-1/LE-4: start, the minute grid, and the deadline lock');

  const startRes = await call('/start', adminUser.token, { event_id: draftId });
  log(
    'start = 200 and the event is live',
    startRes.status === 200 && startRes.body?.event?.status === 'live',
    `status=${startRes.status} event=${startRes.body?.event?.status}`,
  );

  // A separate event with no start_at: starting it stamps the clock, and that
  // stamp must be truncated to the minute.
  const noStart = await call('/create', adminUser.token, {
    title: `LE-E2E ${stamp} nostart`,
    description: 'started without a start_at',
    end_at: futureWindow(120).end_at,
  });
  const noStartId = noStart.body?.event?.id;
  createdEventIds.push(noStartId);
  const startNoStart = await call('/start', adminUser.token, { event_id: noStartId });
  log(
    'starting an event without start_at stamps a MINUTE-TRUNCATED start_at',
    startNoStart.status === 200 && new Date(startNoStart.body?.event?.start_at || 0).getUTCSeconds() === 0,
    `start_at=${startNoStart.body?.event?.start_at}`,
  );

  const liveStart = startRes.body?.event?.start_at;
  const lockRes = await call('/update', adminUser.token, {
    event_id: draftId,
    start_at: new Date(Date.now() + 90 * 60 * 1000).toISOString(),
  });
  log(
    'changing the deadline while live = 403 EVENT_LOCKED',
    lockRes.status === 403 && lockRes.body?.error === 'EVENT_LOCKED',
    `status=${lockRes.status} error=${lockRes.body?.error}`,
  );
  const sameRes = await call('/update', adminUser.token, { event_id: draftId, start_at: liveStart });
  log(
    're-sending the SAME minute while live is allowed (no drift lock)',
    sameRes.status === 200,
    `status=${sameRes.status} error=${sameRes.body?.error}`,
  );

  // =====================================================================
  section('P6  LE-3: messages and the newest-50 window');

  const sendRes = await call('/send', memberUser.token, { event_id: draftId, content: 'hello from the suite' });
  log(
    'a member can send a message to a live event',
    sendRes.status === 200 && !!sendRes.body?.message?.id,
    `status=${sendRes.status} error=${sendRes.body?.error}`,
  );

  const getRes = await call('/get', memberUser.token, { event_id: draftId });
  log(
    'get returns the message',
    getRes.status === 200 && (getRes.body?.messages || []).some((m) => m.content === 'hello from the suite'),
    `messages=${(getRes.body?.messages || []).length}`,
  );
  log('get reports can_write for a live event', getRes.body?.can_write === true);

  // 55 messages: the room must show the NEWEST 50, oldest-first.
  const bulk = [];
  const base = Date.now() - 60 * 60 * 1000;
  for (let i = 0; i < 55; i += 1) {
    bulk.push({
      event_id: draftId,
      author_id: memberUser.id,
      author_alias: 'Bulk',
      content: `bulk-${i}`,
      created_at: new Date(base + i * 1000).toISOString(),
    });
  }
  const { error: bulkErr } = await admin.from('live_event_messages').insert(bulk);
  log('55 messages inserted for the window check', !bulkErr, bulkErr ? bulkErr.message : 'ok');

  const getMany = await call('/get', memberUser.token, { event_id: draftId });
  const msgs = getMany.body?.messages || [];
  log('get returns exactly 50 messages', msgs.length === 50, `messages=${msgs.length}`);
  log(
    'the newest message is present',
    msgs.some((m) => m.content === 'bulk-54'),
    `last=${msgs[msgs.length - 1]?.content}`,
  );
  log(
    'the OLDEST message is NOT present (the window is the newest 50)',
    !msgs.some((m) => m.content === 'bulk-0'),
  );
  log(
    'the messages are oldest-first',
    msgs.length > 1 && new Date(msgs[0].created_at) <= new Date(msgs[msgs.length - 1].created_at),
  );

  // =====================================================================
  section('P7  LE-4: terminal states');

  const closeRes = await call('/close', adminUser.token, { event_id: draftId, reason: 'admin' });
  log(
    'close = 200 and the state is closed',
    closeRes.status === 200 && closeRes.body?.state === 'closed',
    `status=${closeRes.status} state=${closeRes.body?.state} error=${closeRes.body?.error}`,
  );

  const closedUpdate = await call('/update', adminUser.token, { event_id: draftId, title: 'nope' });
  log(
    'editing a closed event = 403 TERMINAL',
    closedUpdate.status === 403 && closedUpdate.body?.error === 'TERMINAL',
    `status=${closedUpdate.status} error=${closedUpdate.body?.error}`,
  );
  const closedPublish = await call('/publish', adminUser.token, { event_id: draftId });
  log(
    'publishing a closed event = 403 TERMINAL',
    closedPublish.status === 403 && closedPublish.body?.error === 'TERMINAL',
    `status=${closedPublish.status} error=${closedPublish.body?.error}`,
  );
  const closedSend = await call('/send', memberUser.token, { event_id: draftId, content: 'too late' });
  log(
    'sending to a closed event = 403 EVENT_CLOSED',
    closedSend.status === 403 && closedSend.body?.error === 'EVENT_CLOSED',
    `status=${closedSend.status} error=${closedSend.body?.error}`,
  );
  const closedGet = await call('/get', memberUser.token, { event_id: draftId });
  log(
    'a closed event is still readable and reports closed_notice',
    closedGet.status === 200 && closedGet.body?.closed === true && !!closedGet.body?.event?.closed_notice,
    `closed=${closedGet.body?.closed}`,
  );

  // A second event: schedule it, cancel it, then try to start it.
  const cancelRes = await call('/create', adminUser.token, {
    title: `LE-E2E ${stamp} cancel`,
    description: 'scheduled then cancelled',
    ...futureWindow(45),
  });
  const cancelId = cancelRes.body?.event?.id;
  createdEventIds.push(cancelId);
  await call('/publish', adminUser.token, { event_id: cancelId });
  const doCancel = await call('/cancel', adminUser.token, { event_id: cancelId });
  log(
    'cancel = 200 and the event is cancelled',
    doCancel.status === 200 && doCancel.body?.event?.status === 'cancelled',
    `status=${doCancel.status} event=${doCancel.body?.event?.status}`,
  );
  const startCancelled = await call('/start', adminUser.token, { event_id: cancelId });
  log(
    'starting a cancelled event = 403 TERMINAL',
    startCancelled.status === 403 && startCancelled.body?.error === 'TERMINAL',
    `status=${startCancelled.status} error=${startCancelled.body?.error}`,
  );
  const cancelLive = await call('/cancel', adminUser.token, { event_id: noStartId });
  log(
    'cancelling a LIVE event = 403 INVALID_TRANSITION (live only closes)',
    cancelLive.status === 403 && cancelLive.body?.error === 'INVALID_TRANSITION',
    `status=${cancelLive.status} error=${cancelLive.body?.error}`,
  );

  const missing = await call('/get', memberUser.token, { event_id: '00000000-0000-0000-0000-000000000000' });
  log(
    'get on an unknown event = 404 EVENT_NOT_FOUND',
    missing.status === 404 && missing.body?.error === 'EVENT_NOT_FOUND',
    `status=${missing.status} error=${missing.body?.error}`,
  );

  // =====================================================================
  section('P8  LE-5: a missing server configuration is a 503, not a 500');

  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const savedSecret = process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SECRET_KEY;
  try {
    const res = mockRes();
    await handleListLiveEvents({ method: 'POST', url: '/api/community/live-events/list', headers: {}, body: {} }, res, memberUser);
    log(
      'no service key = 503 SERVER_CONFIG and the missing variable is NAMED',
      res.statusCode === 503 && res.bodySent?.error === 'SERVER_CONFIG'
        && Array.isArray(res.bodySent?.detail?.missing) && res.bodySent.detail.missing.length > 0,
      `status=${res.statusCode} missing=${JSON.stringify(res.bodySent?.detail?.missing)}`,
    );
    log(
      'the 503 body never contains a secret value',
      !JSON.stringify(res.bodySent || {}).includes('sb_secret_'),
    );
  } finally {
    if (savedKey) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    if (savedSecret) process.env.SUPABASE_SECRET_KEY = savedSecret;
  }

  // =====================================================================
  section('P9  cleanup');

  await cleanup();
  const { data: leftovers } = await admin.from('live_events').select('id').like('title', `LE-E2E %`);
  log('no test events left behind', (leftovers || []).length === 0, `left=${(leftovers || []).length}`);
} catch (err) {
  console.error('\nFATAL', err.stack || err.message);
  await cleanup();
  process.exit(1);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length ? 1 : 0);
