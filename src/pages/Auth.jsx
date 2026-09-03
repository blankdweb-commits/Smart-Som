import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { Mail, Lock, User, Phone, ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import Toast from '../components/Toast';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [toast, setToast] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  // Route-aware initial view: /signup opens the registration form directly.
  const [view, setView] = useState(location.pathname === '/signup' ? 'signup' : 'signin'); // 'signin', 'signup', 'forgot'

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    fullName: '',
    phone: '',
    nursingYear: '',
    role: 'student'
  });

  const NURSING_YEARS = ['Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5'];

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      if (!supabase) {
        setError('Authentication is unavailable. Please try again later.');
        return;
      }

      if (view === 'forgot') {
        if (!formData.email) throw new Error('Please enter your email address');
        const { error } = await supabase.auth.resetPasswordForEmail(
          formData.email,
          { redirectTo: `${window.location.origin}/login` }
        );
        if (error) throw error;
        setSuccessMsg('Password reset link sent to your email.');
        setLoading(false);
        return;
      }

      if (view === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password,
        });
        if (error) throw error;
        navigate(location.state?.from || '/dashboard');
      } else if (view === 'signup') {
        if (formData.password.length < 6) throw new Error('Password must be at least 6 characters');
        if (formData.password !== formData.confirmPassword) throw new Error('Passwords do not match');

        const { data, error } = await supabase.auth.signUp({
          email: formData.email,
          password: formData.password,
          options: {
            data: {
              full_name: formData.fullName,
              phone: formData.phone,
              nursing_year: formData.nursingYear,
              role: formData.role
            }
          }
        });

        // Supabase reports an existing email as an auth error (or user:null for
        // an unconfirmed user). Both cases mean the account already exists.
        const alreadyExists = error?.message
          && /already registered|already exists|already been registered|email.*conflict/i.test(error.message);

        if (alreadyExists) {
          setToast({ message: 'An account with this email already exists. Please sign in.', type: 'error' });
          setView('signin');
          setLoading(false);
          return;
        }
        if (error) throw error;

        // Email confirmation is OFF, so a session should already exist. If not,
        // recover it explicitly so the new user is signed straight in.
        if (data?.session) {
          navigate('/activate');
        } else {
          const { data: recovered } = await supabase.auth.getSession();
          if (recovered?.session) {
            navigate('/activate');
          } else if (!data?.user) {
            setToast({ message: 'An account with this email already exists. Please sign in.', type: 'error' });
            setView('signin');
          } else {
            setSuccessMsg('Account created successfully! You can now sign in.');
            setView('signin');
            setFormData({ ...formData, password: '', confirmPassword: '' });
          }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-medical-500/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md z-10"
      >
        <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-tr from-medical-500 to-blue-600 rounded-2xl mx-auto mb-4 flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-medical-500/20">
              A
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">
              {view === 'signin' ? 'Welcome Back' : view === 'signup' ? 'Join Apex Scholars' : 'Reset Password'}
            </h1>
            <p className="text-slate-400">
              {view === 'signin' ? 'Enter your credentials to continue' : view === 'signup' ? 'Start your journey to excellence today' : 'We will send you a link to reset it'}
            </p>
          </div>

          {successMsg && (
            <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center justify-center">
              {successMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {view === 'signup' && (
              <>
                <div className="relative">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Full Name"
                    autoComplete="name"
                    required
                    className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-medical-500 transition-colors"
                    value={formData.fullName}
                    onChange={(e) => setFormData({...formData, fullName: e.target.value})}
                  />
                </div>
                <div className="relative">
                  <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type="tel"
                    placeholder="Phone Number (optional)"
                    autoComplete="tel"
                    className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-medical-500 transition-colors"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  />
                </div>
                <div className="relative">
                  <select
                    className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:border-medical-500 transition-colors appearance-none"
                    value={formData.nursingYear}
                    onChange={(e) => setFormData({...formData, nursingYear: e.target.value})}
                  >
                    <option value="" className="text-slate-500">Select Nursing Year (optional)</option>
                    {NURSING_YEARS.map(yr => (
                      <option key={yr} value={yr} className="text-slate-900">{yr}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
              <input
                type="email"
                placeholder="Email Address"
                autoComplete="email"
                required
                className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-medical-500 transition-colors"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>

            {view !== 'forgot' && (
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="password"
                  placeholder="Password"
                  autoComplete={view === 'signup' ? 'new-password' : 'current-password'}
                  required
                  className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-medical-500 transition-colors"
                  value={formData.password}
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                />
              </div>
            )}

            {view === 'signup' && (
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="password"
                  placeholder="Confirm Password"
                  autoComplete="new-password"
                  required
                  className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:outline-none focus:border-medical-500 transition-colors"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({...formData, confirmPassword: e.target.value})}
                />
              </div>
            )}

            {error && (
              <p className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-medical-600 to-blue-600 hover:from-medical-500 hover:to-blue-500 text-white font-semibold py-4 rounded-xl shadow-lg shadow-medical-500/25 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {view === 'signin' ? 'Sign In' : view === 'signup' ? 'Create Account' : 'Send Reset Link'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center space-y-4">
            {view === 'signin' && (
              <button
                onClick={() => setView('forgot')}
                className="block w-full text-slate-400 hover:text-white transition-colors text-sm mb-2"
              >
                Forgot your password?
              </button>
            )}

            <button
              onClick={() => {
                setView(view === 'signin' ? 'signup' : 'signin');
                setError(null);
                setSuccessMsg(null);
              }}
              className="block w-full text-slate-400 hover:text-white transition-colors text-sm font-medium"
            >
              {view === 'signin' ? "Don't have an account? Sign Up" : "Back to Sign In"}
            </button>
          </div>

          <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-center gap-2 text-slate-500 text-sm">
            <ShieldCheck className="w-4 h-4" />
            Secure Authentication via Supabase
          </div>
        </div>
      </motion.div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
