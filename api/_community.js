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
//   - Anonymous ROOM (chat): /anonymous/* handlers below serve the immersive
//     room — server-generated Anonymous #NN identities (anonymous_room_identities,
//     never readable by a client), direct replies (reply_to_post_id), whitelisted
//     reactions (community_post_reactions), @mention validation and masked
//     message payloads. No author_id ever leaves the server for a room message.
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

// ------------------------------------------------------------
// Anonymous room (chat) configuration — SERVER-CONTROLLED.
// The client learns the whitelist/page size from /anonymous/room;
// nothing here is duplicated in the frontend.
// ------------------------------------------------------------
export const ROOM_REACTIONS = ['👍', '😂', '❤️', '🔥', '🤔'];
export const ROOM_PAGE_SIZE = 50;
export const ROOM_MAX_LIMIT = 100;
// @Anonymous #NN — only temporary room identities may be referenced.
export const MENTION_RE = /@Anonymous\s*#(\d{1,4})/gi;

const ADMIN_ROLES = ['admin', 'super_admin'];

export const err = (code, message, status = 400) => ({ code, message, status });

// community_posts / community_comments ids are uuids (live schema). Number()
// would turn them into NaN and reject every call, so accept uuid and the
// legacy numeric form; anything else is invalid.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const parseId = (value) => {
  if (typeof value === 'string' && UUID_RE.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
};

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

  const postId = parseId(req.body?.post_id);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!postId) return res.status(400).json({ error: 'Invalid post id' });
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

  const postId = parseId(req.body?.post_id);
  const liked = req.body?.liked !== false;
  if (!postId) return res.status(400).json({ error: 'Invalid post id' });
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

  const postId = parseId(req.body?.post_id);
  if (!postId) return res.status(400).json({ error: 'Invalid post id' });

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

  const postId = parseId(req.body?.post_id);
  if (!postId) return res.status(400).json({ error: 'Invalid post id' });

  const text = typeof req.body?.content === 'string' ? req.body.content.trim() : null;
  const img = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : null;
  if (text === null && img === null) return res.status(400).json({ error: 'Nothing to update' });
  if (text !== null && text.length > MAX_CONTENT) return res.status(400).json({ error: `Content must be under ${MAX_CONTENT} characters` });

  const { data: post } = await supabase
    .from('community_posts')
    .select('id, author_id, group_id')
    .eq('id', postId)
    .maybeSingle();
  if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND' });
  if (post.author_id !== user.id) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You can only edit your own posts.' });
  }
  // Room edits must keep the same @Anonymous #NN validation as sends.
  if (post.group_id && text !== null) {
    const mentionErr = await validateRoomMentions(post.group_id, text);
    if (mentionErr) return res.status(400).json(mentionErr);
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

  const commentId = parseId(req.body?.comment_id);
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!commentId) return res.status(400).json({ error: 'Invalid comment id' });
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

  const commentId = parseId(req.body?.comment_id);
  if (!commentId) return res.status(400).json({ error: 'Invalid comment id' });

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

  const postId = parseId(req.body?.post_id);
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!postId) return res.status(400).json({ error: 'Invalid post id' });
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

// ------------------------------------------------------------
// ANONYMOUS ROOM (chat) — helpers + /anonymous/* handlers.
// Everything that identifies a human (alias mapping, author_id) stays
// server-side; clients only ever receive `alias` + masked fields.
// ------------------------------------------------------------

export const aliasLabel = (alias) => `Anonymous #${String(alias).padStart(2, '0')}`;

// Resolve an anonymous group row. Without an explicit id, pick the canonical
// room: never-wiped first, lowest id first (the seeded room wins over scratch
// rooms created by the e2e suite).
export async function resolveAnonGroup(groupId) {
  const supabase = getDb();
  if (!supabase) return null;
  if (groupId !== undefined && groupId !== null && groupId !== '') {
    const id = Number(groupId);
    if (!Number.isFinite(id)) return null;
    const { data } = await supabase
      .from('study_groups')
      .select('*')
      .eq('id', id)
      .eq('type', 'anonymous')
      .maybeSingle();
    return data || null;
  }
  const { data } = await supabase
    .from('study_groups')
    .select('*')
    .eq('type', 'anonymous')
    .order('group_state', { ascending: true }) // wiped sorts last
    .order('id', { ascending: true })
    .limit(1);
  return (data && data[0]) || null;
}

async function roomMemberCount(groupId) {
  const supabase = getDb();
  const { data } = await supabase.rpc('community_member_count', { p_group: groupId });
  return typeof data === 'number' ? data : null;
}

