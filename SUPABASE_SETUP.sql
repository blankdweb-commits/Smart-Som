-- SQL Schema for Apex Scholars (Supabase)

-- 1. Create Tables

-- USERS (Profile table linked to Supabase Auth)
CREATE TABLE public.profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT,
    email TEXT UNIQUE NOT NULL,
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
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'expired', 'cancelled', 'pending')),
    starts_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    plan_name TEXT NOT NULL,
    amount_paid DECIMAL(12, 2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSACTIONS
CREATE TABLE public.transactions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    reference TEXT UNIQUE NOT NULL,
    gateway TEXT DEFAULT 'paystack',
    amount DECIMAL(12, 2) NOT NULL,
    currency TEXT DEFAULT 'NGN',
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending', 'reversed')),
    paid_at TIMESTAMPTZ,
    receipt_url TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- PRODUCT KEYS
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

-- PAYMENT CHARGES (Institutional fees defined by admin)
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

-- DISPUTES
CREATE TABLE public.disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
    evidence_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ADMIN LOGS
CREATE TABLE public.admin_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Row Level Security (RLS)

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.flashcard_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_logs ENABLE ROW LEVEL SECURITY;

-- Policies for Profiles
CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Policies for Exams (User only)
CREATE POLICY "Users can manage their own exams." ON public.exams FOR ALL USING (auth.uid() = user_id);

-- Policies for Flashcard Progress (User only)
CREATE POLICY "Users can manage their own flashcard progress." ON public.flashcard_progress FOR ALL USING (auth.uid() = user_id);

-- Policies for Transactions
CREATE POLICY "Users can view own transactions." ON public.transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all transactions." ON public.transactions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- Policies for Subscriptions
CREATE POLICY "Users can view own subscriptions." ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can view all subscriptions." ON public.subscriptions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- Policies for Product Keys
CREATE POLICY "Users can view own product keys." ON public.product_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all product keys." ON public.product_keys FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- Policies for Payment Charges
CREATE POLICY "Anyone can view active charges." ON public.payment_charges FOR SELECT USING (active = true);
CREATE POLICY "Admins can manage charges." ON public.payment_charges FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- Policies for Disputes
CREATE POLICY "Users can manage own disputes." ON public.disputes FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage all disputes." ON public.disputes FOR ALL USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- Policies for Admin Logs
CREATE POLICY "Admins can view logs." ON public.admin_logs FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin'))
);

-- 3. Triggers for Profile Sync

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', COALESCE(new.raw_user_meta_data->>'role', 'student'));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4. Storage Buckets Setup (Instructions for user, can't be done via SQL usually but can set policies)
-- 4. Storage Buckets Setup (RLS Policies for Storage)

-- Note: You must first create the buckets in the Supabase Dashboard:
-- 'avatars', 'receipts', 'uploads', 'branding', 'disputes-proof'

-- Avatars: Public to read, User to update
CREATE POLICY "Avatar public access" ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "Users can upload avatars" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'avatars' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Receipts: Private, User and Admin only
CREATE POLICY "Users can view own receipts" ON storage.objects FOR SELECT USING (bucket_id = 'receipts' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Admins can view all receipts" ON storage.objects FOR SELECT USING (bucket_id = 'receipts' AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin', 'super_admin')));

-- 5. Admin Seed Instructions

/*
  HOW TO CREATE THE INITIAL ADMIN:

  1. Go to Supabase Dashboard -> Authentication -> Users -> Add User.
  2. Create user with email: admin@apexscholars.com and password: ChangeMe123!
  3. Once created, copy the User ID (UUID).
  4. Run the following SQL to elevate to Admin:

  UPDATE public.profiles
  SET role = 'super_admin', is_activated = true
  WHERE id = 'PASTE_THE_UUID_HERE';
*/
