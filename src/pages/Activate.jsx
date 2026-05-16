import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShieldCheck, ArrowRight, Zap, Star, Clock, Lock } from '../components/Icons';
import { useAppContext } from '../context/AppContext';

export default function Activate() {
  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const { userProfile, session, fetchUserData, subscriptionPlans } = useAppContext();
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
    if (!window.PaystackPop) return;

    const handler = window.PaystackPop.setup({
      key: import.meta.env.VITE_PAYSTACK_PUBLIC_KEY,
      email: session.user.email,
      amount: Math.round(plan.price * 100),
      currency: "NGN",
      metadata: {
        plan_id: plan.id,
        user_id: session.user.id
      },
      callback: async (response) => {
        setLoading(true);
        try {
          const res = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              reference: response.reference,
              user_id: session.user.id
            })
          });
          const data = await res.json();
          if (data.success) {
            await fetchUserData();
            navigate('/dashboard');
          }
        } catch (e) {
          setError("Verification failed. Please contact support.");
        } finally {
          setLoading(false);
        }
      },
      onClose: () => {
        console.log('Window closed');
      }
    });
    handler.openIframe();
  };

  const handleActivateWithKey = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_key: key, user_id: session.user.id })
      });
      const data = await res.json();
      if (data.success) {
        await fetchUserData();
        navigate('/dashboard');
      } else {
        setError(data.message || "Invalid product key");
      }
    } catch (e) {
      setError("Activation failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-6 flex items-center justify-center">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 items-center">

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
                "AI Past Question Parsing Engine",
                "Personalized Exam Readiness Tracking",
                "Clinical Reference Library"
              ].map((text, i) => (
                <div key={i} className="flex items-center gap-3">
                   <div className="w-5 h-5 rounded-full bg-emerald-500/10 flex items-center justify-center">
                      <ShieldCheck size={14} className="text-emerald-500" />
                   </div>
                   <span className="text-slate-600 dark:text-slate-400 font-medium">{text}</span>
                </div>
              ))}
           </div>

           <div className="p-6 bg-slate-50 dark:bg-slate-900 rounded-3xl border border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2 text-red-500 mb-2">
                 <Clock size={16} />
                 <span className="text-xs font-black uppercase tracking-widest">Limited Offer</span>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                 Join 1,000+ students already using Apex Scholars to master their nursing curriculum.
              </p>
           </div>
        </div>

        {/* Right Side: Action Card */}
        <div className="bg-white dark:bg-slate-900 rounded-[3rem] p-10 shadow-2xl border border-slate-100 dark:border-slate-800 space-y-8 relative overflow-hidden">
           <div className="text-center">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Select Plan</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Instant Activation</p>
           </div>

           <div className="space-y-4">
              {(subscriptionPlans.length > 0 ? subscriptionPlans : [
                { id: '1', name: 'Weekly', price: 1999.9 },
                { id: '2', name: 'Monthly', price: 6999 },
                { id: '3', name: 'Yearly', price: 49999 }
              ]).map((plan) => (
                <button
                  key={plan.id}
                  onClick={() => handlePay(plan)}
                  disabled={loading}
                  className="w-full p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 hover:border-apex-500 transition-all text-left flex justify-between items-center group active:scale-[0.98]"
                >
                  <div>
                    <p className="font-black text-slate-900 dark:text-white">{plan.name} Access</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">NGN {plan.price.toLocaleString()}</p>
                  </div>
                  <div className="w-10 h-10 bg-apex-600 rounded-xl flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <ArrowRight size={18} />
                  </div>
                </button>
              ))}
           </div>

           <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100 dark:border-slate-800"></div></div>
              <div className="relative flex justify-center text-[10px] uppercase font-black text-slate-400 tracking-widest"><span className="bg-white dark:bg-slate-900 px-4">OR</span></div>
           </div>

           <form onSubmit={handleActivateWithKey} className="space-y-4">
              <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">Enter Product Key</p>
              <input
                type="text"
                placeholder="XXXX-XXXX-XXXX"
                value={key}
                onChange={e => setKey(e.target.value)}
                className="w-full p-4 bg-slate-50 dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-xl text-center font-mono text-white tracking-widest"
              />
              <button
                type="submit"
                className="w-full text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-apex-600 transition-colors"
              >
                Activate with key
              </button>
           </form>

           {error && <p className="text-center text-red-500 text-xs font-bold uppercase">{error}</p>}
        </div>

      </div>
    </div>
  );
}