// Stable random room identity. Retries on 23505 (alias collision);
// PK (group_id,user_id) means a user always keeps their own number.
export async function ensureRoomAlias(groupId, userId) {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Server configuration error', 500);
  const { data: existing } = await supabase
    .from('anonymous_room_identities')
    .select('alias')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existing) return existing.alias;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const alias = 1 + Math.floor(Math.random() * 9999);
    const { data, error } = await supabase
      .from('anonymous_room_identities')
      .insert({ group_id: groupId, user_id: userId, alias })
      .select('alias')
      .single();
    if (!error) return data.alias;
    if (error.code !== '23505') {
      console.error('[anonymous room alias]', error);
      throw err('IDENTITY_FAILED', 'Could not assign a room identity.', 500);
    }
  }
  throw err('IDENTITY_EXHAUSTED', 'Could not assign a room identity.', 500);
}

async function loadRoomAliases(groupId, userIds) {
  const map = new Map();
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return map;
  const supabase = getDb();
  const { data } = await supabase
    .from('anonymous_room_identities')
    .select('user_id, alias')
    .eq('group_id', groupId)
    .in('user_id', ids);
  for (const row of data || []) map.set(row.user_id, row.alias);
  return map;
}

// @Anonymous #NN must reference a real identity in THIS room.
// Returns null when valid, or an err() payload for the response.
export async function validateRoomMentions(groupId, text) {
  const matches = [...String(text).matchAll(MENTION_RE)];
  if (!matches.length) return null;
  const supabase = getDb();
  const { data: group } = await supabase
    .from('study_groups')
    .select('type')
    .eq('id', groupId)
    .maybeSingle();
  if (group?.type !== 'anonymous') return null; // mentions only exist in the room
  const wanted = [...new Set(matches.map((m) => Number(m[1])))].filter((n) => Number.isFinite(n));
  if (!wanted.length) return null;
  const { data } = await supabase
    .from('anonymous_room_identities')
    .select('alias')
    .eq('group_id', groupId)
    .in('alias', wanted);
  const have = new Set((data || []).map((r) => r.alias));
  const missing = wanted.find((a) => !have.has(a));
  if (missing === undefined) return null;
  return err('INVALID_MENTION', `There is no ${aliasLabel(missing)} in this room.`, 400);
}

// Server-side access decision for the room. Never 403s on resolution —
// the response says which state the viewer is in.
export async function roomAccess(group, userId) {
  const banned = await isBanned(userId);
  const role = banned ? 'none' : await viewerRole(group.id, userId);
  let access;
  if (banned) access = 'banned';
  else if (group.group_state === 'wiped') access = 'wiped';
  else if (role === 'member' || role === 'admin') access = 'member';
  else if (role === 'spectator') access = 'spectator';
  else if (group.group_state === 'waiting') access = 'join';
  else access = 'closed';
  return { role, access, viewable: access === 'member' || access === 'spectator' };
}

const excerptOf = (text) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > 90 ? `${flat.slice(0, 90)}…` : flat;
};

const orderedReactions = (counts) =>
  ROOM_REACTIONS.filter((emoji) => counts?.[emoji]?.count > 0).map((emoji) => ({
    emoji,
    count: counts[emoji].count,
    mine: !!counts[emoji].mine,
  }));

