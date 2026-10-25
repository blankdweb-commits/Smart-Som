// api/_community.js
//
// Support module backing the single api/community.js serverless function (the
// underscore prefix keeps Vercel from deploying this file as a separate
// function — the Hobby 12-function cap requires ONE file for all community
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

import crypto from 'crypto';
import { getSupabaseAdmin } from './_utils.js';
import { sendRoomPush, vapidKeyHash } from './_push.js';

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
  { key: 'punch', glyph: '👊', label: 'Punch', kind: 'attack', tone: 'rose' },
  { key: 'kick', glyph: '🪵', label: 'Kick', kind: 'attack', tone: 'rose' },
  { key: 'fuckoff', glyph: '🖕', label: 'Fuck Off', kind: 'attack', tone: 'rose' },
  { key: 'waka', glyph: '🖐️', label: 'Waka', kind: 'attack', tone: 'amber' },
  { key: 'hug', glyph: '🤗', label: 'Hug', kind: 'affection', tone: 'amber' },
  { key: 'highfive', glyph: '🙌', label: 'High five', kind: 'affection', tone: 'emerald' },
  { key: 'kiss', glyph: '😘', label: 'Kiss', kind: 'affection', tone: 'pink' },
  // v62 — consent-gated comedic gag. A kind='challenge' row the TARGET must
  // accept before anything happens; NOT an attack, so it never starts a fight.
  { key: 'crack', glyph: '🥵', label: 'Toast / Crack', kind: 'affection', tone: 'pink' },
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
// Anti-slam guardrails (v53): a per-actor ACTION-event budget inside the rate
// window so nobody can spam event cards into the feed.
export const SOCIAL_RATE_CAP = 10;
export const SOCIAL_RATE_WINDOW_MS = 60_000;
// How many recent action/challenge/fight event cards the feed hydrates.
export const EVENT_FEED_LIMIT = 50;
// v54 — action/challenge/fight event cards expire from the feed just like
// messages: 10 minutes after they are created. No event outlives a message.
export const EVENT_LIFETIME_MS = 10 * 60 * 1000;

// v62 — actions that open a CONSENT prompt (accept/decline) rather than firing
// straight away. 'crack' is a comedic gag: nothing happens until the target says
// yes, and the target may decline — which ends the chain entirely.
export const CONSENT_ACTION_KEYS = new Set(['crack']);

// v62 — the gag timeline. One step every GAG_STEP_MS, revealed by the
// request-driven sweep in `revealDueAnnouncements` (no cron exists on this
// project). Copy is deliberately NON-GRAPHIC: slang only, no explicit text.
export const GAG_STEP_MS = 5 * 60 * 1000;
export const GAG_STEPS = [
  { key: 'belle', label: 'belle' },
  { key: 'denied', label: 'denied the belle' },
  { key: 'birth', label: 'gave birth to quadruplets' },
];
const GAG_BIRTHS = [
  'quadruplets',
  'twins',
  'triplets',
  'a set of septuplets',
  'one loud baby',
];

// v62 — rock-paper-scissors for an accepted challenge. Both fighters must have
// picked before the bout resolves; an unanswered bout expires with the card.
export const RPS_MOVES = ['rock', 'paper', 'scissors'];
export const RPS_OPPONENT = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

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
// v62 - bumped to 5: the room gained the consent-gated "Toast / Crack" gag, so
// everyone re-accepts the notice (which now discloses it) before it can appear.
// v88 - bumped to 6: the notice now carries an explicit 18+ confirmation, which
// is BOLD and REQUIRED (the client cannot dismiss the gate and the confirm
// button stays disabled until it is ticked). Spectators are covered from v6
// too - they used to be hard-coded as accepted (see handleAnonRoom), which left
// a reader with full read/react access and no age gate at all.
//
// The bump is what re-asks everyone: community_notice_acks stores the version,
// and hasNoticeAck compares `stored >= ROOM_NOTICE.version`, so every existing
// v5 row stops being valid. That is intended - the notice text changed, so the
// acknowledgement has to be given again.
export const ROOM_NOTICE = { key: 'anonymous_room_safety', version: 6 };
// Minimum age the Anonymous Room admits. The PLATFORM floor is 16 (see
// src/pages/Legal.jsx §8); the room is stricter because it carries adult
// humour and the consent-gated gag. Kept here so the number the server
// enforces and the number the client displays come from one place.
export const ROOM_MINIMUM_AGE = 18;

// ============================================================================
// LIVE EVENT TIMING (migration-v99)
// ============================================================================
// The Anonymous Room is a time-limited live event rather than an open-ended
// room. These constants are the SERVER's copy of the product rule; the database
// CHECK constraints (study_groups_event_duration_check and
// study_groups_event_window_check) enforce the same range independently, so a
// stale build or a crafted request cannot widen it.
//
//   EVENT_MIN_MINUTES  40  minimum INTENDED live duration
//   EVENT_MAX_MINUTES  60  absolute maximum, never exceeded for any reason
//   EVENT_DEFAULT_MINUTES 60 what a room gets if nobody configures otherwise
//
// THE AUTHORITY IS THE DATABASE, NOT THIS FILE. Every guard below ultimately
// asks Postgres `_anon_event_over(group_id)`, which evaluates `now()` on the
// server clock inside the caller's own transaction. A browser clock cannot
// reach it, and a sweep never has to have run for an event to be closed. The
// sweep calls here exist only to write event_ended_at for the audit trail.
export const EVENT_MIN_MINUTES = 40;
export const EVENT_MAX_MINUTES = 60;
export const EVENT_DEFAULT_MINUTES = 60;
// The "ending soon" warning window. Chosen so a member has time to finish what
// they are doing; it is a UI warning only and never gates a write.
export const EVENT_ENDING_SOON_MS = 5 * 60 * 1000;

// Clamp a requested duration into the permitted range, or return null when the
// request is outside it. NULL is the signal: a client asking for 90 minutes is
// REJECTED, not silently rounded, because silently turning "2 hours please"
// into "1 hour" is how a caller ends up believing it got what it asked for.
export function normaliseEventDuration(requested) {
  if (requested === undefined || requested === null || requested === '') return EVENT_DEFAULT_MINUTES;
  const n = Number(requested);
  if (!Number.isInteger(n)) return null;
  if (n < EVENT_MIN_MINUTES || n > EVENT_MAX_MINUTES) return null;
  return n;
}

// The event block every room payload carries. Computed from the group's own
// columns plus the server clock, and it deliberately reports `serverNow` so the
// client can correct for its own clock skew instead of trusting Date.now().
//
// `remainingSeconds` is null when there is no deadline (a room that has not
// activated yet, or one that was already open before v99 existed). The client
// must render "no countdown" in that case rather than counting down to zero.
export function eventBlockFor(group, nowMs = Date.now()) {
  const endsAt = group?.event_ends_at ? new Date(group.event_ends_at).getTime() : null;
  const startedAt = group?.event_started_at ? new Date(group.event_started_at).getTime() : null;
  const hasClock = Number.isFinite(endsAt) && Number.isFinite(startedAt);
  const over = !!(group?.event_ended_at) || (hasClock && nowMs >= endsAt);

  let state = 'scheduled';
  if (group?.group_state === 'wiped') state = 'ended';
  else if (over) state = 'ended';
  else if (group?.group_state === 'waiting') state = 'waiting';
  else if (!hasClock) state = 'live';
  else if (nowMs >= endsAt - EVENT_ENDING_SOON_MS) state = 'ending_soon';
  else state = 'live';

  return {
    state,
    startedAt: startedAt || null,
    endsAt: hasClock ? endsAt : null,
    endedAt: group?.event_ended_at || null,
    endedReason: group?.event_ended_reason || null,
    durationMinutes: group?.event_duration_minutes ?? EVENT_DEFAULT_MINUTES,
    minMinutes: EVENT_MIN_MINUTES,
    maxMinutes: EVENT_MAX_MINUTES,
    endingSoonSeconds: EVENT_ENDING_SOON_MS / 1000,
    remainingSeconds: hasClock ? Math.max(0, Math.round((endsAt - nowMs) / 1000)) : null,
    // Let the client measure its own skew once, on load, instead of guessing.
    serverNow: new Date(nowMs).toISOString(),
  };
}

// A flat 403 for any write into an event that is closed. One shape for every
// write path so the client can recognise it with a single comparison, and one
// place that decides what the user is told.
export function eventEndedError(group, message) {
  const endsAt = group?.event_ends_at || null;
  return {
    status: 403,
    body: {
      error: 'EVENT_ENDED',
      message: message || 'This live event has closed. You can still read it, but no new messages or actions can be added.',
      ends_at: endsAt,
    },
  };
}


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

// LE-5 — the admin lookup is TRI-STATE: 'admin' | 'user' | 'unknown'.
// 'unknown' means the lookup itself failed (the database was unreachable or
// the query errored). Collapsing that into 'not an admin' turns a server
// fault into a 403 that blames the caller for the server's problem.
export const adminRoleState = async (userId) => {
  const supabase = getDb();
  if (!userId || !supabase) return 'unknown';
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[admin role lookup]', error.code || error.message);
    return 'unknown';
  }
  if (!data) return 'user';
  return ADMIN_ROLES.includes(data.role) ? 'admin' : 'user';
};

export const isAdminUser = async (userId) => (await adminRoleState(userId)) === 'admin';

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

// viewer role for a group (member|spectator|admin|none) — server side.
export const viewerRole = async (groupId, userId) => {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Servicio de configuración no disponible', 500);
  const { data, error } = await supabase
    .rpc('community_role_for_group', { p_group: groupId, p_user: userId });
  if (error) throw err('RPC_FAILED', error.message, 500);
  return data;
};

// can this user view content of a group?
export const canViewGroup = async (groupId, userId) => {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Servicio de configuración no disponible', 500);
  const { data, error } = await supabase
    .rpc('community_can_view', { p_group: groupId, p_user: userId });
  if (error) throw err('RPC_FAILED', error.message, 500);
  return !!data;
};

// Fetch a post and decide whether `userId` may see/interact with it.
export const fetchAlivePost = async (postId, userId) => {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Servicio de configuración no disponible', 500);
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

// ------------------------------------------------------------
// Live Events fan-out. A Live Event is keyed by a UUID, not the numeric group
// id the Anonymous Room uses, so it gets its own channel name. The browser
// subscribes to `live_event:<id>` (see src/pages/LiveEventRoom.jsx).
//
// The payload is a NOTICE ONLY — it never carries message content, an author
// id or a reaction owner. A client that receives it re-reads the room through
// the authorized /api/community/live-events/get endpoint, which is the only
// path that can see who is allowed to read what.
//
// Fire-and-forget: a broadcast failure must never fail the write, and the
// room polls as the authoritative fallback.
// ------------------------------------------------------------
export const liveEventChannel = (eventId) => `live_event:${eventId}`;

export async function publishLiveEventEvent(eventId, type, extra = {}) {
  const url = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !eventId) return false;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            topic: liveEventChannel(eventId),
            event: 'live_event',
            payload: { type, at: Date.now(), event_id: eventId, ...extra },
            private: false,
          },
        ],
      }),
      signal: controller.signal,
    });
    return res.ok;
  } catch (e) {
    // Broadcast is best-effort; the room polls and re-reads on an interval.
    console.error('[live event broadcast]', e?.message || e);
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

// The safety-notice + 18+ gate. Call this AFTER a handler's own access check.
// Returns false and has already written the response when the caller has not
// accepted the current notice version.
//
// The client's overlay is the friendly half of this; this function is the half
// that actually holds. Without it the gate is cosmetic - `POST
// /api/community/anonymous/feed` would still hand an unconfirmed caller the
// room's entire message history in one request.
//
// DELIBERATELY NOT APPLIED TO:
//   - handleAnonRoom / handleAnonPreview: the client needs the room payload in
//     order to learn `notice.accepted === false`. Gating the thing that carries
//     the gate flag leaves the client with nothing to render it from.
//   - handleAnonPresence: presence is what keeps a seat alive.
//     community_membership_reconcile releases members idle past
//     MEMBERSHIP_ACTIVITY_SECONDS, and a member reading the 18+ box is by
//     definition idle. Gating presence would cost them their seat before they
//     had any chance to accept.
//   - handleAnonAck: it is the only way out of the gate.
export async function requireNoticeAck(req, res, user) {
  if (await hasNoticeAck(user.id)) return true;
  res.status(403).json({
    error: 'NOTICE_REQUIRED',
    message:
      `Please accept the room safety notice and confirm you are ${ROOM_MINIMUM_AGE} or older `
      + 'before viewing this room.',
    notice: { key: ROOM_NOTICE.key, version: ROOM_NOTICE.version },
    minimumAge: ROOM_MINIMUM_AGE,
  });
  return false;
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
      .select('post_id, cipher_text, recipient_user_id, revealed_at, revealed_by')
      .in('post_id', list);
    if (error) return map;
    for (const row of data || []) {
      map.set(row.post_id, {
        cipher: row.cipher_text,
        recipient: row.recipient_user_id,
        revealed_at: row.revealed_at,
        revealed_by: row.revealed_by,
      });
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

  // An anonymous-room post inside a CLOSED event must stop taking votes. The
  // route is /posts/vote (shared with the general feed), so this only applies
  // when the post actually belongs to an anonymous room — a public community
  // post is unaffected by any room's clock.
  if (post.group_id != null) {
    const votedGroup = await resolveAnonGroup(post.group_id);
    if (votedGroup) {
      const voteRefusal = await requireLiveEvent(votedGroup);
      if (voteRefusal) return res.status(voteRefusal.status).json(voteRefusal.body);
    }
  }

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

  // The event duration is clamped SERVER-side and an out-of-range request is
  // REFUSED, not rounded. Silently turning "two hours please" into "one hour"
  // is how a caller ends up believing it got what it asked for. The database
  // CHECK enforces the same 40-60 range independently.
  const duration = normaliseEventDuration(req.body?.event_duration_minutes);
  if (duration === null) {
    return res.status(400).json({
      error: 'EVENT_DURATION_OUT_OF_RANGE',
      message: `An event must be between ${EVENT_MIN_MINUTES} and ${EVENT_MAX_MINUTES} minutes.`,
      min_minutes: EVENT_MIN_MINUTES,
      max_minutes: EVENT_MAX_MINUTES,
    });
  }

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
      // Written here so the value is auditable. The CLOCK is still stamped by
      // the BEFORE UPDATE activation trigger, never by this INSERT — the room
      // is born waiting and only starts its event when it activates.
      event_duration_minutes: duration,
    })
    .select('id, name, member_limit, minimum_members_to_activate, minimum_members_to_remain_active, spectator_price, group_state, event_duration_minutes')
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
    // A seat cannot be granted into a closed event. The BEFORE INSERT trigger
    // on study_group_members would refuse this anyway (and does, for the
    // payment webhooks that call the RPC directly) — this turns that into a
    // clear 403 instead of a P0001 bubbling out as a 500.
    const joinRefusal = await requireLiveEvent(group);
    if (joinRefusal) return res.status(joinRefusal.status).json(joinRefusal.body);
    const { data, error } = await supabase.rpc('community_anonymous_join', { p_group: groupId, p_user: user.id });
    if (error) {
      console.error('[community anon join]', error);
      return res.status(500).json({ error: 'Failed to join', message: error.message });
    }
    if (!data?.ok) {
      return res.status(403).json({
        error: data.code,
        message: data.message || 'Unable to join this group right now.',
        ...(data.spectator_price != null ? { spectator_price: data.spectator_price } : {}),
        ...(data.member_price != null ? { member_price: data.member_price } : {}),
        ...(data.member_count != null ? { member_count: data.member_count } : {}),
        ...(data.spectator_count != null ? { spectator_count: data.spectator_count } : {}),
        ...(data.member_limit != null ? { member_limit: data.member_limit } : {}),
        ...(data.founding_member_cap != null ? { founding_member_cap: data.founding_member_cap } : {}),
        ...(data.free_spectator_cap != null ? { free_spectator_cap: data.free_spectator_cap } : {}),
      });
    }
    if (!data.already_member) {
      const alias = await ensureRoomAlias(groupId, user.id, readVisitKey(req)).catch(() => null);
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
      founding_member_cap: data.founding_member_cap,
      free: data.free === true,
      already_member: !!data.already_member,
    });
  }

  // Normal group membership (client manages these directly).
  return res.status(400).json({ error: 'NOT_ANONYMOUS', message: 'Use the standard join flow for regular groups.' });
}

// POST /api/community/anonymous/spectate-free  { group_id }
// P2 — claim one of the first `free_spectator_cap` spectator seats (no charge).
// Beyond the cap the server refuses with SPECTATOR_PAYMENT_REQUIRED so the
// client can offer the ?299 paid pass instead.
export async function handleAnonSpectateFree(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const groupId = Number(req.body?.group_id);
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });
  if (await isBanned(user.id)) return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });

  // No spectator seat into a closed event.
  const spectateGroup = await resolveAnonGroup(groupId);
  if (spectateGroup) {
    const spectateRefusal = await requireLiveEvent(spectateGroup);
    if (spectateRefusal) return res.status(spectateRefusal.status).json(spectateRefusal.body);
  }

  const { data, error } = await supabase.rpc('community_anonymous_spectate_free', {
    p_group: groupId,
    p_user: user.id,
  });
  if (error) {
    console.error('[community anon spectate-free]', error);
    return res.status(500).json({ error: 'Failed to start spectating', message: error.message });
  }
  if (!data?.ok) {
    return res.status(403).json({
      error: data.code,
      message: data.message || 'Unable to spectate this room right now.',
      ...(data.spectator_price != null ? { spectator_price: data.spectator_price } : {}),
      ...(data.member_price != null ? { member_price: data.member_price } : {}),
      ...(data.member_count != null ? { member_count: data.member_count } : {}),
      ...(data.spectator_count != null ? { spectator_count: data.spectator_count } : {}),
      ...(data.member_limit != null ? { member_limit: data.member_limit } : {}),
      ...(data.free_spectator_cap != null ? { free_spectator_cap: data.free_spectator_cap } : {}),
    });
  }
  return res.status(200).json({
    ok: true,
    free: data.free === true,
    already_spectator: !!data.already_spectator,
    spectator_count: data.spectator_count,
    member_count: data.member_count,
    free_spectator_cap: data.free_spectator_cap,
    member_limit: data.member_limit,
  });
}

