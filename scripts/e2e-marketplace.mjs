// API-level e2e for the Marketplace Phase A first-party checkout.
// Exercises the REAL handlers (mock req/res) against the live DB:
//   - api/initiate-payment.js  (product resolution + access control)
//   - api/verify-payment.js    (server-side Paystack callback -> entitlement)
//   - api/payments-webhook.js  (signature-verified charge.success -> entitlement)
// Paystack HTTP is stubbed; everything else runs against live Supabase with a
// throwaway user + scratch seller/products that are cleaned up at the end.
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';
import initiateHandler from '../api/initiate-payment.js';
import verifyHandler from '../api/verify-payment.js';
import webhookHandler from '../api/payments-webhook.js';

const results = [];
const log = (step, ok, detail = '') => {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ' \u2014 ' + detail : ''}`);
};

const env = loadEnv();
Object.assign(process.env, {
  VITE_SUPABASE_URL: env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
  PAYSTACK_SECRET_KEY: env.PAYSTACK_SECRET_KEY || 'sk_test_stub',
  APP_URL: 'http://localhost:5173',
});
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const pub = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY);

const stamp = Date.now().toString().slice(-8);
const email = `mkt${stamp}@apextest.local`;
const password = 'testpass123';

let userId = null;
let platformSellerId = null;
let thirdSellerId = null;
const productIds = {};
const refPrefix = `MQ-${stamp}`;

// ---- Paystack HTTP stub (delegates everything else to the real fetch) --------
const realFetch = globalThis.fetch;
let lastInitBody = null;
let verifyPayload = null;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.paystack.co/transaction/initialize')) {
    lastInitBody = opts.body ? JSON.parse(opts.body) : null;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        status: true,
        data: { authorization_url: 'https://checkout.paystack.com/test', reference: lastInitBody?.reference },
      }),
    };
  }
  if (u.includes('api.paystack.co/transaction/verify/')) {
    return { ok: true, status: 200, json: async () => verifyPayload };
  }
  return realFetch(url, opts);
};

const mockRes = () => {
  const r = { statusCode: 200, bodySent: null };
  r.status = (code) => { r.statusCode = code; return r; };
  r.json = (body) => { r.bodySent = body; return r; };
  r.setHeader = () => r;
  return r;
};
const call = async (handler, method, url, token, body, extraHeaders = {}) => {
  const req = { method, url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders }, body };
  const res = mockRes();
  try {
    await handler(req, res);
  } catch (err) {
    res.statusCode = 500;
    res.bodySent = { error: err.message };
  }
  return { status: res.statusCode, body: res.bodySent };
};

const addProduct = async (fields) => {
  const { data, error } = await admin
    .from('marketplace_products')
    .insert({ currency: 'NGN', is_published: true, is_archived: false, ...fields })
    .select('id')
    .single();
  if (error) throw new Error(`product insert (${fields.title}): ${error.code} ${error.message}`);
  return data.id;
};

try {
  // ---- Section A — setup ----------------------------------------------------
  const { data: signup, error: suErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (suErr) throw suErr;
  userId = signup.user.id;
  const { data: agent, error: siErr } = await pub.auth.signInWithPassword({ email, password });
  if (siErr) throw siErr;
  const token = agent.session.access_token;

  const platform = await admin.from('marketplace_sellers').select('id').eq('business_name', 'PolyNurse').maybeSingle();
  if (!platform.data) throw new Error('Platform seller PolyNurse not seeded — run scripts/seed-marketplace-platform-seller.mjs');
  platformSellerId = platform.data.id;

  const third = await admin
    .from('marketplace_sellers')
    .insert({ business_name: `Scratch Seller ${stamp}`, contact_email: `seller${stamp}@apextest.local` })
    .select('id')
    .single();
  if (third.error) throw third.error;
  thirdSellerId = third.data.id;

  productIds.oneTime = await addProduct({ seller_id: platformSellerId, title: `Scratch One-Time ${stamp}`, slug: `mq-one-${stamp}`, price: 990, access_type: 'one-time' });
  productIds.free = await addProduct({ seller_id: platformSellerId, title: `Scratch Free ${stamp}`, slug: `mq-free-${stamp}`, price: 0, access_type: 'free' });
  productIds.premium = await addProduct({ seller_id: platformSellerId, title: `Scratch Premium ${stamp}`, slug: `mq-prem-${stamp}`, price: 0, access_type: 'premium' });
  productIds.zero = await addProduct({ seller_id: platformSellerId, title: `Scratch Zero ${stamp}`, slug: `mq-zero-${stamp}`, price: 0, access_type: 'one-time' });
  productIds.unpub = await addProduct({ seller_id: platformSellerId, title: `Scratch Unpub ${stamp}`, slug: `mq-unpub-${stamp}`, price: 300, access_type: 'one-time', is_published: false });
  productIds.arch = await addProduct({ seller_id: platformSellerId, title: `Scratch Arch ${stamp}`, slug: `mq-arch-${stamp}`, price: 300, access_type: 'one-time', is_archived: true });
  productIds.third = await addProduct({ seller_id: thirdSellerId, title: `Scratch Third ${stamp}`, slug: `mq-third-${stamp}`, price: 500, access_type: 'one-time' });
  productIds.verify = await addProduct({ seller_id: platformSellerId, title: `Scratch Verify ${stamp}`, slug: `mq-verify-${stamp}`, price: 250, access_type: 'one-time' });
  productIds.webhook = await addProduct({ seller_id: platformSellerId, title: `Scratch Webhook ${stamp}`, slug: `mq-webhook-${stamp}`, price: 150, access_type: 'one-time' });
  productIds.mismatch = await addProduct({ seller_id: platformSellerId, title: `Scratch Mismatch ${stamp}`, slug: `mq-mismatch-${stamp}`, price: 120, access_type: 'one-time' });
  productIds.entitle = await addProduct({ seller_id: platformSellerId, title: `Scratch Entitle ${stamp}`, slug: `mq-entitle-${stamp}`, price: 350, access_type: 'one-time', is_featured: true });

  log('setup: user + scratch seller/products', !!token && !!platformSellerId && !!thirdSellerId, `${email} platform=${platformSellerId} third=${thirdSellerId}`);

  // ---- Section B — initiate-payment access control --------------------------
  const init = (tokenArg, body) => call(initiateHandler, 'POST', '/api/initiate-payment', tokenArg, body);

  const b1 = await init(null, { product: 'marketplace_product', product_id: productIds.oneTime });
  log('initiate: unauthenticated = 401', b1.status === 401, `status=${b1.status}`);

  const b2 = await init(token, { product: 'marketplace_product', product_id: 'abc' });
  log('initiate: invalid id = 400 INVALID_PRODUCT', b2.status === 400 && b2.body?.error === 'INVALID_PRODUCT', JSON.stringify(b2.body));

  const b3 = await init(token, { product: 'marketplace_product', product_id: 999999999 });
  log('initiate: missing product = 404 PRODUCT_NOT_FOUND', b3.status === 404 && b3.body?.error === 'PRODUCT_NOT_FOUND', JSON.stringify(b3.body));

  const b4 = await init(token, { product: 'marketplace_product', product_id: productIds.third });
  log('initiate: third-party refused = 403 THIRD_PARTY_NOT_PURCHASABLE', b4.status === 403 && b4.body?.error === 'THIRD_PARTY_NOT_PURCHASABLE', JSON.stringify(b4.body));

  const b5 = await init(token, { product: 'marketplace_product', product_id: productIds.free });
  log('initiate: free = 400 FREE_PRODUCT', b5.status === 400 && b5.body?.error === 'FREE_PRODUCT', JSON.stringify(b5.body));

  const b6 = await init(token, { product: 'marketplace_product', product_id: productIds.premium });
  log('initiate: premium = 400 PREMIUM_ONLY', b6.status === 400 && b6.body?.error === 'PREMIUM_ONLY', JSON.stringify(b6.body));

  const b7 = await init(token, { product: 'marketplace_product', product_id: productIds.zero });
  log('initiate: zero-price one-time = 400 NOT_PURCHASABLE', b7.status === 400 && b7.body?.error === 'NOT_PURCHASABLE', JSON.stringify(b7.body));

  const b8 = await init(token, { product: 'marketplace_product', product_id: productIds.unpub });
  log('initiate: unpublished = 400 PRODUCT_NOT_AVAILABLE', b8.status === 400 && b8.body?.error === 'PRODUCT_NOT_AVAILABLE', JSON.stringify(b8.body));

  const b9 = await init(token, { product: 'marketplace_product', product_id: productIds.arch });
  log('initiate: archived = 400 PRODUCT_NOT_AVAILABLE', b9.status === 400 && b9.body?.error === 'PRODUCT_NOT_AVAILABLE', JSON.stringify(b9.body));

  lastInitBody = null;
  const b10 = await init(token, { product: 'marketplace_product', product_id: productIds.oneTime });
  log('initiate: first-party success = 200', b10.status === 200 && b10.body?.success === true, JSON.stringify(b10.body));
  log('initiate: charged amount = price x 100 kobo', lastInitBody?.amount === 990 * 100, `amount=${lastInitBody?.amount}`);
  log('initiate: reference is APX-MKT-*', /^APX-MKT-/.test(lastInitBody?.reference || ''), `ref=${lastInitBody?.reference}`);
  log('initiate: metadata.product = marketplace_product', lastInitBody?.metadata?.product === 'marketplace_product');
  log('initiate: metadata.product_id matches', lastInitBody?.metadata?.product_id === productIds.oneTime, `pid=${lastInitBody?.metadata?.product_id}`);

  // ---- Section C — entitlement (already owned) ------------------------------
  const { error: ownErr } = await admin.from('marketplace_purchases').insert({
    user_id: userId, product_id: productIds.oneTime, amount: 990, reference: `${refPrefix}-OWN`, status: 'complete',
  });
  if (ownErr) throw new Error(`entitlement insert: ${ownErr.code} ${ownErr.message}`);
  const c1 = await init(token, { product: 'marketplace_product', product_id: productIds.oneTime });
  log('initiate: already owned = 400 ALREADY_OWNED', c1.status === 400 && c1.body?.error === 'ALREADY_OWNED', JSON.stringify(c1.body));
  await admin.from('marketplace_purchases').delete().eq('user_id', userId).eq('product_id', productIds.oneTime);

  // ---- Section D — verify-payment grant -------------------------------------
  verifyPayload = {
    status: true,
    data: { status: 'success', amount: 250 * 100, metadata: { product: 'marketplace_product', product_id: productIds.verify } },
  };
  const dRef = `${refPrefix}-VERIFY-1`;
  const d1 = await call(verifyHandler, 'POST', '/api/verify-payment', token, { reference: dRef });
  log('verify: first-party grant = 200 marketplace', d1.status === 200 && d1.body?.success === true && d1.body?.marketplace === true, JSON.stringify(d1.body));
  const { data: dPurch } = await admin.from('marketplace_purchases').select('id, amount, status').eq('user_id', userId).eq('product_id', productIds.verify);
  log('verify: entitlement row persisted (complete)', dPurch?.length === 1 && dPurch[0].status === 'complete' && Number(dPurch[0].amount) === 250, JSON.stringify(dPurch));
  const { data: dPay } = await admin.from('payments').select('id').eq('reference', dRef);
  log('verify: payments row recorded', (dPay?.length || 0) >= 1, `rows=${dPay?.length || 0}`);

  const d2 = await call(verifyHandler, 'POST', '/api/verify-payment', token, { reference: dRef });
  const { data: dPurch2 } = await admin.from('marketplace_purchases').select('id').eq('user_id', userId).eq('product_id', productIds.verify);
  log('verify: replay is idempotent', d2.status === 200 && dPurch2?.length === 1, `status=${d2.status} purchases=${dPurch2?.length}`);

  verifyPayload = {
    status: true,
    data: { status: 'success', amount: 500 * 100, metadata: { product: 'marketplace_product', product_id: productIds.third } },
  };
  const d3 = await call(verifyHandler, 'POST', '/api/verify-payment', token, { reference: `${refPrefix}-VERIFY-THIRD` });
  log('verify: third-party refused = 400 PRODUCT_NOT_PURCHASABLE', d3.status === 400 && d3.body?.error === 'PRODUCT_NOT_PURCHASABLE', JSON.stringify(d3.body));

  verifyPayload = {
    status: true,
    data: { status: 'success', amount: 9999 * 100, metadata: { product: 'marketplace_product', product_id: productIds.verify } },
  };
  const d4 = await call(verifyHandler, 'POST', '/api/verify-payment', token, { reference: `${refPrefix}-VERIFY-MISMATCH` });
  log('verify: amount mismatch = 400', d4.status === 400 && /amount/i.test(d4.body?.error || ''), JSON.stringify(d4.body));

  // ---- Section E — payments-webhook -----------------------------------------
  const sign = (bodyObj) =>
    crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(JSON.stringify(bodyObj)).digest('hex');
  const whCall = (bodyObj, sig) =>
    call(webhookHandler, 'POST', '/api/payments-webhook', null, bodyObj, { 'x-paystack-signature': sig ?? sign(bodyObj) });

  const e1Ref = `${refPrefix}-WH-1`;
  const e1Body = {
    event: 'charge.success',
    data: { reference: e1Ref, amount: 150 * 100, metadata: { product: 'marketplace_product', product_id: productIds.webhook, user_id: userId, reference: e1Ref } },
  };
  const e1 = await whCall(e1Body);
  log('webhook: first-party grant = 200 marketplace_granted', e1.status === 200 && e1.body?.status === 'marketplace_granted', JSON.stringify(e1.body));
  const { data: ePurch } = await admin.from('marketplace_purchases').select('id, status').eq('user_id', userId).eq('product_id', productIds.webhook);
  log('webhook: entitlement row persisted', ePurch?.length === 1 && ePurch[0].status === 'complete', JSON.stringify(ePurch));

  const e2 = await whCall(e1Body);
  log('webhook: replay is idempotent (already_processed)', e2.status === 200 && e2.body?.status === 'already_processed', JSON.stringify(e2.body));

  const e3 = await whCall(e1Body, 'deadbeef');
  log('webhook: bad signature = 401', e3.status === 401, `status=${e3.status}`);

  const e4Ref = `${refPrefix}-WH-THIRD`;
  const e4Body = {
    event: 'charge.success',
    data: { reference: e4Ref, amount: 500 * 100, metadata: { product: 'marketplace_product', product_id: productIds.third, user_id: userId, reference: e4Ref } },
  };
  const e4 = await whCall(e4Body);
  const { data: e4Purch } = await admin.from('marketplace_purchases').select('id').eq('user_id', userId).eq('product_id', productIds.third);
  log('webhook: third-party ignored (no entitlement)', e4.status === 200 && e4.body?.status === 'ignored' && (e4Purch?.length || 0) === 0, JSON.stringify(e4.body));

  const e5Ref = `${refPrefix}-WH-MISMATCH`;
  const e5Body = {
    event: 'charge.success',
    data: { reference: e5Ref, amount: 9999 * 100, metadata: { product: 'marketplace_product', product_id: productIds.mismatch, user_id: userId, reference: e5Ref } },
  };
  const e5 = await whCall(e5Body);
  log('webhook: amount mismatch = amount_mismatch', e5.status === 200 && e5.body?.status === 'amount_mismatch', JSON.stringify(e5.body));

  // ---- Section F — storefront RLS (publishable client) ----------------------
  const anonRead = await pub.from('marketplace_products').select('id, slug, is_published, is_featured').in('slug', [
    `mq-entitle-${stamp}`, `mq-unpub-${stamp}`, `mq-arch-${stamp}`,
  ]);
  const anonSlugs = (anonRead.data || []).map((r) => r.slug);
  log('storefront: published product visible to anon', anonSlugs.includes(`mq-entitle-${stamp}`), anonSlugs.join(','));
  log('storefront: unpublished product hidden from anon', !anonSlugs.includes(`mq-unpub-${stamp}`));
  log('storefront: archived product hidden from anon', !anonSlugs.includes(`mq-arch-${stamp}`));

  // ---- Section G — cleanup ---------------------------------------------------
  await admin.from('payments').delete().like('reference', `${refPrefix}%`);
  await admin.from('transactions').delete().like('reference', `${refPrefix}%`);
  await admin.from('marketplace_purchases').delete().eq('user_id', userId);
  await admin.from('marketplace_products').delete().in('id', Object.values(productIds));
  await admin.from('marketplace_sellers').delete().eq('id', thirdSellerId);
  const delErr = (await admin.auth.admin.deleteUser(userId)).error;
  log('cleanup: products/seller/purchases/user removed', !delErr, delErr?.message || '');
} catch (err) {
  console.error('FATAL', err.stack || err.message);
  try {
    await admin.from('payments').delete().like('reference', `${refPrefix}%`);
    await admin.from('transactions').delete().like('reference', `${refPrefix}%`);
    if (userId) await admin.from('marketplace_purchases').delete().eq('user_id', userId);
    const ids = Object.values(productIds).filter(Boolean);
    if (ids.length) await admin.from('marketplace_products').delete().in('id', ids);
    if (thirdSellerId) await admin.from('marketplace_sellers').delete().eq('id', thirdSellerId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  } catch (cleanupErr) {
    console.error('cleanup failed', cleanupErr.message);
  }
  process.exit(1);
}

globalThis.fetch = realFetch;
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`);
process.exit(failed.length ? 1 : 0);
