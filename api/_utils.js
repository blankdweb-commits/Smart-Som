import { createClient } from '@supabase/supabase-js';

// Initializing Supabase with Service Role Key for administrative tasks
export const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createClient(url, serviceKey);
};

export const generateProductKey = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const gen = (len) => Array.from({ length: len }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
  const year = new Date().getFullYear();
  return `APEX-${gen(5)}-${gen(5)}-${year}`;
};