// P3 — the buyer's SOCIAL gift seats: shared codes that grant ONE member seat
// in a specific Anonymous room when redeemed. Only the buyer ever sees the
// codes (they own the links they paid for); nobody else should enumerate them.
async function loadAnonGiftSeats(userId, groupId) {
  const supabase = getDb();
  if (!supabase) return [];
  let q = supabase
    .from('anonymous_membership_gifts')
    .select(
      'id, group_id, code, reference, amount, status, created_at, claimed_at, claimed_by, ' +
      'study_groups(name, group_state, is_active)',
    )
    .eq('buyer_id', userId);
  if (groupId != null) q = q.eq('group_id', Number(groupId));
  const { data, error } = await q.order('created_at', { ascending: false }).limit(50);
  if (error) {
    console.error('[anonymous gifts]', error);
    return [];
  }
  return (data || []).map((g) => ({
    id: g.id,
    group_id: g.group_id,
    group_name: g.study_groups?.name ?? null,
    group_state: g.study_groups?.group_state ?? null,
    group_active: g.study_groups?.is_active !== false,
    code: g.code,
    amount: g.amount,
    status: g.status,
    created_at: g.created_at,
    claimed_at: g.claimed_at,
    claimed_by_self: g.claimed_by === userId,
    room_link: `/anonymous/${g.group_id}?gift=${g.code}`,
  }));
}

// POST /api/community/anonymous/gifts  { group_id? }
// P3 — the buyer's own gift seats for this (or any) Anonymous room, so they can
// copy/share the redeem links. Claimed/expired seats are included with status.
export async function handleAnonGifts(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const groupId = req.body?.group_id != null ? Number(req.body.group_id) : null;
  if (groupId != null && !Number.isFinite(groupId)) {
    return res.status(400).json({ error: 'Invalid group id' });
  }
  const gifts = await loadAnonGiftSeats(user.id, groupId);
  return res.status(200).json({ ok: true, gifts });
}

// POST /api/community/anonymous/gift-claim  { group_id, code }
// P3 — redeem ONE gift seat for this room. The claimant's identity comes from
// the session token; the gift code identifies WHICH paid seat. Redemption never
// exceeds capacity: purchases never add seats, so a full room returns
// GROUP_FULL and the gift stays unclaimed until a seat frees.
export async function handleAnonGiftClaim(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const groupId = Number(req.body?.group_id);
  const code = String(req.body?.code || '').trim();
  if (!Number.isFinite(groupId)) return res.status(400).json({ error: 'Invalid group id' });
  if (!code || code.length > 32) return res.status(400).json({ error: 'INVALID_GIFT', message: 'Enter the gift code exactly as it was shared.' });

  // A PAID seat must never be redeemable after the event closed — the buyer
  // would have charged real money for a room that no longer accepts members.
  // This is the single most valuable guard in this file.
  const giftGroup = await resolveAnonGroup(groupId);
  if (giftGroup) {
    const giftRefusal = await requireLiveEvent(giftGroup);
    if (giftRefusal) {
      return res.status(giftRefusal.status).json({
        ...giftRefusal.body,
        message: 'This live event has closed, so its gift seats cannot be redeemed. The code is still valid for the next event — please contact support for a refund.',
      });
    }
  }

  const { data, error } = await supabase.rpc('community_anonymous_redeem_gift', {
    p_group: groupId,
    p_user: user.id,
    p_code: code,
  });
  if (error) {
    console.error('[anonymous gift claim]', error);
    return res.status(500).json({ error: 'Failed to claim gift', message: error.message });
  }
  if (!data?.ok) {
    const status = ['INVALID_GIFT', 'GIFT_ALREADY_CLAIMED', 'GIFT_EXPIRED'].includes(data.code) ? 400 : 403;
    return res.status(status).json({
      error: data.code,
      message: data.message || 'This gift could not be claimed right now.',
      ...(data.member_count != null ? { member_count: data.member_count } : {}),
      ...(data.spectator_count != null ? { spectator_count: data.spectator_count } : {}),
      ...(data.member_limit != null ? { member_limit: data.member_limit } : {}),
    });
  }

  // A newly granted seat gets a room identity + a join push, mirroring the
  // free/paid join flow so the member immediately appears to everyone.
  const alias = await ensureRoomAlias(groupId, user.id, readVisitKey(req)).catch(() => null);
  publishRoomEvent(groupId, 'join', alias ? { alias } : {});
  void sendRoomPush({
    groupId,
    excludeUserId: user.id,
    kind: 'member_joins',
    title: 'Someone joined',
    body: 'A new member joined the Anonymous room via a gift seat.',
    url: `/anonymous/${groupId}`,
  });

  return res.status(200).json({
    ok: true,
    claimed: true,
    member_count: data.member_count,
    group_state: data.group_state,
    code: data.code,
  });
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
    // HOST LEAVE DELETES THE ROOM (migration-v88).
    //
    // community_anonymous_leave hard-refuses with OWNER_CANNOT_LEAVE for anyone
    // holding the owner membership row, which reached the user as a bare 400
    // from the Room's Leave button. The operator decision is that the host
    // leaving closes the room outright, so the ownership test happens HERE,
    // before the RPC, and the host takes a different path entirely.
    //
    // The delete itself lives in one SECURITY DEFINER function so the ordering
    // that keeps this safe cannot be got wrong from JS: community_posts is
    // `on delete set null` off study_groups, and the public community_feed view
    // admits any post whose group_id is null - so deleting the room row first
    // would publish the room's entire message history to logged-out visitors.
    // The function deletes posts first and is service-role only.
    const isHost = group.creator_id === user.id
      || !!(await supabase
        .from('study_group_members')
        .select('role')
        .eq('group_id', groupId)
        .eq('user_id', user.id)
        .eq('role', 'owner')
        .maybeSingle()
        .then((r) => r.data, () => null));

    if (isHost) {
      const { data: deleted, error: deleteErr } = await supabase.rpc('anonymous_room_delete_host', {
        p_group: groupId,
        p_user: user.id,
      });
      if (deleteErr) {
        console.error('[community anon host delete]', deleteErr);
        // The function RAISES on refusal rather than returning a jsonb, so a
        // refusal arrives as an error here. OWNER_CANNOT_LEAVE / NOT_ANONYMOUS
        // can only happen if ownership changed between the check above and the
        // call (the function takes an advisory lock, so this is a genuine race,
        // not a lost update) and are a 409, not a server fault.
        const refusal = /OWNER_CANNOT_LEAVE|NOT_ANONYMOUS/i.test(deleteErr.message || '');
        return res.status(refusal ? 409 : 500).json({
          error: refusal ? 'ROOM_NOT_CLOSED' : 'Failed to close the room',
          message: deleteErr.message,
        });
      }
      return res.status(200).json({
        ok: true,
        deleted: true,
        group_id: groupId,
        posts_deleted: deleted?.posts_deleted ?? 0,
      });
    }

    // Read the alias the ROOM ALREADY KNOWS (no visit key => no re-roll). Passing
    // the visit key here used to re-roll first, so a departing member in a new
    // tab was announced under a number nobody had ever seen.
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
      // Leaving drops the room identity so the NEXT join mints a fresh
      // Anonymous #NN. The visit key lives in sessionStorage, so without this
      // a leave?re-enter in the same tab short-circuited on the stored
      // visit_key and kept the old pseudonym (ensureRoomAlias line ~1300).
      // Membership/seat are already gone; only the identity changes, and only
      // for this room.
      try {
        await supabase
          .from('anonymous_room_identities')
          .delete()
          .eq('group_id', groupId)
          .eq('user_id', user.id);
      } catch (identityErr) {
        // Non-fatal: the worst case is the same pseudonym on re-entry.
        console.error('[anonymous room identity drop]', identityErr);
      }
    }
    return res.status(200).json({
      ok: true,
      member_count: data.member_count,
      group_state: data.group_state,
      wiped: !!data.wiped,
      // The client clears its cached visit key so the re-join is a NEW visit.
      new_identity: !data.wiped,
    });
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

// P2 — active spectator seats (free + paid) for a room. Used by the capacity
// breakdown. Best-effort: an un-migrated DB yields null rather than throwing.
async function roomSpectatorCount(groupId) {
  const supabase = getDb();
  try {
    const { data } = await supabase.rpc('community_spectator_count', { p_group: groupId });
    return typeof data === 'number' ? data : null;
  } catch {
    return null;
  }
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

// A "visit" is one browser session/tab (a client-minted key held in
// sessionStorage). WS3: the same member re-entering in a NEW visit gets a
// fresh Anonymous #NN so they cannot be correlated across visits — while the
// identity row (PK group_id,user_id) and membership stay untouched. Only the
// routes that speak for the CURRENT viewer pass a visit key; every other
// caller (hydrating other members, rosters, targeting) passes none and
// therefore keeps whoever's stable current alias.
const VISIT_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
export function readVisitKey(req) {
  const raw = req?.body?.visit_key ?? req?.headers?.['x-room-visit'];
  const value = typeof raw === 'string' ? raw.trim() : '';
  return VISIT_KEY_RE.test(value) ? value : null;
}

// Stable random room identity. Retries on 23505 (alias collision);
// PK (group_id,user_id) means a user always keeps their own number. When a
// `visitKey` is supplied and differs from the stored one, the alias is
// RE-ROLLED (per-visit pseudonym) and the new visit stamped.
export async function ensureRoomAlias(groupId, userId, visitKey = null) {
  const supabase = getDb();
  if (!supabase) throw err('SERVER_CONFIG', 'Server configuration error', 500);
  const { data: existing } = await supabase
    .from('anonymous_room_identities')
    .select('alias, visit_key')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();
  // Same visit (or a caller that doesn't track visits) ? keep the alias.
  if (existing && (!visitKey || existing.visit_key === visitKey)) return existing.alias;

  const roll = () => 1 + Math.floor(Math.random() * 9999);
  // A returning member in a NEW visit: re-roll the pseudonym.
  if (existing) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { data, error } = await supabase
        .from('anonymous_room_identities')
        .update({ alias: roll(), visit_key: visitKey })
        .eq('group_id', groupId)
        .eq('user_id', userId)
        .select('alias')
        .single();
      if (!error) return data.alias;
      if (error.code !== '23505') {
        console.error('[anonymous room alias]', error);
        throw err('IDENTITY_FAILED', 'Could not assign a room identity.', 500);
      }
    }
    // Every re-roll collided — keep the existing number but stamp the visit.
    await supabase
      .from('anonymous_room_identities')
      .update({ visit_key: visitKey })
      .eq('group_id', groupId)
      .eq('user_id', userId);
    return existing.alias;
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase
      .from('anonymous_room_identities')
      .insert({ group_id: groupId, user_id: userId, alias: roll(), ...(visitKey ? { visit_key: visitKey } : {}) })
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
//
// It also returns `event`, the live-event block. It is computed HERE, at the one
// place every room read already goes through, rather than being re-derived per
// handler.
//
// DELIBERATELY NOT DONE: an ended event does NOT change `access`. Reads stay
// allowed after the deadline — the history is the point of a 40-60 minute event,
// and an event that deleted its own record on expiry would be a worse product
// than one that stops accepting writes. What expiry blocks is WRITES, and it
// blocks them in requireLiveEvent below.
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
  return {
    role,
    access,
    viewable: access === 'member' || access === 'spectator',
    event: eventBlockFor(group),
  };
}

// The write guard for a closed event.
//
// ASYNC AND AUTHORITATIVE ON PURPOSE. An earlier version read the deadline out
// of the `group` object we already had, which is best-effort: that object was
// fetched before this request began, so a caller who loads the room and then
// sits on the response until after the deadline could still get a write
// through the JS check. Asking the database instead costs one small indexed
// query per write — negligible for a community room — and it is the same
// `now() >= event_ends_at` evaluation the trigger uses, in the same clock
// domain. There is no code path where the two can disagree.
//
// The BEFORE INSERT triggers on study_group_members / anonymous_spectators remain
// the backstop for the seat RPCs, because api/payments-webhook.js calls those
// RPCs directly and would otherwise bypass any JavaScript here. This function is
// what turns that backstop into a clear 403 instead of a bare P0001.
export async function requireLiveEvent(group) {
  const supabase = getDb();
  if (!supabase || !group?.id) return null;
  let over = false;
  try {
    const { data, error } = await supabase.rpc('_anon_event_over', { p_group: group.id });
    if (error) throw error;
    over = data === true;
  } catch {
    // If the predicate itself cannot be read we must NOT fall through and allow
    // the write. Fail closed: an unavailability of the guard is not permission.
    return {
      status: 503,
      body: {
        error: 'EVENT_STATE_UNAVAILABLE',
        message: 'We could not confirm this event is still open. Please try again.',
      },
    };
  }
  if (over) return eventEndedError(group);
  return null;
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

// ------------------------------------------------------------
// v53 — room EVENT cards (actions / challenges / fights) that interleave with
// the feed. Each event is a standalone row so members can React to it and a
// member can Accept/Decline a challenge. All optional: an un-migrated DB just
// yields zero events (never throws).
// ------------------------------------------------------------
// v62 - visible_at is selected so a delayed line can be given an explicit
// expiry (created_at + EVENT_LIFETIME is already spent when it finally shows).
// The two call sites that select EVENT_COLUMNS both fall back to the pre-v62
// column set on 42703, so this stays backwards compatible.
const EVENT_COLUMNS = 'id, group_id, post_id, action, kind, status, actor_id, actor_alias, target_id, target_alias, created_at, visible_at';

async function loadEventReactions(eventIds, viewerId) {
  const byEvent = new Map();
  const list = [...new Set((eventIds || []).filter((n) => Number.isFinite(Number(n))))];
  if (!list.length) return byEvent;
  const supabase = getDb();
  if (!supabase) return byEvent;
  try {
    const { data, error } = await supabase
      .from('anonymous_event_reactions')
      .select('event_id, emoji, user_id')
      .in('event_id', list);
    if (error) return byEvent;
    for (const row of data || []) {
      if (!byEvent.has(row.event_id)) byEvent.set(row.event_id, {});
      const counts = byEvent.get(row.event_id);
      if (!counts[row.emoji]) counts[row.emoji] = { count: 0, mine: false };
      counts[row.emoji].count += 1;
      if (row.user_id === viewerId) counts[row.emoji].mine = true;
    }
  } catch {
    /* v53 not applied yet */
  }
  return byEvent;
}

// v54 — 'slap' was replaced by 'punch'. Legacy rows (and any env where the v54
// migration has not run yet) still render as a Punch card, never an ✨ fallback.
// v62 — synthetic cards (fight / RPS result / gag announcements) are not
// user actions, so they get their own presentation table instead of the ?
// fallback. Keep this in sync with the client sentence table.
const EVENT_SYSTEM_META = {
  fight: { glyph: '🥊', label: 'Fight', tone: 'rose' },
  rps_win: { glyph: '✊', label: 'RPS win', tone: 'emerald' },
  rps_draw: { glyph: '🤝', label: 'RPS draw', tone: 'sky' },
  cracked: { glyph: '🥵', label: 'Cracked', tone: 'pink' },
  cracking: { glyph: '😏', label: 'Cracking', tone: 'pink' },
  belle: { glyph: '🤰', label: 'Belle', tone: 'amber' },
  denied: { glyph: '🙅', label: 'Denied the belle', tone: 'sky' },
};
// `birth_<slug>` carries the exact wording with it.
const eventSystemMeta = (action) => {
  if (EVENT_SYSTEM_META[action]) return EVENT_SYSTEM_META[action];
  if (typeof action === 'string' && action.startsWith('birth_')) {
    return { glyph: '👶', label: action.slice(6).replace(/_/g, ' '), tone: 'emerald' };
  }
  return null;
};

const eventActionMeta = (action) =>
  ROOM_ACTIONS.find((a) => a.key === action) ||
  (action === 'slap' ? ROOM_ACTIONS.find((a) => a.key === 'punch') : null) ||
  eventSystemMeta(action) ||
  null;

// Raw event rows -> masked event-card payloads (no user ids, ever). A card is
// targetable for Respond only when the viewer IS the challenged member.
// v62 - when an event card should disappear from a client's timeline. A delayed
// row is written with created_at = visible_at (see startGagChain), so
// created_at already marks the moment the card became visible and the ordinary
// created_at + EVENT_LIFETIME is correct for every row. Sending it explicitly
// keeps the client's sweep in step with the server's filter.
function eventExpiresAt(row) {
  const created = Date.parse(row?.created_at || '');
  if (!Number.isFinite(created)) return null;
  return new Date(created + EVENT_LIFETIME_MS).toISOString();
}

// v62 - the exact wording for each system/gag line. Nigerian slang, no explicit
// text. `birth_<slug>` carries its own words.
function announcementText(action, actor, target) {
  const both = actor && target ? `${actor} and ${target}` : actor;
  switch (action) {
    case 'cracked':
      return target ? `${actor} cracked ${target}` : `${actor} cracked it`;
    case 'cracking':
      return `${both} are cracking`;
    case 'belle':
      return `${actor} don get belle`;
    case 'denied':
      return `${actor} denied the belle`;
    case 'rps_win':
      return target ? `${actor} won rock-paper-scissors against ${target}` : `${actor} won rock-paper-scissors`;
    case 'rps_draw':
      return `${both} tied at rock-paper-scissors`;
    default:
      if (typeof action === 'string' && action.startsWith('birth_')) {
        return `${actor} gave birth to ${action.slice(6).replace(/_/g, ' ')}`;
      }
      return null;
  }
}

function hydrateRoomEvent(row, viewerId, reactions = {}) {
  // v54 - the DB rewrite + this alias both surface any legacy 'slap' row as
  // the canonical Punch card (correct glyph/label AND the "punched" verb).
  const action = row.action === 'slap' ? 'punch' : row.action;
  const actor = aliasLabel(row.actor_alias);
  const target = row.target_alias != null ? aliasLabel(row.target_alias) : null;
  const kind = row.kind || 'action';
  return {
    id: Number(row.id),
    action,
    glyph: eventActionMeta(action)?.glyph || '✨',
    label: eventActionMeta(action)?.label || action,
    tone: eventActionMeta(action)?.tone || 'slate',
    kind,
    status: row.status || 'open',
    actor,
    target,
    // v62 - system/gag lines carry their own sentence: the generic
    // "actor + verb + target|room" shape cannot render "don get belle" or
    // "gave birth to quadruplets" correctly. Still alias-only, never a user id.
    text: kind === 'announce' ? announcementText(action, actor, target) : null,
    created_at: row.created_at,
    // v62 - explicit expiry for the client's sweep. A delayed line starts its
    // 10-minute life at visible_at, so created_at + lifetime would already be
    // in the past the moment it is first served.
    expires_at: eventExpiresAt(row),
    is_actor: row.actor_id === viewerId,
    is_target: !!row.target_id && row.target_id === viewerId,
    can_respond: row.kind === 'challenge' && row.status === 'pending' && !!row.target_id && row.target_id === viewerId,
    reactions: orderedReactions(reactions),
  };
}

async function hydrateRoomEvents(group, rows, viewerId) {
  if (!rows?.length) return [];
  const ids = rows.map((r) => r.id);
  const reactionsByEvent = await loadEventReactions(ids, viewerId);
  return rows.map((row) => hydrateRoomEvent(row, viewerId, reactionsByEvent.get(row.id)));
}

async function fetchRoomEvent(group, eventId) {
  const supabase = getDb();
  if (!supabase) return null;
  const baseQuery = () =>
    supabase
      .from('anonymous_room_events')
      .select(EVENT_COLUMNS)
      .eq('id', eventId)
      .eq('group_id', group.id)
      .maybeSingle();
  let data = null;
  let error = null;
  // v62 - hide a scheduled gag line until its moment. Fall back to the pre-v62
  // shape when the column is absent so single-card fetches keep working.
  const gated = await baseQuery().lte('visible_at', new Date().toISOString());
  if (gated.error && (gated.error.code === '42703' || gated.error.code === '42P10')) {
    const plain = await baseQuery();
    data = plain.data;
    error = plain.error;
  } else {
    data = gated.data;
    error = gated.error;
  }
if (error || !data) return null;
  // v54 - events expire at 10 minutes, exactly like anonymous messages.
  // v62 - a delayed gag row is written with created_at = visible_at (see
  // startGagChain), so created_at ALREADY marks when the card became visible and
  // this plain check is correct for every row. Deliberately do NOT widen this to
  // max(created_at, visible_at): a row whose created_at was backdated but whose
  // visible_at kept the insert-time default would then never expire.
  const created = Date.parse(data.created_at);
  if (!Number.isFinite(created) || created <= Date.now() - EVENT_LIFETIME_MS) return null;
  return data;
}

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
  // v54 — a reply to an Encoded Message quotes as "🔒 Encoded message" (the
  // private body must never leak into a quote preview).
  const parentMeta = await loadMessageMeta(parentIds);

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
          encoded: !!parentMeta.get(parent.id)?.is_encoded,
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
    // v53 — a recipient may REVEAL an Encoded Message to the whole room; until
    // then the private body never enters the feed for ANY viewer.
    const revealed = isEncoded && !!encBody?.revealed_at;
    return {
      id: row.id,
      content: isEncoded ? (revealed ? decodeEncoded(encBody.cipher) : '') : row.content,
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
      revealed: isEncoded ? revealed : false,
      // Only the author and the addressed recipient may unlock (server agrees).
      encoded_for_me: isEncoded && !!encBody && (encBody.recipient === viewerId || row.author_id === viewerId),
      // The author or whoever revealed it may take it private again.
      can_unreveal:
        isEncoded &&
        !!encBody &&
        revealed &&
        encBody.revealed_by != null &&
        (row.author_id === viewerId || encBody.revealed_by === viewerId),
      locked: isEncoded,
      state: computePostState(row, now),
      lives_until: new Date(computeLivesUntil(row)).toISOString(),
    };
  });
}

