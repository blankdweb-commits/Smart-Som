import { createClient } from '@supabase/supabase-js';

// Service-role client for administrative server-side tasks.
export const getSupabaseAdmin = () => {
  const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Supabase environment variables are missing in production');
    }
    console.warn('Supabase environment variables are missing. Using local mock/fail mode.');
    return null;
  }

  return createClient(url, serviceKey);
};

// Resolve the authenticated user server-side from a Supabase access token.
// Never trust user identifiers supplied in request bodies.
export const getUserFromRequest = async (req) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  } catch {
    return null;
  }
};
