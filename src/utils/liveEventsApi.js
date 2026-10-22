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

// ---------------------------------------------------------------------------
// LE-0 — the Live Events error contract, client side.
//
// The server answers every refusal with { error: <CODE>, message: <text> }.
// The message is authoritative and is what we show; this table is the
// fallback for the codes the browser can raise on its own (expired session,
// network, an unreachable API) and for any code a future server adds.
// ---------------------------------------------------------------------------
export const LIVE_EVENT_ERROR_COPY = {
  SERVER_CONFIG: 'Live events are not configured on this server. Ask an administrator to check the deployment.',
  ADMIN_LOOKUP_UNAVAILABLE: 'Could not verify your administrator access just now. Please retry in a moment.',
  UNAUTHORIZED: 'Your session expired. Sign in again and retry.',
  AUTH_SERVICE_UNAVAILABLE: 'Sign-in is temporarily unavailable. Please retry in a moment.',
  AUTH_EXPIRED: 'Your session has expired. Sign in again and retry.',
  AUTH_NOT_READY: 'You need to be signed in to manage live events.',
  NETWORK: 'Could not reach the server. Check your connection and retry.',
  REQUEST_FAILED: 'The request could not be completed. Please retry.',
  FORBIDDEN_ORIGIN: 'This request was blocked because it did not come from the app.',
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
  INVALID_TIME: 'That date and time could not be read. Re-enter it.',
  END_TIME_REQUIRED: 'Set an end time before this event can go live.',
  SCHEDULE_WINDOW_REQUIRED: 'Set a start time and an end time before this event can be scheduled.',
  EVENT_LOCKED:
    'The deadline cannot be changed once the event has started or participants have joined. Edit the title or description instead.',
  TERMINAL: 'This event is closed or cancelled, so it can no longer be changed.',
  INVALID_TRANSITION: 'That status change is not allowed for this event.',
  EVENT_NOT_FOUND: 'That live event no longer exists.',
  MESSAGE_NOT_FOUND: 'That message no longer exists.',
  EVENT_CLOSED: 'This live event has closed. You can still read it, but no new messages or actions can be added.',
  EVENT_NOT_LIVE: 'This event is not live yet. Messages and reactions open when it goes live.',
  NOT_LIVE: 'Only a live event can be closed.',
  LIST_FAILED: 'Could not load live events. Please retry.',
  LOAD_FAILED: 'Could not load the live event. Please retry.',
  MESSAGES_FAILED: 'Could not load the messages. Please retry.',
  MESSAGE_LOAD_FAILED: 'Could not load the message. Please retry.',
  CREATE_FAILED: 'Could not create the live event. Please retry.',
  UPDATE_FAILED: 'Could not update the live event. Please retry.',
  TRANSITION_FAILED: 'Could not change the status of this event. Please retry.',
  CLOSE_FAILED: 'Could not close the live event. Please retry.',
  SEND_FAILED: 'Could not send the message. Please retry.',
  REACT_FAILED: 'Could not save the reaction. Please retry.',
  INTERNAL_ERROR: 'Something went wrong handling this request. Please retry.',
};

// Turns any thrown error into { code, message } ready for display. The server
// message wins when it sent one; the table above fills the gaps.
export const liveEventError = (err) => {
  const code = err?.code || err?.data?.error || 'REQUEST_FAILED';
  const serverMessage = typeof err?.data?.message === 'string' ? err.data.message : '';
  const message =
    serverMessage ||
    LIVE_EVENT_ERROR_COPY[code] ||
    err?.message ||
    'The request could not be completed. Please retry.';
  return { code, message };
};

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
  liveEventError,
  LIVE_EVENT_ERROR_COPY,
};
