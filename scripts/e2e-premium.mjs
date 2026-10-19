// scripts/e2e-premium.mjs (npm e2e:premium)
//
// Premium conversion end-to-end. Covers the v100 schema/config, the Paystack
// integrity fixes, the analytics endpoint, and the client gating.
//
//   P1  plans: annual sorts first, real reference prices, no invented prices
//   P2  the offer ships INACTIVE with no deadline
//   P3  offer admin controls refuse invalid windows (real signed-in identities)
//   P4  a valid window goes live, then is restored to the shipped state
//   P5  audit rows exist for ACCEPTED changes only
//   P6  verify-payment refuses a plan-less ₦1 charge  (the exploit)
//   P7  the webhook refuses a plan-less / unresolvable charge
//   P8  a genuine charge grants the plan's OWN duration, and stays idempotent
//   P9  signature comparison is constant-time and length-safe
//   P10 analytics: closed allowlists, service-role writes only, 204 always
//   P11 conversion_events reads are admin-only
//
// Usage: node scripts/e2e-premium.mjs
import fs from 'fs';
import crypto from 'crypto';

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2]) env[m[1]] = m[2];
}
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (env[k] && !process.env[k]) process.env[k] = env[k];
}
process.env.PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || 'sk_test_e2e_secret';

const { createClient } = await import('@supabase/supabase-js');
const SUPA = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
const SVC = env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(SUPA, SVC);
const stamp = Date.now().toString(36);
const created = [];
let pass = 0, fail = 0;
const results = [];
const log = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  ok ? pass++ : fail++;
};
const section = (t) => console.log(`\n--- ${t} ---`);

const makeUser = async (role = 'student') => {
  const email = `v100e2e${role}${stamp}${Math.random().toString(36).slice(2, 6)}@apextest.local`;
  const password = 'E2E-Probe-Pass!1';
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error(`createUser(${role}): ${error.message}`);
  created.push(data.user.id);
  if (role === 'admin') {
    const { error: re } = await admin.from('profiles').update({ role: 'admin' }).eq('id', data.user.id);
    if (re) throw new Error(`set role: ${re.message}`);
  }
  const c = createClient(SUPA, ANON);
  const { error: se } = await c.auth.signInWithPassword({ email, password });
  if (se) throw new Error(`signIn: ${se.message}`);
  const token = (await c.auth.getSession()).data.session.access_token;
  return { id: data.user.id, email, client: c, token };
};

const cleanup = async () => {
  for (const id of created) {
    await admin.from('conversion_events').delete().eq('user_id', id);
    await admin.from('subscriptions').delete().eq('user_id', id);
    await admin.from('transactions').delete().eq('user_id', id);
    await admin.from('payments').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id).catch(() => {});
  }
};