// Raw room rows -> masked message payloads (NO author_id, ever).
async function hydrateRoomMessages(group, rows, viewerId, now = Date.now()) {
  if (!rows.length) return [];
  const supabase = getDb();

  const aliases = await loadRoomAliases(group.id, rows.map((r) => r.author_id));
  for (const uid of new Set(rows.map((r) => r.author_id))) {
    if (!aliases.has(uid)) aliases.set(uid, await ensureRoomAlias(group.id, uid));
  }

  const ids = rows.map((r) => r.id);
  const parentIds = [...new Set(rows.map((r) => r.reply_to_post_id).filter(Boolean))];
  const parents = new Map();
  if (parentIds.length) {
    const { data } = await supabase
      .from('community_posts')
      .select('id, author_id, content, created_at, updated_at, last_interaction_at, grace_until, is_deleted, is_hidden')
      .in('id', parentIds);
    for (const p of data || []) parents.set(p.id, p);
  }
  const parentAliases = new Map();
  for (const parent of parents.values()) {
    if (!isPostAlive(parent, now)) continue;
    let alias = (await loadRoomAliases(group.id, [parent.author_id])).get(parent.author_id);
    if (alias === undefined) alias = await ensureRoomAlias(group.id, parent.author_id);
    parentAliases.set(parent.id, alias);
  }

  const { data: reactionRows } = await supabase
    .from('community_post_reactions')
    .select('post_id, emoji, user_id')
    .in('post_id', ids);
  const countsByPost = new Map();
  for (const row of reactionRows || []) {
    if (!countsByPost.has(row.post_id)) countsByPost.set(row.post_id, {});
    const counts = countsByPost.get(row.post_id);
    if (!counts[row.emoji]) counts[row.emoji] = { count: 0, mine: false };
    counts[row.emoji].count += 1;
    if (row.user_id === viewerId) counts[row.emoji].mine = true;
  }

  return rows.map((row) => {
    let reply = null;
    if (row.reply_to_post_id) {
      const parent = parents.get(row.reply_to_post_id);
      if (parent && isPostAlive(parent, now)) {
        reply = {
          id: parent.id,
          alias: parentAliases.get(parent.id),
          author: aliasLabel(parentAliases.get(parent.id)),
          excerpt: excerptOf(parent.content),
          deleted: false,
        };
      } else {
        reply = { id: row.reply_to_post_id, alias: null, author: null, excerpt: '', deleted: true };
      }
    }
    const edited =
      !!row.updated_at &&
      new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 1000;
    return {
      id: row.id,
      content: row.content,
      created_at: row.created_at,
      edited,
      alias: aliases.get(row.author_id),
      author: aliasLabel(aliases.get(row.author_id)),
      is_mine: row.author_id === viewerId,
      reply,
      reactions: orderedReactions(countsByPost.get(row.id)),
      state: computePostState(row, now),
      lives_until: new Date(computeLivesUntil(row)).toISOString(),
    };
  });
}

const ROOM_POST_COLUMNS =
  'id, author_id, content, created_at, updated_at, last_interaction_at, grace_until, is_deleted, is_hidden, reply_to_post_id';

// POST /api/community/anonymous/room  { group_id? }
export async function handleAnonRoom(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { role, access } = await roomAccess(group, user.id);
  const viewable = access === 'member' || access === 'spectator';
  const memberCount = viewable || access === 'join' ? await roomMemberCount(group.id) : null;
  const myAlias = access === 'member' ? await ensureRoomAlias(group.id, user.id) : null;

  return res.status(200).json({
    ok: true,
    access,
    my_role: role,
    my_alias: myAlias,
    member_count: memberCount,
    group: {
      id: group.id,
      name: group.name,
      group_state: group.group_state,
      is_active: group.is_active,
      spectator_price: group.spectator_price,
    },
    thresholds: {
      activate: group.minimum_members_to_activate,
      survive: group.minimum_members_to_remain_active,
    },
    channel: `anon-room-${group.id}`,
    config: {
      reactions: ROOM_REACTIONS,
      page_size: ROOM_PAGE_SIZE,
      max_content: MAX_CONTENT,
      mention_pattern: '@Anonymous #NN',
    },
  });
}

