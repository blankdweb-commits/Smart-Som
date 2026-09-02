import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// New-format Supabase projects expose a publishable key (sb_publishable_...)
// that replaces the legacy anon JWT for browser clients. Prefer it, fall back
// to the legacy name so old env files keep working.
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('Supabase URL or Anon/Publishable Key is missing. Live features will be disabled.');
}

export const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Storage Helpers
export const uploadFile = async (bucket, path, file) => {
  if (!supabase) return null;
  const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
    upsert: true
  });
  if (error) throw error;
  return data;
};

export const getPublicUrl = (bucket, path) => {
  if (!supabase) return '';
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
};

// Helper to check if Supabase is properly configured
export const isSupabaseConfigured = () => !!supabase;
