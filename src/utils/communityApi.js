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
import { getAnonVisitKey } from './anonVisit';

export async function communityApi(session, path, body = {}) {
  // WS3 — tag every request with the current tab's Anonymous room visit key so
  // the server can re-roll a member's pseudonym on a new visit. Harmless on
  // non-room routes (the server only reads it where a viewer's alias matters).
  const visit = getAnonVisitKey();
  const headers = authHeaders(session, { json: true });
  if (visit) headers['x-room-visit'] = visit;
  return apiFetch(`/community${path}`, {
    method: 'POST',
    headers,
    token: session?.access_token,
    body,
  });
}

export default communityApi;

// WS4 — public, UNAUTHENTICATED preview of a deep-linked Anonymous room. No
// bearer token (unlike communityApi): the /anonymous/preview route is
// special-cased on the server before authorizeRequest. Used to render a
// logged-out preview screen for /anonymous/:id without booting the full room.
export async function communityPreview(groupId) {
  return apiFetch('/community/anonymous/preview', {
    method: 'POST',
    retryOnAuth: false,
    body: { group_id: groupId },
  });
}

// ---------------------------------------------------------------------------
// Phase 1 — ONE-TIME GUEST PREVIEW
//
// Both calls are unauthenticated on purpose (no bearer token, retryOnAuth off),
// exactly like communityPreview above. A guest token buys these two READ-ONLY
// endpoints and nothing else — every write route in the room still 401s.
//
// `start` is the single mint point. Passing the previously stored token back
// never extends the window: the server honours the ORIGINAL expiry or refuses
// with PREVIEW_ALREADY_USED. It is not a resume, it is a re-presentation.
// ---------------------------------------------------------------------------
export async function guestPreviewStart(groupId, token) {
  return apiFetch('/community/anonymous/guest-preview-start', {
    method: 'POST',
    retryOnAuth: false,
    body: { group_id: groupId, token: token || undefined },
  });
}

export async function guestPreviewStream(groupId, token, before) {
  return apiFetch('/community/anonymous/guest-preview-stream', {
    method: 'POST',
    retryOnAuth: false,
    body: { group_id: groupId, token, before: before || undefined },
  });
}