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
