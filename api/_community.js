// api/_community.js
//
// Support module backing the single api/community.js serverless function (the
// underscore prefix keeps Vercel from deploying this file as a separate
// function â€” the Hobby 12-function cap requires ONE file for all community
// writes). Contains every server-authoritative rule for the "Community Reset +
// Ephemeral Posts + Anonymous Group System":
//
//   - Posts are EPHEMERAL: lives_until = grace_until (legacy 24h phase-out) or
//     coalesce(last_interaction_at, created_at) + 1 hour. Interaction bumps the
//     clock with a 15-second rate limit (a single user cannot farm like/unlike
//     to keep a post alive forever).
//   - Anonymous group: join/leave/wipe are DB RPCs (service-role only, serialized
//     by advisory locks). Spectators may view + react, never post/reply.
//   - All writes are done with the service role; clients are locked out of
//     direct community_posts/comments/likes writes by migration v29 RLS.

import { getSupabaseAdmin } from './_utils.js';

// ------------------------------------------------------------
// Constants
// ------------------------------------------------------------
export const INTERACTION_COOLDOWN_MS = 15_000; // same-user bump rate limit
export const POST_LIFE_MS = 60 * 60 * 1000; // 1h idle window
export const COLD_MS = 110 * 1000; // 110s cold marker
export const MAX_CONTENT = 1000;
export const MAX_REPLY = 500;
export const MAX_REASON = 200;

const ADMIN_ROLES = ['admin', 'super_admin'];

export const err = (code, message, status = 400) => ({ code, message, status });

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// lives_until for a post row pulled from the ADMIN client (RLS bypassed):
// grace_until wins (legacy posts), else last_interaction/created + 1h.
export const computeLivesUntil = (post) => {
  if (post?.grace_until) return new Date(post.grace_until).getTime();
  const base = post?.last_interaction_at || post?.created_at;
  return new Date(base).getTime() + POST_LIFE_MS;
};

export const computePostState = (post, now = Date.now()) => {
  const base = post?.last_interaction_at || post?.created_at;
  const baseT = new Date(base).getTime();
  const lives = computeLivesUntil(post);
  if (now > lives) return 'expired';
  return now - baseT >= COLD_MS ? 'cold' : 'active';
};

export const isPostAlive = (post, now = Date.now()) =>
  !!post && !post.is_deleted && !post.is_hidden && now <= computeLivesUntil(post);

const getDb = () => getSupabaseAdmin();

// ------------------------------------------------------------
// Auth-adjacent lookups (service role, so profiles RLS is bypassed).
// ------------------------------------------------------------
export const isAdminUser = async (userId) => {
  const supabase = getDb();
  if (!userId || !supabase) return false;
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  return !!data && ADMIN_ROLES.includes(data.role);
};

export const isBanned = async (userId) => {
  const supabase = getDb();
  if (!userId || !supabase) return false;
  const { data } = await supabase
    .from('profiles')
    .select('community_banned_at')
    .eq('id', userId)
    .maybeSingle();
  return !!data?.community_banned_at;
};

// viewer role for a group (member|spectator|admin|none) â€” server side.
export const viewerRole = async (groupId, userId) => {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Servicio de configuraciÃ³n no disponible', 500);
  const { data, error } = await supabase
    .rpc('community_role_for_group', { p_group: groupId, p_user: userId });
  if (error) throw err('RPC_FAILED', error.message, 500);
  return data;
};

// can this user view content of a group?
export const canViewGroup = async (groupId, userId) => {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Servicio de configuraciÃ³n no disponible', 500);
  const { data, error } = await supabase
    .rpc('community_can_view', { p_group: groupId, p_user: userId });
  if (error) throw err('RPC_FAILED', error.message, 500);
  return !!data;
};

// Fetch a post and decide whether `userId` may see/interact with it.
export const fetchAlivePost = async (postId, userId) => {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Servicio de configuraciÃ³n no disponible', 500);
  const { data: post } = await supabase
    .from('community_posts')
    .select('*')
    .eq('id', postId)
    .maybeSingle();
  if (!post || !isPostAlive(post)) return null;
  if (post.group_id) {
    const ok = await canViewGroup(post.group_id, userId);
    if (!ok) return null;
  }
  return post;
};

