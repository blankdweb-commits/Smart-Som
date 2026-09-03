// Vercel catch-all route for /api/session/*
// Vercel only serves api/session.js at the exact /api/session path; deep
// sub-paths such as /api/session/register fall through to the SPA rewrite and
// returned HTML. This catch-all routes every /api/session/<subpath> back to the
// same session handler, which dispatches internally on req.url.
export { default } from '../session.js';
