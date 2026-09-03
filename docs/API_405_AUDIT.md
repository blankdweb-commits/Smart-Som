# API 405 / HTML-Audit

**Date:** 2026-09-03
**Status:** RESOLVED & VERIFIED ON PRODUCTION

## 1. Root cause

Apex Scholars is deployed as a **Vite React SPA + Vercel Serverless Functions**
(`api/*.js`). It is **NOT** Next.js.

Vercel only serves a filesystem function file (`api/<name>.js`) at its
**exact mount path**:

- `api/session.js`  →  `/api/session`
- `api/quota.js`    →  `/api/quota`
- `api/progress.js` →  `/api/progress`

Deep sub-paths that the frontend actually calls — `/api/session/register`,
`/api/quota/course-status`, `/api/progress/difficulty`, etc. — did **not** map
to any function file, so they fell through to the SPA rewrite
(`/:path*` → `/index.html`). Result:

- `GET /api/.../<subpath>` → **200 text/html** (the SPA index page)
- `POST /api/.../<subpath>` → **405** (Vercel allows GET/HEAD for static fallback)

The handlers already dispatch internally on `req.url` (`endsWith('/register')`,
etc.), but they never received those requests on Vercel because Vercel never
routed the sub-path to the function.

The earlier `vercel.json` attempt used the API catch-all file convention:

```json
{ "source": "/api/:path*", "destination": "/api/:path*" }
```

This did **not** work: `[...path].js` catch-all files are a **Next.js feature**.
For non-Next.js (`api/`) functions Vercel only supports **single path segments**
(`api/[seg].js`), not multi-segment catch-alls. Hence sub-paths still returned
HTML.

## 2. Affected endpoints

| Frontend URL | Method | Implementation | Before | After |
| :--- | :--- | :--- | :--- | :--- |
| `/api/session/register` | POST | `api/session.js` | 405 / HTML | 401 JSON |
| `/api/session/touch` | POST | `api/session.js` | 405 / HTML | 401 JSON |
| `/api/session/revoke` | POST | `api/session.js` | 405 / HTML | 401 JSON |
| `/api/session/devices` | GET | `api/session.js` | HTML | 401 JSON |
| `/api/quota/course-status` | GET | `api/quota.js` | HTML | 200 JSON |
| `/api/quota/course-consume` | POST | `api/quota.js` | 405 / HTML | 401 JSON |
| `/api/progress/difficulty` | GET/POST | `api/progress.js` | HTML | 200/401 JSON |
| `/api/progress/history` | GET | `api/progress.js` | HTML | 401 JSON |

## 3. Why production returned 405 and HTML

The deployed SPA rewrite `/:path* → /index.html` captured every `/api/*` request
that did not match a function at its exact path. `GET` sub-paths served the SPA
markup (200 text/html); `POST` sub-paths got 405 from the static host. The
frontend then called `await res.json()` on an HTML body, producing
`Unexpected token '<', "<!doctype "... is not valid JSON` in `AppContext.jsx`,
`Quiz.jsx`, and `QuizSetupFlow.jsx`.

## 4. The fix

**Rewrite each `/api/<fn>/<subpath>` to the function's base path in `vercel.json`.**

```json
{
  "rewrites": [
    { "source": "/api/session/:path*",   "destination": "/api/session" },
    { "source": "/api/quota/:path*",     "destination": "/api/quota" },
    { "source": "/api/progress/:path*",  "destination": "/api/progress" },
    { "source": "/api/daily-challenge/:path*",   "destination": "/api/daily-challenge" },
    { "source": "/api/feedback/:path*",          "destination": "/api/feedback" },
    { "source": "/api/initiate-payment/:path*",  "destination": "/api/initiate-payment" },
    { "source": "/api/verify-payment/:path*",    "destination": "/api/verify-payment" },
    { "source": "/api/payments/:path*",  "destination": "/api/payments" },
    { "source": "/api/:path*", "destination": "/api/:path*" },
    { "source": "/:path*", "destination": "/index.html" }
  ]
}
```