// Rate-limited interaction bump. Returns true when the clock was refreshed.
// A second interaction within 15s does NOT extend the post lifetime, so a
// single user cannot toggle like/unlike to keep a post alive forever.
export const bumpInteraction = async (postId, userId) => {
  const supabase = getDb();
  if (!supabase) return false;
  const now = new Date();
  const cutoff = new Date(now.getTime() - INTERACTION_COOLDOWN_MS).toISOString();
  const { error } = await supabase
    .from('community_posts')
    .update({ last_interaction_at: now.toISOString(), last_interaction_by: userId })
    .eq('id', postId)
    .or(`last_interaction_at.is.null,last_interaction_at.lt.${cutoff}`);
  return !error;
};

// Fetch the anonymous study group row (service role).
export const fetchAnonGroup = async (groupId) => {
  const supabase = getDb();
  if (!supabase) return null;
  const { data } = await supabase
    .from('study_groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();
  return data || null;
};

// ------------------------------------------------------------
// Handlers (each resolves req.body fields; dispatch lives in community.js)
// ------------------------------------------------------------

// POST /api/community/posts  { content?, image_url?, group_id? }
export async function handleCreatePost(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const { content, image_url, group_id } = req.body || {};
  const text = typeof content === 'string' ? content.trim() : '';
  const img = typeof image_url === 'string' ? image_url.trim() : '';
  if (!text && !img) return res.status(400).json({ error: 'Content is required' });
  if (text.length > MAX_CONTENT) return res.status(400).json({ error: `Content must be under ${MAX_CONTENT} characters` });
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });

  let groupId = null;
  if (group_id !== undefined && group_id !== null) {
    groupId = Number(group_id);
    if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });

    const group = await fetchAnonGroup(groupId);
    if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND' });
    if (!group.is_active || group.group_state === 'wiped') {
      return res.status(403).json({ error: 'GROUP_CLOSED', message: 'This group is no longer active.' });
    }
    if (group.type === 'anonymous') {
      const role = await viewerRole(groupId, user.id);
      if (role === 'spectator') {
        return res.status(403).json({ error: 'SPECTATOR_READ_ONLY', message: 'Spectators can watch and react, but cannot post in the Anonymous group.' });
      }
      if (role !== 'member' && role !== 'admin') {
        return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can post in the Anonymous group.' });
      }
    } else {
      const canView = await canViewGroup(groupId, user.id);
      if (!canView) return res.status(403).json({ error: 'NOT_AUTHORIZED' });
    }
  }

  const now = new Date().toISOString();
  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({
      author_id: user.id,
      content: text,
      image_url: img,
      section: 'general',
      group_id: groupId,
      is_deleted: false,
      is_hidden: false,
      last_interaction_at: now,
      last_interaction_by: user.id,
    })
    .select('id, created_at, group_id, section, last_interaction_at, last_interaction_by, content, image_url')
    .single();

  if (error) {
    console.error('[community create]', error);
    return res.status(500).json({ error: 'Failed to create post' });
  }
  return res.status(200).json({ ok: true, post });
}

// POST /api/community/posts/reply  { post_id, content }
export async function handleReply(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = Number(req.body?.post_id);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post id' });
  if (!content) return res.status(400).json({ error: 'Reply content is required' });
  if (content.length > MAX_REPLY) return res.status(400).json({ error: `Reply must be under ${MAX_REPLY} characters` });
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });

  const post = await fetchAlivePost(postId, user.id);
  if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND', message: 'This post is no longer visible.' });
  if (post.group_id) {
    const group = await fetchAnonGroup(post.group_id);
    if (group?.type === 'anonymous') {
      const role = await viewerRole(post.group_id, user.id);
      if (role === 'spectator') {
        return res.status(403).json({ error: 'SPECTATOR_READ_ONLY', message: 'Spectators cannot reply in the Anonymous group.' });
      }
      if (role !== 'member' && role !== 'admin') {
        return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can reply in the Anonymous group.' });
      }
    }
  }

  const { data: comment, error } = await supabase
    .from('community_comments')
    .insert({ post_id: postId, author_id: user.id, content, is_deleted: false })
    .select('id, post_id, author_id, content, created_at')
    .single();
  if (error) {
    console.error('[community reply]', error);
    return res.status(500).json({ error: 'Failed to save reply' });
  }
  await bumpInteraction(postId, user.id);
  return res.status(200).json({ ok: true, comment });
}

