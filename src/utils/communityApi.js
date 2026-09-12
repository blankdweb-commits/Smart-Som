// Client helper for the server-authoritative community router (/api/community).
// ALL community writes (post/reply/like/delete/edit/report and anonymous-group
// join/leave/panel) go through this router because migration-v29 removed direct
// client RLS writes from community_posts/comments/likes/reports. Public reads
// still use Supabase directly (community_feed view / RPCs).

import { authHeaders } from './apiHeaders';

export async function communityApi(session, path, body = {}) {
  const res = await fetch(`/api/community${path}`, {
    method: 'POST',
    headers: { ...authHeaders(session, { json: true }) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Request failed');
    err.code = data.error;
    err.status = res.status;
    throw err;
  }
  return data;
}