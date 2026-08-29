import React, { useState } from 'react';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../utils/supabase';
import {
  X,
  Users,
  Mail,
  Lock,
  User,
  Phone,
  Loader2,
  ArrowLeft,
  ShieldCheck,
  Eye,
  EyeOff,
  CheckCircle2
} from './Icons';

const NURSING_YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'];

const CommunityAuthModal = ({ isOpen, onClose, onAuthSuccess }) => {
  // Views: 'gate' | 'signin' | 'signup' | 'forgot'
  const [view, setView] = useState('gate');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    phone: '',
    nursingYear: '',
  });

  const resetState = () => {
    setView('gate');
    setError('');
    setSuccessMessage('');
    setLoading(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
    setFormData({
      email: '',
      password: '',
      confirmPassword: '',
      fullName: '',
      phone: '',
      nursingYear: '',
    });
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setError('');
  };

  const validateEmail = (email) => {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.email || !formData.password) {
      setError('Please fill in all fields.');
      return;
    }
    if (!validateEmail(formData.email)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setLoading(true);
      if (!supabase) {
        setError('Authentication service is not configured.');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });

      if (signInError) throw signInError;

      // Success — AppContext onAuthStateChange will pick up the session
      if (onAuthSuccess) onAuthSuccess();
      handleClose();
    } catch (err) {
      setError(err.message || 'Sign in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.fullName || !formData.email || !formData.password || !formData.confirmPassword) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!validateEmail(formData.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    try {
      setLoading(true);
      if (!supabase) {
        setError('Authentication service is not configured.');
        return;
      }

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            full_name: formData.fullName,
            phone: formData.phone,
            nursing_year: formData.nursingYear,
            role: 'student',
          },
        },
      });

      if (signUpError) throw signUpError;

      // If the user is immediately confirmed (no email verification required),
      // the session will be set automatically by onAuthStateChange
      if (data?.session) {
        if (onAuthSuccess) onAuthSuccess();
        handleClose();
      } else {
        // Email verification is enabled — show success message
        setSuccessMessage('Account created! You can now sign in.');
        setView('signin');
        setFormData(prev => ({ ...prev, password: '', confirmPassword: '' }));
      }
    } catch (err) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setError('');

    if (!formData.email) {
      setError('Please enter your email address.');
      return;
    }
    if (!validateEmail(formData.email)) {
      setError('Please enter a valid email address.');
      return;
    }

    try {
      setLoading(true);
      if (!supabase) {
        setError('Authentication service is not configured.');
        return;
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        formData.email,
        { redirectTo: `${window.location.origin}/login` }
      );

      if (resetError) throw resetError;

      setSuccessMessage('Password reset email sent! Check your inbox.');
    } catch (err) {
      setError(err.message || 'Failed to send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md"
        onClick={handleClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white dark:bg-slate-800 rounded-[2rem] w-full max-w-md shadow-2xl overflow-hidden relative"
        >
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 z-10 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          {/* ========== GATE VIEW ========== */}
          {view === 'gate' && (
            <div className="p-8 text-center">
              <div className="w-20 h-20 bg-gradient-to-tr from-medical-500 to-blue-600 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-medical-500/20">
                <Users size={40} className="text-white" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2">
                Join the Community
              </h2>
              <p className="text-slate-500 dark:text-slate-400 font-medium mb-8 leading-relaxed">
                Sign in or create your free account to participate in the Apex Scholars community.
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => { setView('signin'); setError(''); setSuccessMessage(''); }}
                  className="w-full py-3.5 bg-gradient-to-r from-medical-600 to-blue-600 hover:from-medical-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-medical-500/20 transition-all active:scale-[0.98]"
                >
                  Sign In
                </button>
                <button
                  onClick={() => { setView('signup'); setError(''); setSuccessMessage(''); }}
                  className="w-full py-3.5 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-600 transition-all active:scale-[0.98]"
                >
                  Create Account
                </button>
              </div>
              <div className="mt-6 pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-center gap-2 text-slate-400 text-xs">
                <ShieldCheck size={14} />
                Secure Authentication via Supabase
              </div>
            </div>
          )}

          {/* ========== SIGN IN VIEW ========== */}
          {view === 'signin' && (
            <div className="p-8">
              <button
                onClick={() => { setView('gate'); setError(''); setSuccessMessage(''); }}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mb-4 transition-colors"
              >
                <ArrowLeft size={16} /> Back
              </button>

              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-gradient-to-tr from-medical-500 to-blue-600 rounded-xl mx-auto mb-4 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-medical-500/20">
                  A
                </div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">Welcome Back</h2>
                <p className="text-sm text-slate-400 mt-1">Sign in to your Apex Scholars account</p>
              </div>

              {successMessage && (
                <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm">
                  <CheckCircle2 size={16} />
                  {successMessage}
                </div>
              )}

              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    placeholder="Email Address"
                    required
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                    value={formData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                  />
                </div>

                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password"
                    required
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-11 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                    value={formData.password}
                    onChange={(e) => updateField('password', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {error && (
                  <p className="text-red-500 text-xs bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-200 dark:border-red-800">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-medical-600 to-blue-600 hover:from-medical-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-medical-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : 'Sign In'}
                </button>
              </form>

              <div className="mt-4 space-y-2 text-center">
                <button
                  onClick={() => { setView('forgot'); setError(''); setSuccessMessage(''); }}
                  className="text-sm text-medical-600 hover:text-medical-700 dark:text-medical-400 font-medium transition-colors"
                >
                  Forgot password?
                </button>
                <p className="text-sm text-slate-400">
                  Don't have an account?{' '}
                  <button
                    onClick={() => { setView('signup'); setError(''); setSuccessMessage(''); }}
                    className="text-medical-600 hover:text-medical-700 dark:text-medical-400 font-bold transition-colors"
                  >
                    Create Account
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* ========== SIGN UP VIEW ========== */}
          {view === 'signup' && (
            <div className="p-8">
              <button
                onClick={() => { setView('gate'); setError(''); setSuccessMessage(''); }}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mb-4 transition-colors"
              >
                <ArrowLeft size={16} /> Back
              </button>

              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-gradient-to-tr from-medical-500 to-blue-600 rounded-xl mx-auto mb-4 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-medical-500/20">
                  A
                </div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">Create Account</h2>
                <p className="text-sm text-slate-400 mt-1">Join the Apex Scholars community</p>
              </div>

              <form onSubmit={handleSignUp} className="space-y-3">
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Full Name *"
                    required
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                    value={formData.fullName}
                    onChange={(e) => updateField('fullName', e.target.value)}
                  />
                </div>

                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="email"
                    placeholder="Email Address *"
                    required
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                    value={formData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                  />
                </div>

                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="tel"
                    placeholder="Phone Number (optional)"
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                    value={formData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                  />
                </div>

                <select
                  value={formData.nursingYear}
                  onChange={(e) => updateField('nursingYear', e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 px-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all appearance-none"
                >
                  <option value="">Select Nursing Year (optional)</option>
                  {NURSING_YEARS.map((yr) => (
                    <option key={yr} value={yr}>{yr}</option>
                  ))}
                </select>

                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Password * (min 6 characters)"
                    required
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-11 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                    value={formData.password}
                    onChange={(e) => updateField('password', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="Confirm Password *"
                    required
                    className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-11 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                    value={formData.confirmPassword}
                    onChange={(e) => updateField('confirmPassword', e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>

                {error && (
                  <p className="text-red-500 text-xs bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-200 dark:border-red-800">
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 bg-gradient-to-r from-medical-600 to-blue-600 hover:from-medical-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-medical-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : 'Create Account'}
                </button>
              </form>

              <p className="mt-4 text-sm text-slate-400 text-center">
                Already have an account?{' '}
                <button
                  onClick={() => { setView('signin'); setError(''); setSuccessMessage(''); }}
                  className="text-medical-600 hover:text-medical-700 dark:text-medical-400 font-bold transition-colors"
                >
                  Sign In
                </button>
              </p>
            </div>
          )}

          {/* ========== FORGOT PASSWORD VIEW ========== */}
          {view === 'forgot' && (
            <div className="p-8">
              <button
                onClick={() => { setView('signin'); setError(''); setSuccessMessage(''); }}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 mb-4 transition-colors"
              >
                <ArrowLeft size={16} /> Back to Sign In
              </button>

              <div className="text-center mb-6">
                <div className="w-14 h-14 bg-gradient-to-tr from-amber-500 to-orange-600 rounded-xl mx-auto mb-4 flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <Lock size={28} className="text-white" />
                </div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">Reset Password</h2>
                <p className="text-sm text-slate-400 mt-1">Enter your email to receive a reset link</p>
              </div>

              {successMessage ? (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl text-center">
                  <CheckCircle2 size={32} className="text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{successMessage}</p>
                  <button
                    onClick={() => { setView('signin'); setSuccessMessage(''); }}
                    className="mt-4 text-sm text-medical-600 font-bold hover:text-medical-700 transition-colors"
                  >
                    Return to Sign In
                  </button>
                </div>
              ) : (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="email"
                      placeholder="Email Address"
                      required
                      className="w-full bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-xl py-3 pl-11 pr-4 text-slate-900 dark:text-white text-sm focus:outline-none focus:border-medical-500 focus:ring-1 focus:ring-medical-500/30 transition-all"
                      value={formData.email}
                      onChange={(e) => updateField('email', e.target.value)}
                    />
                  </div>

                  {error && (
                    <p className="text-red-500 text-xs bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-200 dark:border-red-800">
                      {error}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold rounded-xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                  >
                    {loading ? <Loader2 size={18} className="animate-spin" /> : 'Send Reset Link'}
                  </button>
                </form>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default CommunityAuthModal;
