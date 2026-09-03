// Vercel catch-all route for /api/quota/*
// Routes /api/quota/course-status and /api/quota/course-consume to the quota
// handler (which dispatches internally on req.url). Without this, Vercel only
// served api/quota.js at the exact /api/quota path and sub-paths fell through
// to the SPA rewrite, returning HTML instead of JSON.
export { default } from '../quota.js';
