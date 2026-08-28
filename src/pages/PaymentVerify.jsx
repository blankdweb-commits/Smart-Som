import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertCircle, CreditCard, ArrowRight } from '../components/Icons';
import { motion } from 'framer-motion';
import { supabase } from '../utils/supabase';

// /payments/verify — the LIVE callback URL Paystack redirects users to after
// a successful (or cancelled) hosted checkout. The app reads the transaction
// reference and server-verifies it before activating the subscription.
const PaymentVerify = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const reference =
    params.get('reference') ||
    params.get('trxref') ||
    params.get('txRef') ||
    params.get('paystack_reference') ||
    '';

  const [status, setStatus] = useState(reference ? 'verifying' : 'pending');
  const [message, setMessage] = useState(
    reference
      ? ''
      : 'No payment reference found. Complete a checkout to be redirected here automatically.'
  );
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    if (!reference) return;

    const verify = async () => {
      try {
        // Resolve the current access token (in case we landed here signed in).
        const { data } = await supabase.auth.getSession();
        const token = data?.session?.access_token;

        const res = await fetch('/api/verify-payment', {
          method: 'POST',
          headers: token
            ? { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
            : { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reference })
        });

        const body = await res.json();
        if (res.ok && body.success) {
          setStatus('success');
          setMessage('Your subscription is now active. Redirecting to your dashboard…');
          setTimeout(() => navigate('/dashboard', { replace: true }), 1600);
        } else {
          setStatus('error');
          setMessage(body.error || 'Payment verification failed. Please contact support.');
        }
      } catch {
        setStatus('error');
        setMessage('Unable to verify payment. Please contact support and keep your receipt reference.');
      }
    };

    // Brief delay so the activation state from a fresh redirect settles.
    setTimeout(verify, 400);
  }, [reference, navigate]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-4 sm:p-6 flex items-center justify-center">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-[2.5rem] border border-slate-100 dark:border-slate-800 shadow-2xl p-8 sm:p-10 text-center space-y-6"
      >
        <div className={`w-20 h-20 mx-auto rounded-[1.8rem] flex items-center justify-center shadow-lg ${
          status === 'success'
            ? 'bg-emerald-500/10 text-emerald-500'
            : status === 'error'
            ? 'bg-red-500/10 text-red-500'
            : 'bg-apex-600/10 text-apex-600'
        }`}>
          {status === 'success' ? (
            <CheckCircle2 size={40} />
          ) : status === 'error' ? (
            <AlertCircle size={40} />
          ) : (
            <CreditCard size={40} className="animate-pulse" />
          )}
        </div>

        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
            {status === 'success' ? 'Payment Confirmed' : status === 'error' ? 'Verification Issue' : 'Redirecting from Paystack'}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mt-2 leading-relaxed">
            {message || (status === 'verifying' ? 'Verifying your payment with Paystack…' : '')}
          </p>
          {reference && (
            <p className="mt-3 text-[10px] font-black uppercase tracking-widest text-slate-400">
              Reference: {reference}
            </p>
          )}
        </div>

        {status === 'verifying' && (
          <div className="flex items-center justify-center gap-2 text-apex-600">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-xs font-black uppercase tracking-widest">Verifying…</span>
          </div>
        )}

        {status === 'pending' && (
          <Link
            to="/activate"
            className="inline-flex items-center gap-2 px-6 py-3 bg-apex-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all"
          >
            Select a Plan <ArrowRight size={14} />
          </Link>
        )}

        {status === 'error' && (
          <button
            onClick={() => navigate('/settings')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all"
          >
            Back to Settings
          </button>
        )}
      </motion.div>
    </div>
  );
};

export default PaymentVerify;