// POST /api/community/anonymous/feed  { group_id?, before?, limit? }
export async function handleAnonFeed(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (!access || !['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: access.toUpperCase(), message: 'You cannot read this room right now.' });
  }

  const limit = Math.max(1, Math.min(ROOM_MAX_LIMIT, Number(req.body?.limit) || ROOM_PAGE_SIZE));
  const before = typeof req.body?.before === 'string' && req.body.before ? req.body.before : null;

  let query = supabase
    .from('community_posts')
    .select(ROOM_POST_COLUMNS)
    .eq('group_id', group.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) {
    console.error('[anonymous room feed]', error);
    return res.status(500).json({ error: 'Failed to load messages' });
  }

  const hasMore = data.length > limit;
  const page = data.slice(0, limit);
  const alive = page.filter((row) => isPostAlive(row));
  const messages = (await hydrateRoomMessages(group, alive, user.id)).reverse(); // oldest first
  return res.status(200).json({ ok: true, messages, has_more: hasMore });
}

// POST /api/community/anonymous/message  { message_id, group_id? }
export async function handleAnonMessage(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (!access || !['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: access.toUpperCase(), message: 'You cannot read this room right now.' });
  }

  const messageId = parseId(req.body?.message_id);
  if (!messageId) return res.status(400).json({ error: 'Invalid message id' });

  const { data: row } = await supabase
    .from('community_posts')
    .select(ROOM_POST_COLUMNS)
    .eq('id', messageId)
    .eq('group_id', group.id)
    .maybeSingle();
  // 404 = removed / expired / wiped — the caller drops the message.
  if (!row || !isPostAlive(row)) return res.status(404).json({ error: 'MESSAGE_NOT_FOUND' });

  const [message] = await hydrateRoomMessages(group, [row], user.id);
  return res.status(200).json({ ok: true, message });
}

// POST /api/community/anonymous/send  { content, group_id?, reply_to_post_id? }
export async function handleAnonSend(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (access === 'banned') return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });
  if (access === 'wiped') return res.status(403).json({ error: 'GROUP_WIPED', message: 'This round has been wiped. Nothing persists.' });
  if (access === 'spectator') return res.status(403).json({ error: 'SPECTATOR_READ_ONLY', message: 'Spectators can watch and react, but cannot speak.' });
  if (access !== 'member') return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can speak in the Anonymous room.' });

  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) return res.status(400).json({ error: 'CONTENT_REQUIRED', message: 'Message content is required.' });
  if (content.length > MAX_CONTENT) return res.status(400).json({ error: 'CONTENT_TOO_LONG', message: `Message must be under ${MAX_CONTENT} characters.` });

  const mentionErr = await validateRoomMentions(group.id, content);
  if (mentionErr) return res.status(400).json({ error: mentionErr.code, message: mentionErr.message });

  let replyTo = null;
  if (req.body?.reply_to_post_id !== undefined && req.body?.reply_to_post_id !== null) {
    replyTo = parseId(req.body.reply_to_post_id);
    if (!replyTo) return res.status(400).json({ error: 'INVALID_REPLY', message: 'Invalid reply target.' });
    const { data: parent } = await supabase
      .from('community_posts')
      .select('id, group_id')
      .eq('id', replyTo)
      .maybeSingle();
    if (!parent || parent.group_id !== group.id || !isPostAlive(parent)) {
      return res.status(404).json({ error: 'REPLY_NOT_FOUND', message: 'That message is gone.' });
    }
  }

  const now = new Date().toISOString();
  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({
      author_id: user.id,
      content,
      section: 'general',
      group_id: group.id,
      is_deleted: false,
      is_hidden: false,
      last_interaction_at: now,
      last_interaction_by: user.id,
      ...(replyTo ? { reply_to_post_id: replyTo } : {}),
    })
    .select(ROOM_POST_COLUMNS)
    .single();
  if (error) {
    console.error('[anonymous room send]', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }

  const [message] = await hydrateRoomMessages(group, [post], user.id);
  return res.status(200).json({ ok: true, message });
}

// POST /api/community/anonymous/react  { message_id, emoji, active, group_id? }
export async function handleAnonReact(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (access === 'banned') return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });
  if (access === 'wiped') return res.status(403).json({ error: 'GROUP_WIPED', message: 'This round has been wiped.' });
  if (!['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can interact in the Anonymous room.' });
  }

  const messageId = parseId(req.body?.message_id);
  if (!messageId) return res.status(400).json({ error: 'Invalid message id' });
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : '';
  if (!ROOM_REACTIONS.includes(emoji)) {
    return res.status(400).json({ error: 'REACTION_NOT_ALLOWED', message: 'That reaction is not available.' });
  }
  const active = req.body?.active !== false;

  const { data: post } = await supabase
    .from('community_posts')
    .select('id, group_id, author_id')
    .eq('id', messageId)
    .maybeSingle();
  if (!post || post.group_id !== group.id || !isPostAlive(post)) {
    return res.status(404).json({ error: 'MESSAGE_NOT_FOUND', message: 'This message is no longer visible.' });
  }

  if (active) {
    const { error } = await supabase
      .from('community_post_reactions')
      .upsert({ post_id: messageId, user_id: user.id, emoji }, { onConflict: 'post_id,user_id,emoji', ignoreDuplicates: true });
    if (error) {
      console.error('[anonymous room react]', error);
      return res.status(500).json({ error: 'Failed to save reaction' });
    }
    // Same server rule as likes: interacting bumps the 1h life clock,
    // rate-limited so one user cannot keep a message alive forever.
    if (post.author_id !== user.id) await bumpInteraction(messageId, user.id);
  } else {
    const { error } = await supabase
      .from('community_post_reactions')
      .delete()
      .eq('post_id', messageId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
    if (error) {
      console.error('[anonymous room unreact]', error);
      return res.status(500).json({ error: 'Failed to remove reaction' });
    }
  }

  const { data: rows } = await supabase
    .from('community_post_reactions')
    .select('emoji, user_id')
    .eq('post_id', messageId);
  const counts = {};
  for (const row of rows || []) {
    if (!counts[row.emoji]) counts[row.emoji] = { count: 0, mine: false };
    counts[row.emoji].count += 1;
    if (row.user_id === user.id) counts[row.emoji].mine = true;
  }
  return res.status(200).json({ ok: true, reactions: orderedReactions(counts) });
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