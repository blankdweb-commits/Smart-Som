// TEMP debug: why is the anonymous member feed empty? (delete after use)
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from './e2e-utils.mjs';

const env = loadEnv();
const admin = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const stamp = Date.now().toString().slice(-8);
const password = 'testpass123';
let users = [];
let scratchGroupId = null;

try {
  const makeUser = async (tag) => {
    const email = `dbg-${tag}-${stamp}@apextest.local`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Dbg ${tag}` } });
    if (error) throw error;
    users.push(data.user);
    return data.user.id;
  };

  const ownerId = await makeUser('owner');
  const { data: grp, error: gErr } = await admin
    .from('study_groups')
    .insert({ name: `Dbg Anon ${stamp}`, description: 'debug', creator_id: ownerId, is_verified: true, member_limit: 30, is_active: true, type: 'anonymous', privacy: 'restricted', spectator_price: 599, minimum_members_to_activate: 30, minimum_members_to_remain_active: 18, group_state: 'waiting' })
    .select('id').single();
  if (gErr) throw gErr;
  scratchGroupId = grp.id;
  const { error: ownerJoin } = await admin.from('study_group_members').insert({ group_id: scratchGroupId, user_id: ownerId, role: 'owner' });
  if (ownerJoin) throw ownerJoin;
  console.log('group', scratchGroupId, 'owner member insert ok');

  // activate by filling seats 2..30
  for (let i = 1; i <= 29; i++) {
    const uid = await makeUser(`u${i}`);
    const { data: join, error: je } = await admin.rpc('community_anonymous_join', { p_group: scratchGroupId, p_user: uid });
    if (je) console.log('join err', i, je.message);
    else if (i === 1 || i === 29) console.log('join', i, '->', JSON.stringify(join));
  }
  const { data: grpAfter } = await admin.from('study_groups').select('group_state').eq('id', scratchGroupId).single();
  console.log('group_state after 29 joins (owner holds seat 1):', grpAfter?.group_state);

  const postAuthorId = users[1].id;
  const { data: postRow, error: insErr } = await admin.from('community_posts').insert({
    author_id: postAuthorId, content: `masked msg ${stamp}`, section: 'general', group_id: scratchGroupId
  }).select('id, content').single();
  console.log('post insert:', insErr ? 'ERR ' + insErr.message : JSON.stringify(postRow));

  const panel = await admin.rpc('community_panel', { p_group: scratchGroupId, p_user: ownerId });
  console.log('panel owner:', JSON.stringify(panel.data));

  const feed = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: ownerId });
  console.log('feed error:', feed.error ? JSON.stringify(feed.error) : 'none');
  console.log('feed rows:', feed.data ? feed.data.length : 'null');
  console.log('feed sample:', JSON.stringify((feed.data || []).slice(0, 3)));

  const feedU1 = await admin.rpc('community_group_feed', { p_group: scratchGroupId, p_limit: 50, p_user: postAuthorId });
  console.log('feed as u1 rows:', feedU1.data ? feedU1.data.length : 'null', 'err:', feedU1.error ? JSON.stringify(feedU1.error) : 'none');
} catch (e) {
  console.log('DEBUG FLOW ERROR:', e.message);
} finally {
  if (scratchGroupId) {
    await admin.from('study_group_members').delete().eq('group_id', scratchGroupId);
    await admin.from('community_posts').delete().eq('group_id', scratchGroupId);
    await admin.from('study_groups').delete().eq('id', scratchGroupId);
  }
  for (const u of users) await admin.auth.admin.deleteUser(u.id).catch(() => {});
}