// Vercel catch-all route for /api/progress/*
// Routes /api/progress/difficulty and /api/progress/history to the progress
// handler (which dispatches internally on req.url). Without this, Vercel only
// served api/progress.js at the exact /api/progress path and sub-paths fell
// through to the SPA rewrite, returning HTML instead of JSON.
export { default } from '../progress.js';
