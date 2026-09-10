# Vercel Deployment Architecture

> Status: configuration fixed and logic verified locally. **Live redeploy has
> not been executed** — see "Redeploy checklist".

## Why the deployment was failing (analysis)

### Failure A — config validation: `Function Runtimes must have a valid version`

A second deploy attempt aborted at "Running vercel build" (before the app build
ran) with:

```
Error: Function Runtimes must have a valid version, for example `now-php@1.0.0`.
```

Root cause: `vercel.json` pinned `"functions": { "api/*.js": { "runtime":
"nodejs20.x" } }`. In the `functions` map, `runtime` must be an **npm package
name including a version** (`now-php@1.0.0`, `@vercel/node@3.x`, …). `nodejs20.x`
is a Node *runtime identifier* that is only legal inside a function file's
`export const config = { runtime: 'nodejs20.x' }`, never in `vercel.json`.
Vercel rejects the value outright → the error above, which fails before Build.

Fix: removed the `functions` block entirely. Vercel auto-detects top-level
`api/*.js` as Node.js Functions with no configuration; the Node version is taken
from project settings / `package.json` `engines` (`>=20.0.0` → current LTS).

### Failure B — post-build `Deploying outputs...` failure

1. **Non-handler modules treated as serverless functions.** Vercel exposes
   *every* top-level `api/*.js` as a route — except files whose name starts
   with `_`. The repo previously had two real support modules deployed as fake
   functions:
   - `api/questionSelectionService.js` → renamed `api/_questionSelectionService.js`
   - `api/selectionConfig.js` → renamed `api/_selectionConfig.js`
   All imports across `api/matches-create.js`, `api/quiz-batch-*.js`, and
   `_questionSelectionService.js` were updated to the underscored names.

2. **Self-referential rewrite.** Old `vercel.json` had
   `/api/:path* → /api/:path*`, a loop/no-op. Removed.

3. **Missing JSON 404 for unmatched `/api/*`.** Any `/api/...` path without a
   backing function fell through to the SPA `index.html` (200 text/html), so
   the frontend tried to parse HTML as JSON (`<!doctype html>`). Added
   `api/not-found.js` (JSON 404) and a catch-all rewrite
   `/api/:path* → /api/not-found` placed **before** the SPA fallback.

4. **Deploy payload bloat.** Production sourcemaps (~7 MB) removed
   (`build.sourcemap: false`) and the ~16 MB bank chunk taken out of the
   initial load (see "Bundle" below).

## Routing model

- Vercel exposes **only top-level** `api/*.js` as request handlers. Files
  starting with `_` are ignored (shared support modules).
- Handlers use the `@vercel/node` shape: `export default async function
  handler(req, res)`.
- **Consolidation for the Hobby plan (≤ 12 functions)**: the four quiz batch
  actions previously deployed as `api/quiz-batch-{create,get,answer,complete}.js`
  are now served by a **single `api/quiz.js`** function that dispatches on the
  original `req.url`. Logic moved to `api/_quiz-batches.js` (underscore → not
  deployed). Both the flat client paths (`/api/quiz-batch-*`) and the legacy
  nested paths (`/api/quiz/batch-*`) are rewritten onto `/api/quiz`. Total:
  **11 functions**.
- Legacy client/paystack URLs are preserved by rewrites in `vercel.json`:
  `/api/quiz/batch-create|get|answer|complete → /api/quiz`,
  `/api/quiz-batch-create|get|answer|complete → /api/quiz`,
  `/api/matches/create → /api/matches-create`,
  `/api/payments/webhook → /api/payments-webhook`.
- `req.url` is preserved across rewrites, so `api/quiz.js` dispatches on the
  original path.

## vercel.json (current)

```jsonc
{
  "buildCommand": "npm run build",
  "installCommand": "npm install",
  "outputDirectory": "dist",
  "headers": [ /* X-Content-Type-Options / X-Frame-Options / X-XSS-Protection */ ],
  "rewrites": [
    // quiz batch actions — flat + legacy, all onto the single /api/quiz function
    { "source": "/api/quiz/batch-create",       "destination": "/api/quiz" },
    { "source": "/api/quiz-batch-create",       "destination": "/api/quiz" },
    // … also get / answer / complete …
    // JSON 404 catch-all — MUST precede the SPA fallback
    { "source": "/api/:path*", "destination": "/api/not-found" },
    // SPA fallback — MUST be last
    { "source": "/:path*", "destination": "/index.html" }
  ]
}
```

> No `functions` block: the `runtime: "nodejs20.x"` key there is invalid (see
> Failure A) and was removed. Function Node version comes from project
> settings / `package.json` `engines`. **Hobby limit**: deployments allow at
> most 12 Serverless Functions; this config deploys exactly **11**.

## Bundle strategy (client payload)

- `src/data/loadFlashcards.js` uses a **lazy** `import.meta.glob`
  (`./flashcards/**/*.json` without `eager`) and exports the memoized async
  `loadAllBuiltInFlashcards()`.
- `src/context/AppContext.jsx` no longer inlines the bank arrays at module
  load; it hydrates them into `flashcards` state only after a session exists
  (auth-gated, deduplicated, one-time).
- `vite.config.js` `/flashcard-data` manualChunk now matches **only** raw JSON
  under `src/data/flashcards/`. `loadFlashcards.js` stays in the entry chunk —
  AppContext statically imports it, so grouping it with the bank JSON dragged
  the whole ~16 MB chunk back onto the initial page load. With the rule fixed:
  - `dist/index.html` references `index` + `vendor` only, and
  - anonymous visitors never download the protected banks at all.
- The lazy glob still emits a cacheable `flashcard-data` chunk (~15.6 MB) that
  is fetched only after authentication requests it.

## Verified (this session, local)

- `npm run build` — OK (~40 s). `npm run lint` — 0 errors / 36 warnings
  (pre-existing baseline).
- `node scripts/verify-deploy-config.mjs` — **42/42 PASS** (rewrite/function
  backing, `_`-prefix rule, no invalid runtime / legacy builds, no SPA
  swallows, no self-loop, payload shape, `api/not-found.js`, serve-api parity).
- Local API smoke (`node scripts/serve-api.mjs`): `/api/quota/course-status`,
  `/api/quiz/batch-create`, `/api/quiz/batch-get` → 401 JSON; unmatched
  `/api/does-not-exist` → `{"ok":false,"error":{"code":"NOT_FOUND",…}}` from the
  same `api/not-found.js` the Vercel rewrite targets.

## Redeploy checklist (manual, user + Vercel dashboard)

1. Ensure Vercel env vars are set: `VITE_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`,
   `VITE_PAYSTACK_PUBLIC_KEY`, `APP_URL`. Remove `VITE_GEMINI_API_KEY` (no code
   references it anymore).
2. Commit and push this branch; trigger/redeploy in the Vercel dashboard.
3. After deploy, probe `https://<app>/api/quiz-batch-get?id=x` → expect **401
   JSON** (not HTML), and `https://<app>/api/nonexistent` → **404 JSON**.
4. The exact post-`Deploying outputs...` failure cannot be reproduced at the
   command line here (no `vercel` CLI auth in this environment), so the deploy
   must be confirmed once on the dashboard before closing this item.