// Client helper for the server-authoritative community router (/api/community).
// ALL community writes (post/reply/like/delete/edit/report and anonymous-group
// join/leave/panel) go through this router because migration-v29 removed direct
// client RLS writes from community_posts/comments/likes/reports. Public reads
// still use Supabase directly (community_feed view / RPCs).
//
// Auth-aware: on a 401 the shared apiFetch refreshes the session once (deduped)
// and replays the request, so a leave→rejoin cycle that trips over an
// about-to-expire access token self-heals instead of failing until a reload.

import { authHeaders } from './apiHeaders';
import { apiFetch } from './apexFetch';

export async function communityApi(session, path, body = {}) {
  return apiFetch(`/community${path}`, {
    method: 'POST',
    headers: authHeaders(session, { json: true }),
    token: session?.access_token,
    body,
  });
}

export default communityApi;