- The specific rewrites are listed **before** the `/:path*` SPA fallback.
- Vercel preserves the **original `req.url`** across a plain rewrite (no query
  captures) to a function, so each handler still receives the full sub-path
  (`/api/quota/course-status`) and its existing `endsWith()` dispatch works
  unchanged. No handler logic was rewritten.
- The ineffective `api/<name>/[...path].js` catch-all files (added and then
  removed) are not used. Vercel's `api/` filesystem functions do not support
  multi-segment catch-alls outside Next.js.
- `src/utils/apiHeaders.js` (auth + `X-Session-Id`) and all server-authoritative
  quota/difficulty logic are unchanged — no client-side quota, no localStorage
  counters, no premium-forgiveness on API failure.

## 5. Exact files changed

- `vercel.json` — per-function sub-path rewrites (the routing fix).
- `src/context/AppContext.jsx` — added `callApexApi` helper +
  refactored `fetchCourseQuotaStatus`, `consumeCourseQuota`,
  `fetchDifficultyStatus`, `recordAnsweredBatch` to verify `content-type` and
  log a clear *"API returned non-JSON"* diagnostic instead of throwing a
  confusing `Unexpected token '<'`. Required API failures are no longer
  silently labelled "skipped".
- `src/pages/Auth.jsx` — added `autocomplete` attributes (`name`, `email`,
  `tel`, `new-password` for signup, `current-password` for sign in) to fix the
  browser "input elements should have autocomplete attributes" warning.
- `api/session/[...path].js`, `api/quota/[...path].js`,
  `api/progress/[...path].js` — created then **deleted** (ineffective catch-all
  approach, superseded by the vercel.json rewrites).

## 6. Vercel / deployment changes

- Deployed the `feature/nursing-hub-app-10528384678802489862` branch (Vercel
  auto-deploys this branch from GitHub).
- `vercel.json` now carries the explicit `/api/<fn>/<subpath>` → base rewrites
  ahead of the SPA fallback.
- No framework change (still Vite SPA + Vercel Functions). No functions config
  key, build command, or output directory changes were required.

## 7. Security implications

- Server-authoritative quota, difficulty, and session state are fully intact.
- The frontend now **fails safely**: if a deploy ever returns HTML/405 for an
  API route again, `callApexApi` logs a clear diagnostic and callers treat the
  operation as failed (they do not assume `quota = available`,
  `difficulty = unlocked`, or `premium = true`).
- Authentication is verified server-side by the handlers; the client only sends
  the JWT + device id. No secrets are logged.

## 8. Tests performed

### Routing (unauthenticated, live production)

`myapexlaprat.vercel.app` and `www.polynurse.com.ng`:

| Request | Result |
| :--- | :--- |
| `POST /api/session/register` | 401 JSON |
| `GET /api/session/devices` | 401 JSON |
| `POST /api/session/revoke` | 401 JSON |
| `GET /api/quota/course-status` | 401 JSON |
| `POST /api/quota/course-consume` | 401 JSON |
| `GET /api/progress/difficulty` | 401 JSON |
| `GET /api/progress/history` | 401 JSON |

No endpoint returns HTML or a 405 for a supported method.

### Authenticated (read-only, live production, free user)

`blankdweb@mark.com` sign-in → JWT → production API:

- `GET /api/quota/course-status` → 200 JSON, `subjects` with 6 per-course keys.
- `GET /api/progress/difficulty` → 200 JSON, 4 difficulty rows.
- **Server-side gating verified:** Easy unlocked; Medium/Hard/Expert locked;
  Medium gated by Easy correct count (0/50) — values come from server records,
  not the client.

### Build / lint

- `vite build` → OK.
- `eslint` on changed files → 0 errors (pre-existing warnings only).

## 9. Remaining issues

- None blocking. The one transient `405` observed on `/api/session/register`
  during deployment propagation resolved once the new deployment fully
  propagated to all Vercel edge nodes (verified on both domains).
- A full UI regression (`e2e-free-quota-courses.mjs`) still runs against a local
  dev server; if desired, point its `BASE` at production to exercise the full
  browser flow end-to-end (it will consume the free user's real course quota).