// POST /api/community/posts/like  { post_id, liked }  (single toggle endpoint)
export async function handleLike(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = Number(req.body?.post_id);
  const liked = req.body?.liked !== false;
  if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post id' });
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });

  const post = await fetchAlivePost(postId, user.id);
  if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND', message: 'This post is no longer visible.' });

  if (liked) {
    const { error: likeErr } = await supabase
      .from('community_post_likes')
      .upsert({ post_id: postId, user_id: user.id }, { onConflict: 'post_id,user_id', ignoreDuplicates: true });
    if (likeErr) {
      console.error('[community like]', likeErr);
      return res.status(500).json({ error: 'Failed to save like' });
    }
    await bumpInteraction(postId, user.id);
  } else {
    const { error: unlikeErr } = await supabase
      .from('community_post_likes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);
    if (unlikeErr) {
      console.error('[community unlike]', unlikeErr);
      return res.status(500).json({ error: 'Failed to remove like' });
    }
  }
  return res.status(200).json({ ok: true, liked });
}

// POST /api/community/posts/delete  { post_id }
export async function handleDelete(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = Number(req.body?.post_id);
  if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const { data: post } = await supabase
    .from('community_posts')
    .select('id, author_id')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND' });
  const admin = await isAdminUser(user.id);
  if (post.author_id !== user.id && !admin) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You can only delete your own posts.' });
  }

  const { error } = await supabase
    .from('community_posts')
    .update({ is_deleted: true, is_hidden: true })
    .eq('id', postId);
  if (error) {
    console.error('[community delete]', error);
    return res.status(500).json({ error: 'Failed to delete post' });
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/posts/edit  { post_id, content?, image_url? }
export async function handleEdit(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = Number(req.body?.post_id);
  if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post id' });

  const text = typeof req.body?.content === 'string' ? req.body.content.trim() : null;
  const img = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : null;
  if (text === null && img === null) return res.status(400).json({ error: 'Nothing to update' });
  if (text !== null && text.length > MAX_CONTENT) return res.status(400).json({ error: `Content must be under ${MAX_CONTENT} characters` });

  const { data: post } = await supabase
    .from('community_posts')
    .select('id, author_id')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND' });
  if (post.author_id !== user.id) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You can only edit your own posts.' });
  }

  const patch = {};
  if (text !== null) patch.content = text;
  if (img !== null) patch.image_url = img;
  patch.updated_at = new Date().toISOString();

  const { error } = await supabase.from('community_posts').update(patch).eq('id', postId);
  if (error) {
    console.error('[community edit]', error);
    return res.status(500).json({ error: 'Failed to update post' });
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/posts/edit-comment  { comment_id, content }
export async function handleEditComment(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const commentId = Number(req.body?.comment_id);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!Number.isFinite(commentId)) return res.status(400).json({ error: 'Invalid comment id' });
  if (!content) return res.status(400).json({ error: 'Reply content is required' });
  if (content.length > MAX_REPLY) return res.status(400).json({ error: `Reply must be under ${MAX_REPLY} characters` });

  const { data: comment } = await supabase
    .from('community_comments')
    .select('id, author_id')
    .eq('id', commentId)
    .maybeSingle();
  if (!comment) return res.status(404).json({ error: 'COMMENT_NOT_FOUND' });
  if (comment.author_id !== user.id) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You can only edit your own replies.' });
  }

  const { error } = await supabase
    .from('community_comments')
    .update({ content })
    .eq('id', commentId);
  if (error) {
    console.error('[community edit comment]', error);
    return res.status(500).json({ error: 'Failed to update reply' });
  }
  return res.status(200).json({ ok: true, comment_id: commentId, content });
}

// POST /api/community/posts/delete-comment  { comment_id }
export async function handleDeleteComment(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const commentId = Number(req.body?.comment_id);
  if (!Number.isFinite(commentId)) return res.status(400).json({ error: 'Invalid comment id' });

  const { data: comment } = await supabase
    .from('community_comments')
    .select('id, author_id')
    .eq('id', commentId)
    .maybeSingle();
  if (!comment) return res.status(404).json({ error: 'COMMENT_NOT_FOUND' });
  const admin = await isAdminUser(user.id);
  if (comment.author_id !== user.id && !admin) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You can only delete your own replies.' });
  }

  const { error } = await supabase
    .from('community_comments')
    .update({ is_deleted: true })
    .eq('id', commentId);
  if (error) {
    console.error('[community delete comment]', error);
    return res.status(500).json({ error: 'Failed to delete reply' });
  }
  return res.status(200).json({ ok: true, comment_id: commentId });
}

