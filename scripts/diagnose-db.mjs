import fs from 'fs';
import path from 'path';

const envPath = path.join(process.cwd(), '.env');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = env.VITE_SUPABASE_URL;
const anon = env.VITE_SUPABASE_ANON_KEY;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

console.log('--- CONFIG ---');
console.log('VITE_SUPABASE_URL set:', !!url, url ? `(${url.replace(/https?:\/\//, '').split('.')[0]}.supabase.co)` : '');
console.log('ANON key present:', !!anon);
console.log('SERVICE key present:', !!service);

if (!url || !service) {
  console.error('Missing URL or service key; cannot diagnose.');
  process.exit(1);
}

// 1. Enumerate public tables via OpenAPI introspection
try {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` }
  });
  const spec = await res.json();
  const tables = Object.keys(spec.definitions || {});
  console.log('\n--- PUBLIC TABLES/VIEWS ---');
  console.log(tables.length ? tables.join(', ') : '(none found)');
} catch (e) {
  console.error('OpenAPI introspection failed:', e.message);
}

// 2. List existing auth users (count + first emails)
try {
  const res = await fetch(`${url}/auth/v1/admin/users?per_page=50`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` }
  });
  const data = await res.json();
  const users = data.users || [];
  console.log('\n--- AUTH USERS ---');
  console.log('total (this page):', users.length);
  users.forEach(u => console.log(`- ${u.email} | confirmed=${!!u.email_confirmed_at || !!u.confirmed_at} | created=${u.created_at}`));
} catch (e) {
  console.error('Auth user listing failed:', e.message);
}

// 3. Create a temp confirmed test user, check if profiles row auto-appears (trigger check), then clean up
const testEmail = `diag-${Date.now()}@apex-diagnostic.local`;
try {
  const createRes = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: 'diag-' + Math.random().toString(36).slice(2), email_confirm: true, user_metadata: { full_name: 'Diag Test' } })
  });
  const created = await createRes.json();
  if (!created.id) {
    console.log('\n--- TRIGGER TEST --- could not create test user:', JSON.stringify(created.message || created));
  } else {
    await new Promise(r => setTimeout(r, 1500));
    const profRes = await fetch(`${url}/rest/v1/profiles?id=eq.${created.id}&select=*`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` }
    });
    const profData = await profRes.json();
    console.log('\n--- TRIGGER TEST (auto profile creation) ---');
    console.log(profData && profData.length > 0
      ? `PASS: profiles row exists for new user -> ${JSON.stringify(profData[0])}`
      : 'FAIL: NO profiles row created automatically -> on_auth_user_created trigger is MISSING or broken');

    // cleanup
    await fetch(`${url}/auth/v1/admin/users/${created.id}`, {
      method: 'DELETE',
      headers: { apikey: service, Authorization: `Bearer ${service}` }
    });
    await fetch(`${url}/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'DELETE',
      headers: { apikey: service, Authorization: `Bearer ${service}` }
    });
    console.log('(test user cleaned up)');
  }
} catch (e) {
  console.error('Trigger test failed:', e.message);
}

// 4. Check subscription_plans content
try {
  const res = await fetch(`${url}/rest/v1/subscription_plans?select=*`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` }
  });
  const data = await res.json();
  console.log('\n--- SUBSCRIPTION PLANS ---');
  console.log(Array.isArray(data) ? JSON.stringify(data) : JSON.stringify(data.message || data));
} catch (e) {
  console.error('Plans check failed:', e.message);
}
