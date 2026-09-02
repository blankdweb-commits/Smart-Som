// scripts/grant-premium.mjs
// Grants 1 month of premium (subscriptions row + is_activated) to a list of
// paying user emails against the live Supabase project.
//
// Uses the Management API SQL endpoint (batch, atomic) so lookups and writes
// happen in one transaction per user. Credentials read from .env or shell env.
//
// Usage: node scripts/grant-premium.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const loadEnv = () => {
  const env = {};
  const p = path.join(ROOT, '.env');
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
const PROJECT_REF = (env.VITE_SUPABASE_URL || '').replace('https://', '').split('.')[0];
const TOKEN = env.SUPABASE_ACCESS_TOKEN || env.ACCESS_TOKEN;

if (!PROJECT_REF || !TOKEN) {
  console.error('Missing SUPABASE_ACCESS_TOKEN (or ACCESS_TOKEN) / VITE_SUPABASE_URL in .env');
  process.exit(1);
}

const TARGETS = [
  'osagielizabeth33@gmail.com',
  'efoleanita929@gmail.com',
  'onyenajufavour772@gmail.com'
];

const MONTHS = 1;
const DAYS = 30;
const GRACE_DAYS = 2;
const AMOUNT = 6999.00;

const mgmt = async (sql) => {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: sql })
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { ok: res.ok, status: res.status, body: parsed };
};

console.log(`Project: ${PROJECT_REF}`);
console.log(`Granting ${MONTHS} month premium to ${TARGETS.length} emails\n`);

let ok = 0, fail = 0;

for (const email of TARGETS) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const token = `manual-grant-${unique}`;

  const sql = `
    do $$
    declare v_user_id uuid;
    begin
      select id into v_user_id from auth.users where email = '${email.replace(/'/g, "''")}' limit 1;
      if v_user_id is null then
        raise exception 'USER_NOT_FOUND';
      end if;

      insert into public.subscriptions
        (user_id, plan, status, expires_at, grace_until, amount, reference)
      values
        (v_user_id, 'monthly', 'active',
         now() + interval '${DAYS} days',
         now() + interval '${DAYS + GRACE_DAYS} days',
         ${AMOUNT}, '${token}');

      update public.profiles set is_activated = true where id = v_user_id;
    end $$;
  `;

  const { ok: resOk, status, body } = await mgmt(sql);
  if (resOk) {
    ok++;
    console.log(`GRANTED  ${email}  (+${DAYS}d, grace +${GRACE_DAYS}d)`);
  } else {
    fail++;
    const msg = typeof body === 'string' ? body : JSON.stringify(body).slice(0, 400);
    if (msg.includes('USER_NOT_FOUND')) {
      console.error(`MISSING  ${email}  ->  no auth user with this email`);
    } else {
      console.error(`FAIL     ${email}  ->  HTTP ${status}: ${msg}`);
    }
  }
}

console.log(`\nGranted ${ok}, failed ${fail}`);
process.exit(fail ? 1 : 0);
