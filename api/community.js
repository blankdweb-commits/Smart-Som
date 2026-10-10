// ============================================================
// /api/community  (Vercel Serverless Function)
//
// Single entry point for every server-authoritative COMMUNITY write
// (community reset + ephemeral posts + anonymous group system). The client
// is locked OUT of direct community_posts/comments/likes writes by migration
// v29 RLS, so ALL of those writes go through this router with the service
// role. Reads of the public feed still happen via Supabase directly
// (community_feed view); anonymous-group reads use the community RPCs.
//
// vercel.json rewrites /api/community/* (and /api/community) onto this file
// while preserving the original req.url; serve-api.mjs mounts /api/community
// natively by walking api/*.js.
//
// Endpoints (all POST, JSON):
//   /api/community/posts             create post      { content?, image_url?, group_id? }
//   /api/community/posts/reply       reply            { post_id, content }
//   /api/community/posts/like        like toggle      { post_id, liked }
//   /api/community/posts/delete      delete           { post_id }
//   /api/community/posts/edit        edit             { post_id, content?, image_url? }
//   /api/community/posts/edit-comment      edit reply  { comment_id, content }
//   /api/community/posts/delete-comment    delete reply { comment_id }
//   /api/community/posts/report      report           { post_id, reason }
//   /api/community/posts/vote        up/down vote     { post_id, value }
//   /api/community/groups/join       join             { group_id }
//   /api/community/groups/leave      leave            { group_id }
//   /api/community/groups/panel      panel info       { group_id }
//   /api/community/groups/feed       authorized feed  { group_id, limit? }
//   /api/community/anonymous/room-create  open a new room { name? }
//   /api/community/anonymous/room    room bootstrap   { group_id? }
//   /api/community/anonymous/feed    masked messages  { group_id?, before?, limit? }
//   /api/community/anonymous/message one message      { message_id, group_id? }
//   /api/community/anonymous/send    speak            { content, group_id?, reply_to_post_id? }
//   /api/community/anonymous/react   react            { message_id, emoji, active, group_id? }
//   /api/community/anonymous/ack     accept notice    { group_id?, key? }
//   /api/community/anonymous/lock    close/open room  { group_id?, locked }
//   /api/community/anonymous/social        action card  { action, message_id? | target_alias?, group_id? }
//   /api/community/anonymous/event         one card     { event_id, group_id? }
//   /api/community/anonymous/event-react   react to card { event_id, emoji, active, group_id? }
//   /api/community/anonymous/event-respond accept/decline { event_id, respond, group_id? }
//   /api/community/anonymous/prefs         anti-slam opt-out { declining_interactions?, group_id? }
//   /api/community/anonymous/presence       heartbeat { session_id, group_id? }
//   /api/community/anonymous/presence-leave exit      { group_id? }
//   /api/community/anonymous/encoded premium decode/reveal { message_id, action?, group_id? }
//   /api/community/notifications/subscribe    { endpoint, keys:{p256dh,auth}, user_agent? }
//   /api/community/notifications/unsubscribe  { endpoint }
//   /api/community/notifications/preferences  { room_messages?, member_joins?, social? }
//   /api/community/notifications/vapid        public key
//   /api/community/moderation/reports  admin queue    { status?, limit? }
//   /api/community/moderation/resolve  admin action   { report_id, action, note? }
//   /api/community/cleanup           scheduler        header X-Cleanup-Token
// ============================================================

import { applyCors, authorizeRequest } from './_utils.js';
import {
  handleCreatePost,
  handleReply,
  handleLike,
  handleDelete,
  handleEdit,
  handleEditComment,
  handleDeleteComment,
  handleReport,
  handleVote,
  handleCreateAnonRoom,
  handleJoinGroup,
  handleLeaveGroup,
  handlePanel,
  handleGroupFeed,
  handleAnonRoom,
  handleAnonFeed,
  handleAnonMessage,
  handleAnonSend,
  handleAnonReact,
  handleAnonAck,
  handleAnonSetLocked,
  handleAnonSocial,
  handleAnonEvent,
  handleAnonEventReact,
  handleAnonEventRespond,
  handleAnonPrefs,
  handleAnonPresence,
  handleAnonPresenceLeave,
  handleAnonEncoded,
  handleNotificationsSubscribe,
  handleNotificationsUnsubscribe,
  handleNotificationsPreferences,
  handleNotificationsVapid,
  handleModerationReports,
  handleModerationResolve,
  handleCleanup,
} from './_community.js';

