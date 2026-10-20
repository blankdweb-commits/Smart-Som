import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
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
  Building2,
  Copy,
  Sparkles,
    Bell,
    BellOff,
    Volume2,
    VolumeX
  } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useConsentUI } from '../context/ConsentUIContext';
import Toast from '../components/Toast';
import ProfilePrivacyCard from '../components/ProfilePrivacyCard';
import { pushSupported, getPushState, enablePush, disablePush, savePreferences } from '../utils/push';
import { TUTORIALS } from '../data/tutorials';

const NURSING_YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'];
const DEPARTMENTS = [
  'Nursing Science',
  'Midwifery',
  'Public Health Nursing',
  'Mental Health Nursing',
  'Perioperative Nursing'
];

export default function Settings() {
  const { userProfile, updateProfile, session, signOut, identity, getMyReferral, soundEnabled, toggleSound, profileLoaded } = useAppContext();
  const { setIsOpen: openConsentManager } = useConsentUI();

  // The name this account is known by everywhere else in the app.
  //
  // `identityName` is the public display name (set in Profile Details below);
  // `fullName` is the legal name. The ranking, community, friends and rivals
  // all show the identity name, so the account card and the Dashboard heading
  // show it too - otherwise the same scholar reads as two different people
  // depending on which screen you are on.
  const hasIdentityName = !!(userProfile.identityName || '').trim();
  const displayName = hasIdentityName
    ? (userProfile.identityName || '').trim()
    : (userProfile.fullName || '').trim();
  const navigate = useNavigate();

  const [referral, setReferral] = useState(null);
  const [referralToast, setReferralToast] = useState(null);
  const [pushState, setPushState] = useState({ supported: pushSupported(), subscribed: false, permission: 'default' });
  const [pushPrefs, setPushPrefs] = useState({ room_messages: true, member_joins: true, social: true });
  const [pushBusy, setPushBusy] = useState(false);
  const [pushNote, setPushNote] = useState('');

  const refreshPushState = useCallback(async () => {
    if (!session) return;
    setPushState(await getPushState());
    try {
      const prefs = await savePreferences(session, {});
      if (prefs?.preferences) setPushPrefs(prefs.preferences);
    } catch {
      // preferences table may not be migrated yet — keep safe defaults
    }
  }, [session]);

  const togglePushPref = useCallback(async (key) => {
    if (!session) return;
    const next = { ...pushPrefs, [key]: !pushPrefs[key] };
    setPushPrefs(next);
    try {
      await savePreferences(session, { [key]: next[key] });
    } catch {
      setPushPrefs(pushPrefs); // revert the optimistic toggle
    }
  }, [session, pushPrefs]);

  useEffect(() => {
    refreshPushState();
  }, [refreshPushState]);

  const togglePush = useCallback(async () => {
    if (!session) return;
    setPushBusy(true);
    setPushNote('');
    const res = pushState.subscribed ? await disablePush(session) : await enablePush(session);
    setPushBusy(false);
    if (!res.ok) {
      const reason = res.reason;
      if (reason === 'denied') setPushNote('Notifications are blocked in your browser settings.');
      else if (reason === 'not_configured') setPushNote('Push is not configured on this server yet.');
      else if (reason === 'unsupported') setPushNote('This browser does not support push notifications.');
      else setPushNote('Could not update notifications. Please try again.');
    } else {
      // Enabling from Settings is an explicit opt-in: clear the Dashboard dismiss.
      try { localStorage.removeItem('apex:pushOptInDismissed'); } catch { /* storage unavailable */ }
    }
    refreshPushState();
  }, [session, pushState.subscribed, refreshPushState]);

  const loadReferral = useCallback(async () => {
    if (!session || !getMyReferral) return;
    const res = await getMyReferral();
    if (res?.ok) setReferral(res);
  }, [session, getMyReferral]);

  useEffect(() => {
    loadReferral();
  }, [loadReferral]);

  const copyReferralCode = async () => {
    if (!referral?.code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/signup?referral=${encodeURIComponent(referral.code)}`);
      setReferralToast({ message: 'Invite link copied!', type: 'success' });
      setTimeout(() => setReferralToast(null), 2500);
    } catch {
      setReferralToast({ message: 'Could not copy.', type: 'error' });
      setTimeout(() => setReferralToast(null), 2500);
    }
  };

  const [profileForm, setProfileForm] = useState({
    fullName: userProfile.fullName || '',
    identityName: userProfile.identityName || '',
    phone: userProfile.phone || '',
    department: userProfile.department || '',
    level: userProfile.level || ''
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

  // The server profile loads ASYNCHRONOUSLY after auth init, so userProfile is
  // still anonymous when this form first mounts — the fields would render blank
  // even though the DB already has the saved values. Sync the form from the real
  // profile exactly once, then leave it to the user (their edits are never
  // clobbered by a later context update).
  const profileSyncedRef = React.useRef(false);
  React.useEffect(() => {
    if (profileSyncedRef.current) return;
    // An explicit flag, not `userProfile.matricNumber === undefined`. That
    // sentinel only worked because ANONYMOUS_PROFILE happened to omit the key;
    // it is now declared there, so the omission check would never fire again.
    if (!profileLoaded) return;
    profileSyncedRef.current = true;
    setProfileForm({
      fullName: userProfile.fullName || '',
      identityName: userProfile.identityName || '',
      phone: userProfile.phone || '',
      department: userProfile.department || '',
      level: userProfile.level || ''
    });
  }, [userProfile, profileLoaded]);

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
      const { data, error } = await supabase
        .from('profiles')
        .update({
          full_name: profileForm.fullName.trim(),
          // The name other people see on community posts, group member lists and
          // the leaderboard. Until this was writable the view fell back to the
          // literal 'Scholar' for every account. migration-v85 re-granted the
          // column and enforces the 24-char cap in a CHECK constraint, so the
          // server still refuses an over-long value even though this writes
          // straight to the table.
          identity_name: profileForm.identityName.trim(),
          phone: profileForm.phone.trim(),
          department: profileForm.department,
          level: profileForm.level
        })
        .eq('id', session.user.id)
        // Read the row back rather than trusting the values we sent. Without
        // this the handler called updateProfile() unconditionally, so a write
        // that matched zero rows without raising an error left Settings, the
        // Dashboard greeting and the server-rendered leaderboard disagreeing
        // about the same person.
        .select('full_name, identity_name, phone, department, level')
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        // No error, no row: the profile row is gone or unreachable. Say so
        // instead of reporting a save that did not happen.
        setProfileMsg('Could not save — your profile row was not found.');
        setToast({ message: 'Failed to save profile.', type: 'error' });
        return;
      }
      // Apply what the SERVER stored, not what we typed. A trigger, a CHECK or
      // a future normalisation may have changed it, and the Dashboard must
      // agree with the database.
      updateProfile({
        fullName: data.full_name || '',
        identityName: data.identity_name || '',
        phone: data.phone || '',
        department: data.department || '',
        level: data.level || ''
      });
      setProfileForm({
        fullName: data.full_name || '',
        identityName: data.identity_name || '',
        phone: data.phone || '',
        department: data.department || '',
        level: data.level || ''
      });
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
    navigate('/login');
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
            {/* The avatar initial follows the IDENTITY name, because that is
                the name the rest of the app shows for this scholar - the
                ranking, community, friends and rivals all use it. */}
            <div className="w-14 h-14 bg-gradient-to-tr from-medical-500 to-apex-600 rounded-2xl flex items-center justify-center text-white font-black text-xl shrink-0 shadow-lg shadow-medical-500/20">
              {(displayName || 'A').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              {/* Identity name on top, so this card agrees with the Dashboard
                  heading and with every other surface. The legal name sits
                  underneath it, because it is still the name on the account
                  and is worth seeing. */}
              <p className="font-black text-slate-900 dark:text-white truncate">{displayName || 'Scholar'}</p>
              {hasIdentityName && (
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 truncate">
                  {userProfile.fullName}
                </p>
              )}
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
            {identity && (
              <span className="px-3 py-1.5 bg-gradient-to-r from-medical-500 to-apex-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest shadow-md shadow-medical-500/20">
                {identity.emoji} {identity.name}
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

          {/* The name OTHER people see — separate from your legal name on
              purpose. This is what appears next to your posts, on group member
              lists and on the leaderboard. Leave it blank and you appear as a
              stable Scholar-xxxxxx handle instead. */}
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Display name (shown to others)"
              aria-label="Display name shown to others"
              maxLength={24}
              className={inputCls}
              value={profileForm.identityName}
              onChange={(e) => setProfileForm({ ...profileForm, identityName: e.target.value })}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 tabular-nums">
              {profileForm.identityName.length}/24
            </span>
          </div>
          <p className="text-[11px] font-medium text-slate-400 -mt-2">
            Shown beside your posts and your name on the leaderboard. Blank keeps you as a Scholar handle.
            Your real name is only revealed to someone once you have completed a duel together.
          </p>

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

      {/* Push notifications */}
      {session && (
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.14 }}
          className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
        >
          <div className="flex items-center justify-between gap-3 mb-5">
            <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Notifications</h2>
            <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${pushState.subscribed ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
              {pushState.subscribed ? 'On' : 'Off'}
            </span>
          </div>

          {!pushState.supported ? (
            <p className="text-xs font-bold text-slate-400">Your browser does not support push notifications.</p>
          ) : (
            <>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
                Receive alerts for room messages, new members and social activity — even when the app is closed.
              </p>
              <button
                onClick={togglePush}
                disabled={pushBusy}
                className={`w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60 ${pushState.subscribed ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600' : 'bg-polynurse-600 text-white hover:bg-polynurse-700'}`}
              >
                {pushState.subscribed ? <BellOff size={16} /> : <Bell size={16} />}
                {pushBusy ? 'Working…' : pushState.subscribed ? 'Turn off notifications' : 'Enable notifications'}
              </button>
              {pushState.subscribed && (
                <div className="mt-5 space-y-2">
                  {[
                    { key: 'room_messages', label: 'Room messages, replies & mentions' },
                    { key: 'member_joins', label: 'New members joining your rooms' },
                    { key: 'social', label: 'Social activity (actions & challenges)' }
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => togglePushPref(key)}
                      // The visible track/knob below is decorative spans, so
                      // without these the state is conveyed visually only.
                      // aria-pressed, not role="switch": these toggle one
                      // channel on/off rather than a named setting, matching
                      // the equivalent toggles in AnonymousRoom.jsx.
                      aria-pressed={!!pushPrefs[key]}
                      className="w-full flex items-center justify-between gap-3 py-2.5 text-left group"
                    >
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
                      <span className={`shrink-0 w-10 h-6 rounded-full transition-colors relative ${pushPrefs[key] ? 'bg-polynurse-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${pushPrefs[key] ? 'translate-x-4' : ''}`} />
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {pushNote && <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">{pushNote}</p>}
        </motion.div>
      )}

      {/* Profile privacy + profile views. The server half of this feature
          existed (migration-v91) with no client to reach it; this card is the
          missing half. */}
      {session && <ProfilePrivacyCard />}

      {/* Sound effects.
          The preference has existed in AppContext since long before this card
          did - `soundEnabled` state, `toggleSound`, and a localStorage key that
          is already documented in the storage policy on the Legal page. What
          was missing was anywhere to reach it: `useQuizAudio` even returned
          `toggleSound` for exactly this purpose and nothing rendered it.

          It is not a quiz-only switch. The AudioManager is a module singleton,
          and AppContext now keeps it in step with this preference on every
          route, so turning sound off here silences the app - and cuts off
          anything already playing. */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.145 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
      >
        <div className="flex items-center justify-between gap-3 mb-5">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Sound Effects</h2>
          <span className={`text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full ${soundEnabled ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'}`}>
            {soundEnabled ? 'On' : 'Off'}
          </span>
        </div>

        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
          Answer feedback, quiz sounds and interface effects. Turning this off
          silences sound everywhere in the app, and stops anything already
          playing.
        </p>

        <button
          onClick={toggleSound}
          type="button"
          // role="switch" + aria-checked, matching the pattern
          // ProfilePrivacyCard already uses in this file tree. The label alone
          // changes with state, so without these a screen reader hears a new
          // button name and never learns whether sound is currently on.
          role="switch"
          aria-checked={soundEnabled}
          aria-label="Sound effects"
          className={`w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center justify-center gap-2 transition-all active:scale-95 ${soundEnabled ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600' : 'bg-polynurse-600 text-white hover:bg-polynurse-700'}`}
        >
          {soundEnabled ? <VolumeX size={16} /> : <Volume2 size={16} />}
          {soundEnabled ? 'Turn off sound effects' : 'Turn on sound effects'}
        </button>
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

      {/* Invite & Earn */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.16 }}
        className="bg-gradient-to-br from-polynurse-700 to-polynurse-900 rounded-[2rem] p-6 sm:p-8 text-white shadow-clinical"
      >
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-amber-300" />
          <h2 className="text-sm font-black uppercase tracking-widest text-white/80">Invite &amp; Earn</h2>
        </div>
        <p className="text-xs font-bold text-white/70 mb-4 leading-relaxed">
          Share your invite code — every friend who activates their account earns you
          15 Smart Coins.
        </p>
        {referral ? (
          <div className="flex items-center gap-2">
            <button
              onClick={copyReferralCode}
              className="flex-1 flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/20 rounded-xl py-3 font-black text-lg tracking-[0.35em] transition"
            >
              {referral.code} <Copy size={16} />
            </button>
            {Number(referral.referredCount || 0) > 0 && (
              <span className="shrink-0 text-[10px] font-black uppercase tracking-widest text-white/70">
                {referral.referredCount} referred
              </span>
            )}
          </div>
        ) : (
          <p className="text-xs font-bold text-white/50">Your invite code appears here once you're signed in.</p>
        )}
      {referralToast && (
          <p className={`mt-3 text-[10px] font-black uppercase tracking-widest ${referralToast.type === 'success' ? 'text-emerald-300' : 'text-red-300'}`}>
            {referralToast.message}
          </p>
        )}
      </motion.div>

      {/* Guided tours — replayable at any time. */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.16 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
      >
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Guides</h2>
          <Link
            to="/tutorials"
            className="text-[11px] font-black uppercase tracking-widest text-medical-600 dark:text-medical-400 hover:underline"
          >
            All tours
          </Link>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Replay any walkthrough whenever you need it. Completing a tour is never required.
        </p>
        <div className="flex flex-col sm:flex-row gap-2">
          {TUTORIALS.map(t => (
            <Link
              key={t.key}
              to={`/tutorials?t=${t.key}`}
              className="flex-1 px-4 py-3 min-h-[44px] flex items-center justify-center bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-medical-600 hover:border-medical-500 transition-colors text-center"
            >
              {t.title}
            </Link>
          ))}
        </div>
      </motion.div>

      {/* Privacy & consent.
          The ConsentManager is mounted once at the app root; this card re-opens
          it so the user can change or withdraw cookie / local-storage choices at
          any time (FCCPC Reg. 4 guidance: withdrawal as easy as acceptance). */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.155 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
      >
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Privacy &amp; consent</h2>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-4 leading-relaxed">
          Change which optional technologies PolyNurse may use (theme and sound
          preferences are always yours; advertising is off unless you allow it).
          Your choice is saved and can be updated here at any time.
        </p>
        <button
          onClick={() => openConsentManager(true)}
          className="w-full py-3.5 rounded-xl font-black uppercase tracking-widest text-[10px] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82-.33l-.06-.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0 2.83l.06.06a1.65 1.65 0 0 0 .33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 0 2-2v-2.64a1.65 1.65 0 0 0-.33-1.82z"/></svg>
          Manage cookie &amp; privacy preferences
        </button>
      </motion.div>
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.18 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical"
      >
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400 mb-4">Legal</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          {[
            { to: '/legal/terms', label: 'Terms of Service' },
            { to: '/legal/privacy', label: 'Privacy Policy' },
            { to: '/legal/cookies', label: 'Cookie & Local Storage Policy' }
          ].map(l => (
            <Link
              key={l.to}
              to={l.to}
              className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-600 dark:text-slate-300 hover:text-medical-600 hover:border-medical-500 transition-colors text-center"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </motion.div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
