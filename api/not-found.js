// ============================================================
// /api (catch-all) — JSON 404
//
// Every unmatched /api/* path on Vercel is rewritten to /api/not-found (see
// vercel.json) so a browser request to a route with no backing function gets a
// JSON error — NEVER the SPA index.html. This keeps the frontend's JSON
// contract intact: no more "attempted to parse <!doctype html> as JSON".
//
// Also intentionally rejects the support modules that used to live under api/
// (_utils, question-selection service, selection config) — those are now
// underscore-prefixed so Vercel ignores them as functions, and if someone
// probes their old URLs they get a clean 404 JSON here. Zero information leak.
// ============================================================

export default function handler(req, res) {
  const path = (req.url || '/').split('?')[0];
  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Unknown API route.',
    },
    path,
  });
}