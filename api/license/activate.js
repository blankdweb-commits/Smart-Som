// api/license/activate.js
import { getSupabaseAdmin } from '../_utils';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { product_key, user_id } = req.body;

  if (!product_key || !user_id) {
    return res.status(400).json({ error: 'Missing product key or user ID' });
  }

  const supabase = getSupabaseAdmin();

  try {
    // 1. Verify Key
    const { data: keyData, error: keyError } = await supabase
      .from('product_keys')
      .select('*')
      .eq('key_hash', product_key)
      .eq('status', 'unused')
      .single();

    if (keyError || !keyData) {
      return res.status(404).json({ error: 'Invalid or already used product key' });
    }

    // 2. Activate Key
    const { error: updateKeyError } = await supabase
      .from('product_keys')
      .update({
        user_id: user_id,
        status: 'active',
        activated_at: new Date().toISOString()
      })
      .eq('id', keyData.id);

    if (updateKeyError) throw updateKeyError;

    // 3. Activate User Profile
    const { error: profileError } = await supabase
      .from('profiles')
      .update({ is_activated: true })
      .eq('id', user_id);

    if (profileError) throw profileError;

    return res.status(200).json({ success: true, message: 'Application activated successfully' });
  } catch (error) {
    console.error('Activation error:', error);
    return res.status(500).json({ error: 'Failed to activate license' });
  }
}