const ROOM_POST_COLUMNS =
  'id, group_id, author_id, content, created_at, updated_at, last_interaction_at, grace_until, is_deleted, is_hidden, reply_to_post_id, expires_at';

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

  const { role, access, event } = await roomAccess(group, user.id);
  const viewable = access === 'member' || access === 'spectator';
  // P2 — the capacity breakdown (seat counts + caps + prices) is a prospective-
  // joiner surface, so the counts are computed for every access. The top-level
  // `member_count` stays restricted to viewers / waiting rooms as before.
  const seatMemberCount = await roomMemberCount(group.id);
  const seatSpectatorCount = await roomSpectatorCount(group.id);
  const memberCount = viewable || access === 'join' ? seatMemberCount : null;
  const foundingCap = typeof group.founding_member_cap === 'number' ? group.founding_member_cap : null;
  const freeSpectatorCap = typeof group.free_spectator_cap === 'number' ? group.free_spectator_cap : null;
  const totalCapacity = typeof group.member_limit === 'number' ? group.member_limit : null;
  const memberPrice = group.member_price != null ? Number(group.member_price) : null;
  const capacity = {
    total_capacity: totalCapacity,
    founding_member_cap: foundingCap,
    free_spectator_cap: freeSpectatorCap,
    member_price: memberPrice,
    spectator_price: group.spectator_price != null ? Number(group.spectator_price) : null,
    member_count: seatMemberCount,
    spectator_count: seatSpectatorCount,
    member_paid_required:
      typeof seatMemberCount === 'number' && typeof foundingCap === 'number'
        ? seatMemberCount >= foundingCap
        : null,
    spectator_paid_required:
      typeof seatSpectatorCount === 'number' && typeof freeSpectatorCap === 'number'
        ? seatSpectatorCount >= freeSpectatorCap
        : null,
  };
  const myAlias = access === 'member' ? await ensureRoomAlias(group.id, user.id, readVisitKey(req)) : null;
  // Opening the room is real engagement for a member (S4).
  if (access === 'member') void touchMembership(group.id, user.id);
  // Both MEMBERS and SPECTATORS must have accepted the current notice (which
  // includes the 18+ confirmation). Spectators used to be hard-coded `true`
  // here, which meant anyone could take a spectator seat - full read and react
  // access - with no notice and no age gate whatsoever. A spectator cannot post
  // (handleAnonSend is gated and they hold no member role), so covering them
  // here changes no server behaviour beyond the payload flag itself.
  const noticeAccepted =
    access === 'member' || access === 'spectator' ? await hasNoticeAck(user.id) : true;
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

  // P3 — gift seats I bought for THIS room (the shareable purchase codes).
  // Only the buyer of a seat ever receives its code.
  const gifts = await loadAnonGiftSeats(user.id, group.id);

  return res.status(200).json({
    ok: true,
    access,
    my_role: role,
    is_host: isHost,
    my_alias: myAlias,
    member_count: memberCount,
    online_count: online,
    is_premium: premium,
    capacity,
    gifts,
    can_speak: access === 'member',
    can_react: viewable,
    // ONE flag the client uses to lock the composer, the action sheet and every
    // reaction control. Reads stay open, so the history remains readable.
    can_write: viewable && event.state !== 'ended',
    group: {
      id: group.id,
      name: group.name,
      group_state: group.group_state,
      is_active: group.is_active,
      spectator_price: group.spectator_price,
      member_limit: group.member_limit,
      membership_locked: !!group.membership_locked,
      founding_member_cap: foundingCap,
      free_spectator_cap: freeSpectatorCap,
      member_price: memberPrice,
    },
    thresholds: {
      activate: group.minimum_members_to_activate,
      survive: group.minimum_members_to_remain_active,
    },
notice: noticeAccepted ? { accepted: true } : { accepted: false, key: ROOM_NOTICE.key, version: ROOM_NOTICE.version },
    channel: roomChannel(group.id),
    // The live-event block: state, the authoritative deadline, and the server's
    // own clock. The client renders a countdown from this and re-syncs it on
    // every loadRoom; it never decides validity itself.
    event,
    config: {
      reactions: ROOM_REACTIONS,
      page_size: ROOM_PAGE_SIZE,
      max_content: MAX_CONTENT,
      mention_pattern: '@Anonymous #NN',
      message_lifetime_seconds: MESSAGE_LIFETIME_SECONDS,
      lifetime_hours: MAX_POST_LIFE_MS / (60 * 60 * 1000),
      notice_key: ROOM_NOTICE.key,
      notice_version: ROOM_NOTICE.version,
      // Sent so the age the client renders in the gate is the SAME number the
      // server enforces, rather than a second literal that can drift.
      minimum_age: ROOM_MINIMUM_AGE,
      actions: ROOM_ACTIONS,
      tags: ROOM_TAGS,
      social_actions: SOCIAL_ACTIONS,
      social_rate: { cap: SOCIAL_RATE_CAP, window_ms: SOCIAL_RATE_WINDOW_MS },
      event_feed_limit: EVENT_FEED_LIMIT,
      event_lifetime_seconds: Math.round(EVENT_LIFETIME_MS / 1000),
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
      event: {
        min_minutes: EVENT_MIN_MINUTES,
        max_minutes: EVENT_MAX_MINUTES,
        default_minutes: EVENT_DEFAULT_MINUTES,
        ending_soon_seconds: EVENT_ENDING_SOON_MS / 1000,
      },
    },
  });
}

// POST /api/community/anonymous/rooms
// P2 — browse joinable Anonymous rooms BEFORE creating a new one: every
// non-wiped anonymous room with its live capacity breakdown (members,
// spectators, caps, prices, seats left) so a visitor can pick an open room.
export async function handleAnonRooms(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const { data: rows, error } = await supabase
    .from('study_groups')
    .select('id, name, group_state, is_active, member_limit, spectator_price, membership_locked, founding_member_cap, free_spectator_cap, member_price, minimum_members_to_activate, created_at')
    .eq('type', 'anonymous')
    .eq('is_active', true)
    .neq('group_state', 'wiped')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) {
    console.error('[anonymous rooms]', error);
    return res.status(500).json({ error: 'Failed to load rooms' });
  }

  const rooms = [];
  for (const g of rows || []) {
    const memberCount = await roomMemberCount(g.id);
    const spectatorCount = await roomSpectatorCount(g.id);
    const foundingCap = typeof g.founding_member_cap === 'number' ? g.founding_member_cap : null;
    const freeSpecCap = typeof g.free_spectator_cap === 'number' ? g.free_spectator_cap : null;
    const totalCapacity = typeof g.member_limit === 'number' ? g.member_limit : null;
    const used =
      (typeof memberCount === 'number' ? memberCount : 0) +
      (typeof spectatorCount === 'number' ? spectatorCount : 0);
    rooms.push({
      id: g.id,
      name: g.name,
      group_state: g.group_state,
      membership_locked: !!g.membership_locked,
      member_count: memberCount,
      spectator_count: spectatorCount,
      total_capacity: totalCapacity,
      founding_member_cap: foundingCap,
      free_spectator_cap: freeSpecCap,
      member_price: g.member_price != null ? Number(g.member_price) : null,
      spectator_price: g.spectator_price != null ? Number(g.spectator_price) : null,
      member_paid_required:
        typeof memberCount === 'number' && typeof foundingCap === 'number' ? memberCount >= foundingCap : null,
      spectator_paid_required:
        typeof spectatorCount === 'number' && typeof freeSpecCap === 'number' ? spectatorCount >= freeSpecCap : null,
      seats_left: totalCapacity != null ? Math.max(totalCapacity - used, 0) : null,
    });
  }

  return res.status(200).json({ ok: true, rooms });
}

// POST /api/community/anonymous/preview  { group_id }
// WS4 — PUBLIC, unauthenticated preview of a deep-linked Anonymous room so a
// logged-out visitor landing on /anonymous/:id sees something useful instead of
// a login redirect. Routed in api/community.js BEFORE authorizeRequest (no
// session required, like handleCleanup). Only NON-SENSITIVE room metadata + the
// live seat-count breakdown — never messages, aliases, or the roster. The
// counts come from the service role, so nothing leaks to the anon role.
export async function handleAnonPreview(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const requestedId = req?.body?.group_id;
  const hasRequestedId = requestedId !== undefined && requestedId !== null && requestedId !== '';
  // A specific room id that does not resolve is a real 404; a bare preview
  // (no id, the /anonymous index) resolves the current default room.
  const group = await resolveAnonGroup(hasRequestedId ? requestedId : null);
  if (!group) {
    return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });
  }

  const seatMemberCount = await roomMemberCount(group.id);
  const seatSpectatorCount = await roomSpectatorCount(group.id);
  const foundingCap = typeof group.founding_member_cap === 'number' ? group.founding_member_cap : null;
  const freeSpectatorCap = typeof group.free_spectator_cap === 'number' ? group.free_spectator_cap : null;
  const totalCapacity = typeof group.member_limit === 'number' ? group.member_limit : null;
  const memberPrice = group.member_price != null ? Number(group.member_price) : null;
  const spectatorPrice = group.spectator_price != null ? Number(group.spectator_price) : null;

  return res.status(200).json({
    ok: true,
    requires_auth: true,
    access: 'preview',
    room: {
      id: group.id,
      name: group.name,
      group_state: group.group_state,
      is_active: !!group.is_active,
      membership_locked: !!group.membership_locked,
    },
    member_count: typeof seatMemberCount === 'number' ? seatMemberCount : null,
    capacity: {
      total_capacity: totalCapacity,
      founding_member_cap: foundingCap,
      free_spectator_cap: freeSpectatorCap,
      member_price: memberPrice,
      spectator_price: spectatorPrice,
      member_count: seatMemberCount,
      spectator_count: seatSpectatorCount,
      member_paid_required:
        typeof seatMemberCount === 'number' && typeof foundingCap === 'number'
          ? seatMemberCount >= foundingCap
          : null,
      spectator_paid_required:
        typeof seatSpectatorCount === 'number' && typeof freeSpectatorCap === 'number'
          ? seatSpectatorCount >= freeSpectatorCap
          : null,
    },
    thresholds: {
      activate: group.minimum_members_to_activate,
      survive: group.minimum_members_to_remain_active,
    },
    // Read-only event metadata for the logged-out preview. No messages, no
    // roster, no aliases — the same discipline the rest of this handler keeps.
    // The preview does NOT touch the event clock: observing a live event must
    // never start, extend or restart it.
    event: eventBlockFor(group),
  });
}

// ============================================================
// GUEST PREVIEW (Phase 1) — a signed, read-only, time-boxed window
// onto the Anonymous Room for visitors with no account.
//
// WHY AN ENDPOINT AND NOT A CLIENT READ: every query in this file runs on the
// service role (getDb() === getSupabaseAdmin()), which bypasses RLS entirely.
// The room's read gate is therefore application-level (roomAccess), and
// community_posts is NOT readable by the anon role. Widening RLS to let guests
// read posts directly would hand out every anonymous message in every room to
// anyone with the publishable key. So the preview is served HERE, from the
// service role, behind a signature the client cannot forge, and it emits a
// deliberately minimal projection of each message.
//
// THE RULES THIS ENFORCES:
//   * 2 minutes, measured on the SERVER clock (GUEST_PREVIEW_MS). The browser
//     clock is never trusted; the client gets expires_at + server_now and
//     renders a countdown from the difference.
//   * ONE preview per guest. Starting it spends the allowance immediately —
//     closing the tab early does not give it back. The spent token lives in the
//     visitor's localStorage and is presented on every later visit; the server
//     answers PREVIEW_ALREADY_USED and the client routes to /signup. The
//     client cannot re-mint, because minting requires the server and the server
//     has no way to know it already did (see LIMITATIONS in the report).
//   * STRICTLY READ-ONLY. The hydrator below never calls ensureRoomAlias (a
//     write) and never calls revealDueAnnouncements (also a write). It reads
//     aliases that already exist and DROPS any message whose author has none,
//     rather than creating a row to render it.
//   * MINIMAL FIELDS. No author_id, no email, no score, no reaction counts, no
//     encoded bodies, no expiry internals beyond lives_until. Encoded messages
//     always render as a placeholder for a guest — the reveal path is member
//     only and is never exercised here.
//   * FAIL CLOSED. Any verify/DB problem is a 503 with a retry affordance, never
//     a silent empty success that would look like "the room is quiet".
// ============================================================

export const GUEST_PREVIEW_MS = 2 * 60 * 1000; // 2 minutes, server-authoritative
const GUEST_PREVIEW_PAGE = 12; // small first page; guests never need the backlog
const GUEST_PREVIEW_MAX_LIMIT = 20;
const GUEST_PREVIEW_START_THROTTLE_MS = 3_000; // per caller-key, best effort

