import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase URL or Anon Key is missing. Live features will be disabled.');
}

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
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
