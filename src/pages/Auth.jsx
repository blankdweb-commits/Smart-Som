import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import { motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { Mail, Lock, ArrowRight, Loader2, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import SignupWizard from '../components/SignupWizard';

// Registration moved to components/SignupWizard.jsx — a guided, one-task-per-step
// flow. Sign-in and password reset stay HERE, untouched: sign-in is the path
// most e2e suites drive and the one path that must not regress, and there is no
// reason to rebuild it to make the sign-up experience nicer.
//
// The password field below is now only ever rendered by the sign-in and reset
// views, so its helper line no longer has to branch.
const PASSWORD_HINT = 'The password you set when you signed up.';

export default function Auth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  // Show/hide on the password field. CommunityAuthModal already had this; the
  // main page did not, so a mistyped character was invisible and the only
  // symptom was a bare "Invalid login credentials" from Supabase.
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Route-aware initial view: /signup opens the registration wizard directly.
  const [view, setView] = useState(location.pathname === '/signup' ? 'signup' : 'signin'); // 'signin', 'signup', 'forgot'
  const { session, loadingAuth } = useAppContext();

  // TRUE from the moment the wizard begins creating an account until the new
  // account has been handed off to /activate.
  //
  // WHY A REF AND NOT STATE: signUp resolves into a live session, and the very
  // next render would run the redirect effect and the `session` render guard
  // and tear the wizard out of the DOM — before it could show its success
  // screen, so the user was silently dropped on the dashboard and the
  // /activate hand-off never happened. Neither can be fixed with state: React
  // applies a setState from a child's effect only AFTER the parent's effects
  // for that same commit have already run, and the parent's render guard runs
  // even earlier. A ref is written synchronously, so the wizard can claim the
  // redirect BEFORE the session exists and both guards see it in time.
  //
  // The wizard sets this before it calls signUp, not after: it cannot know in
  // advance whether the response will carry a session, and claiming early is
  // harmless because the guard is `session && !claimed` — with no session
  // there is nothing to redirect away from anyway.
  const signupOwnsRedirect = useRef(false);

  // Session recognition — a device that already has a live session (persisted
  // in localStorage by supabase-js) is sent straight to the dashboard instead
  // of being asked to log in again. The wizard is the exception: see above.
  useEffect(() => {
    if (!loadingAuth && session && !signupOwnsRedirect.current) {
      navigate(location.state?.from || '/dashboard', { replace: true });
    }
  }, [loadingAuth, session, navigate, location.state?.from]);

  // Referral capture: a `?referral=CODE` (or `ref=CODE` / `code=CODE`) deep
  // link stores the code so the brand-new account redeems it once, later, via
  // the server's apply_referral (migration v35).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('referral') || params.get('ref') || params.get('code');
    if (code && code.trim().length >= 4 && code.trim().length <= 16) {
      try {
        localStorage.setItem('apex_pending_referral', code.trim().toUpperCase());
      } catch (err) {
        console.warn('Referral capture failed:', err?.message);
      }
    }
  }, [location.search]);

  // Sign-in and reset only. The four-field registration form used to live here
  // too; it is now components/SignupWizard.jsx, which owns the whole create
  // flow. formData therefore holds just the two fields these views read.
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });

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
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          formData.email,
          { redirectTo: `${window.location.origin}/login` }
        );
        if (resetError) throw resetError;
        setSuccessMsg('Password reset link sent to your email.');
        setLoading(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: formData.email,
        password: formData.password,
      });
      if (signInError) throw signInError;
      navigate(location.state?.from || '/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // The wizard hands its collected state back to us here, because the sign-in
  // view owns the inline error block and the "already exists" message needs to
  // land where the user is already looking. The email is carried across so a
  // user who hit a duplicate does not retype it.
  const handleDuplicateAccount = ({ email, message }) => {
    setFormData((f) => ({ ...f, email }));
    setError(message);
    setSuccessMsg(null);
    setShowPassword(false);
    setView('signin');
  };

  // Stable identity so the wizard's handleCreateAccount does not get a new
  // `onCreated` on every parent render.
  const handleWizardCreated = useCallback(() => {
    signupOwnsRedirect.current = true;
  }, []);

  const handleWizardComplete = useCallback(() => {
    signupOwnsRedirect.current = false;
    navigate('/activate');
  }, [navigate]);

  const switchToSignIn = () => {
    setError(null);
    setSuccessMsg(null);
    setShowPassword(false);
    setView('signin');
    window.scrollTo({ top: 0 });
  };

  const switchToSignUp = () => {
    setError(null);
    setSuccessMsg(null);
    setShowPassword(false);
    // A password typed into Sign In was still sitting in formData when the
    // Sign Up form appeared, so the new-account form opened pre-filled with
    // it. With the show/hide toggle above that is now plainly visible, and it
    // is a real leak on a shared device.
    setFormData((f) => ({ ...f, password: '' }));
    window.scrollTo({ top: 0 });
    setView('signup');
  };

  // While the persisted session is being rehydrated (or a signed-in user on a
  // returning device is being redirected), don't flash the login form.
  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="w-12 h-12 border-4 border-apex-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  // Registration owns its own card, progress indicator and terminal screens, so
  // the wizard replaces the page entirely rather than being nested inside the
  // sign-in card below.
  //
  // This check MUST sit above the `if (session) return null` guard, and the
  // `session && !signupOwnsRedirect` test is what distinguishes "a returning
  // visitor who wandered onto /signup" from "the wizard that just created this
  // account". Only the first should be bounced; the second has to stay mounted
  // so its success screen can render before the hand-off.
  if (view === 'signup') {
    if (session && !signupOwnsRedirect.current) return null;
    return (
      <SignupWizard
        onCreated={handleWizardCreated}
        onComplete={handleWizardComplete}
        onDuplicateAccount={handleDuplicateAccount}
        onSwitchToSignIn={switchToSignIn}
      />
    );
  }

  if (session) return null;

  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-slate-950 p-4 py-6 sm:py-8 relative overflow-hidden">
      {/* items-start + py on small screens, not items-center: the helper lines
          make this card tall enough to exceed a short phone viewport, and a
          centred over-tall flex child clips the top AND bottom with no way to
          scroll to either. */}
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
            <div className="flex items-center justify-center gap-2 mb-4">
              <BrandLogo variant="mark" size="xl" />
              <BrandLogo variant="short" size="lg" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-2">
              {view === 'forgot' ? 'Reset Password' : 'Welcome Back'}
            </h1>
            <p className="text-slate-400">
              {view === 'forgot' ? 'We will send you a link to reset it' : 'Enter your credentials to continue'}
            </p>
          </div>

          {successMsg && (
            <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm flex items-center justify-center">
              {successMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                <input
                  type="email"
                  placeholder="e.g. amaka@gmail.com"
                  aria-label="Email address"
                  autoComplete="email"
                  required
                  className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder:text-slate-400 focus:outline-none focus:border-medical-500 transition-colors"
                  value={formData.email}
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                />
              </div>
              <p className="mt-1.5 text-[11px] font-medium text-slate-500">
                Use an address you can actually open on this device.
              </p>
            </div>

            {view !== 'forgot' && (
              <div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Your password"
                    aria-label="Password"
                    autoComplete="current-password"
                    required
                    className="w-full bg-slate-800/50 border border-white/10 rounded-xl py-3 pl-12 pr-12 text-white placeholder:text-slate-400 focus:outline-none focus:border-medical-500 transition-colors"
                    value={formData.password}
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
                  />
                  {/* type="button" is essential: the form has no other guard, so a
                      submit-by-default eye would fire handleSubmit. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                <p className="mt-1.5 text-[11px] font-medium text-slate-500">{PASSWORD_HINT}</p>
              </div>
            )}

            {error && (
              <p role="alert" className="text-red-400 text-sm bg-red-400/10 p-3 rounded-lg border border-red-400/20">
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
                  {view === 'forgot' ? 'Send Reset Link' : 'Sign In'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

          <div className="mt-8 text-center space-y-4">
            {view === 'signin' && (
              <button
                onClick={() => {
                  setView('forgot');
                  setError(null);
                  setSuccessMsg(null);
                  setShowPassword(false);
                }}
                className="block w-full text-slate-400 hover:text-white transition-colors text-sm mb-2"
              >
                Forgot your password?
              </button>
            )}

            <button
              onClick={() => (view === 'signin' ? switchToSignUp() : switchToSignIn())}
              className="block w-full text-slate-400 hover:text-white transition-colors text-sm font-medium"
            >
              {view === 'signin' ? "Don't have an account? Sign Up" : 'Back to Sign In'}
            </button>
          </div>

          <div className="flex items-center justify-center gap-3 text-slate-500 text-xs pt-4">
            <Link to="/legal/terms" className="hover:text-slate-300 transition-colors">Terms</Link>
            <span className="text-slate-700">•</span>
            <Link to="/legal/privacy" className="hover:text-slate-300 transition-colors">Privacy</Link>
            <span className="text-slate-700">•</span>
            <Link to="/legal/cookies" className="hover:text-slate-300 transition-colors">Cookies</Link>
          </div>

          <div className="mt-4 pt-6 border-t border-white/5 flex items-center justify-center gap-2 text-slate-500 text-sm">
            <ShieldCheck className="w-4 h-4" />
            Secure Authentication via Supabase
          </div>
        </div>
      </motion.div>
    </div>
  );
}
