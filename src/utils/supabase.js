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

// ---------------------------------------------------------------------------
// getAuthUserId — the current user's uuid, deduped.
//
// WHY THIS EXISTS: `supabase.auth.getUser()` does NOT read from localStorage.
// It takes GoTrue's navigator lock `lock:supabase-auth-token` and holds it
// across a NETWORK round-trip to /auth/v1/user so the JWT is validated. Several
// components calling it in the same commit therefore queue on that lock, and
// once the queue passes 5s gotrue-js logs
//   "Lock ... was not released within 5000ms ... Forcefully acquiring"
// which stalls every other auth-touching call in the app (it also causes the
// empty text/plain 500s from /api/session/touch, because that path can no
// longer resolve an access token).
//
// React StrictMode double-invokes mount effects, so a page with two effects
// that each called getUser() issued FOUR concurrent calls and tripped this
// reliably. This helper collapses any number of concurrent callers into ONE
// lock acquisition, so the herd never forms.
//
// PREFER THE CONTEXT: most components already have `session?.user?.id` from
// AppContext, which is synchronous and takes no lock at all. Use this only
// where a component genuinely has no session to hand.
// ---------------------------------------------------------------------------
let userIdFlight = null;

export const getAuthUserId = async () => {
  if (!supabase) return null;
  if (!userIdFlight) {
    userIdFlight = supabase.auth.getUser()
      .then(({ data }) => data?.user?.id || null)
      .catch(() => null)
      .finally(() => {
        userIdFlight = null;
      });
  }
  return userIdFlight;
};

// Same dedupe, returning the whole user object for callers that need more
// than the id (e.g. checking `is_anonymous` before a write). Shares ONE
// in-flight request with getAuthUserId via the authUserFlight.
let authUserFlight = null;

export const getAuthUser = async () => {
  if (!supabase) return null;
  if (!authUserFlight) {
    authUserFlight = supabase.auth.getUser()
      .then(({ data }) => data?.user || null)
      .catch(() => null)
      .finally(() => {
        authUserFlight = null;
        userIdFlight = null;
      });
  }
  return authUserFlight;
};

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
