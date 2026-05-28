# Apex Scholars Production Setup Guide

This guide provides instructions for deploying Apex Scholars with a production-ready Supabase backend, Paystack payments, and Vercel hosting.

## 1. Supabase Setup

1. **Create Project**: Go to [Supabase](https://supabase.com/) and create a new project.
2. **Database Schema**:
   - Go to the **SQL Editor** in your Supabase dashboard.
   - Copy the contents of `SUPABASE_SETUP.sql` from this repository.
   - Run the script to create all tables, RLS policies, and triggers.
3. **Storage Buckets**:
   - Go to **Storage** -> **New Bucket**.
   - Create the following buckets:
     - `avatars` (Public: Yes)
     - `receipts` (Public: No)
     - `uploads` (Public: No)
     - `branding` (Public: Yes)
     - `disputes-proof` (Public: No)
4. **Auth Configuration**:
   - Go to **Authentication** -> **URL Configuration**.
   - Set **Site URL** to your Vercel deployment URL (e.g., `https://apex-scholars.vercel.app`).
   - Add redirect URLs as needed.

## 2. Paystack Setup

1. **Account**: Create an account at [Paystack](https://paystack.com/).
2. **API Keys**:
   - Go to **Settings** -> **API Keys & Webhooks**.
   - Copy your **Secret Key** and **Public Key**.
3. **Webhook**:
   - In Paystack Settings, set the **Webhook URL** to:
     `https://your-vercel-domain.com/api/payments/webhook`
   - Ensure you are listening for the `charge.success` event.

## 3. Vercel Deployment

1. **Connect Repo**: Push your code to GitHub and connect it to [Vercel](https://vercel.com/).
2. **Environment Variables**:
   Add the following variables in the Vercel dashboard:

   ```env
   # Supabase
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

   # Paystack
   PAYSTACK_SECRET_KEY=your_paystack_secret_key
   VITE_PAYSTACK_PUBLIC_KEY=your_paystack_public_key

   # App
   APP_URL=https://your-vercel-domain.com
   VITE_DEV_DASHBOARD_MODE=true
   ```

3. **Deploy**: Click **Deploy**.

## 4. Admin Access

1. **Initial User**: Sign up for an account via the app using `admin@apexscholars.com`.
2. **Elevation**:
   - Find your user's UUID in **Authentication** -> **Users**.
   - In the **SQL Editor**, run:
     ```sql
     UPDATE public.profiles
     SET role = 'super_admin', is_activated = true
     WHERE id = 'YOUR_USER_ID_HERE';
     ```
3. **Dashboard**: Access the admin panel at `/admin/finance`.

## 5. Local Development

1. Clone the repository.
2. Create a `.env` file with the variables above.
3. Run `npm install`.
4. Run `npm run dev`.

---
*Apex Scholars: Rise to Excellence.*
