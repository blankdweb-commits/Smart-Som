// Client helper for the server-authoritative Anonymous Live Events router
// (/api/community/live-events/*). Every call is authenticated; apiFetch refreshes
// the session once on a 401 and replays, so an expiring access token
// self-heals instead of failing until a reload.
import { authHeaders } from './apiHeaders';
import { apiFetch } from './apexFetch';

export async function liveEventsApi(session, path, body = {}) {
  return apiFetch(`/community/live-events${path}`, {
    method: 'POST',
    headers: authHeaders(session, { json: true }),
    token: session?.access_token,
    body,
  });
}

export const listLiveEvents = (session) => liveEventsApi(session, '/list', {});
export const getLiveEvent = (session, eventId) => liveEventsApi(session, '/get', { event_id: eventId });
export const createLiveEvent = (session, payload) => liveEventsApi(session, '/create', payload);
export const updateLiveEvent = (session, eventId, patch) => liveEventsApi(session, '/update', { event_id: eventId, ...patch });
export const publishLiveEvent = (session, eventId) => liveEventsApi(session, '/publish', { event_id: eventId });
export const startLiveEvent = (session, eventId) => liveEventsApi(session, '/start', { event_id: eventId });
export const cancelLiveEvent = (session, eventId) => liveEventsApi(session, '/cancel', { event_id: eventId });
export const closeLiveEvent = (session, eventId, reason = 'admin') =>
  liveEventsApi(session, '/close', { event_id: eventId, reason });
export const sendLiveEventMessage = (session, eventId, content) =>
  liveEventsApi(session, '/send', { event_id: eventId, content });
export const reactLiveEventMessage = (session, messageId, emoji, active) =>
  liveEventsApi(session, '/react', { message_id: messageId, emoji, active });

export default {
  listLiveEvents,
  getLiveEvent,
  createLiveEvent,
  updateLiveEvent,
  publishLiveEvent,
  startLiveEvent,
  cancelLiveEvent,
  closeLiveEvent,
  sendLiveEventMessage,
  reactLiveEventMessage,
};