try {
  // =====================================================================
  section('P1  plan metadata: annual first, real references, nothing invented');
  const { data: plans, error: planErr } = await admin
    .from('subscription_plans').select('*').eq('is_active', true)
    .order('sort_order', { ascending: true }).order('price', { ascending: true });
  if (planErr) throw planErr;

  const annual = plans.find(p => Number(p.duration_days) >= 365);
  const promo = plans.filter(p => p.is_promo || p.offer_eligible);
  const base = plans.filter(p => !p.is_promo && !p.offer_eligible);

  log('the ANNUAL plan is the first card', plans[0]?.duration_days >= 365, `first=${plans[0]?.name}`);
  log('annual exists and is single', !!annual && plans.filter(p => Number(p.duration_days) >= 365).length === 1);
  log('every plan has a sort_order', plans.every(p => p.sort_order != null));
  log('exactly 2 promo-eligible plans', promo.length === 2, `${promo.length}`);
  log('base plans carry NO reference price', base.every(p => p.reference_price === null));
  log('promo plans DO carry a reference', promo.every(p => p.reference_price != null));
  log('every reference is strictly above its price',
    plans.every(p => p.reference_price == null || Number(p.reference_price) > Number(p.price)));

  // The reference must be the real cost of the SAME duration, not an invented
  // "was" figure: 7d promo -> weekly price, 30d promo -> monthly price.
  const weekly = base.find(p => Number(p.duration_days) === 7);
  const monthly = base.find(p => Number(p.duration_days) === 30);
  const promo7 = promo.find(p => Number(p.duration_days) === 7);
  const promo30 = promo.find(p => Number(p.duration_days) === 30);
  log('the 7-day promo references the REAL weekly price',
    promo7 && weekly && Number(promo7.reference_price) === Number(weekly.price),
    `${promo7?.reference_price} vs weekly ${weekly?.price}`);
  log('the 30-day promo references the REAL monthly price',
    promo30 && monthly && Number(promo30.reference_price) === Number(monthly.price),
    `${promo30?.reference_price} vs monthly ${monthly?.price}`);
  log('promo plans are cheaper than the plans they reference',
    promo.every(p => Number(p.price) < Number(p.reference_price)));

  // The "Best value" badge on the annual must be arithmetic.
  const weeklyPrice = Number(weekly?.price || 0);
  const yearlyPrice = Number(annual?.price || 0);
  log('the annual really does beat 52 weeks of weekly billing',
    yearlyPrice > 0 && weeklyPrice > 0 && yearlyPrice < weeklyPrice * 52,
    `${yearlyPrice} vs ${(weeklyPrice * 52).toFixed(2)}`);

  // =====================================================================
  section('P2  the offer ships INACTIVE, with no invented deadline');
  const { data: offRows } = await admin.rpc('premium_offer_public');
  const off = offRows;
  log('offer enabled is false', off?.enabled === false, `enabled=${off?.enabled}`);
  log('offer state is inactive', off?.state === 'inactive', off?.state);
  log('no deadline was invented', off?.ends_at === null && off?.starts_at === null,
    `ends=${off?.ends_at}`);
  log('server_now is present for client skew correction', !!off?.server_now);

  // A zero-arg PostgREST RPC returns a BARE jsonb object, not an array.
  const { data: leaked } = await admin.rpc('premium_offer_public');
  const keys = Object.keys(leaked || {});
  log('the public RPC exposes ONLY offer fields (no arena/loan/economy config)',
    keys.every(k => ['state', 'enabled', 'starts_at', 'ends_at', 'headline', 'subline', 'server_now', 'eligibility_note'].includes(k)),
    `keys=${keys.join(',')}`);

  // =====================================================================
  section('P3–P5  admin offer controls (real signed-in identities)');
  const adminSess = await makeUser('admin');
  const DAY = 864e5;
  const iso = (ms) => new Date(ms).toISOString();
  const rpc = (s, fn, args) => s.client.rpc(fn, args);

  const asStudent = await rpc(await makeUser('student'), 'admin_set_premium_offer', { p_enabled: true });
  log('a non-admin is refused by the is_admin() gate',
    asStudent.data?.code === 'NOT_AUTHORIZED', JSON.stringify(asStudent.data));

  const bad = async (label, args, expect) => {
    const r = await rpc(adminSess, 'admin_set_premium_offer', args);
    log(label, r.data?.code === expect, JSON.stringify(r.data || r.error?.message));
  };
  await bad('enabling with no dates is refused', { p_enabled: true }, 'MISSING_DATES');
  await bad('an end before the start is refused',
    { p_enabled: true, p_starts_at: iso(Date.now() + 2 * DAY), p_ends_at: iso(Date.now() + DAY) }, 'END_BEFORE_START');
  await bad('a window already in the past is refused',
    { p_enabled: true, p_starts_at: iso(Date.now() - 30 * DAY), p_ends_at: iso(Date.now() - DAY) }, 'OFFER_ALREADY_ENDED');

  const { count: auditBefore } = await admin.from('admin_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'premium_offer_change');

  const live = await rpc(adminSess, 'admin_set_premium_offer', {
    p_enabled: true,
    p_starts_at: iso(Date.now() - 60000),
    p_ends_at: iso(Date.now() + 30 * DAY),
    p_headline: 'E2E offer',
  });
  log('a valid one-month window is accepted and reports active',
    live.data?.ok === true && live.data?.state === 'active', JSON.stringify(live.data?.state));

  const { data: liveRows } = await admin.rpc('premium_offer_public');
  log('the public surface agrees it is active', liveRows?.state === 'active', liveRows?.state);

  const { count: auditAfter } = await admin.from('admin_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'premium_offer_change');
  log('an audit row was written for the ACCEPTED change',
    auditAfter > auditBefore, `${auditBefore} -> ${auditAfter}`);
  log('refused attempts wrote NO audit rows',
    (auditAfter - auditBefore) === 1, `delta=${auditAfter - auditBefore}`);

  // =====================================================================
  section('P6–P8  Paystack integrity (the plan-less charge exploit)');
  const payer = await makeUser('student');
  let stubbed = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.paystack.co/transaction/verify/')) {
      return new Response(JSON.stringify({ status: true, data: stubbed }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, opts);
  };

  const callVerify = async (body) => {
    const { default: h } = await import('../api/verify-payment.js?t=' + Date.now());
    let out = {};
    const res = { status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return res; }, setHeader: () => res, end: () => res };
    await h({ method: 'POST', headers: { authorization: `Bearer ${payer.token}` }, url: '/api/verify-payment', body }, res);
    return out;
  };
  const callWebhook = async (body) => {
    const { default: h } = await import('../api/payments-webhook.js?t=' + Date.now());
    const sig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(body)).digest('hex');
    let out = {};
    const res = { status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return res; }, setHeader: () => res, end: () => res };
    await h({ method: 'POST', headers: { 'x-paystack-signature': sig }, url: '/api/payments-webhook', body }, res);
    return out;
  };
  const subsFor = async (ref) =>
    (await admin.from('subscriptions').select('id,plan,expires_at,amount').eq('reference', ref)).data || [];
  let n = 0;
  const ref = () => `v100e2e-${stamp}-${++n}`;

  // THE EXPLOIT. The Paystack PUBLIC key is public, so anyone can initialize a
  // ₦1 charge whose metadata omits plan_id. Before the fix this granted 30 days
  // of Premium for ₦1, because the amount guard compared against a null default.
  const forged = ref();
  stubbed = { status: 'success', amount: 100, reference: forged, metadata: { user_id: payer.id, expected_amount_kobo: 100 } };
  const v1 = await callVerify({ reference: forged });
  log('verify-payment REFUSES a plan-less ₦1 charge', v1.status === 400, `HTTP ${v1.status}`);
  log('  -> mints NO subscription', (await subsFor(forged)).length === 0);

  const forgedW = ref();
  stubbed = { status: 'success', amount: 100, reference: forgedW, metadata: { user_id: payer.id, expected_amount_kobo: 100 } };
  const w1 = await callWebhook({ event: 'charge.success', data: { reference: forgedW, amount: 100, metadata: { user_id: payer.id, expected_amount_kobo: 100 } } });
  log('the webhook REFUSES a plan-less charge', w1.body?.status === 'plan_unresolved', JSON.stringify(w1.body));
  log('  -> mints NO subscription', (await subsFor(forgedW)).length === 0);
  log('  -> does NOT trust the self-certified expected_amount_kobo', w1.body?.status !== 'success');

  // A real plan_id at the wrong price is still refused.
  const wrongPrice = ref();
  stubbed = { status: 'success', amount: 100, reference: wrongPrice, metadata: { user_id: payer.id, plan_id: monthly.id } };
  log('a ₦1 charge naming the real monthly plan is refused',
    (await callVerify({ reference: wrongPrice })).status === 400);
  log('  -> mints NO subscription', (await subsFor(wrongPrice)).length === 0);

  // A deleted plan cannot mint anything.
  const gonePlan = ref();
  stubbed = { status: 'success', amount: 999900, reference: gonePlan, metadata: { user_id: payer.id, plan_id: 987654 } };
  const w2 = await callWebhook({ event: 'charge.success', data: { reference: gonePlan, amount: 999900, metadata: { user_id: payer.id, plan_id: 987654 } } });
  log('a charge naming a non-existent plan is not granted', w2.body?.status === 'plan_unresolved', JSON.stringify(w2.body));
  log('  -> mints NO subscription', (await subsFor(gonePlan)).length === 0);

  // A genuine charge grants the plan's OWN duration — the old code's fallback
  // was a hardcoded 30 days regardless of which plan was bought.
  const good = ref();
  stubbed = { status: 'success', amount: Math.round(Number(annual.price) * 100), reference: good, metadata: { user_id: payer.id, plan_id: annual.id } };
  const vGood = await callVerify({ reference: good });
  log('a correctly priced annual charge is accepted', vGood.status === 200 && vGood.body?.success === true, JSON.stringify(vGood.body));
  const ySub = (await subsFor(good))[0];
  log('  -> granted as the ANNUAL plan, not a default',
    ySub?.plan === String(annual.name).toLowerCase(), `plan=${ySub?.plan} expected=${String(annual.name).toLowerCase()}`);
  const yDays = ySub ? Math.round((new Date(ySub.expires_at) - Date.now()) / DAY) : null;
  log('  -> for ~365 days, not 30', Math.abs(yDays - Number(annual.duration_days)) <= 1, `${yDays}d vs ${annual.duration_days}d`);

  const replay = await callVerify({ reference: good });
  log('replaying the reference grants nothing twice',
    replay.status === 200 && (await subsFor(good)).length === 1, JSON.stringify(replay.body));

  globalThis.fetch = realFetch;

  // =====================================================================
  section('P9  webhook signature comparison');
  {
    const { default: h } = await import('../api/payments-webhook.js?t=' + Date.now());
    const body = { event: 'charge.success', data: { reference: 'v100-sig', amount: 100, metadata: {} } };
    const goodSig = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(body)).digest('hex');
    const run = async (sig) => {
      let out = {};
      const res = { status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return res; }, setHeader: () => res, end: () => res };
      await h({ method: 'POST', headers: sig === undefined ? {} : { 'x-paystack-signature': sig }, body: JSON.parse(JSON.stringify(body)) }, res);
      return out;
    };
    log('a valid signature is accepted', (await run(goodSig)).status === 200);
    log('a wrong signature is rejected 401', (await run(crypto.randomBytes(32).toString('hex'))).status === 401);
    // Same length, last byte flipped: `timingSafeEqual` requires equal-length
    // buffers, so this is the case that would throw without the length guard.
    const near = goodSig.slice(0, -1) + (goodSig.slice(-1) === 'a' ? 'b' : 'a');
    log('a 1-byte-off signature is rejected, not thrown on', (await run(near)).status === 401);
    log('a SHORT signature is rejected, not a length crash', (await run('abcd')).status === 401);
    log('a MISSING header is rejected cleanly', (await run(undefined)).status === 401);
    log('the comparison uses timingSafeEqual, not !==',
      /timingSafeEqual/.test(fs.readFileSync('api/payments-webhook.js', 'utf8')));
    await admin.from('transactions').delete().eq('reference', 'v100-sig');
  }

  // =====================================================================
  section('P10  analytics: closed allowlists, no client writes');
  const { default: feedback } = await import('../api/feedback.js?t=' + Date.now());
  const callConv = async (body, tok = payer.token) => {
    let out = { status: 200 };
    const res = { status: (s) => { out.status = s; return res; }, json: (b) => { out.body = b; return res; }, end: () => res, setHeader: () => res };
    await feedback({ method: 'POST', headers: tok ? { authorization: `Bearer ${tok}` } : {}, url: '/api/feedback/conversion', body }, res);
    return out;
  };
  const rows = async () =>
    (await admin.from('conversion_events').select('id,action,metadata').eq('user_id', payer.id).order('id', { ascending: true })).data || [];

  log('an allowed action returns 204', (await callConv({ action: 'modal_view', surface: 'quiz' })).status === 204);
  log('  -> stored with the surface', (await rows()).some(r => r.action === 'modal_view' && r.metadata?.surface === 'quiz'));

  const beforeJunk = (await rows()).length;
  log('an unknown action returns 204 (no oracle)', (await callConv({ action: 'not_a_real_action' })).status === 204);
  log('  -> and stores NOTHING', (await rows()).length === beforeJunk);

  await callConv({
    action: 'upgrade_click',
    surface: 'marketplace',
    email: 'victim@example.com',
    full_name: 'Real Person',
    payment_reference: 'APX-SECRET',
    authorization: 'Bearer stolen',
    metadata: { surface: 'marketplace', plan_id: promo7.id, evil: 'x', nested: { a: 1 } },
  });
  const last = (await rows()).slice(-1)[0];
  const mk = Object.keys(last?.metadata || {});
  log('only allowlisted metadata keys survive',
    mk.every(k => ['surface', 'plan_id', 'offer_state'].includes(k)), `keys=${mk.join(',')}`);
  log('no email / name / payment reference / credential is stored',
    !mk.some(k => ['email', 'full_name', 'payment_reference', 'authorization', 'nested', 'evil'].includes(k)));
  log('allowlisted values ARE kept (top-level wins, nested fills the gap)',
    last?.metadata?.surface === 'marketplace' && String(last?.metadata?.plan_id) === String(promo7.id),
    JSON.stringify(last?.metadata));

  await callConv({ action: 'plan_selected', surface: 'x'.repeat(5000) });
  log('an oversized value is truncated, not stored whole',
    ((await rows()).slice(-1)[0]?.metadata?.surface?.length || 0) <= 64);

  const beforeAnon = (await rows()).length;
  log('an unauthenticated post is refused', (await callConv({ action: 'modal_view' }, null)).status === 401);
  log('  -> and writes nothing', (await rows()).length === beforeAnon);

  const direct = await payer.client.from('conversion_events')
    .insert({ user_id: payer.id, action: 'premium_activated', metadata: { forged: true } });
  log('a client cannot plant an event directly', !!direct.error, direct.error?.message?.slice(0, 60));

  // =====================================================================
  section('P11  conversion_events reads are admin-only');
  const asAdminRead = await adminSess.client.from('conversion_events').select('action').eq('user_id', payer.id);
  log('a signed-in ADMIN can read events', !asAdminRead.error && (asAdminRead.data?.length || 0) > 0,
    `${asAdminRead.data?.length} row(s) ${asAdminRead.error?.message || ''}`);
  const asStudentRead = await payer.client.from('conversion_events').select('action').eq('user_id', payer.id);
  log('the student who generated them cannot read them',
    (asStudentRead.data?.length || 0) === 0, JSON.stringify(asStudentRead.data ?? asStudentRead.error?.message));
  const anonRead = await createClient(SUPA, ANON).from('conversion_events').select('action');
  log('an anonymous caller cannot read them', !!anonRead.error || (anonRead.data?.length || 0) === 0);

  // Retention prune is service-role only and bounded.
  const { data: prune } = await admin.rpc('conversion_events_prune', { p_days: 180 });
  log('the retention prune runs and reports', prune?.ok === true, JSON.stringify(prune));

} catch (err) {
  log('suite crashed', false, err.stack || err.message);
} finally {
  // Restore the shipped state: the offer must be INACTIVE with no dates, or
  // the next run of this suite starts against a live promo.
  try {
    await admin.rpc('admin_set_premium_offer', {
      p_enabled: false, p_starts_at: null, p_ends_at: null, p_headline: null, p_subline: null,
    });
  } catch { /* the real admin RPC needs an admin session; fall back to a direct write */ }
  const { data: after } = await admin.rpc('premium_offer_public');
  const o = after;
  if (o?.enabled !== false) {
    // is_admin() cannot be satisfied from the service role, so write the
    // server_config key directly. This is the ONE place the suite bypasses the
    // RPC, and only to undo its own state.
    await admin.from('server_config').update({
      value: { enabled: false, starts_at: null, ends_at: null, headline: null, subline: null },
    }).eq('key', 'premium_offer');
  }
  await cleanup();
  const { data: final } = await admin.rpc('premium_offer_public');
  const fo = final;
  console.log(`\n  offer restored: enabled=${fo?.enabled} ends_at=${fo?.ends_at}`);
}

console.log(`\n=== ${pass}/${pass + fail} checks passed ===`);
process.exit(fail ? 1 : 0);