// Minting starts. This is ONLY an abuse brake on the mint endpoint — the
// one-preview rule itself is enforced by the signed token in localStorage, not
// by IP, so this limit can be generous without weakening the product.
//
// It is deliberately NOT tight, because the target audience shares IP space:
// carrier NAT in Nigeria means dozens of unrelated visitors can present the
// same public address. At 10/hour a single busy network would have locked out
// real people. 60/hour still stops a scripted mint loop (a loop needs 60
// requests to be useful, and each one only buys a 5-minute read) while leaving
// a whole NAT'd neighbourhood room to browse.
//
// Weakness, stated plainly: a per-instance Map is best-effort on Vercel
// (functions are not shared), so this is a floor rather than a wall. Clearing
// browser storage defeats the one-preview rule; that is inherent to binding a
// pre-account session to a browser and is why the token is signed.
const guestPreviewMints = new Map();
const guestPreviewMintCount = new Map();
const GUEST_PREVIEW_MINT_LIMIT = 60; // per caller-key within the window below
const GUEST_PREVIEW_MINT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// The signing secret. ANON_PREVIEW_SECRET is preferred; the service-role key is
// an acceptable server-only fallback because it never leaves the server and is
// already required for this function to do anything. If neither exists we fail
// CLOSED rather than fall back to an unsigned/guessable token.
const guestPreviewSecret = () =>
  process.env.ANON_PREVIEW_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (str) => Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// Signature comparison that does not leak length/position through timing.
function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Mint a preview token bound to one room and one absolute expiry.
 * Format: v1.<base64url(payload)>.<base64url(hmac-sha256)>
 */
function issueGuestPreviewToken(groupId, nowMs) {
  const secret = guestPreviewSecret();
  if (!secret) return null;
  const iat = Math.floor(nowMs / 1000);
  const payload = { g: Number(groupId), i: iat, e: iat + Math.floor(GUEST_PREVIEW_MS / 1000), n: crypto.randomBytes(8).toString('hex') };
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `v1.${body}.${sig}`;
}

/**
 * Verify a token. Returns
 *   { ok:true,  groupId, issuedAt, expiresAt }
 *   { ok:false, reason:'MALFORMED' | 'BAD_SIGNATURE' | 'EXPIRED' | 'NOT_CONFIGURED' }
 */
export function verifyGuestPreviewToken(token, nowMs = Date.now()) {
  const secret = guestPreviewSecret();
  if (!secret) return { ok: false, reason: 'NOT_CONFIGURED' };
  const raw = typeof token === 'string' ? token.trim() : '';
  if (!raw) return { ok: false, reason: 'MALFORMED' };
  const parts = raw.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return { ok: false, reason: 'MALFORMED' };
  const [, body, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  if (!safeEqual(sig, expected)) return { ok: false, reason: 'BAD_SIGNATURE' };
  let payload;
  try {
    payload = JSON.parse(unb64url(body).toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (!payload || !Number.isFinite(Number(payload.g)) || !Number.isFinite(Number(payload.e))) {
    return { ok: false, reason: 'MALFORMED' };
  }
  if (Number(payload.e) * 1000 <= nowMs) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, groupId: Number(payload.g), issuedAt: Number(payload.i) * 1000, expiresAt: Number(payload.e) * 1000 };
}

// A cheap, non-fingerprinting caller key. x-forwarded-for's first hop is the
// Vercel edge's view of the client; it is only ever used to slow down mint
// spam, never stored, and never sent anywhere.
function previewCallerKey(req) {
  const fwd = req?.headers?.['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim().slice(0, 64);
  return 'unknown';
}

// Read-only alias lookup. Returns authors that ALREADY have an identity row;
// the caller drops anything missing so this path never creates one.
async function loadExistingAliases(groupId, userIds) {
  const map = new Map();
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return map;
  const supabase = getDb();
  if (!supabase) return map;
  const { data } = await supabase
    .from('anonymous_room_identities')
    .select('user_id, alias')
    .eq('group_id', groupId)
    .in('user_id', ids);
  for (const row of data || []) map.set(row.user_id, row.alias);
  return map;
}

/**
 * Minimal, read-only projection of room messages for a guest preview.
 * Deliberately NOT hydrateRoomMessages(): that one calls ensureRoomAlias (a
 * write) and emits score / reactions / my_vote / encoded bodies. This returns
 * only what a visitor needs to see that the room is real.
 */
async function hydrateGuestMessages(group, rows, nowMs) {
  if (!rows.length) return [];
  const aliasMap = await loadExistingAliases(group.id, rows.map((r) => r.author_id));
  const metaByPost = await loadMessageMeta(rows.map((r) => r.id));
  const out = [];
  for (const row of rows) {
    const alias = aliasMap.get(row.author_id);
    // No identity row yet -> do NOT create one. The message is simply not
    // showable to an anonymous visitor until its author has been identified.
    if (alias == null || alias === undefined) continue;
    const meta = metaByPost.get(row.id) || null;
    const isEncoded = !!meta?.is_encoded;
    out.push({
      id: row.id,
      alias,
      author: aliasLabel(alias),
      // An Encoded Message never reveals its body to a guest, even if a member
      // has revealed it to the room — the reveal path is member-only.
      content: isEncoded ? '🔒 Encoded message' : row.content,
      encoded: isEncoded,
      created_at: row.created_at,
      state: computePostState(row, nowMs),
      lives_until: new Date(computeLivesUntil(row)).toISOString(),
    });
  }
  return out;
}

// POST /api/community/anonymous/guest-preview-start  { group_id?, token? }
//
// One mint per guest, ever. If a token comes back in the body we honour the
// EXISTING window (never extend it): a live token returns the remaining time, an
// expired/garbage token is refused as already-used.
export async function handleGuestPreviewStart(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });
  if (!guestPreviewSecret()) {
    return res.status(503).json({
      error: 'GUEST_PREVIEW_UNAVAILABLE',
      message: 'The guest preview is not available right now. Please create a free account or sign in.',
    });
  }

  const nowMs = Date.now();
  const presented = req?.body?.token;

  // --- Returning visitor: never mint a second window. -------------------
  // NOTE the `!= null` test rather than `.trim()`: a client that sends
  // token:" " has PRESENTED a token, and a blank presentation must fail
  // closed rather than fall through to the mint path. Only a genuinely
  // absent token is a first visit.
  if (presented !== undefined && presented !== null) {
    const check = verifyGuestPreviewToken(presented, nowMs);
    if (check.ok) {
      const group = await resolveAnonGroup(req?.body?.group_id ?? check.groupId);
      if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });
      if (Number(group.id) !== Number(check.groupId)) {
        // Token is bound to one room; it cannot be pointed at another.
        return res.status(403).json({ error: 'PREVIEW_ROOM_MISMATCH', message: 'That preview was for a different room.' });
      }
      return res.status(200).json({
        ok: true,
        already_used: true,
        token: presented,
        expires_at: new Date(check.expiresAt).toISOString(),
        server_now: new Date(nowMs).toISOString(),
        room: await guestRoomSummary(group),
      });
    }
    // Expired, tampered or corrupt -> treated as spent. Fail closed.
    return res.status(403).json({
      error: 'PREVIEW_ALREADY_USED',
      message: 'You have already used your one-time guest preview. Create a free account to join the room.',
    });
  }

  // --- First visit: mint once, spending the allowance immediately. ------
  const caller = previewCallerKey(req);
  const windowStart = Date.now();
  const seen = (guestPreviewMintCount.get(caller) || []).filter((t) => windowStart - t < GUEST_PREVIEW_MINT_WINDOW_MS);
  if (seen.length >= GUEST_PREVIEW_MINT_LIMIT) {
    return res.status(429).json({
      error: 'GUEST_PREVIEW_RATE_LIMITED',
      message: 'Too many preview requests. Please create a free account or sign in.',
    });
  }
  seen.push(windowStart);
  guestPreviewMintCount.set(caller, seen);

  const last = guestPreviewMints.get(caller) || 0;
  if (nowMs - last < GUEST_PREVIEW_START_THROTTLE_MS) {
    return res.status(429).json({
      error: 'GUEST_PREVIEW_THROTTLED',
      message: 'Give it a moment before starting another preview.',
    });
  }
  guestPreviewMints.set(caller, nowMs);

  const group = await resolveAnonGroup(req?.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const token = issueGuestPreviewToken(group.id, nowMs);
  if (!token) {
    return res.status(503).json({ error: 'GUEST_PREVIEW_UNAVAILABLE', message: 'The guest preview is not available right now.' });
  }

  const summary = await guestRoomSummary(group);

  // Derive the advertised expiry from the SAME second-truncated value that is
  // signed into the token, so the countdown can never promise more time than
  // the stream will actually honour.
  const expiresAtMs = Math.floor(nowMs / 1000) * 1000 + GUEST_PREVIEW_MS;

  return res.status(200).json({
    ok: true,
    already_used: false,
    token,
    expires_at: new Date(expiresAtMs).toISOString(),
    server_now: new Date(nowMs).toISOString(),
    room: summary,
  });
}

// The non-sensitive room header the preview needs. Same shape the existing
// metadata preview exposes — no counts of anything private.
async function guestRoomSummary(group) {
  const seatMemberCount = await roomMemberCount(group.id);
  const seatSpectatorCount = await roomSpectatorCount(group.id);
  return {
    id: group.id,
    name: group.name,
    group_state: group.group_state,
    member_count: typeof seatMemberCount === 'number' ? seatMemberCount : null,
    spectator_count: typeof seatSpectatorCount === 'number' ? seatSpectatorCount : null,
  };
}

// POST /api/community/anonymous/guest-preview-stream  { group_id?, token, before? }
//
// The live read. Requires a VALID, UNEXPIRED token bound to this room.
export async function handleGuestPreviewStream(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const nowMs = Date.now();
  const check = verifyGuestPreviewToken(req?.body?.token, nowMs);
  if (!check.ok) {
    // One shape for every failure so the client cannot probe which it was.
    const status = check.reason === 'NOT_CONFIGURED' ? 503 : 403;
    return res.status(status).json({
      error: check.reason === 'NOT_CONFIGURED' ? 'GUEST_PREVIEW_UNAVAILABLE' : 'PREVIEW_ALREADY_USED',
      message: 'Your guest preview has ended. Create a free account to join the room.',
      server_now: new Date(nowMs).toISOString(),
    });
  }

  const group = await resolveAnonGroup(req?.body?.group_id ?? check.groupId);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });
  if (Number(group.id) !== Number(check.groupId)) {
    return res.status(403).json({ error: 'PREVIEW_ROOM_MISMATCH', message: 'That preview was for a different room.' });
  }

  const limit = Math.max(1, Math.min(GUEST_PREVIEW_MAX_LIMIT, Number(req?.body?.limit) || GUEST_PREVIEW_PAGE));
  const before = typeof req?.body?.before === 'string' && req.body.before ? req.body.before : null;

  let query = supabase
    .from('community_posts')
    .select(ROOM_POST_COLUMNS)
    .eq('group_id', group.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) {
    console.error('[guest preview stream]', error);
    return res.status(503).json({
      error: 'GUEST_PREVIEW_UNAVAILABLE',
      message: 'We could not load the room right now. Please retry, or create a free account.',
    });
  }

  // Only LIVE messages. An all-expired page still yields a usable cursor so
  // "older" cannot dead-end.
  const alive = (data || []).filter((row) => isPostAlive(row, nowMs));
  const messages = (await hydrateGuestMessages(group, alive, nowMs)).reverse(); // oldest first
  const cursorBase = (data || [])[0]?.created_at || null;
  const oldest = messages.length ? messages[0].created_at : null;

  return res.status(200).json({
    ok: true,
    access: 'guest_preview',
    read_only: true,
    room: await guestRoomSummary(group),
    messages,
    next_before: cursorBase,
    expires_at: new Date(check.expiresAt).toISOString(),
    server_now: new Date(nowMs).toISOString(),
    oldest_alive_at: oldest,
  });
}
export async function handleAnonMembers(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (access === 'banned') return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });
  if (access === 'wiped') return res.status(403).json({ error: 'GROUP_WIPED', message: 'This round has been wiped. Nothing persists.' });
