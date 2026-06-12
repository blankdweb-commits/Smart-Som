-- User Roles Enum
CREATE TYPE user_role AS ENUM ('student', 'administrator', 'financial_admin', 'super_admin');

-- Profiles Table
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name TEXT,
  role user_role DEFAULT 'student',
  department TEXT,
  level TEXT,
  is_activated BOOLEAN DEFAULT FALSE,
  subscription_status TEXT DEFAULT 'inactive',
  subscription_expiry TIMESTAMPTZ,
  device_fingerprint TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets Table
CREATE TABLE wallets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE,
  balance DECIMAL(12, 2) DEFAULT 0,
  currency TEXT DEFAULT 'NGN',
  is_frozen BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallet Transactions
CREATE TABLE wallet_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_id UUID REFERENCES wallets(id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL,
  type TEXT CHECK (type IN ('credit', 'debit')),
  description TEXT,
  reference TEXT UNIQUE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Commission Tiers
CREATE TABLE commission_tiers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  threshold DECIMAL(12, 2) NOT NULL,
  percentage DECIMAL(5, 2) NOT NULL,
  label TEXT,
  active BOOLEAN DEFAULT TRUE
);

-- Audit Logs
CREATE TABLE audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID REFERENCES profiles(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  old_data JSONB,
  new_data JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Student Submissions
CREATE TABLE student_submissions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID REFERENCES profiles(id),
  content_type TEXT CHECK (content_type IN ('quiz_question', 'flashcard')),
  content_data JSONB NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id UUID REFERENCES profiles(id),
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Flashcard Progress (SM-2)
CREATE TABLE flashcard_progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  flashcard_id TEXT NOT NULL, -- Can be built-in ID (string) or UUID
  easiness DECIMAL(5, 2) DEFAULT 2.5,
  interval INTEGER DEFAULT 0,
  repetition INTEGER DEFAULT 0,
  next_review TIMESTAMPTZ DEFAULT NOW(),
  last_studied TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, flashcard_id)
);

-- RLS Helpers
CREATE OR REPLACE FUNCTION is_super_admin() RETURNS BOOLEAN AS $$
  SELECT role = 'super_admin' FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_administrator() RETURNS BOOLEAN AS $$
  SELECT role IN ('administrator', 'super_admin') FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_financial_admin() RETURNS BOOLEAN AS $$
  SELECT role IN ('financial_admin', 'super_admin') FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- Example Policy for Wallet
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super and Financial Admins can view all wallets" ON wallets
  FOR SELECT USING (is_financial_admin());
CREATE POLICY "Users can view own wallet" ON wallets
  FOR SELECT USING (auth.uid() = user_id);
