import fs from 'fs';
import path from 'path';

// Seeds the default super admin account:
//   email:    admin@apexscholars.com
//   password: changeme123
// Run AFTER .env has real Supabase credentials and SUPABASE_SETUP.sql was executed.

const envPath = path.join(process.cwd(), '.env');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m && m[2] !== '') env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const url = env.VITE_SUPABASE_URL;
const service = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !service) {
  console.error('ERROR: VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set in .env');
  console.error('Fill them in first, then re-run this script.');
  process.exit(1);
}

const ADMIN_EMAIL = 'admin@apexscholars.com';
const ADMIN_PASSWORD = 'changeme123';

async function main() {
  // 1. Check if admin already exists
  const listRes = await fetch(`${url}/auth/v1/admin/users?per_page=200`, {
    headers: { apikey: service, Authorization: `Bearer ${service}` }
  });
  const listData = await listRes.json();
  const existing = (listData.users || []).find(u => u.email === ADMIN_EMAIL);

  let userId;
  if (existing) {
    userId = existing.id;
    console.log(`Admin user already exists (${ADMIN_EMAIL}), updating...`);

    await fetch(`${url}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD, email_confirm: true })
    });
  } else {
    console.log(`Creating admin user ${ADMIN_EMAIL}...`);
    const createRes = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: 'Apex Admin', role: 'super_admin' }
      })
    });
    const created = await createRes.json();
    if (!created.id) {
      console.error('Failed to create user:', JSON.stringify(created.message || created));
      process.exit(1);
    }
    userId = created.id;
  }

  // 2. Promote profile to super_admin + activated
  //    (trigger may not have run if this is an old user — upsert defensively)
  const upsertRes = await fetch(`${url}/rest/v1/profiles`, {
    method: 'POST',
    headers: {
      apikey: service,
      Authorization: `Bearer ${service}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify({
      id: userId,
      email: ADMIN_EMAIL,
      full_name: 'Apex Admin',
      role: 'super_admin',
      is_activated: true
    })
  });

  if (!upsertRes.ok) {
    const err = await upsertRes.json().catch(() => ({}));
    console.error('Failed to promote profile:', JSON.stringify(err));
    process.exit(1);
  }

  console.log('\nSUCCESS.');
  console.log(`  Login email:    ${ADMIN_EMAIL}`);
  console.log(`  Login password: ${ADMIN_PASSWORD}`);
  console.log('  Role:           super_admin (is_activated = true)');
  console.log('\nIMPORTANT: change this password after first login in Settings.');
}

main().catch(e => {
  console.error('Script failed:', e.message);
  process.exit(1);
});
