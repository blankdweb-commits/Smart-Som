import React, { useState } from 'react';
import { ShieldCheck, ArrowRight, Star, Clock, Loader2, AlertCircle, CheckCircle2 } from '../components/Icons';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';

const durationLabel = (days) => {
  if (Number(days) >= 365) return 'year';
  if (Number(days) >= 30) return 'month';
  return 'week';
};

const paystackKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY || '';
const paystackMode = paystackKey.startsWith('pk_live_')
  ? 'live'
  : paystackKey.startsWith('pk_test_')
  ? 'test'
  : null;

export default function Activate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [activePlanId, setActivePlanId] = useState(null);
  const { userProfile, subscriptionPlans, session } = useAppContext();

  // HOSTED CHECKOUT FLOW (works on iOS — no injected iframe that Safari can
  // silently block). The server initializes a Paystack session, the browser is
  // redirected to Paystack's hosted page, and Paystack redirects the payer back
  // to the LIVE callback URL: <origin>/payments/verify
  const handlePay = async (plan) => {
    setError(null);
    setSuccess(false);

    if (!supabase) {
      setError('Payments require a configured backend.');
      return;
    }
    if (!session?.access_token) {
      setError('Please sign in first to purchase a plan.');
      return;
    }

    setLoading(true);
    setActivePlanId(plan.id);

    try {
      const res = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ plan_id: plan.id })
      });

      const body = await res.json();
      if (res.ok && body.authorization_url) {
        // Going to a new page — loading state stays until we return.
        window.location.assign(body.authorization_url);
        return;
      }

      setError(body.error || 'Payment could not be started. Please try again.');
    } catch {
      setError('Could not start payment. Check your connection and try again.');
    } finally {
      setLoading(false);
      setActivePlanId(null);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-4 sm:p-6 flex items-center justify-center">
      <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12 items-center">

        {/* Left Side: Value Proposition */}
        <div className="space-y-8">
           <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-apex-50 dark:bg-apex-900/30 border border-apex-100 dark:border-apex-800">
              <Star size={14} className="text-apex-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-apex-600 dark:text-apex-400">Institutional Access</span>
           </div>

           <h1 className="text-4xl md:text-6xl font-black tracking-tight text-slate-900 dark:text-white leading-tight">
              Unlock Your <span className="text-apex-600">Full Potential</span>
           </h1>

           <div className="space-y-4">
              {[
                "Access 10,000+ Questions & Flashcards",
                "Personalized Exam Readiness Tracking",
                "Clinical Reference Library",
                "Priority Community Support"
              ].map((text, i) => (
                <div key={i} className="flex items-center gap-3">
                   <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <ShieldCheck size={14} className="text-emerald-500" />
                   </div>
                   <span className="text-slate-600 dark:text-slate-400 font-medium">{text}</span>
                </div>
              ))}
           </div>

           <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-red-500 mb-2">
                 <Clock size={16} />
                 <span className="text-xs font-black uppercase tracking-widest">Flexible Pricing</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                 Choose the access window that fits your study schedule — weekly for exam sprints, monthly for terms, yearly for full coverage.
              </p>
           </div>
        </div>

        {/* Right Side: Plan Selection */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-6 sm:p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8 relative overflow-hidden">
           <div className="text-center">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Select Plan</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {userProfile.isActivated ? 'Extend Your Access' : 'Instant Activation'}
              </p>
              {paystackMode && (
                <span className={`inline-block mt-2 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest border ${
                  paystackMode === 'live'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
                }`}>
                  Paystack {paystackMode} mode
                </span>
              )}
            </div>

            {!paystackKey && (
              <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 text-xs font-bold text-center">
                Payment key missing. Set VITE_PAYSTACK_PUBLIC_KEY in Vercel (Settings → Environment Variables) and redeploy.
              </div>
            )}

           {!supabase && (
             <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-700 dark:text-amber-400 text-xs font-bold text-center">
               Payments require a configured backend. Sign in once Supabase is connected.
             </div>
           )}

           <div className="space-y-4">
              {subscriptionPlans.map((plan) => {
                const isPlanLoading = loading && activePlanId === plan.id;
                return (
                  <button
                    key={plan.id}
                    onClick={() => handlePay(plan)}
                    disabled={loading}
                    className="w-full p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-apex-500 transition-all text-left flex justify-between items-center group active:scale-[0.98] disabled:opacity-50"
                  >
                    <div>
                      <p className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                        {isPlanLoading && <Loader2 size={14} className="animate-spin text-apex-600" />}
                        {plan.name} Access
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                        NGN {Number(plan.price).toLocaleString()} / {durationLabel(plan.duration_days)}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase mt-1 sm:hidden">
                        Tap to pay securely
                      </p>
                    </div>
                    <div className="w-10 h-10 bg-apex-600 rounded-xl flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shrink-0 max-sm:opacity-100">
                      {success ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                    </div>
                  </button>
                );
              })}
           </div>

           {loading && (
             <div className="p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-center gap-2">
               <Loader2 size={14} className="animate-spin text-slate-400" />
               <p className="text-slate-500 dark:text-slate-400 text-xs font-bold">Connecting to Paystack…</p>
             </div>
           )}

           {error && (
             <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
               <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
               <p className="text-red-600 dark:text-red-400 text-xs font-bold">{error}</p>
             </div>
           )}

           {success && (
             <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl flex items-start gap-2">
               <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
               <p className="text-emerald-600 dark:text-emerald-400 text-xs font-bold">Payment successful! Activating your subscription…</p>
             </div>
           )}

           <p className="text-center text-[9px] font-bold text-slate-400 uppercase tracking-widest">
             Secure payment via Paystack • Activated instantly after verification
           </p>
        </div>

      </div>
    </div>
  );
}
