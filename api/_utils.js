import { createClient } from '@supabase/supabase-js';

// Initializing Supabase with Service Role Key for administrative tasks
export const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createClient(url, serviceKey);
};

export const generateProductKey = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let key = '';
  for (let i = 0; i < 17; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
};