// POST /api/community/posts/report  { post_id, reason }
export async function handleReport(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = Number(req.body?.post_id);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid post id' });
  if (!reason) return res.status(400).json({ error: 'Reason is required' });
  if (reason.length > MAX_REASON) return res.status(400).json({ error: 'Reason is too long' });
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED' });

  const { data: post } = await supabase
    .from('community_posts')
    .select('id')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND' });

  const { error } = await supabase.from('community_reports').insert({
    reporter_id: user.id,
    post_id: postId,
    reason,
    resolved: false,
  });
  if (error) {
    console.error('[community report]', error);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/groups/join  { group_id }
export async function handleJoinGroup(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const groupId = Number(req.body?.group_id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });

  const group = await fetchAnonGroup(groupId);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND' });

  if (group.type === 'anonymous') {
    if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });
    const { data, error } = await supabase.rpc('community_anonymous_join', { p_group: groupId, p_user: user.id });
    if (error) {
      console.error('[community anon join]', error);
      return res.status(500).json({ error: 'Failed to join', message: error.message });
    }
    if (!data?.ok) {
      return res.status(403).json({ error: data.code, message: data.message || 'Unable to join this group right now.', ...(data.spectator_price ? { spectator_price: data.spectator_price } : {}) });
    }
    return res.status(200).json({ ok: true, member_count: data.member_count, group_state: data.group_state, already_member: !!data.already_member });
  }

  // Normal group membership (client manages these directly).
  return res.status(400).json({ error: 'NOT_ANONYMOUS', message: 'Use the standard join flow for regular groups.' });
}

// POST /api/community/groups/leave  { group_id }
export async function handleLeaveGroup(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const groupId = Number(req.body?.group_id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });

  const group = await fetchAnonGroup(groupId);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND' });

  if (group.type === 'anonymous') {
    const { data, error } = await supabase.rpc('community_anonymous_leave', { p_group: groupId, p_user: user.id });
    if (error) {
      console.error('[community anon leave]', error);
      return res.status(500).json({ error: 'Failed to leave', message: error.message });
    }
    if (!data?.ok) {
      return res.status(400).json({ error: data.code, message: data.message || 'Unable to leave this group.' });
    }
    return res.status(200).json({ ok: true, member_count: data.member_count, group_state: data.group_state, wiped: !!data.wiped });
  }

  // Leave handled by the client for normal groups (members_delete_own policy).
  return res.status(400).json({ error: 'NOT_ANONYMOUS', message: 'Use the standard leave flow for regular groups.' });
}

// POST /api/community/groups/panel  { group_id }
export async function handlePanel(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const groupId = Number(req.body?.group_id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });

  const { data, error } = await supabase.rpc('community_panel', { p_group: groupId, p_user: user.id });
  if (error) {
    console.error('[community panel]', error);
    return res.status(500).json({ error: 'Failed to load group panel', message: error.message });
  }
  return res.status(200).json({ ok: !!data?.ok, ...(data || {}) });
}

// POST /api/community/groups/feed  { group_id, limit? }
export async function handleGroupFeed(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const groupId = Number(req.body?.group_id);
  const limit = Math.max(1, Math.min(200, Number(req.body?.limit) || 50));
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });

  const { data, error } = await supabase.rpc('community_group_feed', { p_group: groupId, p_limit: limit, p_user: user.id });
  if (error) {
    console.error('[community feed]', error);
    return res.status(500).json({ error: 'Failed to load feed', message: error.message });
  }
  return res.status(200).json({ ok: true, posts: data || [], count: (data || []).length });
}

// POST /api/community/cleanup  (header X-Cleanup-Token)
export async function handleCleanup(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const expected = process.env.COMMUNITY_CLEANUP_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'CLEANUP_NOT_CONFIGURED', message: 'COMMUNITY_CLEANUP_TOKEN is not configured.' });
  }
  const provided = req.headers['x-cleanup-token'] || '';
  if (provided !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { data, error } = await supabase.rpc('community_cleanup', { p_now: null });
  if (error) {
    console.error('[community cleanup]', error);
    return res.status(500).json({ error: 'Cleanup failed', message: error.message });
  }
  return res.status(200).json({ ok: true, result: data });
}