if (access !== 'member') {
    return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can view the room roster.' });
  }
  if (!(await requireNoticeAck(req, res, user))) return;

  const { data: memberRows, error: memberError } = await supabase
    .from('study_group_members')
    .select('user_id, role')
    .eq('group_id', group.id);
  if (memberError) {
    console.error('[anonymous members]', memberError);
    return res.status(500).json({ error: 'Failed to load members' });
  }
  const seats = (memberRows || []).filter((m) => m.user_id);
  const memberIds = seats.map((m) => m.user_id);
  const roleById = new Map(seats.map((m) => [m.user_id, m.role]));

  // Every member has a stable identity; assign any that are still missing so
  // the roster never hides someone who simply has not spoken yet.
  const aliasMap = await loadRoomAliases(group.id, memberIds);
  const missing = memberIds.filter((uid) => !aliasMap.has(uid));
  if (missing.length) {
    const assigned = await Promise.all(
      missing.map((uid) => ensureRoomAlias(group.id, uid).then((a) => [uid, a]).catch(() => null)),
    );
    for (const pair of assigned) if (pair) aliasMap.set(pair[0], pair[1]);
  }

  // Online = a presence heartbeat inside the grace window (same signal the
  // header counter uses).
  const cutoff = new Date(Date.now() - PRESENCE_GRACE_SECONDS * 1000).toISOString();
  const { data: presenceRows } = await supabase
    .from('anonymous_presence')
    .select('user_id')
    .eq('group_id', group.id)
    .gt('last_seen_at', cutoff);
  const onlineIds = new Set((presenceRows || []).map((r) => r.user_id));

  const members = memberIds
    .map((uid) => {
      const alias = aliasMap.get(uid);
      if (alias == null) return null;
      return {
        alias: Number(alias),
        online: onlineIds.has(uid),
        is_self: uid === user.id,
        is_host: roleById.get(uid) === 'owner',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.alias - b.alias);

  return res.status(200).json({
    ok: true,
    members,
    member_count: members.length,
    online_count: members.filter((m) => m.online).length,
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
  if (!(await requireNoticeAck(req, res, user))) return;

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

// v62 — reveal any gag step whose visible_at has come. This sweep IS the
  // scheduler: it piggy-backs on ordinary room traffic (this feed fetch, the
  // room open, and every realtime-triggered reconcile) because the project has
  // no cron and a serverless invocation cannot hold a timer open.
  await revealDueAnnouncements(supabase, group.id);

  // v53 — interleave action/challenge/fight EVENT cards with the messages.
  // Newest cards first, returned oldest-first for a clean client-side merge.
let events = [];
  try {
// v62 - the event-lifetime cutoff. Shared by the "still alive" filter below.
  const sinceIso = new Date(nowMs - EVENT_LIFETIME_MS).toISOString();
  const baseEventQuery = () =>
supabase
        .from('anonymous_room_events')
        .select(EVENT_COLUMNS)
        .eq('group_id', group.id)
        // v62 - lifetime filter. startGagChain writes created_at = visible_at for
        // a delayed line, so this single comparison is already correct: the card
        // is hidden until visible_at passes, and expires EVENT_LIFETIME after
        // it APPEARS rather than after it was written.
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(EVENT_FEED_LIMIT);
    // v62 - a scheduled gag line stays hidden until its moment. If the column is
    // not there yet (v62 unapplied), fall back to the pre-v62 query so event
    // cards keep working instead of vanishing.
    let eventRows = null;
    let eventError = null;
    const gated = await baseEventQuery().lte('visible_at', new Date(nowMs).toISOString());
    if (gated.error && (gated.error.code === '42703' || gated.error.code === '42P10')) {
      const plain = await supabase
        .from('anonymous_room_events')
        .select(EVENT_COLUMNS)
        .eq('group_id', group.id)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(EVENT_FEED_LIMIT);
      eventRows = plain.data;
      eventError = plain.error;
    } else {
      eventRows = gated.data;
      eventError = gated.error;
    }
    if (eventError) {
      /* v53 not applied yet */
    } else if (eventRows?.length) {
      events = await hydrateRoomEvents(group, eventRows.reverse(), user.id);
    }
  } catch {
    /* v53 not applied yet */
  }

  return res.status(200).json({ ok: true, messages, events, has_more: hasMore, next_before: nextBefore });
}

// POST /api/community/anonymous/message  { message_id, group_id? }
export async function handleAnonMessage(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

const { access } = await roomAccess(group, user.id);
  // NOT GUARDED, deliberately: this is a READ. An event that refused to show its
  // own history after closing would be destroying the thing the 40-60 minute
  // window produced. requireLiveEvent gates WRITES only.
  if (!access || !['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: access.toUpperCase(), message: 'You cannot read this room right now.' });
  }
  if (!(await requireNoticeAck(req, res, user))) return;

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
  const eventRefusal = await requireLiveEvent(group);
  if (eventRefusal) return res.status(eventRefusal.status).json(eventRefusal.body);
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
      .select('id, group_id, created_at, expires_at, grace_until, last_interaction_at, is_deleted, is_hidden')
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
  // Same helper as the read gates, so the message a refused writer sees names the
  // age confirmation too rather than only the safety notice.
  if (!(await requireNoticeAck(req, res, user))) return;

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

  // Stamp the viewer's CURRENT visit so their pseudonym is per-visit (WS3)
  // before the message is hydrated with the (possibly re-rolled) alias.
  await ensureRoomAlias(group.id, user.id, readVisitKey(req)).catch(() => null);
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
  const eventRefusal = await requireLiveEvent(group);
  if (eventRefusal) return res.status(eventRefusal.status).json(eventRefusal.body);
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
    .select(ROOM_POST_COLUMNS)
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

// POST /api/community/anonymous/social  { message_id?, target_user_id?, action, group_id? }
// An action aimed at ANOTHER member becomes an interleaved event card in the
// feed (v53). A message may be referenced (then the author is the target), or
// a member may be targeted directly by profile. Challenges turn into invites
// the target may Accept (starts a fresh fight) or Decline.
export async function handleAnonSocial(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  const eventRefusal = await requireLiveEvent(group);
  if (eventRefusal) return res.status(eventRefusal.status).json(eventRefusal.body);
  if (access === 'banned') return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });
  if (access === 'wiped') return res.status(403).json({ error: 'GROUP_WIPED', message: 'This round has been wiped.' });
  if (access !== 'member') {
    return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can use actions in the Anonymous room.' });
  }

  const action = typeof req.body?.action === 'string' ? req.body.action : '';
  if (!SOCIAL_ACTION_KEYS.has(action)) {
    return res.status(400).json({ error: 'SOCIAL_NOT_ALLOWED', message: 'That action is not available.' });
  }

  // Target: either the author of a referenced message, or a directly addressed
  // member (profile tap) — resolved server-side; user ids never leave the api.
  const messageId = parseId(req.body?.message_id);
  let targetUserId = null;
  if (messageId) {
    const { data: post } = await supabase
      .from('community_posts')
      .select(ROOM_POST_COLUMNS)
      .eq('id', messageId)
      .eq('group_id', group.id)
      .maybeSingle();
    if (!post || !isPostAlive(post)) {
      return res.status(404).json({ error: 'MESSAGE_NOT_FOUND', message: 'That message is gone.' });
    }
    targetUserId = post.author_id;
  } else {
    // Direct member aiming by alias (@Anonymous #NN) or, for server-internal
    // callers, by raw user id. User ids never reach the client, so the public
    // path resolves the alias to a uid here and nowhere else.
    const rawTarget = typeof req.body?.target_user_id === 'string' ? req.body.target_user_id.trim() : '';
    const aliasNum = Number(req.body?.target_alias);
    if (UUID_RE.test(rawTarget)) {
      const targetAliases = await loadRoomAliases(group.id, [rawTarget]);
      if (!targetAliases.has(rawTarget)) {
        return res.status(400).json({ error: 'TARGET_NOT_IN_ROOM', message: 'That member is not in this room.' });
      }
      targetUserId = rawTarget;
    } else if (Number.isFinite(aliasNum) && aliasNum >= 1) {
      const uid = await resolveAliasToUser(group.id, aliasNum).catch(() => null);
      if (!uid) {
        return res.status(400).json({ error: 'TARGET_NOT_IN_ROOM', message: 'That member is not in this room.' });
      }
      targetUserId = uid;
    } else {
      return res.status(400).json({ error: 'TARGET_REQUIRED', message: 'Choose a member to aim this action at.' });
    }
  }
  if (!targetUserId || targetUserId === user.id) {
    return res.status(400).json({ error: 'TARGET_REQUIRED', message: 'Pick another member for this action.' });
  }

  // A directly aimed action must target a CURRENT member: an alias can linger
  // after someone leaves the room, so confirm the seat before recording it.
  if (!messageId) {
    const { data: targetSeat } = await supabase
      .from('study_group_members')
      .select('user_id')
      .eq('group_id', group.id)
      .eq('user_id', targetUserId)
      .maybeSingle();
    if (!targetSeat) {
      return res.status(400).json({ error: 'NOT_A_MEMBER', message: 'That member is no longer in this room.' });
    }
  }

  // Anti-slam: a member opting out of being targeted refuses the action.
  const { data: prefs } = await supabase
    .from('anonymous_room_member_prefs')
    .select('declining_interactions')
    .eq('owner_id', targetUserId)
    .maybeSingle();
  if (prefs?.declining_interactions) {
    return res.status(403).json({ error: 'SOCIAL_DECLINED', message: 'This member is declining interactions right now.' });
  }

  // A member who has muted this actor refuses the action (server-side).
  const { data: blocked } = await supabase
    .from('anonymous_social_prefs')
    .select('blocked')
    .eq('owner_id', targetUserId)
    .eq('peer_id', user.id)
    .maybeSingle();
  if (blocked?.blocked) {
    return res.status(403).json({ error: 'SOCIAL_BLOCKED', message: 'This member is not accepting that action.' });
  }

  // Room-wide cooldown: one social action per actor per cooldown window.
  const cutoff = new Date(Date.now() - SOCIAL_COOLDOWN_MS).toISOString();
  if (messageId) {
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
  }

  // Anti-slam cap: no more than SOCIAL_RATE_CAP event cards per actor per window.
  const rateCutoff = new Date(Date.now() - SOCIAL_RATE_WINDOW_MS).toISOString();
  const { data: recentEvents, error: eventRateError } = await supabase
    .from('anonymous_room_events')
    .select('id')
    .eq('group_id', group.id)
    .eq('actor_id', user.id)
    .gte('created_at', rateCutoff);
  if (!eventRateError && Array.isArray(recentEvents) && recentEvents.length >= SOCIAL_RATE_CAP) {
    return res.status(429).json({
      error: 'SOCIAL_RATE_LIMITED',
      message: 'You have used a lot of actions just now — take a short break.',
      retry_after_ms: SOCIAL_RATE_WINDOW_MS,
    });
  }

  const alias = await ensureRoomAlias(group.id, user.id, readVisitKey(req));
  const targetAlias = (await loadRoomAliases(group.id, [targetUserId])).get(targetUserId) ?? (await ensureRoomAlias(group.id, targetUserId).catch(() => null));

  if (messageId) {
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
  }

  // v62 — 'crack' is consent-gated: it opens an accept/decline invite exactly
  // like 'challenge', so the target consents before anything happens.
  const isChallenge = action === 'challenge' || CONSENT_ACTION_KEYS.has(action);
  const { data: eventRow, error: eventError } = await supabase
    .from('anonymous_room_events')
    .insert({
      group_id: group.id,
      post_id: messageId || null,
      action,
      kind: isChallenge ? 'challenge' : 'action',
      status: isChallenge ? 'pending' : 'open',
      actor_id: user.id,
      actor_alias: alias,
      target_id: targetUserId,
      target_alias: targetAlias,
    })
    .select(EVENT_COLUMNS)
    .single();
  if (eventError) {
    console.error('[anonymous room event]', eventError);
    return res.status(500).json({ error: 'Failed to record action' });
  }

  publishRoomEvent(group.id, 'room_event', { id: Number(eventRow.id) });
  if (messageId) publishRoomEvent(group.id, 'social', { id: messageId, action });
  void touchMembership(group.id, user.id);

// A challenge/consent invite flags the target; give them a nudge (opt-in social pref).
  if (isChallenge) {
    const isCrack = action === 'crack';
    void sendRoomPush({
      groupId: group.id,
      recipientUserIds: [targetUserId],
      kind: 'social',
      title: isCrack ? '🥵 Somebody toasted you!' : '⚔️ You have been challenged!',
      body: isCrack
        ? `${aliasLabel(alias)} sent you a move in the Anonymous room. Accept or decline.`
        : `${aliasLabel(alias)} challenged you in the Anonymous room.`,
      url: `/study-groups/${group.id}`,
    }).catch(() => {});
  }

  // S1 — a reciprocal attack inside the fight window starts ONE (deduped)
  // fight. Only an assigned attack action can trigger it. The fight is also
  // surfaced as an event card (v53).
  let fight = false;
  if (ATTACK_ACTION_KEYS.has(action) && messageId) {
    try {
      const { data: fightResult } = await supabase.rpc('community_fight_check', {
        p_group: group.id,
        p_actor: user.id,
        p_target: targetUserId,
        p_action: action,
      });
      fight = !!fightResult?.fight;
      if (fight && !fightResult?.deduped) {
        const attacker = alias;
        const defender = targetAlias;
        if (attacker != null && defender != null) {
          await supabase
            .from('anonymous_room_events')
            .insert({
              group_id: group.id,
              post_id: messageId,
              action: 'fight',
              kind: 'fight',
              status: 'open',
              actor_id: user.id,
              actor_alias: attacker,
              target_id: targetUserId,
              target_alias: defender,
            })
            .then(({ error: insertError }) => {
              if (!insertError) publishRoomEvent(group.id, 'room_event', { action: 'fight' });
            });
          publishRoomEvent(group.id, 'fight', { attacker, defender, action });
        }
      }
    } catch {
      /* v46 not applied yet */
    }
  }

  const counts = (messageId ? (await loadSocialCounts([messageId], user.id)).get(messageId) : null) || {};
  const reactions = await loadEventReactions([eventRow.id], user.id);
  return res.status(200).json({
    ok: true,
    social: messageId ? orderedSocial(counts) : [],
    fight,
    event: hydrateRoomEvent(eventRow, user.id, reactions.get(eventRow.id)),
  });
}

// POST /api/community/anonymous/event  { event_id, group_id? }
// Fetch one event card (used after a realtime room_event hint).
export async function handleAnonEvent(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
if (!['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: access.toUpperCase(), message: 'You cannot read this room right now.' });
  }
  if (!(await requireNoticeAck(req, res, user))) return;

  const eventId = Number(req.body?.event_id);
  if (!Number.isFinite(eventId) || eventId <= 0) return res.status(400).json({ error: 'Invalid event id' });

  const row = await fetchRoomEvent(group, eventId);
  if (!row) return res.status(404).json({ error: 'EVENT_NOT_FOUND', message: 'This event is no longer visible.' });

  const reactions = await loadEventReactions([row.id], user.id);
  return res.status(200).json({ ok: true, event: hydrateRoomEvent(row, user.id, reactions.get(row.id)) });
}

// POST /api/community/anonymous/event-react  { event_id, emoji, active, group_id? }
// React to an event card (or remove the reaction).
export async function handleAnonEventReact(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  const eventRefusal = await requireLiveEvent(group);
  if (eventRefusal) return res.status(eventRefusal.status).json(eventRefusal.body);
  if (access === 'banned') return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });
  if (!['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: access.toUpperCase(), message: 'You cannot interact with this room right now.' });
  }

  const eventId = Number(req.body?.event_id);
  if (!Number.isFinite(eventId) || eventId <= 0) return res.status(400).json({ error: 'Invalid event id' });
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji : '';
  if (!ROOM_REACTIONS.includes(emoji)) {
    return res.status(400).json({ error: 'REACTION_NOT_ALLOWED', message: 'That reaction is not available.' });
  }
  const active = req.body?.active !== false;

  const row = await fetchRoomEvent(group, eventId);
  if (!row) return res.status(404).json({ error: 'EVENT_NOT_FOUND', message: 'This event is no longer visible.' });

  if (active) {
    await supabase
      .from('anonymous_event_reactions')
      .upsert({ event_id: eventId, user_id: user.id, emoji }, { onConflict: 'event_id,user_id,emoji', ignoreDuplicates: true });
  } else {
    await supabase
      .from('anonymous_event_reactions')
      .delete()
      .eq('event_id', eventId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
  }

  publishRoomEvent(group.id, 'room_event', { id: eventId });
  void touchMembership(group.id, user.id);

  const reactions = await loadEventReactions([eventId], user.id);
  return res.status(200).json({ ok: true, event: hydrateRoomEvent(row, user.id, reactions.get(eventId)) });
}

// =====================================================================
// v62 — the consent-gated comedic gag ("toast / crack / belle").
//
// Nothing happens until the TARGET accepts. On accept we publish the immediate
// announcement and pre-write the delayed steps as HIDDEN rows (visible_at in
// the future). There is no scheduler on this project (no vercel cron; Vercel
// Hobby cron is daily-only), so the hidden rows are revealed by a
// request-driven sweep that piggy-backs on the room's own traffic.
// =====================================================================

// Which of the pair ends up "pregnant" is a coin flip — either party can be,
// which is the joke.
function gagCarrier(actorId, targetId) {
  return Math.random() < 0.5 ? actorId : targetId;
}

async function startGagChain(supabase, group, row) {
  const carrierId = gagCarrier(row.actor_id, row.target_id);
  const otherId = carrierId === row.actor_id ? row.target_id : row.actor_id;
  const carrierAlias = carrierId === row.actor_id ? row.actor_alias : row.target_alias;
  const otherAlias = carrierId === row.actor_id ? row.target_alias : row.actor_alias;
  const birth = GAG_BIRTHS[Math.floor(Math.random() * GAG_BIRTHS.length)];

  // t+0 — visible immediately.
  const nowIso = new Date().toISOString();
  const rows = [
    {
      group_id: group.id,
      post_id: row.post_id,
      action: Math.random() < 0.5 ? 'cracked' : 'cracking',
      kind: 'announce',
      status: 'open',
      actor_id: row.actor_id,
      actor_alias: row.actor_alias,
      target_id: row.target_id,
      target_alias: row.target_alias,
      created_at: nowIso,
      visible_at: nowIso,
    },
  ];

  // t+5m, t+10m, t+15m — hidden until the sweep reveals them.
  // created_at is deliberately set EQUAL to visible_at for a delayed row. That
  // single choice fixes three things at once:
  //   * ordering — the feed sorts by created_at, so the line lands at the
  //     moment it is revealed instead of clustering at the original T0;
  //   * the LIMIT 50 window — a delayed row is no longer pushed out of the feed
  //     by everything that happened while it waited;
  //   * expiry — created_at + EVENT_LIFETIME then equals visible_at + lifetime,
  //     i.e. the card lives exactly 10 minutes after it APPEARS.
  const at = (step) => new Date(Date.now() + step * GAG_STEP_MS).toISOString();
  const payloadFor = (action, actorId, actorAlias, targetId, targetAlias, step) => {
    const when = at(step);
    return {
      group_id: group.id,
      post_id: row.post_id,
      action,
      kind: 'announce',
      status: 'open',
      actor_id: actorId,
      actor_alias: actorAlias,
      target_id: targetId,
      target_alias: targetAlias,
      created_at: when,
      visible_at: when,
    };
  };
  rows.push(payloadFor('belle', carrierId, carrierAlias, null, null, 1));
  rows.push(payloadFor('denied', otherId, otherAlias, carrierId, carrierAlias, 2));
  rows.push(payloadFor(`birth_${birth.replace(/\s+/g, '_')}`, carrierId, carrierAlias, null, null, 3));

  const { error } = await supabase.from('anonymous_room_events').insert(rows);
  if (error) {
    // v62 not applied yet (or the CHECK was not widened): the invite still
    // resolved, we just could not stage the punchline.
    console.error('[anonymous gag chain]', error.code || '', error.message);
  }
}

// Reveals any gag step whose time has come. Runs off ordinary room traffic
// (feed fetch / room open / realtime-triggered reconcile) and broadcasts a hint
// so connected clients refresh immediately. Throttled per room.
const gagSweepAt = new Map();
const GAG_SWEEP_THROTTLE_MS = 10_000;
export async function revealDueAnnouncements(supabase, groupId) {
  const last = gagSweepAt.get(groupId) || 0;
  const nowMs = Date.now();
  if (nowMs - last < GAG_SWEEP_THROTTLE_MS) return 0;
  gagSweepAt.set(groupId, nowMs);
  try {
    const baseQuery = () =>
      supabase
        .from('anonymous_room_events')
        .select('id')
        .eq('group_id', groupId)
        .eq('kind', 'announce')
        .limit(1);
    // v62 - gate on visible_at, but fall back to the pre-v62 shape when the
    // column is absent. Without this fallback the sweep failed SILENTLY (the
    // bare .lte() returned 42703 and hit the early return below), so a due gag
    // line was never broadcast and clients only saw it on the next poll.
    let due = null;
    let error = null;
    const gated = await baseQuery().lte('visible_at', new Date(nowMs).toISOString());
    if (gated.error && (gated.error.code === '42703' || gated.error.code === '42P10')) {
      const plain = await baseQuery();
      due = plain.data;
      error = plain.error;
    } else {
      due = gated.data;
      error = gated.error;
    }
    if (error || !due || due.length === 0) return 0;
    // Rows become visible the moment visible_at has passed (the feed filter is
    // `visible_at <= now`), so all that is left is to tell clients to refetch.
    publishRoomEvent(groupId, 'room_event', { action: 'announcement' });
    return due.length;
  } catch {
    return 0;
  }
}

// =====================================================================
// v62 — rock-paper-scissors for an accepted challenge (opt-in). The bout is
// only STARTED here; the fighters choose to play by tapping the card.
// =====================================================================
export async function openDuel(supabase, group, { eventId, aId, bId, aAlias, bAlias }) {
  const { data, error } = await supabase
    .from('anonymous_duels')
    .insert({ group_id: group.id, event_id: eventId, a_id: aId, b_id: bId, a_alias: aAlias, b_alias: bAlias })
    .select('id')
    .single();
  if (error) {
    // Unique on event_id => the verifier/webhook already opened it.
    if (error.code === '23505') return null;
    // v62 not applied: fail soft, the fight card still works.
    if (error.code === '42P01' || error.code === '42703') {
      console.error('[anonymous duel schema]', error.code);
      return null;
    }
    throw error;
  }
  publishRoomEvent(group.id, 'duel', { id: data.id, eventId });
  return data.id;
}

const DUEL_COLUMNS = 'id, group_id, event_id, a_id, b_id, a_move, b_move, status, winner_id, a_alias, b_alias, created_at, decided_at';

// Masked payload: the viewer learns only what is safe (their own move and
// whether the opponent has locked in) plus the outcome once decided. Moves are
// HIDDEN until both are in, so picking cannot be countered.
function hydrateDuel(row, viewerId) {
  if (!row) return null;
  const isA = row.a_id === viewerId;
  const isB = row.b_id === viewerId;
  if (!isA && !isB) return null;
  const bothPicked = !!row.a_move && !!row.b_move;
  return {
    id: Number(row.id),
    event_id: Number(row.event_id),
    you: aliasLabel(isA ? row.a_alias : row.b_alias),
    them: aliasLabel(isA ? row.b_alias : row.a_alias),
    your_move: isA ? row.a_move : row.b_move,
    opponent_locked: isA ? !!row.b_move : !!row.a_move,
    status: row.status,
    // Revealed only once the bout is settled.
    your_throw: bothPicked && row.status === 'done'
      ? (isA ? row.a_move : row.b_move)
      : null,
    their_throw: bothPicked && row.status === 'done'
      ? (isA ? row.b_move : row.a_move)
      : null,
    you_won: row.status === 'done' ? row.winner_id === viewerId : null,
    result: row.status === 'done'
      ? (row.winner_id ? 'won' : 'lost')
      : null,
  };
}

export function resolveRps(aMove, bMove) {
  if (!RPS_MOVES.includes(aMove) || !RPS_MOVES.includes(bMove)) return null;
  if (aMove === bMove) return 'draw';
  return RPS_OPPONENT[aMove] === bMove ? 'a' : 'b';
}

export async function finishDuel(supabase, duel, group) {
  const outcome = resolveRps(duel.a_move, duel.b_move);
  if (!outcome) return null;
  const winnerId = outcome === 'draw' ? null : outcome === 'a' ? duel.a_id : duel.b_id;
  const { data: updated, error } = await supabase
    .from('anonymous_duels')
    .update({ status: 'done', winner_id: winnerId, decided_at: new Date().toISOString() })
    .eq('id', duel.id)
    .eq('status', 'open')
    .select('id')
    .single();
  if (error || !updated) return null;

  const winnerAlias = winnerId === duel.a_id ? duel.a_alias : duel.b_alias;
  const loserId = winnerId === duel.a_id ? duel.b_id : duel.a_id;
  const loserAliasNum = loserId === duel.a_id ? duel.a_alias : duel.b_alias;

  // The result is a normal event card so it expires like everything else.
  await supabase.from('anonymous_room_events').insert({
    group_id: group.id,
    action: outcome === 'draw' ? 'rps_draw' : 'rps_win',
    kind: 'announce',
    status: 'open',
    actor_id: winnerId || duel.a_id,
    actor_alias: winnerId ? winnerAlias : duel.a_alias,
    target_id: loserId,
    target_alias: loserAliasNum,
    visible_at: new Date().toISOString(),
  });
  publishRoomEvent(group.id, 'duel', { id: duel.id, eventId: duel.event_id, done: true });
  return { status: outcome, winner_id: winnerId };
}

// GET  /api/community/anonymous/duel  { event_id, group_id? }
// POST /api/community/anonymous/duel-pick  { duel_id, move, group_id? }
export async function handleAnonDuel(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });
  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  if (access !== 'member') {
    return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can fight.' });
  }
  if (!(await requireNoticeAck(req, res, user))) return;

  // The GET below is a read (fetching the state of a duel someone already
  // started) and stays open after the deadline; only the PICK is a write.
  if (req.method === 'GET') {
    const eventId = Number(req.body?.event_id);
    if (!Number.isFinite(eventId) || eventId <= 0) return res.status(400).json({ error: 'Invalid event id' });
    const { data, error } = await supabase
      .from('anonymous_duels')
      .select(DUEL_COLUMNS)
      .eq('group_id', group.id)
      .eq('event_id', eventId)
      .maybeSingle();
    if (error) {
      if (error.code === '42P01') return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Duels are not available yet.' });
      console.error('[anonymous duel get]', error);
      return res.status(500).json({ error: 'Failed to load duel' });
    }
    if (!data) return res.status(404).json({ error: 'DUEL_NOT_FOUND', message: 'That bout is not available.' });
    return res.status(200).json({ ok: true, duel: hydrateDuel(data, user.id) });
  }

  const duelId = Number(req.body?.duel_id);
  const move = typeof req.body?.move === 'string' ? req.body.move : '';
  if (!Number.isFinite(duelId) || duelId <= 0) return res.status(400).json({ error: 'Invalid duel id' });
  if (!RPS_MOVES.includes(move)) {
    return res.status(400).json({ error: 'INVALID_MOVE', message: 'Pick rock, paper or scissors.' });
  }

  // Throwing a move is a WRITE, and it writes an anonymous_room_events card
  // when the duel resolves — so it has to be refused once the event is over,
  // or the closing minutes produce new cards.
  const duelEventRefusal = await requireLiveEvent(group);
  if (duelEventRefusal) return res.status(duelEventRefusal.status).json(duelEventRefusal.body);

  const { data: duel, error: duelError } = await supabase
    .from('anonymous_duels')
    .select(DUEL_COLUMNS)
    .eq('id', duelId)
    .eq('group_id', group.id)
    .maybeSingle();
  if (duelError) {
    if (duelError.code === '42P01') return res.status(503).json({ error: 'SCHEMA_NOT_READY', message: 'Duels are not available yet.' });
    console.error('[anonymous duel pick]', duelError);
    return res.status(500).json({ error: 'Failed to load duel' });
  }
  if (!duel) return res.status(404).json({ error: 'DUEL_NOT_FOUND', message: 'That bout is not available.' });

  const isA = duel.a_id === user.id;
  const isB = duel.b_id === user.id;
  if (!isA && !isB) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'You are not in this bout.' });
  }
  if (duel.status !== 'open') {
    return res.status(409).json({ error: 'DUEL_RESOLVED', message: 'This bout is already finished.' });
  }
  // One throw per fighter — a second pick would let a loser change their answer.
  const already = isA ? duel.a_move : duel.b_move;
  if (already) {
    return res.status(409).json({ error: 'DUEL_ALREADY_PICKED', message: 'You already threw.' });
  }

  const patch = isA ? { a_move: move } : { b_move: move };
  const { error: patchError } = await supabase
    .from('anonymous_duels')
    .update(patch)
    .eq('id', duelId)
    .eq('status', 'open')
    .is(isA ? 'a_move' : 'b_move', null);
  if (patchError) {
    console.error('[anonymous duel move]', patchError);
    return res.status(409).json({ error: 'DUEL_ALREADY_PICKED', message: 'You already threw.' });
  }
  void touchMembership(group.id, user.id);

  // Resolve once BOTH throws are in.
  const { data: after } = await supabase
    .from('anonymous_duels')
    .select(DUEL_COLUMNS)
    .eq('id', duelId)
    .maybeSingle();
  if (after?.a_move && after?.b_move) {
    await finishDuel(supabase, after, group).catch((e) => console.error('[anonymous duel finish]', e));
  } else {
    publishRoomEvent(group.id, 'duel', { id: duelId, eventId: duel.event_id, locked: true });
  }

  const { data: finalRow } = await supabase
    .from('anonymous_duels')
    .select(DUEL_COLUMNS)
    .eq('id', duelId)
    .maybeSingle();
  return res.status(200).json({ ok: true, duel: hydrateDuel(finalRow, user.id) });
}

