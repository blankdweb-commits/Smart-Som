// Shared helper for authenticating requests to the Apex serverless API.
// Attaches the caller's access token.

// Build base headers for Apex API calls: { Authorization }.
// Pass `{ json: true }` to also set Content-Type: application/json.
export const authHeaders = (session, { json = false } = {}) => {
  const headers = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  if (json) headers['Content-Type'] = 'application/json';
  return headers;
};
