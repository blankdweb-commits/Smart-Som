import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import {
  User,
  Phone,
  Mail,
  Loader2,
  ShieldCheck,
  LogOut,
  Save,
  Lock,
  GraduationCap,
  Building2
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import Toast from '../components/Toast';

const NURSING_YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'];
const DEPARTMENTS = [
  'Nursing Science',
  'Midwifery',
  'Public Health Nursing',
  'Mental Health Nursing',
  'Perioperative Nursing'
];

export default function Settings() {
  const { userProfile, updateProfile, session, signOut } = useAppContext();
  const navigate = useNavigate();

  const [profileForm, setProfileForm] = useState({
    fullName: userProfile.fullName || '',
    phone: userProfile.phone || '',
    department: userProfile.department || '',
    level: userProfile.level || ''
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

  const [passwordForm, setPasswordForm] = useState({ next: '', confirm: '' });
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState(null);

  const [toast, setToast] = useState(null);

  const handleProfileSave = async (e) => {
    e.preventDefault();
    if (!supabase || !session) {
      setToast({ message: 'Sign in to save your profile.', type: 'error' });
      return;
    }
    setSavingProfile(true);
    setProfileMsg(null);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: profileForm.fullName.trim(),
          phone: profileForm.phone.trim(),
          department: profileForm.department,
          level: profileForm.level
        })
        .eq('id', session.user.id);
      if (error) throw error;
      updateProfile(profileForm);
      setProfileMsg('Profile updated.');
      setToast({ message: 'Profile saved successfully!', type: 'success' });
    } catch (err) {
      setProfileMsg(err.message);
      setToast({ message: 'Failed to save profile.', type: 'error' });
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError(null);
    if (!supabase) return;
    if (passwordForm.next.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      return;
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError('Passwords do not match');
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: passwordForm.next });
      if (error) throw error;
      setPasswordForm({ next: '', confirm: '' });
      setToast({ message: 'Password changed successfully!', type: 'success' });
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setSavingPassword(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/dashboard');
  };

  const subLabel = {
    active: 'Active',
    grace: 'Grace Period',
    expired: 'Expired',
    none: 'No Subscription'
  }[userProfile.subscriptionStatus] || '—';

  const inputCls = "w-full bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-4 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-medical-500 transition-colors text-sm font-medium";

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <div className="flex items-center gap-3 text-medical-600 mb-2">
           <ShieldCheck size={28} />
           <span className="text-[10px] font-black uppercase tracking-[0.3em]">Account Center</span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Manage your profile, security, and subscription.</p>
      </header>

      {/* Account Overview */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
      >
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-5">Account</h2>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-14 h-14 bg-gradient-to-tr from-medical-500 to-apex-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shrink-0 shadow-lg shadow-medical-500/20">
              {(userProfile.fullName || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="font-black text-slate-900 dark:text-white truncate">{userProfile.fullName || 'Auxibaby'}</p>
              <p className="text-xs font-bold text-slate-400 truncate">{session?.user?.email || userProfile.email || 'Not signed in'}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <span className={`px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest ${
              userProfile.isActivated
                ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
            }`}>
              {userProfile.isActivated ? 'Activated' : 'Not Activated'}
            </span>
            <span className="px-3 py-1.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-lg text-[9px] font-black uppercase tracking-widest">
              {subLabel}
            </span>
            {userProfile.isAdmin && (
              <span className="px-3 py-1.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg text-[9px] font-black uppercase tracking-widest">
                {userProfile.role === 'super_admin' ? 'Super Admin' : 'Admin'}
              </span>
            )}
          </div>
        </div>

        {!userProfile.isActivated && (
          <button
            onClick={() => navigate('/activate')}
            className="mt-6 w-full py-3 bg-apex-600 hover:bg-apex-700 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-apex-600/20 transition-all active:scale-95"
          >
            Activate Full Access
          </button>
        )}
      </motion.div>

      {/* Profile Details */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.05 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
      >
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Profile Details</h2>

        <form onSubmit={handleProfileSave} className="space-y-4">
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Full Name"
              className={inputCls}
              value={profileForm.fullName}
              onChange={(e) => setProfileForm({ ...profileForm, fullName: e.target.value })}
            />
          </div>

          <div className="relative">
            <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="email"
              disabled
              placeholder="Email (managed at sign-up)"
              className={`${inputCls} opacity-60 cursor-not-allowed`}
              value={session?.user?.email || userProfile.email || ''}
              readOnly
            />
          </div>

          <div className="relative">
            <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="tel"
              placeholder="Phone Number"
              className={inputCls}
              value={profileForm.phone}
              onChange={(e) => setProfileForm({ ...profileForm, phone: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative">
              <Building2 className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                className={`${inputCls} appearance-none`}
                value={profileForm.department}
                onChange={(e) => setProfileForm({ ...profileForm, department: e.target.value })}
              >
                <option value="">Select Department</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>

            <div className="relative">
              <GraduationCap className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <select
                className={`${inputCls} appearance-none`}
                value={profileForm.level}
                onChange={(e) => setProfileForm({ ...profileForm, level: e.target.value })}
              >
                <option value="">Select Level</option>
                {NURSING_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>

          {profileMsg && (
            <p className={`text-xs font-bold ${profileMsg === 'Profile updated.' ? 'text-emerald-500' : 'text-red-500'}`}>{profileMsg}</p>
          )}

          <button
            type="submit"
            disabled={savingProfile}
            className="w-full py-4 bg-medical-600 hover:bg-medical-700 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-600/20 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
          >
            {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            {savingProfile ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      </motion.div>

      {/* Security */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
      >
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-6">Security</h2>

        {!session ? (
          <p className="text-sm text-slate-400 font-medium">Sign in to change your password.</p>
        ) : (
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                placeholder="New Password"
                className={inputCls}
                value={passwordForm.next}
                onChange={(e) => setPasswordForm({ ...passwordForm, next: e.target.value })}
              />
            </div>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="password"
                placeholder="Confirm New Password"
                className={inputCls}
                value={passwordForm.confirm}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
              />
            </div>

            {passwordError && (
              <p className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">{passwordError}</p>
            )}

            <button
              type="submit"
              disabled={savingPassword}
              className="w-full py-4 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {savingPassword ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
              {savingPassword ? 'Updating...' : 'Change Password'}
            </button>
          </form>
        )}
      </motion.div>

      {/* Session */}
      {session && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15 }}
          className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
        >
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-5">Session</h2>
          <button
            onClick={handleSignOut}
            className="w-full py-4 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 transition-all active:scale-95"
          >
            <LogOut size={16} />
            Sign Out
          </button>
        </motion.div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