// POST /api/community/anonymous/event-respond  { event_id, respond: accept|decline, group_id? }
// A CHALLENGE invite can be Accepted (starts a live fight) or Declined by the
// targeted member. One-shot: responding again returns 409 EVENT_RESOLVED.
export async function handleAnonEventRespond(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  const eventRefusal = await requireLiveEvent(group);
  if (eventRefusal) return res.status(eventRefusal.status).json(eventRefusal.body);
  if (access === 'banned') return res.status(403).json({ error: 'BANNED', message: 'Your community access is currently restricted.' });
  if (access !== 'member') {
    return res.status(403).json({ error: 'ANONYMOUS_MEMBERS_ONLY', message: 'Only members can respond to a challenge.' });
  }

  const eventId = Number(req.body?.event_id);
  if (!Number.isFinite(eventId) || eventId <= 0) return res.status(400).json({ error: 'Invalid event id' });
  const respond = req.body?.respond === 'accept' ? 'accept' : req.body?.respond === 'decline' ? 'decline' : null;
  if (!respond) return res.status(400).json({ error: 'INVALID_RESPOND', message: 'Respond with accept or decline.' });

  const row = await fetchRoomEvent(group, eventId);
  if (!row) return res.status(404).json({ error: 'EVENT_NOT_FOUND', message: 'This event is no longer visible.' });
  if (row.kind !== 'challenge' || row.status !== 'pending') {
    return res.status(409).json({ error: 'EVENT_RESOLVED', message: 'This challenge has already been resolved.' });
  }
  if (!row.target_id || row.target_id !== user.id) {
    return res.status(403).json({ error: 'NOT_AUTHORIZED', message: 'Only the challenged member may respond.' });
  }

const nextStatus = respond === 'accept' ? 'accepted' : 'declined';
  // `.eq('status','pending')` makes the accept/decline a genuine one-shot: two
  // concurrent accepts previously both passed the check above and both settled.
  const { data: updated, error: updateError } = await supabase
    .from('anonymous_room_events')
    .update({ status: nextStatus })
    .eq('id', eventId)
    .eq('group_id', group.id)
    .eq('status', 'pending')
    .select('id');
  if (updateError || !updated || updated.length === 0) {
    return res.status(409).json({ error: 'EVENT_RESOLVED', message: 'This challenge has already been resolved.' });
  }

  publishRoomEvent(group.id, 'room_event', { id: eventId });
  void touchMembership(group.id, user.id);

  if (respond === 'accept' && row.action === 'crack') {
    // v62 — the comedic gag. Accepted: announce it now, then SCHEDULE the
    // delayed steps (belle ? the other one denies it ? the birth) as hidden
    // rows (visible_at in the future) revealed by revealDueAnnouncements().
    await startGagChain(supabase, group, row);
    publishRoomEvent(group.id, 'room_event', { action: 'crack_accepted' });
    void sendRoomPush({
      groupId: group.id,
      recipientUserIds: [row.actor_id],
      kind: 'social',
      title: '🥵 It is on!',
      body: `${aliasLabel(row.target_alias)} accepted your move.`,
      url: `/study-groups/${group.id}`,
    }).catch(() => {});
  } else if (respond === 'accept') {
    // The duel is live: record the fight and surface a fight event card, then
    // open an OPT-IN rock-paper-scissors bout on that card (nothing is forced).
    const lo = user.id < row.actor_id ? user.id : row.actor_id;
    const hi = user.id < row.actor_id ? row.actor_id : user.id;
    await supabase.from('anonymous_fights').insert({ group_id: group.id, a_id: lo, b_id: hi }).then(async ({ error: fightInsertError }) => {
      if (!fightInsertError) {
        const { data: fightCard, error: cardError } = await supabase
          .from('anonymous_room_events')
          .insert({
            group_id: group.id,
            post_id: row.post_id,
            action: 'fight',
            kind: 'fight',
            status: 'open',
            actor_id: row.actor_id,
            actor_alias: row.actor_alias,
            target_id: row.target_id,
            target_alias: row.target_alias,
          })
          .select('id')
          .single();
        // Publish WITH the id so a realtime client can fetch the new card
        // instead of waiting for the next feed refetch.
        if (!cardError && fightCard?.id) {
          publishRoomEvent(group.id, 'room_event', { id: fightCard.id, action: 'fight' });
          // v62 — opt-in RPS bout for this fight.
          await openDuel(supabase, group, {
            eventId: fightCard.id,
            aId: row.actor_id,
            bId: row.target_id,
            aAlias: row.actor_alias,
            bAlias: row.target_alias,
          }).catch((e) => console.error('[anonymous duel open]', e));
        }
      }
    });
    publishRoomEvent(group.id, 'fight', { attacker: row.actor_alias, defender: row.target_alias, action: 'challenge' });
    void sendRoomPush({
      groupId: group.id,
      recipientUserIds: [row.actor_id],
      kind: 'social',
      title: '⚔️ Your challenge was accepted!',
      body: `${aliasLabel(row.target_alias)} accepted your challenge — it is on!`,
      url: `/study-groups/${group.id}`,
    }).catch(() => {});
  } else {
    // Declined. For the gag this ENDS the chain (nothing is ever scheduled).
    void sendRoomPush({
      groupId: group.id,
      recipientUserIds: [row.actor_id],
      kind: 'social',
      title: row.action === 'crack' ? '🤝 Declined' : '🤝 Challenge declined',
      body:
        row.action === 'crack'
          ? `${aliasLabel(row.target_alias)} declined your move. Nothing happened.`
          : `${aliasLabel(row.target_alias)} declined your challenge.`,
      url: `/study-groups/${group.id}`,
    }).catch(() => {});
  }

  const refreshed = await fetchRoomEvent(group, eventId);
  const reactions = await loadEventReactions([eventId], user.id);
  return res.status(200).json({ ok: true, event: hydrateRoomEvent(refreshed, user.id, reactions.get(eventId)) });
}

// POST /api/community/anonymous/prefs  { declining_interactions? }
// Read/update the viewer's "declining interactions" anti-slam opt-out.
export async function handleAnonPrefs(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const wanted = req.body?.declining_interactions;
  if (wanted !== undefined && wanted !== null) {
    await supabase.from('anonymous_room_member_prefs').upsert(
      { owner_id: user.id, declining_interactions: wanted === true || wanted === 'true', updated_at: new Date().toISOString() },
      { onConflict: 'owner_id' },
    );
  }
  const { data } = await supabase
    .from('anonymous_room_member_prefs')
    .select('declining_interactions')
    .eq('owner_id', user.id)
    .maybeSingle();
  return res.status(200).json({ ok: true, declining_interactions: !!data?.declining_interactions });
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

  // Traffic-driven event close. This already runs on the 25s presence heartbeat
  // with a per-room throttle, so an event that expires while members are still
  // connected is recorded as ended within about a minute, and the client learns
  // about it through the same room_event broadcast it already handles.
  //
  // Reconnecting and continued activity do NOT extend anything: this only ever
  // writes event_ended_at, never the window. And it is not what makes expiry
  // WORK — writes are already refused by the _anon_event_over() predicate. This
  // is the audit trail and the client signal.
  try {
    const { data: eventEnd } = await supabase.rpc('community_anonymous_event_end', {
      p_group: groupId,
      p_reason: 'deadline',
    });
    if (eventEnd && eventEnd.ok && eventEnd.already_ended === false) {
      publishRoomEvent(groupId, 'state', { event: 'ended', ends_at: eventEnd.ends_at });
    }
  } catch { /* v99 not applied yet */ }

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

// POST /api/community/anonymous/encoded  { message_id, action: decode|reveal|unreveal, group_id? }
// Decode of an Encoded Message — only the author or the single intended
// recipient may ever see the plaintext. Server-authoritative.
//   decode   (default)  return the plaintext to the author/recipient.
//   reveal              the RECIPIENT publicly reveals the secret so the whole
//                       room sees the plaintext inline ("the room knows").
//   unreveal            the author or the revealer takes it private again.
export async function handleAnonEncoded(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(500).json({ error: 'Server configuration error' });

  const group = await resolveAnonGroup(req.body?.group_id);
  if (!group) return res.status(404).json({ error: 'GROUP_NOT_FOUND', message: 'No Anonymous room found.' });

  const { access } = await roomAccess(group, user.id);
  const eventRefusal = await requireLiveEvent(group);
  if (eventRefusal) return res.status(eventRefusal.status).json(eventRefusal.body);
  if (!['member', 'spectator'].includes(access)) {
    return res.status(403).json({ error: access.toUpperCase(), message: 'You cannot read this room right now.' });
  }

  const messageId = parseId(req.body?.message_id);
  if (!messageId) return res.status(400).json({ error: 'Invalid message id' });
  const action = typeof req.body?.action === 'string' && req.body.action ? req.body.action : 'decode';
  if (!['decode', 'reveal', 'unreveal'].includes(action)) {
    return res.status(400).json({ error: 'INVALID_ACTION', message: 'Unknown encoded-message action.' });
  }

  const { data: post } = await supabase
    .from('community_posts')
    .select(ROOM_POST_COLUMNS)
    .eq('id', messageId)
    .eq('group_id', group.id)
    .maybeSingle();
  if (!post || !isPostAlive(post)) return res.status(404).json({ error: 'MESSAGE_NOT_FOUND', message: 'That message is gone.' });

  const { data: enc } = await supabase
    .from('anonymous_encoded_messages')
    .select('cipher_text, recipient_user_id, revealed_at, revealed_by')
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

  if (action === 'reveal') {
    // Public reveal is the RECIPIENT's call (they consciously share the secret).
    if (!isRecipient) {
      return res.status(403).json({ error: 'ENCODED_PRIVATE', message: 'Only the intended recipient can reveal this message.' });
    }
    const { error } = await supabase
      .from('anonymous_encoded_messages')
      .update({ revealed_at: new Date().toISOString(), revealed_by: user.id })
      .eq('post_id', messageId);
    if (error) {
      console.error('[anonymous room reveal]', error);
      return res.status(500).json({ error: 'Failed to update message' });
    }
    publishRoomEvent(group.id, 'message', { id: messageId });
    return res.status(200).json({ ok: true, revealed: true, content: decodeEncoded(enc.cipher_text) });
  }

  if (action === 'unreveal') {
    const canUnreveal = isAuthor || (!!enc.revealed_by && user.id === enc.revealed_by);
    if (!canUnreveal) {
      return res.status(403).json({ error: 'ENCODED_PRIVATE', message: 'Only the author or the revealer can take this private again.' });
    }
    if (enc.revealed_at) {
      const { error } = await supabase
        .from('anonymous_encoded_messages')
        .update({ revealed_at: null, revealed_by: null })
        .eq('post_id', messageId);
      if (error) {
        console.error('[anonymous room unreveal]', error);
        return res.status(500).json({ error: 'Failed to update message' });
      }
      publishRoomEvent(group.id, 'message', { id: messageId });
    }
    return res.status(200).json({ ok: true, revealed: false });
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
  if (!supabase) {
    return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Push service temporarily unavailable.' });
  }

  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  const p256dh = typeof req.body?.keys?.p256dh === 'string' ? req.body.keys.p256dh : '';
  const auth = typeof req.body?.keys?.auth === 'string' ? req.body.keys.auth : '';
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'INVALID_SUBSCRIPTION', message: 'A valid push subscription is required.' });
  }

  // Rows minted with a superseded keypair can never be delivered to again.
  // Track the key that created this subscription; the backfill script stamps
  // existing rows before a rotation so they survive it.
  const keyHash = vapidKeyHash();
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: user.id,
      endpoint: endpoint.slice(0, 1024),
      p256dh,
      auth,
      user_agent: typeof req.body?.user_agent === 'string' ? req.body.user_agent.slice(0, 300) : null,
      vapid_key_hash: keyHash,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'endpoint' },
  );
  if (error) {
    console.error('[push subscribe]', error?.message || error);
    return res.status(503).json({ error: 'DB_ERROR', message: 'Push notifications are not available yet.' });
  }

  if (keyHash) {
    const { data: rows } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, vapid_key_hash')
      .eq('user_id', user.id);
    const stale = (rows || [])
      .filter((row) => row.endpoint !== endpoint.slice(0, 1024) && row.vapid_key_hash !== keyHash)
      .map((row) => row.id);
    if (stale.length) {
      await supabase.from('push_subscriptions').delete().in('id', stale);
    }
  }

  return res.status(200).json({ ok: true });
}

