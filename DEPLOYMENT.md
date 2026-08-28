# Apex Scholars - Deployment Guide

This guide provides instructions for deploying the Apex Scholars platform to production using **Vercel**, **Supabase**, and **Paystack**.

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
    (e.g. `https://myapexlaprat.vercel.app/api/payments/webhook`). This receives
    real-time `charge.success` events so the subscription is activated even if
    the user closes the page during checkout.
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

---

## 4. Post-Deployment Verification

1.  **Authentication:** Sign up for a new account. You should be redirected to the `/activate` page.
2.  **Payment Flow:** Attempt to "Activate" or "Purchase License". Use Paystack test cards if in test mode.
3.  **Webhook:** After a successful payment, the `transactions` table in Supabase should populate, and a 17-character product key should be generated in the `product_keys` table.
4.  **AI Parsing:** Go to **Past Questions**, upload a PDF or Image. Ensure Tesseract/PDF.js extracts content and generates flashcards.

## 5. Security Notes

*   Ensure **Row Level Security (RLS)** is enabled in Supabase (the setup script does this).
*   Never expose `SUPABASE_SERVICE_ROLE_KEY` or `PAYSTACK_SECRET_KEY` to the frontend (prefixed with `VITE_`).
*   Always verify `x-paystack-signature` in webhooks (handled in `api/payments/webhook.js`).
