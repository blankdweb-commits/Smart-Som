# Testing Credentials & Seed Data

This document provides test accounts and the SQL necessary to set them up in your Supabase environment for QA and testing.

## 1. Test Accounts

| Role | Email | Password | Status |
|------|-------|----------|--------|
| **Student** | `student@apexscholars.com` | `testing123` | Not Activated (unless in Dev Mode) |
| **Admin** | `admin@apexscholars.com` | `testing123` | Super Admin |

## 2. Supabase Seeding SQL

Run the following SQL in your Supabase SQL Editor to create these users and assign their roles.

> **Note:** You must first sign up these emails via the application UI to create the Auth records, then run this SQL to elevate their profiles.

```sql
-- 1. Elevate the Admin User
UPDATE public.profiles
SET
    role = 'super_admin',
    is_activated = true,
    subscription_status = 'active',
    subscription_expiry = (now() + interval '1 year')
WHERE email = 'admin@apexscholars.com';

-- 2. Setup the Student User (Standard)
UPDATE public.profiles
SET
    role = 'student',
    is_activated = false,
    subscription_status = 'none'
WHERE email = 'student@apexscholars.com';

-- 3. Optional: Create a Sample Subscription Plan for testing
INSERT INTO public.subscription_plans (name, price, duration_days)
VALUES
('Weekly Sprint', 1999.9, 7),
('Monthly Mastery', 6999, 30),
('Yearly Excellence', 49999, 365);
```

## 3. Testing "Dashboard Mode"

To bypass the landing page and paywalls locally:

1. Create a `.env` file from `.env.example`.
2. Set `VITE_DEV_DASHBOARD_MODE=true`.
3. Restart the dev server: `npm run dev`.

The app will now:
- Redirect `/` to `/dashboard`.
- Disable the activation overlay on the Dashboard.
- Enable all Study and Quiz features even for un-activated accounts.
- Reduce Framer Motion animations for faster navigation.