// POST /api/community/notifications/unsubscribe  { endpoint }
export async function handleNotificationsUnsubscribe(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Push service temporarily unavailable.' });
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint.trim() : '';
  if (!endpoint) return res.status(400).json({ error: 'INVALID_SUBSCRIPTION' });
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint)
    .eq('user_id', user.id);
  if (error) {
    console.error('[push unsubscribe]', error?.message || error);
    return res.status(503).json({ error: 'DB_ERROR', message: 'Push notifications are not available yet.' });
  }
  return res.status(200).json({ ok: true });
}

// POST /api/community/notifications/preferences  { room_messages?, member_joins?, social? }
export async function handleNotificationsPreferences(req, res, user) {
  const supabase = getDb();
  if (!supabase) return res.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'Notification preferences unavailable.' });

  const patch = {};
  for (const key of ['room_messages', 'member_joins', 'social']) {
    if (typeof req.body?.[key] === 'boolean') patch[key] = req.body[key];
  }

  if (Object.keys(patch).length) {
    const { error } = await supabase
      .from('notification_preferences')
      .upsert({ user_id: user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) {
      console.error('[notification prefs]', error?.message || error);
      return res.status(503).json({ error: 'DB_ERROR', message: 'Notification preferences are not available yet.' });
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
  const enabled = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
  return res.status(200).json({
    ok: true,
    public_key: process.env.VAPID_PUBLIC_KEY || null,
    enabled,
    configured: enabled,
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

  // Record any event whose deadline has passed. This is the AUDIT trail and a
  // hint to bulk cleanup — it is NOT what makes expiry work. Writes are refused
  // by the _anon_event_over() predicate whether or not this sweep has ever run,
  // which is why an event still closes on time with no cron and no browser open.
  let eventsSwept = null;
  try {
    const { data: sweep } = await supabase.rpc('community_anonymous_event_sweep', { p_now: null });
    eventsSwept = sweep || null;
  } catch { /* v99 not applied yet — nothing to sweep */ }

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
  const seatsReconciled = [];
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

      // v51 — release idle seats in EVERY state (waiting AND active) so a room
      // never shows a stale member count when nobody is online. The RPC is
      // owner-exempt and only wipes when an ACTIVE room falls below its
      // survival threshold.
      const { data: recon } = await supabase.rpc('community_membership_reconcile', {
        p_group: g.id,
        p_deadline: null,
        p_warning: null,
      });
      if (recon?.ok && ((recon.released || 0) > 0 || recon.wipe)) {
        seatsReconciled.push({ group: g.id, ...recon });
      }
    }
  } catch {
    /* v44/v51 not applied yet — nothing to reap */
  }

  return res.status(200).json({ ok: true, result: data, presence_reaped: presenceReaped, seats_reconciled: seatsReconciled, events_swept: eventsSwept });
}

export async function handleRelationshipRequest(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  const targetId = req.body?.target_id;
  const relType = req.body?.rel_type === 'rival' ? 'rival' : 'friend';
  if (!targetId) return res.status(400).json({ error: 'MISSING_TARGET' });
  const { data, error } = await supabase.rpc('request_relationship', { p_target: targetId, p_type: relType });
  if (error) return res.status(500).json({ error: 'REQUEST_FAILED' });
  return res.status(200).json(data || { ok: true });
}

export async function handleRelationshipRespond(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  const relId = Number(req.body?.rel_id);
  const accept = !!req.body?.accept;
  if (!relId) return res.status(400).json({ error: 'MISSING_REL_ID' });
  const { data, error } = await supabase.rpc('respond_relationship', { p_rel_id: relId, p_accept: accept });
  if (error) return res.status(500).json({ error: 'RESPOND_FAILED' });
  return res.status(200).json(data || { ok: true });
}

export async function handleRelationshipRemove(req, res) {
  const supabase = getDb();
  if (!supabase) return res.status(503).json({ error: 'SERVICE_UNAVAILABLE' });
  const otherId = req.body?.other_id;
  if (!otherId) return res.status(400).json({ error: 'MISSING_OTHER_ID' });
  const { error } = await supabase.rpc('remove_relationship', { p_other: otherId });
  if (error) return res.status(500).json({ error: 'REMOVE_FAILED' });
  return res.status(200).json({ ok: true });
}

// ============================================================================
// Anonymous Live Events — admin-managed, dedicated from the Anonymous Room.
// Every handler runs service_role (getDb) but enforces auth + lifecycle in JS.
// ============================================================================
const LIVE_EVENT_CLOSED_NOTICE =
  'This live event has closed. You can still read it, but no new messages or actions can be added.';

const LIVE_EVENT_STATUS_ORDER = { live: 0, scheduled: 1, closed: 2, draft: 3, cancelled: 4 };

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);

const effectiveStatus = (row) => {
  if (!row) return null;
  if (row.status === 'cancelled') return 'cancelled';
  if (row.status === 'closed') return 'closed';
  if (row.status === 'live' && row.end_at && new Date(row.end_at).getTime() <= Date.now()) return 'closed';
  if (row.status === 'scheduled' && row.start_at && new Date(row.start_at).getTime() <= Date.now()) return 'live';
  return row.status;
};

// ---------------------------------------------------------------------------
// LE-1 — the deadline contract.
//
// The admin console edits deadlines on a MINUTE grid in the browser's local
// time. To make that exact:
//   • a deadline is stored truncated to the minute, so the minute the console
//     shows IS the minute the database holds;
//   • two deadlines are "the same" when they land in the same minute, so a
//     stray millisecond can never lock an event the admin did not retime
//     (this was the reported 403 EVENT_LOCKED);
//   • the console always sends an absolute instant; a naive "YYYY-MM-DDTHH:mm"
//     string is read as UTC, so the server never guesses a timezone.
// ---------------------------------------------------------------------------
const LIVE_EVENT_MINUTE_MS = 60 * 1000;

const truncateToMinute = (date) =>
  new Date(Math.floor(date.getTime() / LIVE_EVENT_MINUTE_MS) * LIVE_EVENT_MINUTE_MS);

const NAIVE_MINUTE_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/;

// Any value → an ISO minute string, or null when it is absent/unreadable.
const toMinuteIso = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return truncateToMinute(d).toISOString();
};

// Returns { ok, iso }. `iso` is null for "no deadline" and truncated to the
// minute. ok=false means the value was present but unreadable.
const parseLiveEventTime = (value) => {
  if (value === null || value === undefined) return { ok: true, iso: null };
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === '') return { ok: true, iso: null };
  const parsed = new Date(NAIVE_MINUTE_RE.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw);
  if (Number.isNaN(parsed.getTime())) return { ok: false, iso: null };
  return { ok: true, iso: truncateToMinute(parsed).toISOString() };
};

// ---------------------------------------------------------------------------
// LE-0 — the Live Events error contract.
//
// Every refusal leaves this router as { error: <CODE>, message: <human text> }
// and is logged with its code. The code is the machine contract (the admin
// console maps it to copy); the message is what a person reads. Nothing that
// is logged is a secret: the code, the status and the event id only — never a
// token, a user id, a message body or a stack.
// ---------------------------------------------------------------------------
export const LIVE_EVENT_ERROR_MESSAGES = {
  SERVER_CONFIG: 'The live-events service is not configured. Please contact an administrator.',
  ADMIN_LOOKUP_UNAVAILABLE: 'Could not verify administrator access right now. Please retry.',
  UNAUTHORIZED: 'Sign in to use live events.',
  AUTH_SERVICE_UNAVAILABLE: 'Authentication service temporarily unavailable. Please retry.',
  FORBIDDEN_ORIGIN: 'This API is locked to the app domain.',
  METHOD_NOT_ALLOWED: 'That request method is not allowed here.',
  NOT_FOUND: 'Unknown live-events endpoint.',
  NOT_AUTHORIZED: 'Administrator access is required to manage live events.',
  INVALID_EVENT_ID: 'That live event id is not valid.',
  INVALID_MESSAGE_ID: 'That message id is not valid.',
  INVALID_TITLE: 'A title between 1 and 120 characters is required.',
  INVALID_DESCRIPTION: 'A description between 1 and 2000 characters is required.',
  INVALID_CONTENT: 'A message between 1 and 1000 characters is required.',
  INVALID_EMOJI: 'That reaction is not valid.',
  INVALID_WINDOW: 'The end time must be after the start time.',
  INVALID_TIME: 'That date and time could not be read.',
  END_TIME_REQUIRED: 'An end time is required before this event can go live.',
  SCHEDULE_WINDOW_REQUIRED: 'A start time and an end time are required before this event can be scheduled.',
  EVENT_LOCKED:
    'The deadline cannot be changed once the event has started or participants have joined. Edit the title or description instead.',
  TERMINAL: 'A closed or cancelled event cannot be changed.',
  INVALID_TRANSITION: 'That status change is not allowed for this event.',
  EVENT_NOT_FOUND: 'No such live event.',
  MESSAGE_NOT_FOUND: 'No such message.',
  EVENT_CLOSED: LIVE_EVENT_CLOSED_NOTICE,
  EVENT_NOT_LIVE: 'Only a live event can accept messages and reactions.',
  NOT_LIVE: 'Only a live event can be closed.',
  LIST_FAILED: 'Could not load live events. Please retry.',
  LOAD_FAILED: 'Could not load the live event. Please retry.',
  MESSAGES_FAILED: 'Could not load the messages for this event. Please retry.',
  MESSAGE_LOAD_FAILED: 'Could not load the message. Please retry.',
  CREATE_FAILED: 'Could not create the live event. Please retry.',
  UPDATE_FAILED: 'Could not update the live event. Please retry.',
  TRANSITION_FAILED: 'Could not change the status of this event. Please retry.',
  CLOSE_FAILED: 'Could not close the live event. Please retry.',
  SEND_FAILED: 'Could not send the message. Please retry.',
  REACT_FAILED: 'Could not save the reaction. Please retry.',
  INTERNAL_ERROR: 'Something went wrong handling this request. Please retry.',
};

// Historic free-text errors → canonical codes. This is the ONE place that
// knows an old string, so each handler can be migrated independently without
// the wire contract changing under it.
const LIVE_EVENT_ERROR_ALIASES = {
  'Server configuration error': 'SERVER_CONFIG',
  Unauthorized: 'UNAUTHORIZED',
  'Method not allowed': 'METHOD_NOT_ALLOWED',
  'Internal Server Error': 'INTERNAL_ERROR',
  'Invalid event id': 'INVALID_EVENT_ID',
  'Invalid message id': 'INVALID_MESSAGE_ID',
  'Invalid title': 'INVALID_TITLE',
  'Invalid description': 'INVALID_DESCRIPTION',
  'Invalid content': 'INVALID_CONTENT',
  'Invalid emoji': 'INVALID_EMOJI',
  'end_at must be after start_at': 'INVALID_WINDOW',
  'end_at is required to start an event': 'END_TIME_REQUIRED',
  'start_at and end_at are required to schedule': 'SCHEDULE_WINDOW_REQUIRED',
  'Failed to load live events': 'LIST_FAILED',
  'Failed to load event': 'LOAD_FAILED',
  'Failed to load messages': 'MESSAGES_FAILED',
  'Failed to load message': 'MESSAGE_LOAD_FAILED',
  'Failed to create event': 'CREATE_FAILED',
  'Failed to update event': 'UPDATE_FAILED',
  'Failed to transition event': 'TRANSITION_FAILED',
  'Failed to close event': 'CLOSE_FAILED',
  'Failed to send message': 'SEND_FAILED',
  'Failed to add reaction': 'REACT_FAILED',
  'Failed to remove reaction': 'REACT_FAILED',
};

// A refusal code is either an alias, an already-canonical SCREAMING_SNAKE
// code, or — if the handler invented something else — a generic failure.
export const liveEventErrorCode = (raw) => {
  const text = typeof raw === 'string' ? raw : '';
  if (LIVE_EVENT_ERROR_ALIASES[text]) return LIVE_EVENT_ERROR_ALIASES[text];
  if (/^[A-Z][A-Z0-9_]*$/.test(text)) return text;
  return 'INTERNAL_ERROR';
};

// Wraps res.json for the Live Events routes so the contract is enforced in ONE
// place: a refusal body always ends up as { error: <CODE>, message: <text> }
// and every refusal is logged with its code.
export const withLiveEventErrors = (req, res) => {
  if (!res || res.__liveEventErrorsApplied) return res;
  res.__liveEventErrorsApplied = true;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (!body || typeof body !== 'object' || !body.error) return originalJson(body);
    const code = liveEventErrorCode(body.error);
    const message = body.message || LIVE_EVENT_ERROR_MESSAGES[code] || LIVE_EVENT_ERROR_MESSAGES.INTERNAL_ERROR;
    const context = { code, status: res.statusCode };
    const reqBody = req && typeof req.body === 'object' ? req.body : null;
    const eventId = reqBody?.event_id || reqBody?.message_id || null;
    if (eventId) context.event_id = eventId;
    if (res.statusCode >= 500) console.error('[live-events:refusal]', context);
    else console.warn('[live-events:refusal]', context);
    return originalJson({ ...body, error: code, message });
  };
  return res;
};

// ---------------------------------------------------------------------------
// Live Events server helpers (LE-5).
// ---------------------------------------------------------------------------

// A missing server configuration is a 503 that NAMES what is missing (the
// names only, never a value). It is a server fault — not a 500, and never the
// caller's fault.
const liveEventsDb = (res) => {
  let supabase = null;
  let missing = [];
  try {
    supabase = getDb();
  } catch (error) {
    missing = Array.isArray(error?.missing) ? error.missing : ['SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY'];
  }
  if (supabase) return supabase;
  if (!missing.length) {
    // getDb() returned null instead of throwing (development mode). Name the
    // variables that are actually absent — never their values.
    if (!process.env.VITE_SUPABASE_URL && !process.env.SUPABASE_URL) missing.push('VITE_SUPABASE_URL|SUPABASE_URL');
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY)
      missing.push('SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY');
  }
  res.status(503).json({
    error: 'SERVER_CONFIG',
    message: LIVE_EVENT_ERROR_MESSAGES.SERVER_CONFIG,
    detail: { missing },
  });
  return null;
};

// The admin check is tri-state. A FAILED LOOKUP is a 503, not a 403 — a 403
// would blame the caller for the server's own fault.
const requireLiveEventAdmin = async (res, user) => {
  const role = await adminRoleState(user?.id);
  if (role === 'admin') return true;
  if (role === 'unknown') {
    res.status(503).json({
      error: 'ADMIN_LOOKUP_UNAVAILABLE',
      message: LIVE_EVENT_ERROR_MESSAGES.ADMIN_LOOKUP_UNAVAILABLE,
    });
    return false;
  }
  res.status(403).json({ error: 'NOT_AUTHORIZED' });
  return false;
};

// POST /api/community/live-events/list   {}
// Discovery: live now, upcoming, recently closed. Real participant counts.
export async function handleListLiveEvents(req, res, user) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;

  // LE-3 — a DRAFT is an unpublished event: admin-only. The filter is applied
  // in the QUERY, so a non-admin never reads the row at all (hiding it in the
  // payload would still have shipped the event to the browser).
  const admin = (await adminRoleState(user?.id)) === 'admin';

  let query = supabase
    .from('live_events')
    .select('id, title, description, cover_url, status, start_at, end_at, created_by, created_at')
    .order('status', { ascending: true })
    .order('start_at', { ascending: true, nullsLast: true });
  if (!admin) query = query.neq('status', 'draft');

  const { data: events, error } = await query;

  if (error) {
    console.error('[live events list]', error);
    return res.status(500).json({ error: 'Failed to load live events' });
  }

  const rows = (events || []).map((e) => ({
    ...e,
    state: effectiveStatus(e),
  }));

  // Real participant count: distinct authors who have sent a message in the event.
  const eventIds = rows.map((e) => e.id);
  let counts = {};
  if (eventIds.length) {
    const { data: msgCounts } = await supabase
      .from('live_event_messages')
      .select('event_id, author_id')
      .in('event_id', eventIds);
    if (msgCounts) {
      for (const m of msgCounts) {
        if (!counts[m.event_id]) counts[m.event_id] = new Set();
        counts[m.event_id].add(m.author_id);
      }
    }
  }

  return res.status(200).json({
    ok: true,
    events: rows.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      cover_url: e.cover_url,
      status: e.state,
      status_raw: e.status,
      start_at: e.start_at,
      end_at: e.end_at,
      created_at: e.created_at,
      created_by: e.created_by,
      participant_count: counts[e.id] ? counts[e.id].size : 0,
    })),
  });
}

