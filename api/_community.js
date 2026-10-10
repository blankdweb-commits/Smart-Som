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
import { sendRoomPush } from './_push.js';

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

// ------------------------------------------------------------
// Tags, social actions, presence. All SERVER allowlists.
// Stickers were removed entirely (no sticker picker, payload, or glyph) —
// the room uses ONLY the action/tag set below.
// ------------------------------------------------------------

// v46 — the old message "tag" set is REPLACED by the room ACTION set. Each
// action carries a kind: 'affection' | 'attack' | 'play'. Two reciprocal
// attacks inside the fight window start ONE (deduped) fight.
export const ROOM_ACTIONS = [
  { key: 'slap', glyph: '👉', label: 'Slap', kind: 'attack', tone: 'rose' },
  { key: 'kick', glyph: '🦵', label: 'Kick', kind: 'attack', tone: 'rose' },
  { key: 'hug', glyph: '🤗', label: 'Hug', kind: 'affection', tone: 'amber' },
  { key: 'highfive', glyph: '🙌', label: 'High five', kind: 'affection', tone: 'emerald' },
  { key: 'kiss', glyph: '😘', label: 'Kiss', kind: 'affection', tone: 'pink' },
  { key: 'danceoff', glyph: '💃', label: 'Dance-off', kind: 'play', tone: 'violet' },
  { key: 'wave', glyph: '👋', label: 'Wave', kind: 'affection', tone: 'sky' },
  { key: 'challenge', glyph: '⚔️', label: 'Challenge', kind: 'play', tone: 'indigo' },
];
export const ROOM_ACTION_KEYS = new Set(ROOM_ACTIONS.map((a) => a.key));
export const ROOM_TAGS = ROOM_ACTIONS; // backward-compatible alias
export const ROOM_TAG_KEYS = ROOM_ACTION_KEYS;
export const SOCIAL_ACTIONS = ROOM_ACTIONS;
export const SOCIAL_ACTION_KEYS = ROOM_ACTION_KEYS;
export const ATTACK_ACTION_KEYS = new Set(
  ROOM_ACTIONS.filter((a) => a.kind === 'attack').map((a) => a.key),
);
export const SOCIAL_COOLDOWN_MS = 8_000;

export const PRESENCE_GRACE_SECONDS = 45;
export const PRESENCE_INACTIVITY_SECONDS = 300;
export const ENCODED_MAX = MAX_CONTENT;

// ------------------------------------------------------------
// v46 — anonymous lifetime + vote adjustments + membership activity + fights.
// These MIRROR the server_config seeds in migration v46; the SQL functions are
// the authority for enforcement, these drive the values exposed to the client.
// ------------------------------------------------------------
export const MESSAGE_LIFETIME_SECONDS = 600; // 10 minutes (was 300)
export const UPVOTE_THRESHOLD = 7; // +vote_adjust at >= 7 upvotes
export const DOWNVOTE_THRESHOLD = 10; // -vote_adjust at >= 10 downvotes
export const VOTE_ADJUST_SECONDS = 180; // ±3 minutes, applied once
export const FIGHT_WINDOW_SECONDS = 30; // reciprocal attack window
export const MEMBERSHIP_ACTIVITY_SECONDS = 900; // 15-min idle deadline
export const MEMBERSHIP_WARNING_SECONDS = 600; // warn at 10 min

// Absolute lifetime ceiling (mirrors the v41 SQL community_post_lives_until).
// No amount of interaction can keep a message alive beyond 6 hours.
export const MAX_POST_LIFE_MS = 6 * 60 * 60 * 1000;

// Versioned safety notice members must acknowledge before they can speak.
export const ROOM_NOTICE = { key: 'anonymous_room_safety', version: 4 };

// Reporting: fixed categories + a per-user hourly rate limit.
export const REPORT_CATEGORIES = ['harassment', 'spam', 'self_harm', 'hate', 'sexual', 'personal_info', 'other'];
export const REPORT_RATE_LIMIT = 12; // max reports per user per hour
export const REPORT_RATE_WINDOW_MS = 60 * 60 * 1000;

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

