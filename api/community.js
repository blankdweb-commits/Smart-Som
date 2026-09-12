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
//   /api/community/groups/join       join             { group_id }
//   /api/community/groups/leave      leave            { group_id }
//   /api/community/groups/panel      panel info       { group_id }
//   /api/community/groups/feed       authorized feed  { group_id, limit? }
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
  handleJoinGroup,
  handleLeaveGroup,
  handlePanel,
  handleGroupFeed,
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
  { re: /\/posts$/, fn: handleCreatePost },
  { re: /\/groups\/join$/, fn: handleJoinGroup },
  { re: /\/groups\/leave$/, fn: handleLeaveGroup },
  { re: /\/groups\/panel$/, fn: handlePanel },
  { re: /\/groups\/feed$/, fn: handleGroupFeed },
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