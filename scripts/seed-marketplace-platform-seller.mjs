// scripts/seed-marketplace-platform-seller.mjs
// Seeds the PolyNurse PLATFORM seller (idempotent). First-party / checkout-
// eligible products are those whose seller is this platform storefront. Run:
//   node scripts/seed-marketplace-platform-seller.mjs
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const PLATFORM_SELLER_NAME = 'PolyNurse';

const env = loadEnv();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: existing } = await admin
  .from('marketplace_sellers')
  .select('id, business_name')
  .eq('business_name', PLATFORM_SELLER_NAME)
  .maybeSingle();

if (existing) {
  console.log(`Platform seller already exists: id=${existing.id} name=${existing.business_name}`);
} else {
  const { data: created, error } = await admin
    .from('marketplace_sellers')
    .insert({
      business_name: PLATFORM_SELLER_NAME,
      description: 'Official PolyNurse storefront. Products sold and delivered by PolyNurse.',
      contact_email: 'admin@polynurse.com.ng',
      is_verified: true,
      verification_status: 'approved',
      verified_at: new Date().toISOString(),
    })
    .select('id, business_name')
    .single();
  if (error) {
    console.error('Seed failed:', error.message);
    process.exit(1);
  }
  console.log(`Platform seller created: id=${created.id} name=${created.business_name}`);
}