// lives_until for a post row pulled from the ADMIN client (RLS bypassed).
// ABSOLUTE expiry wins: anonymous-group messages carry `expires_at`
// (created_at + 5 min, assigned by the v43 DB trigger and never resettable),
// so interactions cannot extend them. Everything else keeps the legacy
// grace_until / last_interaction+1h model, clamped to created_at + 6h.
export const computeLivesUntil = (post) => {
  if (post?.expires_at) {
    const exp = new Date(post.expires_at).getTime();
    if (Number.isFinite(exp)) return exp;
  }
  const created = new Date(post?.created_at).getTime();
  let lives;
  if (post?.grace_until) {
    lives = new Date(post.grace_until).getTime();
  } else {
    const base = post?.last_interaction_at || post?.created_at;
    lives = new Date(base).getTime() + POST_LIFE_MS;
  }
  return Math.min(lives, Number.isFinite(created) ? created + MAX_POST_LIFE_MS : lives);
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
// Realtime fan-out (server-mediated). The browser client subscribes to the
// PUBLIC broadcast channel `anon-room-<id>`; RLS blocks it from the underlying
// tables (v39), so we push a NOTIFICATION-ONLY event over the Realtime HTTP
// broadcast API. Payloads never carry message content or author_id — clients
// always re-fetch through the authorized /api/community/anonymous/* endpoints.
// Fire-and-forget: a broadcast failure must never fail the write.
// ------------------------------------------------------------
export const roomChannel = (groupId) => `anon-room-${groupId}`;

export async function publishRoomEvent(groupId, type, extra = {}) {
  const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const id = Number(groupId);
  if (!url || !key || !Number.isFinite(id) || id <= 0) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            topic: roomChannel(id),
            event: 'room',
            payload: { type, at: Date.now(), ...extra },
            private: false,
          },
        ],
      }),
      signal: controller.signal,
    });
    return res.ok;
  } catch (e) {
    // Broadcast is best-effort; clients also poll + refetch on reconnect.
    console.error('[room broadcast]', e?.message || e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Has the user accepted the current safety notice (versioned)?
export async function hasNoticeAck(userId) {
  const supabase = getDb();
  if (!supabase) return false;
  const { data } = await supabase
    .from('community_notice_acks')
    .select('version')
    .eq('user_id', userId)
    .eq('notice_key', ROOM_NOTICE.key)
    .maybeSingle();
  return !!data && Number(data.version) >= ROOM_NOTICE.version;
}

// SERVER-AUTHORITATIVE premium check (mirrors AppContext but never trusts the
// client). Active when the latest subscription has not expired, or is in grace.
export async function isPremiumUser(userId) {
  const supabase = getDb();
  if (!supabase || !userId) return false;
  try {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('expires_at, grace_until')
      .eq('user_id', userId)
      .order('expires_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return false;
    const now = Date.now();
    const exp = data.expires_at ? new Date(data.expires_at).getTime() : 0;
    const grace = data.grace_until ? new Date(data.grace_until).getTime() : 0;
    return (Number.isFinite(exp) && exp > now) || (Number.isFinite(grace) && grace > now);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// v44 optional side-tables. Every loader degrades gracefully when the v44
// migration has not been applied yet (returns an empty map, never throws),
// so the base room keeps working on a pre-v44 database.
// ------------------------------------------------------------
async function loadMessageMeta(ids) {
  const map = new Map();
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return map;
  const supabase = getDb();
  if (!supabase) return map;
  try {
    const { data, error } = await supabase
      .from('anonymous_message_meta')
      .select('post_id, tag, is_encoded')
      .in('post_id', list);
    if (error) return map;
    for (const row of data || []) map.set(row.post_id, row);
  } catch {
    /* v44 not applied yet */
  }
  return map;
}

async function loadEncodedBodies(ids) {
  const map = new Map();
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return map;
  const supabase = getDb();
  if (!supabase) return map;
  try {
    const { data, error } = await supabase
      .from('anonymous_encoded_messages')
      .select('post_id, cipher_text, recipient_user_id')
      .in('post_id', list);
    if (error) return map;
    for (const row of data || []) {
      map.set(row.post_id, { cipher: row.cipher_text, recipient: row.recipient_user_id });
    }
  } catch {
    /* v44 not applied yet */
  }
  return map;
}

async function loadSocialCounts(ids, viewerId) {
  const byPost = new Map();
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return byPost;
  const supabase = getDb();
  if (!supabase) return byPost;
  try {
    const { data, error } = await supabase
      .from('anonymous_social_actions')
      .select('post_id, action, actor_id')
      .in('post_id', list);
    if (error) return byPost;
    for (const row of data || []) {
      if (!byPost.has(row.post_id)) byPost.set(row.post_id, {});
      const counts = byPost.get(row.post_id);
      if (!counts[row.action]) counts[row.action] = { count: 0, mine: false };
      counts[row.action].count += 1;
      if (row.actor_id === viewerId) counts[row.action].mine = true;
    }
  } catch {
    /* v44 not applied yet */
  }
  return byPost;
}

const decodeEncoded = (cipher) => {
  if (!cipher) return '';
  try {
    return Buffer.from(String(cipher), 'base64').toString('utf8');
  } catch {
    return '';
  }
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

// POST /api/community/posts/vote  { post_id, value: 1 | -1 | 0 }
// Server-authoritative up/down vote. value 0 clears the caller's vote (the row
// is deleted — "no row" == neutral), 1/-1 upserts to one vote per (post, user).
// The returned score is computed from the votes table, never trusted from the
// client. Rate-limited like any interaction so a single user can't keep a post
// alive just by toggling votes.
export async function handleVote(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = parseId(req.body?.post_id);
  if (!postId) return res.status(400).json({ error: 'Invalid post id' });

  const rawValue = req.body?.value;
  const value = rawValue === undefined ? 1 : Number(rawValue);
  if (![1, -1, 0].includes(value)) {
    return res.status(400).json({ error: 'INVALID_VOTE', message: 'Vote must be -1, 1, or 0 to clear.' });
  }
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });

  const post = await fetchAlivePost(postId, user.id);
  if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND', message: 'This post is no longer visible.' });

  let writeError = null;
  if (value === 0) {
    const { error } = await supabase
      .from('community_post_votes')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', user.id);
    writeError = error;
  } else {
    const { error } = await supabase
      .from('community_post_votes')
      .upsert({ post_id: postId, user_id: user.id, value }, { onConflict: 'post_id,user_id' });
    writeError = error;
  }
  if (writeError) {
    console.error('[community vote]', writeError);
    return res.status(500).json({ error: 'Failed to record vote' });
  }

  await bumpInteraction(postId, user.id);

  // S2 — anonymous vote adjustments (+3 min at >=7 up, -3 min at >=10 down,
  // applied once, never reviving an expired message). S4 — voting is activity.
  let expiresAt = null;
  if (post.group_id) {
    expiresAt = await applyVoteExpiry(postId);
    void touchMembership(post.group_id, user.id);
  }

  const { data: rows } = await supabase
    .from('community_post_votes')
    .select('user_id, value')
    .eq('post_id', postId);
  const score = (rows || []).reduce((sum, r) => sum + (r.value || 0), 0);
  const myVote = (rows || []).find((r) => r.user_id === user.id)?.value ?? 0;
  return res.status(200).json({ ok: true, score, my_vote: myVote, expires_at: expiresAt });
}

// POST /api/community/posts/delete  { post_id }
export async function handleDelete(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = parseId(req.body?.post_id);
  if (!postId) return res.status(400).json({ error: 'Invalid post id' });

  const { data: post } = await supabase
    .from('community_posts')
    .select('id, author_id, group_id')
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
  if (post.group_id) publishRoomEvent(post.group_id, 'delete', { id: postId });
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
  if (post.group_id) publishRoomEvent(post.group_id, 'edit', { id: postId });
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

// POST /api/community/posts/report  { post_id|comment_id, reason, category?, details? }
export async function handleReport(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const postId = req.body?.post_id != null ? parseId(req.body.post_id) : null;
  const commentId = req.body?.comment_id != null ? parseId(req.body.comment_id) : null;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  const details = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
  const category = REPORT_CATEGORIES.includes(req.body?.category) ? req.body.category : 'other';

  if (!postId && !commentId) return res.status(400).json({ error: 'Invalid report target' });
  if (!reason) return res.status(400).json({ error: 'Reason is required' });
  if (reason.length > MAX_REASON || details.length > MAX_REASON) {
    return res.status(400).json({ error: 'Report details are too long' });
  }
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED' });

  // The target must exist (service role read — RLS bypassed for moderation).
  if (postId) {
    const { data: post } = await supabase.from('community_posts').select('id').eq('id', postId).maybeSingle();
    if (!post) return res.status(404).json({ error: 'POST_NOT_FOUND' });
  } else {
    const { data: comment } = await supabase.from('community_comments').select('id').eq('id', commentId).maybeSingle();
    if (!comment) return res.status(404).json({ error: 'COMMENT_NOT_FOUND' });
  }

  // Per-user rate limit (server-side; cannot be bypassed by the client).
  const since = new Date(Date.now() - REPORT_RATE_WINDOW_MS).toISOString();
  const { count } = await supabase
    .from('community_reports')
    .select('id', { count: 'exact', head: true })
    .eq('reporter_id', user.id)
    .gte('created_at', since);
  if ((count || 0) >= REPORT_RATE_LIMIT) {
    return res.status(429).json({ error: 'REPORT_RATE_LIMITED', message: 'Too many reports. Please wait a little while.' });
  }

  // One open report per user per target.
  let dupQuery = supabase
    .from('community_reports')
    .select('id')
    .eq('reporter_id', user.id)
    .eq('status', 'pending');
  dupQuery = postId ? dupQuery.eq('post_id', postId) : dupQuery.eq('comment_id', commentId);
  const { data: dup } = await dupQuery.limit(1).maybeSingle();
  if (dup) return res.status(200).json({ ok: true, duplicate: true });

  const { error } = await supabase.from('community_reports').insert({
    reporter_id: user.id,
    post_id: postId,
    comment_id: postId ? null : commentId,
    reason,
    category,
    details: details || null,
    status: 'pending',
  });
  if (error) {
    console.error('[community report]', error);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/anonymous/room-create  { name? }
// Opens a NEW Anonymous room with the caller as owner + first member. Service-
// role only (clients cannot INSERT type='anonymous' study_groups — v29 RLS
// forbids it), so thresholds/price/lock come from server defaults, never the
// client. Returns the new room id; the client navigates to /anonymous/:id.
export async function handleCreateAnonRoom(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });

  const requested = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 120) : '';
  const name = requested || `Anonymous Nursing Room ${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const { data: group, error } = await supabase
    .from('study_groups')
    .insert({
      name,
      description: 'Anonymous study room — membership opens when the room fills up.',
      creator_id: user.id,
      type: 'anonymous',
      privacy: 'restricted',
      group_state: 'waiting',
      membership_locked: false,
    })
    .select('id, name, member_limit, minimum_members_to_activate, minimum_members_to_remain_active, spectator_price, group_state')
    .single();

  if (error) {
    console.error('[community create-anon-room]', error);
    return res.status(500).json({ error: 'Failed to create the room', message: 'Could not create a new Anonymous room right now.' });
  }

  // Owner is member #1: without this the room would have no one in it.
  const { error: memberErr } = await supabase
    .from('study_group_members')
    .insert({ group_id: group.id, user_id: user.id, role: 'owner' });
  if (memberErr) {
    console.error('[community create-anon-room membership]', memberErr);
    await supabase.from('study_groups').delete().eq('id', group.id);
    return res.status(500).json({ error: 'Failed to create the room', message: 'Could not reserve the room seat right now.' });
  }

  publishRoomEvent(group.id, 'join', {});
  return res.status(200).json({
    ok: true,
    room: { id: group.id, name: group.name },
  });
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
      return res.status(403).json({
        error: data.code,
        message: data.message || 'Unable to join this group right now.',
        ...(data.spectator_price ? { spectator_price: data.spectator_price } : {}),
        ...(data.member_count != null ? { member_count: data.member_count } : {}),
        ...(data.member_limit != null ? { member_limit: data.member_limit } : {}),
      });
    }
    if (!data.already_member) {
      const alias = await ensureRoomAlias(groupId, user.id).catch(() => null);
      publishRoomEvent(groupId, 'join', alias ? { alias } : {});
      void sendRoomPush({
        groupId,
        excludeUserId: user.id,
        kind: 'member_joins',
        title: 'Someone joined',
        body: 'A new member joined the Anonymous room.',
        url: `/anonymous/${groupId}`,
      });
    }
    return res.status(200).json({
      ok: true,
      member_count: data.member_count,
      group_state: data.group_state,
      member_limit: data.member_limit,
      already_member: !!data.already_member,
    });
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
    const alias = await ensureRoomAlias(groupId, user.id).catch(() => null);
    const { data, error } = await supabase.rpc('community_anonymous_leave', { p_group: groupId, p_user: user.id });
    if (error) {
      console.error('[community anon leave]', error);
      return res.status(500).json({ error: 'Failed to leave', message: error.message });
    }
    if (!data?.ok) {
      return res.status(400).json({ error: data.code, message: data.message || 'Unable to leave this group.' });
    }
    if (data.wiped) {
      publishRoomEvent(groupId, 'wipe');
    } else {
      publishRoomEvent(groupId, 'departure', alias ? { alias } : {});
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

// Resolve the canonical NON-WIPED anonymous room. Returns null when every
// anonymous room has been wiped (the caller then opens a fresh one).
async function resolveActiveAnonGroup(groupId) {
  const group = await resolveAnonGroup(groupId);
  if (!group) return null;
  if (groupId !== undefined && groupId !== null && groupId !== '') return group;
  if (group.group_state === 'wiped') return null;
  return group;
}

// S3 — atomic first-visitor room creation. Opens exactly one room when none is
// live (advisory-locked server-side) with the caller as owner + member #1.
async function ensureAnonRoom(userId, name) {
  const supabase = getDb();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('community_ensure_anonymous_room', {
    p_user: userId,
    p_name: name || null,
  });
  if (error || !data?.group_id) {
    console.error('[anonymous ensure room]', error || data);
    return null;
  }
  const { data: group } = await supabase
    .from('study_groups')
    .select('*')
    .eq('id', data.group_id)
    .maybeSingle();
  return group || null;
}

// S4 — stamp real engagement for a room member (send/reply/react/vote/social).
// Never fatal: activity tracking must not break the write it accompanies.
async function touchMembership(groupId, userId) {
  const supabase = getDb();
  if (!supabase || !groupId || !userId) return;
  try {
    await supabase.rpc('community_membership_touch', { p_group: groupId, p_user: userId });
  } catch {
    /* v46 not applied yet */
  }
}

// S2 — apply the once-only vote-expiry adjustment for a message. Returns the
// resulting expires_at (or null for non-anonymous posts / pre-v46 databases).
async function applyVoteExpiry(postId) {
  const supabase = getDb();
  if (!supabase) return null;
  try {
    const { data } = await supabase.rpc('community_apply_vote_expiry', { p_post: postId });
    return data || null;
  } catch {
    return null;
  }
}

// S4 — release idle seats + flag warnings. Returns the reconcile payload.
async function reconcileMembership(groupId) {
  const supabase = getDb();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.rpc('community_membership_reconcile', {
      p_group: groupId,
      p_deadline: null,
      p_warning: null,
    });
    if (error) return null;
    return data || null;
  } catch {
    return null;
  }
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

// Map @Anonymous #NN (a room identity) back to its user id. Used ONLY
// server-side to target Encoded Messages and pushes at one member without
// ever leaking the underlying user id to the client.
async function resolveAliasToUser(groupId, aliasNumber) {
  const supabase = getDb();
  const alias = Number(aliasNumber);
  if (!supabase || !Number.isFinite(alias)) return null;
  const { data } = await supabase
    .from('anonymous_room_identities')
    .select('user_id')
    .eq('group_id', groupId)
    .eq('alias', alias)
    .maybeSingle();
  return data?.user_id || null;
}

// Which members should be notified about a NEW public message? Only the
// author of a message being replied to plus anyone explicitly @mentioned.
// A plain public message returns [] — the room does NOT push every public
// message to every member (notification_preferences kinds stay opt-in per
// kind, and joining/social broadcasts use their own kinds).
async function roomMessagePushTargets(groupId, senderId, replyToId, content) {
  const targets = new Set();
  const supabase = getDb();
  if (!supabase) return [];
  if (replyToId) {
    const { data: parent } = await supabase
      .from('community_posts')
      .select('author_id')
      .eq('id', replyToId)
      .maybeSingle();
    if (parent?.author_id && parent.author_id !== senderId) targets.add(parent.author_id);
  }
  if (content) {
    const numbers = [...new Set(
      [...String(content).matchAll(MENTION_RE)]
        .map((m) => Number(m[1]))
        .filter((n) => Number.isFinite(n)),
    )];
    if (numbers.length) {
      const { data } = await supabase
        .from('anonymous_room_identities')
        .select('user_id, alias')
        .eq('group_id', groupId)
        .in('alias', numbers);
      for (const row of data || []) {
        if (row.user_id && row.user_id !== senderId) targets.add(row.user_id);
      }
    }
  }
  return [...targets];
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

const orderedSocial = (counts) =>
  SOCIAL_ACTIONS.filter((a) => counts?.[a.key]?.count > 0).map((a) => ({
    action: a.key,
    glyph: a.glyph,
    label: a.label,
    count: counts[a.key].count,
    mine: !!counts[a.key].mine,
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
      .select('id, author_id, content, created_at, updated_at, last_interaction_at, grace_until, is_deleted, is_hidden, expires_at')
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

  // Server-authoritative votes: net score + the viewer's own vote (0|1|-1).
  const { data: voteRows } = await supabase
    .from('community_post_votes')
    .select('post_id, user_id, value')
    .in('post_id', ids);
  const votesByPost = new Map();
  for (const row of voteRows || []) {
    if (!votesByPost.has(row.post_id)) votesByPost.set(row.post_id, { score: 0, mine: 0 });
    const agg = votesByPost.get(row.post_id);
    agg.score += row.value || 0;
    if (row.user_id === viewerId) agg.mine = row.value || 0;
  }

  // v44 decorations (tag/encoded) + social actions — all optional.
  const metaByPost = await loadMessageMeta(ids);
  const encodedByPost = await loadEncodedBodies(ids);
  const socialByPost = await loadSocialCounts(ids, viewerId);

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
    const votes = votesByPost.get(row.id) || { score: 0, mine: 0 };
    const meta = metaByPost.get(row.id) || null;
    const isEncoded = !!meta?.is_encoded;
    const encBody = isEncoded ? encodedByPost.get(row.id) : null;
    return {
      id: row.id,
      // The private body NEVER enters the feed for ANY viewer (not even a
      // premium one) — an Encoded Message is decoded only by its author or
      // its intended recipient via the /anonymous/encoded endpoint.
      content: isEncoded ? '' : row.content,
      created_at: row.created_at,
      edited,
      alias: aliases.get(row.author_id),
      author: aliasLabel(aliases.get(row.author_id)),
      is_mine: row.author_id === viewerId,
      reply,
      reactions: orderedReactions(countsByPost.get(row.id)),
      social: orderedSocial(socialByPost.get(row.id)),
      score: votes.score,
      my_vote: votes.mine,
      tag: meta?.tag || null,
      encoded: isEncoded,
      // Only the author and the addressed recipient may unlock (server agrees).
      encoded_for_me: isEncoded && !!encBody && (encBody.recipient === viewerId || row.author_id === viewerId),
      locked: isEncoded,
      state: computePostState(row, now),
      lives_until: new Date(computeLivesUntil(row)).toISOString(),
    };
  });
}

const ROOM_POST_COLUMNS =
  'id, author_id, content, created_at, updated_at, last_interaction_at, grace_until, is_deleted, is_hidden, reply_to_post_id, expires_at';

// Does an ALIVE message exist strictly older than `beforeIso`? Expired rows
// linger until the cleanup runs, so "there are more rows" is not the same as
// "there is more to load". We walk older batches (bounded) checking liveness,
// so the client's "Load earlier messages" is only shown when it will find
// something — fixing the false-positive control.
async function hasOlderAlive(supabase, groupId, beforeIso, nowMs, maxBatches = 4) {
  if (!beforeIso) return false;
  let cursor = beforeIso;
  for (let i = 0; i < maxBatches; i += 1) {
    const { data, error } = await supabase
      .from('community_posts')
      .select(ROOM_POST_COLUMNS)
      .eq('group_id', groupId)
      .lt('created_at', cursor)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(ROOM_MAX_LIMIT);
    if (error || !data || !data.length) return false;
    if (data.some((row) => isPostAlive(row, nowMs))) return true;
    cursor = data[data.length - 1].created_at;
    if (data.length < ROOM_MAX_LIMIT) return false;
  }
  return false;
}

// POST /api/community/anonymous/room  { group_id? }
export async function handleAnonRoom(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const requestedId = req.body?.group_id;
  let group = await resolveActiveAnonGroup(requestedId);
  if (!group) {
    // A specific room id that does not resolve is a real 404; only an
    // unqualified open (no id) triggers first-visitor room creation (S3).
    if (requestedId !== undefined && requestedId !== null && requestedId !== '') {
      return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });
    }
    group = await ensureAnonRoom(user.id, req.body?.name);
  }
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  // S4 — release idle seats + reconcile counts before they are shown. Never fatal.
  await reconcileMembership(group.id).catch(() => {});

  const { role, access } = await roomAccess(group, user.id);
  const viewable = access === 'member' || access === 'spectator';
  const memberCount = viewable || access === 'join' ? await roomMemberCount(group.id) : null;
  const myAlias = access === 'member' ? await ensureRoomAlias(group.id, user.id) : null;
  // Opening the room is real engagement for a member (S4).
  if (access === 'member') void touchMembership(group.id, user.id);
  const noticeAccepted = access === 'member' ? await hasNoticeAck(user.id) : true;
  const premium = viewable ? await isPremiumUser(user.id) : false;
  let online = null;
  if (viewable) {
    try {
      const { data } = await supabase.rpc('community_presence_online', {
        p_group: group.id,
        p_grace: PRESENCE_GRACE_SECONDS,
      });
      if (typeof data === 'number') online = data;
    } catch {
      online = null;
    }
  }

  // Is this viewer the room host (owner) or an admin? Only they may lock/unlock
  // membership while the room keeps running.
  let isHost = role === 'admin';
  if (!isHost && access === 'member') {
    const { data: membership } = await supabase
      .from('study_group_members')
      .select('role')
      .eq('group_id', group.id)
      .eq('user_id', user.id)
      .maybeSingle();
    isHost = membership?.role === 'owner';
  }

  return res.status(200).json({
    ok: true,
    access,
    my_role: role,
    is_host: isHost,
    my_alias: myAlias,
    member_count: memberCount,
    online_count: online,
    is_premium: premium,
    can_speak: access === 'member',
    can_react: viewable,
    group: {
      id: group.id,
      name: group.name,
      group_state: group.group_state,
      is_active: group.is_active,
      spectator_price: group.spectator_price,
      member_limit: group.member_limit,
      membership_locked: !!group.membership_locked,
    },
    thresholds: {
      activate: group.minimum_members_to_activate,
      survive: group.minimum_members_to_remain_active,
    },
    notice: noticeAccepted ? { accepted: true } : { accepted: false, key: ROOM_NOTICE.key, version: ROOM_NOTICE.version },
    channel: roomChannel(group.id),
    config: {
      reactions: ROOM_REACTIONS,
      page_size: ROOM_PAGE_SIZE,
      max_content: MAX_CONTENT,
      mention_pattern: '@Anonymous #NN',
      message_lifetime_seconds: MESSAGE_LIFETIME_SECONDS,
      lifetime_hours: MAX_POST_LIFE_MS / (60 * 60 * 1000),
      notice_key: ROOM_NOTICE.key,
      notice_version: ROOM_NOTICE.version,
      actions: ROOM_ACTIONS,
      tags: ROOM_TAGS,
      social_actions: SOCIAL_ACTIONS,
      votes: {
        upvote_threshold: UPVOTE_THRESHOLD,
        downvote_threshold: DOWNVOTE_THRESHOLD,
        adjust_seconds: VOTE_ADJUST_SECONDS,
      },
      fight: { window_seconds: FIGHT_WINDOW_SECONDS },
      membership: {
        activity_seconds: MEMBERSHIP_ACTIVITY_SECONDS,
        warning_seconds: MEMBERSHIP_WARNING_SECONDS,
        capacity: typeof group.member_limit === 'number' ? group.member_limit : null,
      },
      presence: {
        grace_seconds: PRESENCE_GRACE_SECONDS,
        inactivity_seconds: PRESENCE_INACTIVITY_SECONDS,
      },
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

  const nowMs = Date.now();
  const page = data.slice(0, limit);
  const alive = page.filter((row) => isPostAlive(row, nowMs));
  // A page row cursor that the client can page from even when the whole page
  // has already expired (otherwise an all-expired page would dead-end).
  const nextBefore = page.length
    ? page[page.length - 1].created_at
    : data.length
      ? data[data.length - 1].created_at
      : null;

  let hasMore = false;
  if (alive.length) {
    const oldestAlive = alive[alive.length - 1].created_at;
    hasMore = await hasOlderAlive(supabase, group.id, oldestAlive, nowMs);
  } else if (page.length) {
    hasMore = await hasOlderAlive(supabase, group.id, nextBefore, nowMs);
  }

  const messages = (await hydrateRoomMessages(group, alive, user.id)).reverse(); // oldest first
  return res.status(200).json({ ok: true, messages, has_more: hasMore, next_before: nextBefore });
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
  const rawTag = req.body?.tag;
  const tag = rawTag === undefined || rawTag === null || rawTag === '' ? null : String(rawTag);
  if (tag !== null && !ROOM_TAG_KEYS.has(tag)) {
    return res.status(400).json({ error: 'TAG_NOT_ALLOWED', message: 'That tag is not available.' });
  }
  const wantsEncoded = req.body?.encoded === true || req.body?.encoded === 'true';

  if (!content) {
    return res.status(400).json({ error: 'CONTENT_REQUIRED', message: 'Message content is required.' });
  }
  if (content.length > MAX_CONTENT) return res.status(400).json({ error: 'CONTENT_TOO_LONG', message: `Message must be under ${MAX_CONTENT} characters.` });

  if (wantsEncoded && !(await isPremiumUser(user.id))) {
    return res.status(403).json({ error: 'PREMIUM_REQUIRED', message: 'Encoded Messages are a premium feature.' });
  }

  // Encode is RECIPIENT-TARGETED: the sender must name exactly one other
  // member (by their room alias). Only that member — plus the author — can
  // ever decrypt it, so no premium viewer can read someone else's private
  // message. The alias is resolved server-side; the user id never leaves.
  let recipientUserId = null;
  if (wantsEncoded) {
    const rawAlias = req.body?.recipient_alias;
    const recipientAlias = rawAlias === undefined || rawAlias === null || rawAlias === '' ? null : Number(rawAlias);
    if (!recipientAlias || !Number.isFinite(recipientAlias)) {
      return res.status(400).json({ error: 'RECIPIENT_REQUIRED', message: 'Choose who can read this Encoded Message.' });
    }
    recipientUserId = await resolveAliasToUser(group.id, recipientAlias);
    if (!recipientUserId || recipientUserId === user.id) {
      return res.status(400).json({ error: 'INVALID_RECIPIENT', message: 'Pick another member of this room to encode to.' });
    }
  }

  const mentionErr = content ? await validateRoomMentions(group.id, content) : null;
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

  // Feature/argument validation runs BEFORE the safety-notice gate so an
  // unavailable feature (e.g. non-premium Encode) reports its own reason
  // rather than a generic NOTICE_REQUIRED. The notice is still enforced
  // server-side before any write happens.
  if (!(await hasNoticeAck(user.id))) {
    return res.status(403).json({
      error: 'NOTICE_REQUIRED',
      message: 'Please accept the room safety notice before speaking.',
      notice: { key: ROOM_NOTICE.key, version: ROOM_NOTICE.version },
    });
  }

  const now = new Date().toISOString();
  const { data: post, error } = await supabase
    .from('community_posts')
    .insert({
      author_id: user.id,
      content: wantsEncoded ? '' : content,
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

  if (tag || wantsEncoded) {
    const { error: metaError } = await supabase
      .from('anonymous_message_meta')
      .upsert({ post_id: post.id, tag, is_encoded: wantsEncoded }, { onConflict: 'post_id' });
    if (metaError) {
      console.error('[anonymous room meta]', metaError);
      return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Message decoration is not available yet.' });
    }
    if (wantsEncoded) {
      const cipher = Buffer.from(content, 'utf8').toString('base64');
      const { error: encError } = await supabase
        .from('anonymous_encoded_messages')
        .upsert({ post_id: post.id, cipher_text: cipher, recipient_user_id: recipientUserId }, { onConflict: 'post_id' });
      if (encError) {
        console.error('[anonymous room encoded]', encError);
        return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Encoded messages are not available yet.' });
      }
    }
  }

  const [message] = await hydrateRoomMessages(group, [post], user.id);
  void touchMembership(group.id, user.id);
  publishRoomEvent(group.id, 'message', { id: post.id });
  // Best-effort TARGETED push (no-op unless VAPID + web-push are configured).
  // The room is quiet by default: an Encoded Message notifies only its
  // recipient; a reply notifies the author of the message being replied to;
  // an @mention notifies just the mentioned members. Plain public messages
  // don't push the whole room. Fire-and-forget so push never fails the write.
  const pushTargets = wantsEncoded
    ? [recipientUserId]
    : await roomMessagePushTargets(group.id, user.id, replyTo, content);
  if (pushTargets.length) {
    void sendRoomPush({
      groupId: group.id,
      recipientUserIds: pushTargets,
      kind: 'room_messages',
      title: wantsEncoded ? 'Encoded message' : 'Anonymous room',
      body: wantsEncoded ? 'A private Encoded Message was sent to you.' : 'A message just mentioned you.',
      url: `/anonymous/${group.id}`,
    });
  }
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
  publishRoomEvent(group.id, 'react', { id: messageId });
  void touchMembership(group.id, user.id);
  return res.status(200).json({ ok: true, reactions: orderedReactions(counts) });
}

// POST /api/community/anonymous/ack  { group_id?, key?, version? }
// Records the member's acknowledgement of the safety notice. Idempotent.
export async function handleAnonAck(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const key = typeof req.body?.key === 'string' && req.body.key ? req.body.key : ROOM_NOTICE.key;
  if (key !== ROOM_NOTICE.key) return res.status(400).json({ error: 'UNKNOWN_NOTICE' });

  const { error } = await supabase
    .from('community_notice_acks')
    .upsert(
      { user_id: user.id, notice_key: key, version: ROOM_NOTICE.version, accepted_at: new Date().toISOString() },
      { onConflict: 'user_id,notice_key' },
    );
  if (error) {
    console.error('[anonymous room ack]', error);
    return res.status(500).json({ error: 'Failed to record acknowledgement' });
  }
  return res.status(200).json({ ok: true, key, version: ROOM_NOTICE.version });
}

// POST /api/community/anonymous/lock  { group_id?, locked }
// Owner or admin opens/closes membership while the room keeps running.
export async function handleAnonSetLocked(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });
  const locked = req.body?.locked !== false;

  const admin = await isAdminUser(user.id);
  if (!admin) {
    const { data: membership } = await supabase
      .from('study_group_members')
      .select('role')
      .eq('group_id', group.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (membership?.role !== 'owner') {
      return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'Only the room host can change membership access.' });
    }
  }

  const { data, error } = await supabase.rpc('community_anonymous_set_locked', { p_group: group.id, p_locked: locked });
  if (error) {
    console.error('[anonymous room lock]', error);
    return res.status(500).json({ error: 'Failed to update membership access', message: error.message });
  }
  if (!data?.ok) return res.status(400).json({ error: data.code, message: data.message });
  publishRoomEvent(group.id, 'state', { membership_locked: !!data.membership_locked, member_count: data.member_count });
  return res.status(200).json({ ok: true, membership_locked: !!data.membership_locked, member_count: data.member_count, member_limit: data.member_limit });
}

// POST /api/community/anonymous/social  { message_id, action, group_id? }
// Lightweight ephemeral acknowledgement aimed at a message (support/hug/…).
export async function handleAnonSocial(req, res, user) {
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
  const action = typeof req.body?.action === 'string' ? req.body.action : '';
  if (!SOCIAL_ACTION_KEYS.has(action)) {
    return res.status(400).json({ error: 'SOCIAL_NOT_ALLOWED', message: 'That action is not available.' });
  }

  const { data: post } = await supabase
    .from('community_posts')
    .select(ROOM_POST_COLUMNS)
    .eq('id', messageId)
    .eq('group_id', group.id)
    .maybeSingle();
  if (!post || !isPostAlive(post)) {
    return res.status(404).json({ error: 'MESSAGE_NOT_FOUND', message: 'That message is gone.' });
  }

  // A member who has muted this actor refuses the action (server-side).
  const { data: blocked } = await supabase
    .from('anonymous_social_prefs')
    .select('blocked')
    .eq('owner_id', post.author_id)
    .eq('peer_id', user.id)
    .maybeSingle();
  if (blocked?.blocked) {
    return res.status(403).json({ error: 'SOCIAL_BLOCKED', message: 'This member is not accepting that action.' });
  }

  // Room-wide cooldown: one social action per actor per cooldown window.
  const cutoff = new Date(Date.now() - SOCIAL_COOLDOWN_MS).toISOString();
  const { data: recent, error: rateError } = await supabase
    .from('anonymous_social_actions')
    .select('created_at')
    .eq('actor_id', user.id)
    .gte('created_at', cutoff)
    .limit(1);
  if (rateError) {
    console.error('[anonymous room social]', rateError);
    return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Social actions are not available yet.' });
  }
  if (recent && recent.length) {
    return res.status(429).json({
      error: 'SOCIAL_COOLDOWN',
      message: 'Give it a moment before the next action.',
      retry_after_ms: SOCIAL_COOLDOWN_MS,
    });
  }

  // PER-TARGET cooldown: the same member cannot repeatedly spam a single
  // message within the window even if their room-wide allowance reset.
  const { data: targetRecent } = await supabase
    .from('anonymous_social_actions')
    .select('created_at')
    .eq('actor_id', user.id)
    .eq('post_id', messageId)
    .gte('created_at', cutoff)
    .limit(1);
  if (targetRecent && targetRecent.length) {
    return res.status(429).json({
      error: 'SOCIAL_COOLDOWN',
      message: 'Give it a moment before the next action.',
      retry_after_ms: SOCIAL_COOLDOWN_MS,
    });
  }

  const alias = await ensureRoomAlias(group.id, user.id);
  const targetAlias = (await loadRoomAliases(group.id, [post.author_id])).get(post.author_id) ?? null;
  const { error: upsertError } = await supabase
    .from('anonymous_social_actions')
    .upsert(
      { post_id: messageId, actor_id: user.id, actor_alias: alias, action, target_alias: targetAlias },
      { onConflict: 'post_id,actor_id,action', ignoreDuplicates: true },
    );
  if (upsertError) {
    console.error('[anonymous room social]', upsertError);
    return res.status(500).json({ error: 'Failed to record action' });
  }

  publishRoomEvent(group.id, 'social', { id: messageId, action });
  void touchMembership(group.id, user.id);

  // S1 — a reciprocal attack inside the fight window starts ONE (deduped)
  // fight. Only an assigned attack action can trigger it.
  let fight = false;
  if (ATTACK_ACTION_KEYS.has(action)) {
    try {
      const { data: fightResult } = await supabase.rpc('community_fight_check', {
        p_group: group.id,
        p_actor: user.id,
        p_target: post.author_id,
        p_action: action,
      });
      fight = !!fightResult?.fight;
      if (fight && !fightResult?.deduped) {
        const attacker = await ensureRoomAlias(group.id, user.id);
        const defender = (await loadRoomAliases(group.id, [post.author_id])).get(post.author_id) ?? null;
        publishRoomEvent(group.id, 'fight', { attacker, defender, action });
      }
    } catch {
      /* v46 not applied yet */
    }
  }

  const counts = (await loadSocialCounts([messageId], user.id)).get(messageId) || {};
  return res.status(200).json({ ok: true, social: orderedSocial(counts), fight });
}

// Throttled, best-effort spot-reap so an absent member releases their seat
// (and stale presence rows clear) without waiting for the cron cleanup. The
// owner seat is never released by the RPC. At most once per minute per room.
const presenceReapAt = new Map();
export const PRESENCE_REAP_INTERVAL_MS = 60_000;
async function maybeReapPresence(groupId) {
  const supabase = getDb();
  if (!supabase) return;
  const now = Date.now();
  if (now - (presenceReapAt.get(groupId) || 0) < PRESENCE_REAP_INTERVAL_MS) return;
  presenceReapAt.set(groupId, now);
  try {
    await supabase.rpc('community_presence_reap', {
      p_group: groupId,
      p_grace: PRESENCE_GRACE_SECONDS,
      p_inactivity: PRESENCE_INACTIVITY_SECONDS,
    });
  } catch {
    /* v44 not applied yet — presence stays best-effort */
  }
  // S4 — release idle seats, warn members due, re-run the wipe watchdog.
  try {
    const { data } = await supabase.rpc('community_membership_reconcile', {
      p_group: groupId,
      p_deadline: null,
      p_warning: null,
    });
    if (data?.ok) {
      const warned = Array.isArray(data.warned) ? data.warned : [];
      if (warned.length) {
        void sendRoomPush({
          groupId,
          recipientUserIds: warned,
          kind: 'room_messages',
          title: 'Still there?',
          body: 'You will lose your seat in this room unless you interact soon.',
          url: `/anonymous/${groupId}`,
        });
      }
      if ((data.released || 0) > 0 || data.wipe) {
        publishRoomEvent(groupId, 'state', {
          released: data.released,
          member_count: data.member_count,
          wipe: !!data.wipe,
        });
      }
    }
  } catch {
    /* v46 not applied yet — membership activity stays best-effort */
  }
}

// POST /api/community/anonymous/presence  { session_id, group_id? }
// Server-time heartbeat. Degrades to { online: null } before v44 is applied.
export async function handleAnonPresence(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (!['member', 'spectator'].includes(access)) {
    const code = access === 'banned' ? 'BANNED' : String(access || 'none').toUpperCase();
    return res.status(403).json({ error: code, message: 'You cannot join this room right now.' });
  }

  const rawSession = typeof req.body?.session_id === 'string' ? req.body.session_id.trim() : '';
  if (!rawSession) return res.status(400).json({ error: 'SESSION_REQUIRED', message: 'A session id is required.' });
  const sessionId = rawSession.slice(0, 128);

  const memberCount = await roomMemberCount(group.id);
  const { data, error } = await supabase.rpc('community_presence_heartbeat', {
    p_group: group.id,
    p_user: user.id,
    p_session: sessionId,
  });
  // Auto-release stale seats on the heartbeat path (throttled, never fatal).
  void maybeReapPresence(group.id);
  if (error) {
    // v44 not applied yet — keep the room usable without live presence.
    return res.status(200).json({ ok: true, online: null, member_count: memberCount, presence: false });
  }
  return res.status(200).json({ ok: true, online: typeof data?.online === 'number' ? data.online : null, member_count: memberCount, presence: true });
}

// POST /api/community/anonymous/presence-leave  { group_id? }
// Explicit exit drops presence immediately (no reconnect grace).
export async function handleAnonPresenceLeave(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(200).json({ ok: true });
  const group = await resolveAnonGroup(req.body?.group_id);
  if (group) {
    const { error } = await supabase.rpc('community_presence_leave', { p_group: group.id, p_user: user.id });
    if (error) {
      // Best-effort: a stale presence row is reaped by the grace window anyway.
    }
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/anonymous/encoded  { message_id, group_id? }
// Decode of an Encoded Message — only the author or the single intended
// recipient may ever see the plaintext. Server-authoritative.
export async function handleAnonEncoded(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (!['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: access.toUpperCase(), message: 'You cannot read this room right now.' });
  }

  const messageId = parseId(req.body?.message_id);
  if (!messageId) return res.status(400).json({ error: 'Invalid message id' });

  const { data: post } = await supabase
    .from('community_posts')
    .select(ROOM_POST_COLUMNS)
    .eq('id', messageId)
    .eq('group_id', group.id)
    .maybeSingle();
  if (!post || !isPostAlive(post)) return res.status(404).json({ error: 'MESSAGE_NOT_FOUND', message: 'That message is gone.' });

  const { data: enc } = await supabase
    .from('anonymous_encoded_messages')
    .select('cipher_text, recipient_user_id')
    .eq('post_id', messageId)
    .maybeSingle();
  if (!enc) return res.status(400).json({ error: 'NOT_ENCODED', message: 'That message is not encoded.' });

  // Author or intended recipient only. A premium member who is neither gets
  // the same privacy as a non-premium one — encoded bodies never leak in the
  // feed, and this endpoint refuses them here too. (Legacy rows without a
  // recipient decode for the author alone.)
  const isAuthor = user.id === post.author_id;
  const isRecipient = !!enc.recipient_user_id && user.id === enc.recipient_user_id;
  if (!isAuthor && !isRecipient) {
    return res.status(403).json({ error: 'ENCODED_PRIVATE', message: 'This is a private Encoded Message.' });
  }
  return res.status(200).json({ ok: true, content: decodeEncoded(enc.cipher_text) });
}

// ------------------------------------------------------------
// Push notifications (v44). Subscriptions + preferences are service-role only;
// DELIVERY is best-effort and only active when VAPID keys + web-push exist.
// ------------------------------------------------------------

// POST /api/community/notifications/subscribe  { endpoint, keys:{p256dh,auth}, user_agent? }
export async function handleNotificationsSubscribe(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  const p256dh = typeof req.body?.keys?.p256dh === 'string' ? req.body.keys.p256dh : '';
  const auth = typeof req.body?.keys?.auth === 'string' ? req.body.keys.auth : '';
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'INVALID_SUBSCRIPTION', message: 'A valid push subscription is required.' });
  }

  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: endpoint.slice(0, 1024),
      p256dh,
      auth,
      user_agent: typeof req.body?.user_agent === 'string' ? req.body.user_agent.slice(0, 300) : null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) {
    console.error('[push subscribe]', error);
    return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Push notifications are not available yet.' });
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/notifications/unsubscribe  { endpoint }
export async function handleNotificationsUnsubscribe(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  if (!endpoint) return res.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', user.id);
  if (error) {
    console.error('[push unsubscribe]', error);
    return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Push notifications are not available yet.' });
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/notifications/preferences  { room_messages?, member_joins?, social? }
export async function handleNotificationsPreferences(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const patch = {};
  for (const key of ['room_messages', 'member_joins', 'social']) {
    if (typeof req.body?.[key] === 'boolean') patch[key] = req.body[key];
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
      console.error('[notification prefs]', error);
      return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Notification preferences are not available yet.' });
    }
  }

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('room_messages, member_joins, social')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) {
    return res.status(200).json({ ok: true, preferences: { room_messages: true, member_joins: true, social: true }, ready: false });
  }
  return res.status(200).json({
    ok: true,
    ready: true,
    preferences: data || { room_messages: true, member_joins: true, social: true },
    vapid_public_key: process.env.VAPID_PUBLIC_KEY || null,
  });
}

// POST /api/community/notifications/vapid  (public key for the client)
export async function handleNotificationsVapid(req, res) {
  return res.status(200).json({
    ok: true,
    public_key: process.env.VAPID_PUBLIC_KEY || null,
    enabled: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
  });
}

// POST /api/community/moderation/reports  { status?, limit? }  (admin only)
export async function handleModerationReports(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });
  if (!(await isAdminUser(user.id))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const status = ['pending', 'resolved', 'dismissed'].includes(req.body?.status) ? req.body.status : 'pending';
  const limit = Math.max(1, Math.min(100, Number(req.body?.limit) || 50));

  const { data, error } = await supabase
    .from('community_reports')
    .select('id, reporter_id, post_id, comment_id, reason, category, details, status, admin_note, created_at')
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error('[moderation reports]', error);
    return res.status(500).json({ error: 'Failed to load reports', message: error.message });
  }

  const postIds = [...new Set((data || []).map((r) => r.post_id).filter(Boolean))];
  const posts = new Map();
  if (postIds.length) {
    const { data: rows } = await supabase
      .from('community_posts')
      .select('id, content, group_id, created_at, is_hidden')
      .in('id', postIds);
    for (const p of rows || []) posts.set(p.id, p);
  }

  const reports = (data || []).map((r) => ({
    ...r,
    post: r.post_id && posts.get(r.post_id)
      ? {
        id: r.post_id,
        content: posts.get(r.post_id).content,
        group_id: posts.get(r.post_id).group_id,
        created_at: posts.get(r.post_id).created_at,
        is_hidden: posts.get(r.post_id).is_hidden,
        anon: false,
      }
      : null,
  }));
  return res.status(200).json({ ok: true, reports, count: reports.length });
}

// POST /api/community/moderation/resolve  { report_id, action, note? }  (admin only)
export async function handleModerationResolve(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });
  if (!(await isAdminUser(user.id))) return res.status(403).json({ error: 'NOT_AUTHORIZED' });

  const reportId = parseId(req.body?.report_id);
  const action = req.body?.action === 'hide' ? 'hide' : 'dismiss';
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, MAX_REASON) : null;
  if (!reportId) return res.status(400).json({ error: 'Invalid report id' });

  const { data: report } = await supabase
    .from('community_reports')
    .select('id, post_id, comment_id')
    .eq('id', reportId)
    .maybeSingle();
  if (!report) return res.status(404).json({ error: 'REPORT_NOT_FOUND' });

  // Moderators may hide the offending message; server-authoritative.
  if (action === 'hide') {
    if (report.post_id) {
      const { data: post } = await supabase
        .from('community_posts')
        .select('group_id')
        .eq('id', report.post_id)
        .maybeSingle();
      const { error } = await supabase
        .from('community_posts')
        .update({ is_hidden: true, is_deleted: true })
        .eq('id', report.post_id);
      if (error) return res.status(500).json({ error: 'Failed to hide post', message: error.message });
      if (post?.group_id) publishRoomEvent(post.group_id, 'delete', { id: report.post_id });
    } else if (report.comment_id) {
      const { error } = await supabase
        .from('community_comments')
        .update({ is_hidden: true, is_deleted: true })
        .eq('id', report.comment_id);
      if (error) return res.status(500).json({ error: 'Failed to hide comment', message: error.message });
    }
  }

  const { error } = await supabase
    .from('community_reports')
    .update({ status: action === 'hide' ? 'resolved' : 'dismissed', admin_note: note, updated_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) return res.status(500).json({ error: 'Failed to update report', message: error.message });

  return res.status(200).json({ ok: true, report_id: reportId, action });
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

  // Reap presence across every anonymous group so stale sessions clear and
  // absent members (past the inactivity window) lose their seat even when no
  // browser is open to trigger the throttled heartbeat-path reap. Owner seats
  // are protected by the RPC. Best-effort: presence may not be applied yet.
  const presenceReaped = [];
  try {
    const { data: anonGroups } = await supabase
      .from('study_groups')
      .select('id')
      .eq('type', 'anonymous');
    for (const g of anonGroups || []) {
      const { data: reap } = await supabase.rpc('community_presence_reap', {
        p_group: g.id,
        p_grace: PRESENCE_GRACE_SECONDS,
        p_inactivity: PRESENCE_INACTIVITY_SECONDS,
      });
      if (reap) presenceReaped.push({ group: g.id, ...reap });
    }
  } catch {
    /* v44 not applied yet — nothing to reap */
  }

  return res.status(200).json({ ok: true, result: data, presence_reaped: presenceReaped });
}