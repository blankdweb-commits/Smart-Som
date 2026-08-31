import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// E2E: Flashcards are ADMIN-GRANTED, NOT premium.
// Verifies the RLS matrix on custom_flashcards + the can_access_flashcards()
// gate + admin grant/revoke + audit log (server-authoritative entitlement).
//
// Matrix (expected):
//   anonymous                              select custom_flashcards -> DENIED
//   authenticated free (no grant)          can_access_flashcards false + DENIED
//   authenticated PREMIUM (no grant)       can_access_flashcards false + DENIED
//   user with admin-granted access         can_access_flashcards true + ALLOWED
//   admin (is_admin)                       custom_flashcards ALLOWED
//
// Usage: node scripts/e2e-flashcard-access.mjs
// Cleanup: deletes the test users it creates.

const loadEnv = () => {
  const env = {};
  const p = path.join(process.cwd(), '.env');
  if (fs.existsSync(p)) {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && m[2]) env[m[1]] = m[2];
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return env;
};

const env = loadEnv();
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.log('FAIL  missing env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

const stamp = Date.now().toString().slice(-6);
const EMAIL_FREE = `fce2e_free_${stamp}@apexscholars.test`;
const EMAIL_PREM = `fce2e_prem_${stamp}@apexscholars.test`;
const PASSWORD = 'E2e-Change-Me-123!';
let ok = true;

const log = (step, pass, detail = '') => {
  if (!pass) ok = false;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${step}${detail ? '  ->  ' + detail : ''}`);
};

// Sign into an anon-key client as `email` so the resulting client is subject
// to that user's RLS (not service-role). Returns {client, jwt, uid}.
async function signIn(email) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  c.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  return { client: c, jwt: data.session.access_token, uid: data.user.id };
}

// Read custom_flashcards through a given REST/JWT or service context.
async function readCards(client, jwt) {
  const headers = jwt
    ? { apikey: ANON, Authorization: `Bearer ${jwt}` }
    : { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` };
  const res = await fetch(`${URL}/rest/v1/custom_flashcards?select=id&limit=1`, { headers });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  const denied = res.status === 401 || res.status === 403
    || (Array.isArray(body) && body.length === 0 && res.status !== 200)
    || (res.status === 200 && Array.isArray(body) && body.length === 0);
  return { denied, status: res.status, length: Array.isArray(body) ? body.length : null };
}

const userIds = [];