const HANDLERS = [
  { re: /\/posts\/reply$/, fn: handleReply },
  { re: /\/posts\/like$/, fn: handleLike },
  { re: /\/posts\/delete$/, fn: handleDelete },
  { re: /\/posts\/edit$/, fn: handleEdit },
  { re: /\/posts\/edit-comment$/, fn: handleEditComment },
  { re: /\/posts\/delete-comment$/, fn: handleDeleteComment },
  { re: /\/posts\/report$/, fn: handleReport },
  { re: /\/posts\/vote$/, fn: handleVote },
  { re: /\/posts$/, fn: handleCreatePost },
  { re: /\/groups\/join$/, fn: handleJoinGroup },
  { re: /\/groups\/leave$/, fn: handleLeaveGroup },
  { re: /\/groups\/panel$/, fn: handlePanel },
  { re: /\/groups\/feed$/, fn: handleGroupFeed },
  { re: /\/anonymous\/room-create$/, fn: handleCreateAnonRoom },
  { re: /\/anonymous\/room$/, fn: handleAnonRoom },
  { re: /\/anonymous\/feed$/, fn: handleAnonFeed },
  { re: /\/anonymous\/message$/, fn: handleAnonMessage },
  { re: /\/anonymous\/send$/, fn: handleAnonSend },
  { re: /\/anonymous\/react$/, fn: handleAnonReact },
  { re: /\/anonymous\/ack$/, fn: handleAnonAck },
  { re: /\/anonymous\/lock$/, fn: handleAnonSetLocked },
  { re: /\/anonymous\/social$/, fn: handleAnonSocial },
  { re: /\/anonymous\/event-react$/, fn: handleAnonEventReact },
  { re: /\/anonymous\/event-respond$/, fn: handleAnonEventRespond },
  { re: /\/anonymous\/event$/, fn: handleAnonEvent },
  { re: /\/anonymous\/prefs$/, fn: handleAnonPrefs },
  { re: /\/anonymous\/presence-leave$/, fn: handleAnonPresenceLeave },
  { re: /\/anonymous\/presence$/, fn: handleAnonPresence },
  { re: /\/anonymous\/encoded$/, fn: handleAnonEncoded },
  { re: /\/notifications\/subscribe$/, fn: handleNotificationsSubscribe },
  { re: /\/notifications\/unsubscribe$/, fn: handleNotificationsUnsubscribe },
  { re: /\/notifications\/preferences$/, fn: handleNotificationsPreferences },
  { re: /\/notifications\/vapid$/, fn: handleNotificationsVapid },
  { re: /\/moderation\/reports$/, fn: handleModerationReports },
  { re: /\/moderation\/resolve$/, fn: handleModerationResolve },
  { re: /\/cleanup$/, fn: handleCleanup },
];

export default async function handler(req, res) {
  if (!applyCors(req, res)) {
    return res.status(403).json({ error: 'FORBIDDEN_ORIGIN', message: 'This API is locked to the app domain.' });
  }
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = (req.url || '').split('?')[0];
  const entry = HANDLERS.find(({ re }) => re.test(path));

  if (!entry) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Unknown community endpoint.',
      path,
    });
  }

  if (entry.fn === handleCleanup) {
    // Scheduler endpoint: authenticated by header token only.
    return handleCleanup(req, res);
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authorizeRequest(req);
  if (auth.status !== 200) {
    return res.status(auth.status).json(auth.body);
  }

  try {
    return await entry.fn(req, res, auth.user);
  } catch (error) {
    console.error(`[community ${path}]`, error?.stack || error?.message || error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}