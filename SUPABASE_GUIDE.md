# Supabase Storage & JWT Integration Guide

This guide explains how to set up the Supabase bucket system for the Apex Scholars app and integrate it with JWT authentication.

## 1. Supabase Project Setup

1.  Go to [Supabase Dashboard](https://app.supabase.com/) and create a new project.
2.  In the **Database** section, create two tables:
    *   `posts`:
        *   `id` (int8, primary key, auto-increment)
        *   `created_at` (timestamptz, default: now())
        *   `user` (text)
        *   `content` (text)
        *   `category` (text)
        *   `likes` (int4, default: 0)
        *   `image_url` (text, nullable)
    *   `replies`:
        *   `id` (int8, primary key)
        *   `post_id` (int8, foreign key to posts.id)
        *   `user` (text)
        *   `content` (text)
        *   `created_at` (timestamptz)

## 2. Storage Bucket Configuration

1.  Go to **Storage** in the Supabase sidebar.
2.  Create a new bucket named `community-images`.
3.  Set the bucket to **Public** (or Private if you prefer to use signed URLs via JWT).
4.  If using **Public**, images are accessible via a direct URL.
5.  If using **Private** (recommended for JWT integration):
    *   Users must be authenticated to upload.
    *   The app uses the Supabase Auth JWT to authorize requests.

## 3. Row Level Security (RLS) Policies

To protect your data and bucket, enable RLS:

### For the `posts` table:
*   `Enable read access for all users` (Policy: `true`)
*   `Enable insert access for authenticated users` (Policy: `auth.role() = 'authenticated'`)

### For the `community-images` bucket:
*   Select the `community-images` bucket -> **Policies**.
*   **Insert Policy**: `authenticated` users can upload.
    *   `bucket_id = 'community-images' AND auth.role() = 'authenticated'`
*   **Select Policy**: Allow anyone to view if public, or only `authenticated` if private.

## 4. App Integration (Vite)

Ensure your `.env` file contains:
```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

The app handles the connection in `src/utils/supabase.js`.

## 5. Launching

1.  Initialize the database schema using the SQL Editor in Supabase.
2.  Deploy the frontend to Vercel/Netlify.
3.  Add the environment variables to your deployment provider.
4.  Testing: Log in to the app (if auth is enabled) or ensure the 'Anon' key is working for public buckets.

## Security Note on JWT
The Supabase client automatically includes the user's JWT in the headers for all storage and database requests once `supabase.auth.signIn()` is called. This ensures that RLS policies are strictly enforced.
