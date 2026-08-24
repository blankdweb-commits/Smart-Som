import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Star, Clock } from '../components/Icons';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';

const durationLabel = (days) => {
  if (Number(days) >= 365) return 'year';
  if (Number(days) >= 30) return 'month';
  return 'week';
};

export default function Activate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { userProfile, subscriptionPlans } = useAppContext();
  const navigate = useNavigate();

  useEffect(() => {
    // Load Paystack script
    const script = document.createElement("script");
    script.src = "https://js.paystack.co/v1/inline.js";
    script.async = true;
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  const handlePay = (plan) => {
    if (!window.PaystackPop || !supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      const activeSession = data?.session;
      if (!activeSession) {
        setError('Please sign in first to purchase a plan.');
        return;
      }

      const handler = window.PaystackPop.setup({
        key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
        email: activeSession.user.email,
        amount: Math.round(plan.price * 100),
        currency: "NGN",
        metadata: {
          plan_id: plan.id,
          user_id: activeSession.user.id
        },
        callback: async (response) => {
          setLoading(true);
          try {
            // The server derives the user from this token — no user_id in the body.
            const res = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${activeSession.access_token}`
              },
              body: JSON.stringify({ reference: response.reference })
            });
            const resData = await res.json();
            if (resData.success) {
              navigate('/dashboard');
            } else {
              setError(resData.error || "Verification failed. Please contact support.");
            }
          } catch {
            setError("Verification failed. Please contact support.");
          } finally {
            setLoading(false);
          }
        },
        onClose: () => {}
      });
      handler.openIframe();
    });
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
           </div>

           {!supabase && (
             <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl text-amber-700 dark:text-amber-400 text-xs font-bold text-center">
               Payments require a configured backend. Sign in once Supabase is connected.
             </div>
           )}

           <div className="space-y-4">
              {subscriptionPlans.map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => handlePay(plan)}
                  disabled={loading}
                  className="w-full p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-apex-500 transition-all text-left flex justify-between items-center group active:scale-[0.98] disabled:opacity-50"
                >
                  <div>
                    <p className="font-black text-slate-900 dark:text-white">{plan.name} Access</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                      NGN {Number(plan.price).toLocaleString()} / {durationLabel(plan.duration_days)}
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-apex-600 rounded-xl flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <ArrowRight size={18} />
                  </div>
                </button>
              ))}
           </div>

           {error && (
             <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl">
               <p className="text-red-600 dark:text-red-400 text-xs font-bold">{error}</p>
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