// POST /api/community/live-events/get   { event_id }
// Read-only archive for closed events; full feed + composer availability for live ones.
export async function handleGetLiveEvent(req, res, user) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;

  const eventId = req.body?.event_id;
  if (!isUuid(eventId)) return res.status(400).json({ error: 'Invalid event id' });

  const { data: event, error } = await supabase
    .from('live_events')
    .select('id, title, description, cover_url, status, start_at, end_at, created_by, created_at, updated_at')
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    console.error('[live event get]', error);
    return res.status(500).json({ error: 'Failed to load event' });
  }
  if (!event) return res.status(404).json({ error: 'EVENT_NOT_FOUND', message: 'No such live event.' });

  const state = effectiveStatus(event);
  const isClosed = state === 'closed' || state === 'cancelled';

  // LE-3 — the LATEST 50 messages. Ordering ascending and then limiting to 50
  // returned the OLDEST 50, so a busy room never showed a recent message.
  // (id is the tiebreaker: created_at is not unique.)
  const { data: newestMessages, error: mErr } = await supabase
    .from('live_event_messages')
    .select('id, author_id, author_alias, content, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50);

  if (mErr) {
    console.error('[live event get messages]', mErr);
    return res.status(500).json({ error: 'Failed to load messages' });
  }

  // Oldest-first for rendering, but still the newest 50.
  const messages = [...(newestMessages || [])].reverse();

  // Reaction counts per message (only for messages in this batch), plus the
  // VIEWER's own reactions. Without `my_reactions` the client cannot tell a
  // reaction it already made from one it has not, so it could neither toggle a
  // reaction off nor render "mine" — and `reactions: { emoji: count }` stays
  // exactly the shape it was.
  const messageIds = (messages || []).map((m) => m.id);
  let reactions = {};
  const myReactions = {};
  if (messageIds.length) {
    const { data: reacs } = await supabase
      .from('live_event_reactions')
      .select('message_id, emoji, user_id')
      .in('message_id', messageIds);
    if (reacs) {
      for (const r of reacs) {
        if (!reactions[r.message_id]) reactions[r.message_id] = {};
        reactions[r.message_id][r.emoji] = (reactions[r.message_id][r.emoji] || 0) + 1;
        if (user?.id && r.user_id === user.id) {
          if (!myReactions[r.message_id]) myReactions[r.message_id] = [];
          myReactions[r.message_id].push(r.emoji);
        }
      }
    }
  }

  return res.status(200).json({
    ok: true,
    event: {
      id: event.id,
      title: event.title,
      description: event.description,
      cover_url: event.cover_url,
      status: state,
      status_raw: event.status,
      start_at: event.start_at,
      end_at: event.end_at,
      created_at: event.created_at,
      updated_at: event.updated_at,
      created_by: event.created_by,
      closed_notice: isClosed ? LIVE_EVENT_CLOSED_NOTICE : null,
    },
    messages: (messages || []).map((m) => ({
      id: m.id,
      author_id: m.author_id,
      author_alias: m.author_alias,
      content: m.content,
      created_at: m.created_at,
      reactions: reactions[m.id] || {},
      my_reactions: myReactions[m.id] || [],
    })),
    can_write: state === 'live',
    closed: isClosed,
  });
}

// POST /api/community/live-events/create   { title, description, cover_url?, start_at?, end_at?, status? }  admin only
export async function handleCreateLiveEvent(req, res, user) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;
  if (!(await requireLiveEventAdmin(res, user))) return;

  const { title, description, cover_url, start_at, end_at, status } = req.body || {};
  if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 120)
    return res.status(400).json({ error: 'Invalid title' });
  if (typeof description !== 'string' || description.trim().length < 1 || description.trim().length > 2000)
    return res.status(400).json({ error: 'Invalid description' });
  const st = status && ['draft','scheduled','live'].includes(status) ? status : 'draft';

  const startParsed = parseLiveEventTime(start_at);
  const endParsed = parseLiveEventTime(end_at);
  if (!startParsed.ok || !endParsed.ok)
    return res.status(400).json({ error: 'INVALID_TIME' });
  let startsAt = startParsed.iso;
  let endsAt = endParsed.iso;
  if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime())
    return res.status(400).json({ error: 'end_at must be after start_at' });
  if (st === 'live' && !endsAt) return res.status(400).json({ error: 'end_at is required to start an event' });
  if (st === 'live' && !startsAt) startsAt = truncateToMinute(new Date()).toISOString();

  const { data, error } = await supabase
    .from('live_events')
    .insert({
      title: title.trim(),
      description: description.trim(),
      cover_url: cover_url || null,
      status: st,
      start_at: startsAt,
      end_at: endsAt,
      created_by: user.id,
    })
    .select('id, title, description, cover_url, status, start_at, end_at, created_at')
    .maybeSingle();
  if (error) {
    console.error('[live event create]', error);
    return res.status(500).json({ error: 'Failed to create event' });
  }

  publishLiveEventEvent(data.id, 'created', { status: data.status });
  return res.status(200).json({ ok: true, event: data });
}

// POST /api/community/live-events/update   { event_id, title?, description?, cover_url?, start_at?, end_at? }  admin only
// (`status` is not editable here — the lifecycle has its own endpoints.)
export async function handleUpdateLiveEvent(req, res, user) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;
  if (!(await requireLiveEventAdmin(res, user))) return;

  const eventId = req.body?.event_id;
  if (!isUuid(eventId)) return res.status(400).json({ error: 'Invalid event id' });

  const { data: event, error } = await supabase
    .from('live_events')
    .select('id, status, start_at, end_at')
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    console.error('[live event update]', error);
    return res.status(500).json({ error: 'Failed to load event' });
  }
  if (!event) return res.status(404).json({ error: 'EVENT_NOT_FOUND', message: 'No such live event.' });

  const state = effectiveStatus(event);
  if (state === 'closed' || state === 'cancelled')
    return res.status(403).json({ error: 'TERMINAL', message: 'A closed or cancelled event cannot be edited.' });

  // Once live or with participants, the deadline window is immutable.
  const { data: msg } = await supabase
    .from('live_event_messages')
    .select('id')
    .eq('event_id', eventId)
    .limit(1)
    .maybeSingle();
  const hasParticipants = !!msg;

  // LE-1 — deadlines are read on the minute grid and stored as minutes.
  const startProvided = req.body?.start_at !== undefined;
  const endProvided = req.body?.end_at !== undefined;
  const startParsed = startProvided
    ? parseLiveEventTime(req.body.start_at)
    : { ok: true, iso: undefined };
  const endParsed = endProvided
    ? parseLiveEventTime(req.body.end_at)
    : { ok: true, iso: undefined };
  if (!startParsed.ok || !endParsed.ok)
    return res.status(400).json({ error: 'INVALID_TIME' });

  const oldStart = toMinuteIso(event.start_at);
  const oldEnd = toMinuteIso(event.end_at);
  const newStart = startProvided ? startParsed.iso : oldStart;
  const newEnd = endProvided ? endParsed.iso : oldEnd;

  // Same minute = not a change. A millisecond of drift must never lock an
  // event the admin did not actually retime.
  if ((state === 'live' || hasParticipants) && (startProvided || endProvided)) {
    if (newStart !== oldStart || newEnd !== oldEnd) {
      return res.status(403).json({
        error: 'EVENT_LOCKED',
        message: 'The event deadline cannot be changed once the event has started or participants have joined.',
      });
    }
  }

  const patch = {};
  if (req.body?.title !== undefined) {
    const t = String(req.body.title).trim();
    if (t.length < 1 || t.length > 120) return res.status(400).json({ error: 'Invalid title' });
    patch.title = t;
  }
  if (req.body?.description !== undefined) {
    const d = String(req.body.description).trim();
    if (d.length < 1 || d.length > 2000) return res.status(400).json({ error: 'Invalid description' });
    patch.description = d;
  }
  if (req.body?.cover_url !== undefined) patch.cover_url = String(req.body.cover_url).trim() || null;
  if (startProvided) patch.start_at = startParsed.iso;
  if (endProvided) patch.end_at = endParsed.iso;
  // LE-2 — `status` is NOT editable here. The lifecycle only moves through the
  // dedicated publish / start / cancel / close endpoints, each of which
  // validates its own transition (and the deadline lock).
  patch.updated_at = new Date().toISOString();

  // The window is validated against the MERGED row, so changing only the end
  // time is still checked against the stored start time.
  const effectiveStart = startProvided ? startParsed.iso : oldStart;
  const effectiveEnd = endProvided ? endParsed.iso : oldEnd;
  if (effectiveStart && effectiveEnd && new Date(effectiveEnd).getTime() <= new Date(effectiveStart).getTime())
    return res.status(400).json({ error: 'end_at must be after start_at' });

  const { data, error: uErr } = await supabase
    .from('live_events')
    .update(patch)
    .eq('id', eventId)
    .select('id, title, description, cover_url, status, start_at, end_at, updated_at')
    .maybeSingle();
  if (uErr) {
    console.error('[live event update]', uErr);
    return res.status(500).json({ error: 'Failed to update event' });
  }

  publishLiveEventEvent(eventId, 'updated', { status: data.status, start_at: data.start_at, end_at: data.end_at });
  return res.status(200).json({ ok: true, event: data });
}

// POST /api/community/live-events/publish   { event_id }  admin only  (draft/scheduled -> scheduled)
export async function handlePublishLiveEvent(req, res, user) {
  return handleSetLiveEventStatus(req, res, user, 'scheduled');
}

// POST /api/community/live-events/start   { event_id }  admin only  (scheduled -> live)
export async function handleStartLiveEvent(req, res, user) {
  return handleSetLiveEventStatus(req, res, user, 'live');
}

// POST /api/community/live-events/cancel   { event_id }  admin only  (draft/scheduled -> cancelled)
export async function handleCancelLiveEvent(req, res, user) {
  return handleSetLiveEventStatus(req, res, user, 'cancelled');
}

// POST /api/community/live-events/close   { event_id, reason? }  admin only  (live -> closed)
export async function handleCloseLiveEvent(req, res, user) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;
  if (!(await requireLiveEventAdmin(res, user))) return;

  const eventId = req.body?.event_id;
  if (!isUuid(eventId)) return res.status(400).json({ error: 'Invalid event id' });

  const reason = req.body?.reason && ['deadline','moderator','admin','operational'].includes(req.body.reason)
    ? req.body.reason
    : 'admin';

  const { data, error } = await supabase.rpc('live_event_close', { p_event: eventId, p_reason: reason });
  if (error) {
    console.error('[live event close]', error);
    return res.status(500).json({ error: 'Failed to close event' });
  }
  if (!data || data.ok === false)
    return res.status(409).json({ error: data?.code || 'CLOSE_FAILED' });

  publishLiveEventEvent(eventId, 'closed', { state: data.state });
  return res.status(200).json({ ok: true, event_id: eventId, state: data.state, closed_notice: LIVE_EVENT_CLOSED_NOTICE });
}

async function handleSetLiveEventStatus(req, res, user, target) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;
  if (!(await requireLiveEventAdmin(res, user))) return;

  const eventId = req.body?.event_id;
  if (!isUuid(eventId)) return res.status(400).json({ error: 'Invalid event id' });

  const { data: event, error } = await supabase
    .from('live_events')
    .select('id, status, start_at, end_at')
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    console.error(`[live event ${target}]`, error);
    return res.status(500).json({ error: 'Failed to load event' });
  }
  if (!event) return res.status(404).json({ error: 'EVENT_NOT_FOUND', message: 'No such live event.' });

  const state = effectiveStatus(event);
  if (state === 'closed' || state === 'cancelled')
    return res.status(403).json({ error: 'TERMINAL', message: 'A closed or cancelled event cannot be transitioned.' });

  const allowed = {
    draft: ['scheduled','live'],
    scheduled: ['live','cancelled'],
    live: [], // live -> closed handled by close handler
  }[state] || [];
  if (!allowed.includes(target))
    return res.status(403).json({ error: 'INVALID_TRANSITION', message: `Cannot move ${state} to ${target}.` });

  if (target === 'scheduled' && (!event.start_at || !event.end_at))
    return res.status(400).json({ error: 'start_at and end_at are required to schedule' });
  if (target === 'live' && !event.end_at)
    return res.status(400).json({ error: 'end_at is required to start an event' });

  const patch = { status: target, updated_at: new Date().toISOString() };
  if (target === 'live' && !event.start_at) patch.start_at = truncateToMinute(new Date()).toISOString();

  const { data, error: uErr } = await supabase
    .from('live_events')
    .update(patch)
    .eq('id', eventId)
    .select('id, status, start_at, end_at, updated_at')
    .maybeSingle();
  if (uErr) {
    console.error(`[live event ${target}]`, uErr);
    return res.status(500).json({ error: 'Failed to transition event' });
  }

  publishLiveEventEvent(eventId, 'transition', { status: target, state: effectiveStatus(data) });
  return res.status(200).json({ ok: true, event: data });
}

// ---------------------------------------------------------------------------
// LE-6 - THE WRITES ARE LIVE-ONLY, AND THE SERVER DECIDES.
//
// The room's composer opens when the event goes live, and the room read
// answers `can_write: state === 'live'`. If the server then accepted a
// message into a SCHEDULED event, the client would be the only thing
// enforcing the rule - and the rule is the whole point of a live event.
//
// ORDER MATTERS: `_live_event_over` is checked FIRST, so a closed, cancelled
// or deadline-expired event still answers EVENT_CLOSED (the LE-4 contract).
// Only a non-live, non-terminal event answers EVENT_NOT_LIVE.
//
// A failed state read FAILS CLOSED (the write is refused), exactly as it did
// before this helper existed.
// ---------------------------------------------------------------------------
const requireLiveEventWritable = async (res, supabase, eventId) => {
  const over = await supabase.rpc('_live_event_over', { p_event: eventId });
  if (over.error || over.data === true) {
    res.status(403).json({ error: 'EVENT_CLOSED', message: LIVE_EVENT_CLOSED_NOTICE });
    return null;
  }

  const { data: event, error: evErr } = await supabase
    .from('live_events')
    .select('id, status, start_at, end_at')
    .eq('id', eventId)
    .maybeSingle();
  if (evErr) {
    console.error('[live event write]', evErr);
    res.status(500).json({ error: 'Failed to load event' });
    return null;
  }
  if (!event) {
    res.status(404).json({ error: 'EVENT_NOT_FOUND', message: 'No such live event.' });
    return null;
  }

  // effectiveStatus promotes a SCHEDULED event whose start has passed to
  // 'live', so a scheduled event that is already running still accepts
  // writes - the same rule the room read advertises.
  if (effectiveStatus(event) !== 'live') {
    res.status(403).json({
      error: 'EVENT_NOT_LIVE',
      message: LIVE_EVENT_ERROR_MESSAGES.EVENT_NOT_LIVE,
    });
    return null;
  }

  return event;
};

// POST /api/community/live-events/send   { event_id, content }   (authenticated, live only)
export async function handleSendLiveEventMessage(req, res, user) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;

  const eventId = req.body?.event_id;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!isUuid(eventId)) return res.status(400).json({ error: 'Invalid event id' });
  if (content.length < 1 || content.length > 1000) return res.status(400).json({ error: 'Invalid content' });

  // LE-6: the server refuses the write unless the event is LIVE. A closed,
  // cancelled or deadline-expired event answers EVENT_CLOSED; a scheduled or
  // draft event answers EVENT_NOT_LIVE.
  const writable = await requireLiveEventWritable(res, supabase, eventId);
  if (!writable) return;

  const { data, error } = await supabase
    .from('live_event_messages')
    .insert({ event_id: eventId, author_id: user.id, author_alias: 'Anonymous Member', content })
    .select('id, author_id, author_alias, content, created_at')
    .maybeSingle();
  if (error) {
    console.error('[live event send]', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }

  publishLiveEventEvent(eventId, 'message', { message_id: data.id });
  return res.status(200).json({ ok: true, message: data });
}

// POST /api/community/live-events/react   { message_id, emoji, active }   (authenticated, live only)
export async function handleReactLiveEventMessage(req, res, user) {
  const supabase = liveEventsDb(res);
  if (!supabase) return;

  const messageId = req.body?.message_id;
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim() : '';
  const active = req.body?.active !== false;
  if (!isUuid(messageId)) return res.status(400).json({ error: 'Invalid message id' });
  if (emoji.length < 1 || emoji.length > 20) return res.status(400).json({ error: 'Invalid emoji' });

  // Resolve the parent event so we can gate on its lifecycle.
  const { data: message, error: mErr } = await supabase
    .from('live_event_messages')
    .select('id, event_id')
    .eq('id', messageId)
    .maybeSingle();
  if (mErr) {
    console.error('[live event react]', mErr);
    return res.status(500).json({ error: 'Failed to load message' });
  }
  if (!message) return res.status(404).json({ error: 'MESSAGE_NOT_FOUND', message: 'No such message.' });

  // LE-6: the reaction is a write too, so it is gated on the SAME live-only
  // rule as the message it belongs to.
  const writable = await requireLiveEventWritable(res, supabase, message.event_id);
  if (!writable) return;

  if (active) {
    const { error } = await supabase
      .from('live_event_reactions')
      .insert({ message_id: messageId, event_id: message.event_id, user_id: user.id, emoji })
      .select('id')
      .maybeSingle();
    if (error) {
      // Duplicate (same user/emoji on same message) is idempotent — treat as ok.
      if (error.code === '23505') return res.status(200).json({ ok: true, active: true });
      console.error('[live event react insert]', error);
      return res.status(500).json({ error: 'Failed to add reaction' });
    }
  } else {
    const { error } = await supabase
      .from('live_event_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', user.id)
      .eq('emoji', emoji);
    if (error) {
      console.error('[live event react delete]', error);
      return res.status(500).json({ error: 'Failed to remove reaction' });
    }
  }

  // Notice only: no user id. A public broadcast channel must not turn into a
  // roster of who reacted to what.
  publishLiveEventEvent(message.event_id, 'reaction', { message_id: messageId, emoji, active });
  return res.status(200).json({ ok: true, active });
}
