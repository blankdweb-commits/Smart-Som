# Polynurse Exam Center - Deployment Guide

This guide provides instructions for deploying the Polynurse Exam Center platform to production using **Vercel**, **Supabase**, and **Paystack**.

## Prerequisites

1.  **Vercel Account:** For hosting the frontend and serverless API functions.
2.  **Supabase Project:** For authentication and database.
3.  **Paystack Account:** For handling payments (Live or Test mode).

---

## 1. Supabase Setup

1.  Create a new project in [Supabase](https://supabase.com).
2.  Navigate to the **SQL Editor** in your Supabase dashboard.
3.  Copy the contents of `SUPABASE_SETUP.sql` from this repository and run it to create the necessary tables, indexes, and RLS policies.
4.  Go to **Project Settings > API** and note down your:
    *   `Project URL`
    *   `anon public API key`
    *   `service_role secret key` (Keep this secret!)

## 2. Paystack Setup

1.  Create an account at [Paystack](https://paystack.com).
2.  Go to **Settings > API Keys & Webhooks**.
3.  Note down your **Public Key** and **Secret Key**.
4.  Set your **Webhook URL** to:
    `https://<your-live-domain>/api/payments/webhook`
    (e.g. `https://myapexlaprat.vercel.app/api/payments/webhook`). This URL is
    preserved by a `vercel.json` rewrite and handled by the top-level
    `api/payments-webhook.js` function. It receives real-time `charge.success`
    events so the subscription is activated even if the user closes the page
    during checkout.
5.  Set your **Callback URL** to:
    `https://<your-live-domain>/payments/verify`
    (e.g. `https://myapexlaprat.vercel.app/payments/verify`). Users are
    redirected here after a successful hosted checkout, where the app
    server-verifies the reference and activates the plan. The app also sends
    this callback URL with every `transaction/initialize` call automatically.
6.  Always use the **live** public/secret keys (`pk_live_...` / `sk_live_...`)
    for real transactions. Put both in Vercel environment variables (below) —
    never commit live keys.

## 3. Vercel Deployment

1.  Connect your GitHub repository to Vercel.
2.  Add the following **Environment Variables** in Vercel project settings:

| Variable | Description |
| :--- | :--- |
| `VITE_SUPABASE_URL` | Your Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase Anon Public Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase Service Role Key (Server-side only) |
| `VITE_PAYSTACK_PUBLIC_KEY` | Your Paystack Public Key |
| `PAYSTACK_SECRET_KEY` | Your Paystack Secret Key (Server-side only) |
| `APP_URL` | Your production URL (e.g., `https://myapexlaprat.vercel.app`) |

3.  Deploy the project.

### `/api/*` routing requirement

This app is a **Vite SPA + Vercel Serverless Functions** project (not Next.js).
Vercel only serves `api/<name>.js` at its exact mount path, so sub-paths the
frontend calls (`/api/quota/course-status`, `/api/session/register`,
`/api/progress/difficulty`, ...) must be routed to their function base via
`vercel.json` rewrites. The committed `vercel.json` already includes these
rules **before** the `/:path*` SPA fallback. Keep them in this order or the
APIs will return HTML (SPA page) / 405 instead of JSON. Do **not** rely on
`[...path].js` catch-all files in `api/` — multi-segment catch-alls are a
Next.js feature and are not supported by Vercel filesystem functions.

---

## 4. Post-Deployment Verification

1.  **Authentication:** Sign up for a new account. You should be redirected to the `/activate` page.
2.  **Payment Flow:** Attempt to "Activate" or "Purchase License". Use Paystack test cards if in test mode.
3.  **Webhook:** After a successful payment, the `transactions` table in Supabase should populate, and a 17-character product key should be generated in the `product_keys` table.
4.  **AI Parsing:** Go to **Past Questions**, upload a PDF or Image. Ensure Tesseract/PDF.js extracts content and generates flashcards.

## 5. Security Notes

*   Ensure **Row Level Security (RLS)** is enabled in Supabase (the setup script does this).
*   Never expose `SUPABASE_SERVICE_ROLE_KEY` or `PAYSTACK_SECRET_KEY` to the frontend (prefixed with `VITE_`).
*   Always verify `x-paystack-signature` in webhooks (handled in `api/payments-webhook.js`).

---

## 6. Phase 4–5 features: Nursing Licence (S8) + Loan Shark (S9)

Both are **Smart-Coin-only** and server-authoritative. They add **no** new Vercel
functions — all routes dispatch from the existing `api/quiz.js` (underscore
modules `api/_license.js` / `api/_loans.js` are not deployed as functions, so the
Hobby **12-function** budget is preserved).

### Database migrations (apply in order, all idempotent)

| File | Purpose |
| --- | --- |
| `scripts/migration-v48-license-renewal.sql` | `nursing_licenses` + `license_renewal_attempts` tables, `license_ensure`/`license_apply_result` RPCs, `license_renewal` config (100 SC / 50 Q / 80% / 24h / 12mo). |
| `scripts/migration-v49-sc-ledger-ref-id-text.sql` | Widens `smart_coin_ledger.ref_id` bigint→text so `_sc_apply` accepts a ref id (fixes a latent v31 bug). |
| `scripts/migration-v50-loan-shark.sql` | `loan_profiles` + `loans` tables, `loan` config (cap 3/10, 10%, 48h, licence 500 SC / ≥1500 balance), and the 8 loan lifecycle RPCs. |
| `scripts/migration-v51-anonymous-waiting-reconcile.sql` | Rewrites `community_membership_reconcile` to release idle seats in **waiting** rooms too (was active-only), plus a one-time stale-seat self-heal — fixes the "N/100 members" count when nobody is online. |
| `scripts/migration-v52-premium-grant-two-users.sql` | Data grant: one active `monthly` subscription (+30d / +32d grace) + `profiles.is_activated` for the two operator accounts (idempotent, `on conflict (reference) do nothing`). |

Apply with the Management-API helper: `node scripts/_apply-v43.mjs <file>` (needs
a valid `SUPABASE_ACCESS_TOKEN` in `.env`; HTTP 201 = ok).

### Endpoints (all require a bearer session; unauth → `401 {"error":"Unauthorized"}`)

*   `GET  /api/quiz/license-status` · `POST /api/quiz/license-start` · `POST /api/quiz/license-submit`
*   `GET  /api/loans/list` · `POST /api/loans/{request|offer|accept|repay|reject|cancel|shark-buy|default}`

### Verification

*   `npm run e2e:license-renewal` (32/32) and `npm run e2e:loan-shark` (36/36) — live.
*   `node scripts/verify-deploy-config.mjs` (235 checks) — static/deploy parity.
*   RLS/authority for both features is documented in `docs/QUIZ_SECURITY_AUDIT.md`.

> **Loan Shark default policy:** a default sweeps the borrower's *available* SC
> (never below 0) to the lender and records the default on their public loan
> history. The stronger consequence described to borrowers ("lose licences,
> achievements and all data from the first stage") is surfaced as a warning only
> and is **not** auto-executed — it would require a separate, confirmed
> account-reset action.

---

## 7. Web Push (VAPID) + WhatsApp-style reply-to-message

### No migration required

Push was a double no-op: no VAPID keys were set anywhere, and `web-push` was not
a dependency (`api/_push.js` lazy-`import('web-push')` threw → `PUSH_ENABLED=false`
→ the client showed "Push notifications are not configured on this server yet").
The v44 tables (`push_subscriptions`, `notification_preferences`) and
`public/sw.js` already exist, so **no SQL** was needed. Reply-to-message was
already implemented end-to-end; this release (a) makes the reply affordance
discoverable on touch and (b) fixes a **latent 404**: the reply-parent SELECT was
`id, group_id` only, so `isPostAlive` had no `expires_at/created_at` and judged
every parent dead → all anonymous replies 404'd `REPLY_NOT_FOUND`.

### New server dependency

*   `web-push@^3.6.7` (in `package.json`). Already `npm install`ed — run `npm install` on the deploy machine so the lockfile installs it.

### Vercel env vars (MUST set + redeploy — the whole push feature gates on these)

```env
VAPID_PUBLIC_KEY=BIRbVNvYtH2DqyRLPIAxM4-l-52mzT92US4q8TIK2eVHn0el2y4zRlfR1GTICJSN3sxb1RY3tuoS27A8kdk09pk
VAPID_PRIVATE_KEY=12QnZ6KDGGcU78cengsdBqGBQnAB5do2U2D7KTexwPg
VAPID_SUBJECT=mailto:admin@polynurse.com.ng
```

These are also in `.env` (local dev, gitignored) and `.env.example` (placeholders). `GET/POST /api/community/notifications/vapid` returns `{ok, public_key, enabled}` — `enabled:true` only when both keys are present. Push is **targeted** (mention / reply-to / Encoded recipient / member joined), fire-and-forget — it never fails a message write.

### Reply-to-message release contents

*   `src/pages/AnonymousRoom.jsx` — **swipe-to-reply**: `SWIPE_REPLY_THRESHOLD=64`, pointer handlers (`beginSwipe/moveSwipe/endSwipe/cancelSwipe`, `setPointerCapture`, horizontal-only, vertical `touch-pan-y` preserved, `prefersReducedMotion` respected, vibrate + composer focus on arm) and the message-action ⋮ button is now always visible (was hover-only).
*   `api/_community.js` — reply-parent SELECT now includes `created_at, expires_at, grace_until, last_interaction_at, is_deleted, is_hidden` so a real alive parent can be quoted (fixes the 404).

### Verification

*   `node scripts/verify-deploy-config.mjs` → **250/250** (new PART E gates: `web-push` dep, `_push.js` VAPID/web-push wiring, `/notifications/vapid` `enabled`, swipe handlers, non-hover-only trigger, `.env.example` VAPID, reply-parent lifetime columns).
*   `npm run e2e:anonymous-lifecycle` → **102/102** (10f block: quoted target posted → reply persists `reply_to_post_id` (DB-backed) → hydrated `reply` quote with `Anonymous #NN` author + excerpt → bogus target 404).
*   `npm run build` ✓; eslint 0 errors on touched files.
*   Post-deploy browser QA: open the Anonymous room → toggle push on (permission prompt) → have a second account reply / `@mention` / Encoded / join → the first device must receive a system notification; test swipe-to-reply on a phone.
