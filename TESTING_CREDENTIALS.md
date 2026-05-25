# Apex Scholars: System Manifest & Testing Guide

This document defines the core system configurations, test credentials, and dev-mode behaviors for the Apex Scholars platform.

## 1. Environment Configuration: "Dashboard Mode"

The application includes a specialized `VITE_DEV_DASHBOARD_MODE` toggle for rapid development and quality assurance.

### Activation
Set `VITE_DEV_DASHBOARD_MODE=true` in your `.env` file and restart the development server.

### Behaviors in Dev Mode
- **Auto-Redirect**: The landing page (`/`) automatically redirects to `/dashboard`.
- **Paywall Bypass**: All premium locks on Flashcards, Quizzes, and Clinical Tracks are disabled.
- **UI Cleaning**: `FeeBanner` and `FeeDashboardWidget` are hidden to provide a clean workspace.
- **Fast Login**: A "Fast Dev Login" button appears on the Auth page to auto-fill test credentials.
- **Performance**: Framer Motion animations are globally set to `reducedMotion: "always"` for instantaneous navigation.
- **System Indicator**: A persistent amber banner confirms "Testing Mode Active".

## 2. Testing Credentials

| Role | Email | Password | Access Level |
|------|-------|----------|--------------|
| **Student** | `student@apexscholars.com` | `testing123` | Default (Activated in Dev Mode) |
| **Admin** | `admin@apexscholars.com` | `testing123` | Super Admin / Financial Control |

## 3. Database Seed SQL (Supabase)

To prepare a fresh Supabase environment for these accounts, run the following in the SQL Editor:

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

-- 3. Core Subscription Plans
INSERT INTO public.subscription_plans (name, price, duration_days)
VALUES
('Weekly Sprint', 1999.9, 7),
('Monthly Mastery', 6999, 30),
('Yearly Excellence', 49999, 365)
ON CONFLICT DO NOTHING;
```

## 4. Verification Checklist

1. [ ] **Build Check**: `npm run build` must complete without errors.
2. [ ] **Auth Check**: Standard users must still be redirected to `/activate` when Dev Mode is `false`.
3. [ ] **Payment Check**: Paystack webhook signature verification must remain active in all modes.