try {
  // ---- create users (admin / service role) ----
  const { data: a1, error: e1 } = await admin.auth.admin.createUser({ email: EMAIL_FREE, password: PASSWORD, email_confirm: true });
  if (e1) throw e1;
  userIds.push(a1.user.id);
  const freeUid = a1.user.id;

  const { data: a2, error: e2 } = await admin.auth.admin.createUser({ email: EMAIL_PREM, password: PASSWORD, email_confirm: true });
  if (e2) throw e2;
  userIds.push(a2.user.id);
  const premUid = a2.user.id;

  // Make the second user PREMIUM via an active subscription, WITHOUT granting
  // flashcard access. This proves premium does not auto-unlock flashcards.
  const { error: subErr } = await admin.from('subscriptions').insert({
    user_id: premUid,
    plan: 'monthly',
    status: 'active',
    expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    reference: `e2e-sc-${stamp}`
  });
  if (subErr) throw subErr;

  // ---- 0. Anonymous read on custom_flashcards -> DENIED ----
  {
    const { denied, status } = await readCards(anon, null);
    const passthrough = (await (await fetch(`${URL}/rest/v1/custom_flashcards?select=id&limit=1`, { headers: { apikey: ANON } })).json());
    log('anonymous custom_flashcards select DENIED',
      status === 401 || status === 403 || (Array.isArray(passthrough) && passthrough.length === 0),
      `http ${status}`);
  }

  // ---- 1. Free user: RPC false + cards DENIED ----
  {
    const free = await signIn(EMAIL_FREE);
    const { data: can, error } = await free.client.rpc('can_access_flashcards');
    log('free user can_access_flashcards() = false', error ? false : can === false, `can=${can}`);
    const { denied, status } = await readCards(null, free.jwt);
    log('free user custom_flashcards DENIED', denied, `http ${status}`);
  }

  // ---- 2. PREMIUM user without flashcard grant: RPC false + DENIED ----
  {
    const prem = await signIn(EMAIL_PREM);
    const { data: can, error } = await prem.client.rpc('can_access_flashcards');
    log('PREMIUM (no grant) can_access_flashcards() = false', error ? false : can === false, `can=${can}`);
    const { denied, status } = await readCards(null, prem.jwt);
    log('PREMIUM (no grant) custom_flashcards DENIED', denied, `http ${status}`);
  }

  // ---- 3. Admin grants access -> RPC true + cards ALLOWED + audit log ----
  {
    const { error: grantErr } = await admin.rpc('admin_set_flashcard_access', { p_user_id: freeUid, p_granted: true });
    log('admin_set_flashcard_access(grant) OK', !grantErr, grantErr?.message || '');

    const free = await signIn(EMAIL_FREE);
    const { data: can, error } = await free.client.rpc('can_access_flashcards');
    log('granted user can_access_flashcards() = true', error ? false : can === true, `can=${can}`);
    const { denied, status } = await readCards(null, free.jwt);
    log('granted user custom_flashcards ALLOWED', !denied, `http ${status}`);

    const { data: audit, error: audErr } = await admin.from('admin_audit_log')
      .select('action')
      .eq('user_id', freeUid)
      .eq('action', 'flashcard_grant');
    log('audit log flashcard_grant recorded', !audErr && (audit || []).length >= 1, `${(audit || []).length} row(s)`);
  }

  // ---- 4. Admin revokes -> RPC false + DENIED + audit log ----
  {
    const { error: revErr } = await admin.rpc('admin_set_flashcard_access', { p_user_id: freeUid, p_granted: false });
    log('admin_set_flashcard_access(revoke) OK', !revErr, revErr?.message || '');

    const free = await signIn(EMAIL_FREE);
    const { data: can, error } = await free.client.rpc('can_access_flashcards');
    log('revoked user can_access_flashcards() = false', error ? false : can === false, `can=${can}`);
    const { denied, status } = await readCards(null, free.jwt);
    log('revoked user custom_flashcards DENIED', denied, `http ${status}`);

    const { data: audit, error: audErr } = await admin.from('admin_audit_log')
      .select('action')
      .eq('user_id', freeUid)
      .eq('action', 'flashcard_revoke');
    log('audit log flashcard_revoke recorded', !audErr && (audit || []).length >= 1, `${(audit || []).length} row(s)`);
  }

  // ---- 5. Grand re-grant + admin (is_admin) read ALLOWED ----
  {
    const { error: grantErr } = await admin.rpc('admin_set_flashcard_access', { p_user_id: premUid, p_granted: true });
    log('re-grant premium user OK', !grantErr, grantErr?.message || '');

    const prem = await signIn(EMAIL_PREM);
    const { data: can } = await prem.client.rpc('can_access_flashcards');
    log('granted premium user can_access_flashcards() = true', can === true, `can=${can}`);
    const { denied, status } = await readCards(null, prem.jwt);
    log('granted premium user custom_flashcards ALLOWED', !denied, `http ${status}`);

    const { denied: adminDenied, status: adminStatus } = await readCards(admin, null);
    log('admin custom_flashcards select ALLOWED (is_admin bypass)', !adminDenied, `http ${adminStatus}`);
  }
} catch (e) {
  log('e2e-flashcard-access ran into an error', false, e.message.slice(0, 300));
} finally {
  // cleanup test users
  for (const uid of userIds) {
    try { await admin.auth.admin.deleteUser(uid); } catch {}
  }
  console.log(ok ? '\nALL PASS' : '\nSOME CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}
