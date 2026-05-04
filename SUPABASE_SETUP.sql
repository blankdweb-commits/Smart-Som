-- SQL Schema for Apex Scholars (Supabase) - "Next-Level" Production Version

-- 1. Create Tables

-- PROFILES (Linked to Supabase Auth)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    email TEXT,
    full_name TEXT,
    phone TEXT,
    role TEXT DEFAULT 'student' CHECK (role IN ('student', 'admin', 'super_admin')),
    department TEXT,
    level TEXT,
    is_activated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- SUBSCRIPTIONS
CREATE TABLE public.subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    plan TEXT DEFAULT 'monthly',
    status TEXT CHECK (status IN ('active', 'expired', 'grace')) DEFAULT 'active',
    amount NUMERIC DEFAULT 1999.9,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    grace_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PAYMENTS
CREATE TABLE public.payments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id),
    email TEXT,
    amount NUMERIC,
    reference TEXT UNIQUE,
    status TEXT,
    provider TEXT DEFAULT 'paystack',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRODUCT KEYS (Retained for offline/manual activation if needed)
CREATE TABLE public.product_keys (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    key_hash TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'unused' CHECK (status IN ('unused', 'active', 'expired', 'revoked')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ
);

-- EXAMS
CREATE TABLE public.exams (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    subject TEXT NOT NULL,
    exam_date TIMESTAMPTZ NOT NULL,
    reminder_enabled BOOLEAN DEFAULT TRUE,
    lecturer TEXT,
    type TEXT DEFAULT 'Written',
    priority TEXT DEFAULT 'Medium',
    notes TEXT,
    readiness INTEGER DEFAULT 0,
    topics JSONB DEFAULT '[]'::jsonb,
    reminders JSONB DEFAULT '["1 day before"]'::jsonb,
    study_materials TEXT,
    acknowledged_reminders JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FLASHCARD PROGRESS
CREATE TABLE public.flashcard_progress (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    card_id TEXT NOT NULL,
    score INTEGER DEFAULT 0,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    interval INTEGER DEFAULT 0,
    reps INTEGER DEFAULT 0,
    efactor DECIMAL(5, 2) DEFAULT 2.5,
    next_review TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, card_id)
);

-- PAYMENT CHARGES (Institutional fees)
CREATE TABLE public.payment_charges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(12, 2) NOT NULL,
    active BOOLEAN DEFAULT TRUE,
    target_dept TEXT DEFAULT 'All',
    target_level TEXT DEFAULT 'All',
    one_time BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Row Level Security (RLS)

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_charges ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can manage their own exams." ON public.exams FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage their own flashcard progress." ON public.flashcard_progress FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can view own payments." ON public.payments FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view own subscriptions." ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- 3. Triggers for Profile Sync

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', COALESCE(new.raw_user_meta_data->>'role', 'student'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4. Initial Admin Seed Example
/*
  Run after creating a user in Supabase:
  UPDATE public.profiles SET role = 'super_admin', is_activated = true WHERE email = 'admin@example.com';
*/
