import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, Star, Clock, Loader2, AlertCircle, CheckCircle2, Info } from '../components/Icons';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';

const durationLabel = (days) => {
  if (Number(days) >= 365) return 'year';
  if (Number(days) >= 30) return 'month';
  return 'week';
};

// "2d 14h left" — rendered ONLY when the server supplied a real end time.
// Returns null for the shipped state (inactive, or active with no end), so no
// countdown can ever appear over an offer that has no deadline.
const formatOfferRemaining = (endsAt, serverNow) => {
  if (!endsAt) return null;
  const base = serverNow ? new Date(serverNow).getTime() : Date.now();
  const ms = new Date(endsAt).getTime() - base;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h left`;
  const m = Math.floor((ms % 3600000) / 60000);
  return m > 0 ? `${h}h ${m}m left` : `${m}m left`;
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
  const { userProfile, subscriptionPlans, session, premiumOffer, fetchPremiumOffer, trackConversion } = useAppContext();
  const navigate = useNavigate();

  // migration-v100. The offer is server state: it ships DISABLED with no dates,
  // and an admin has to give it a real start/end window before any promo
  // pricing is shown. `offerLive` is therefore false on a fresh install, which
  // is correct — there is no promotion running to advertise.
  const offerLive = premiumOffer?.enabled === true;
  const offerRemaining = formatOfferRemaining(premiumOffer?.ends_at, premiumOffer?.server_now);

  // Annual-first, with a stable tie-break. `sort_order` is the admin's
  // merchandising column (annual=1, weekly=2); price breaks ties so plans that
  // share a sort_order never reorder between renders.
  const orderedPlans = useMemo(() => {
    return [...subscriptionPlans].sort((a, b) => {
      const so = (a.sort_order ?? 100) - (b.sort_order ?? 100);
      if (so !== 0) return so;
      return Number(a.price) - Number(b.price);
    }).map((p) => ({ ...p, isAnnual: Number(p.duration_days) >= 365 }));
  }, [subscriptionPlans]);

  const promoPlans = useMemo(
    () => subscriptionPlans.filter((p) => p.is_promo || p.offer_eligible),
    [subscriptionPlans],
  );

  // Re-read the offer on mount: it can be switched on or expire while a user is
  // signed in, and a stale `enabled` would keep showing dead promo pricing.
  useEffect(() => { fetchPremiumOffer(); }, [fetchPremiumOffer]);

  useEffect(() => {
    trackConversion('pricing_viewed', { offer_state: premiumOffer?.state || 'inactive' });
    if (offerLive) trackConversion('offer_viewed', { offer_state: premiumOffer?.state || 'active' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    trackConversion('plan_selected', { plan_id: String(plan.id) });

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
        // Only a checkout that actually redirected counts as started.
        trackConversion('checkout_started', { plan_id: String(plan.id) });
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
                "Global Competitive Rankings",
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
              {/* The promo banner used to hardcode "₦990 for 30 days or ₦550
                  for 7 days" as JSX literals — the same two numbers are also in
                  the plan table, so the two could drift and the banner would
                  advertise a price nobody was charged. It is now rendered from
                  the plan rows, and only when the SERVER says the offer is
                  live (migration-v100 ships it disabled with no dates). */}
              {offerLive && promoPlans.length > 0 && (
                <div className="p-4 rounded-2xl border border-amber-300 dark:border-amber-700/60 bg-gradient-to-r from-amber-100/80 to-amber-50 dark:from-amber-900/25 dark:to-amber-800/10 flex items-start gap-3">
                  <ShieldCheck size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-amber-700 dark:text-amber-300 text-xs font-bold leading-relaxed">
                      {premiumOffer?.headline || 'Student promo pricing is live'}
                      {offerRemaining ? ` · ${offerRemaining}` : ''}
                    </p>
                    {premiumOffer?.subline && (
                      <p className="text-amber-700/80 dark:text-amber-300/80 text-[11px] mt-0.5">
                        {premiumOffer.subline}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Annual-first, defensively re-sorted here rather than trusting
                  the fetch order alone. AppContext already orders by the admin's
                  `sort_order`, but this list must still lead with the annual if
                  the plans arrive from the static cache or FALLBACK_PLANS. */}
              {orderedPlans.map((plan) => {
                const isPlanLoading = loading && activePlanId === plan.id;
                const isPromo = Boolean(plan.is_promo);
                // A promo row is only purchasable-as-promoted while the offer is
                // live; the plan itself remains sellable, it just must not be
                // dressed up with strikethrough pricing against a dead offer.
                const showPromoPricing = isPromo && offerLive;
                const reference = showPromoPricing ? plan.reference_price : null;
                const savePct = reference != null && Number(reference) > 0
                  ? Math.round((1 - Number(plan.price) / Number(reference)) * 100)
                  : 0;
                return (
                  <button
                    key={plan.id}
                    onClick={() => handlePay(plan)}
                    disabled={loading}
                    className={`w-full p-6 rounded-2xl border transition-all text-left flex justify-between items-center group active:scale-[0.98] disabled:opacity-50 ${
                      plan.isAnnual
                        ? 'border-apex-400 dark:border-apex-600 bg-gradient-to-r from-apex-50 to-white dark:from-apex-900/20 dark:to-slate-800/50'
                        : isPromo
                          ? 'bg-gradient-to-r from-amber-50 to-amber-100/60 dark:from-amber-900/20 dark:to-amber-800/10 border-amber-300 dark:border-amber-700/60'
                          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700 hover:border-apex-500'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-black text-slate-900 dark:text-white flex items-center gap-2">
                        {isPlanLoading && <Loader2 size={14} className="animate-spin text-apex-600" />}
                        {plan.name} Access
                      </p>
                      <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                        {durationLabel(plan.duration_days)} access · one-time payment
                      </p>
                      <p className="text-xs font-black text-slate-700 dark:text-slate-200 mt-1">
                        {/* The struck-through figure is the REAL equivalent
                            price of the same duration (weekly for the 7-day
                            promo, monthly for the 30-day one) — never an invented
                            "was" number. */}
                        {reference != null && (
                          <span className="text-slate-400 line-through font-bold mr-1.5">
                            NGN {Number(reference).toLocaleString()}
                          </span>
                        )}
                        Total payable: NGN {Number(plan.price).toLocaleString()}
                      </p>
                      <p className="text-[9px] text-slate-400 font-bold uppercase mt-1">
                        No auto-renewal
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {showPromoPricing && savePct > 0 && (
                        <span className="px-2 py-1 rounded-full bg-amber-500 text-white text-[9px] font-black uppercase tracking-widest">
                          Save {savePct}%
                        </span>
                      )}
                      {isPromo && !showPromoPricing && (
                        <span className="px-2 py-1 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-widest">
                          Student rate
                        </span>
                      )}
                      {plan.isAnnual && (
                        <span className="px-2 py-1 rounded-full bg-apex-600 text-white text-[9px] font-black uppercase tracking-widest">
                          Best value
                        </span>
                      )}
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-white transition-opacity shrink-0 max-sm:opacity-100 ${
                        isPromo ? 'bg-amber-500 opacity-100' : 'bg-apex-600 opacity-0 group-hover:opacity-100'
                      }`}>
                        {success ? <CheckCircle2 size={18} /> : <ArrowRight size={18} />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

           <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-3 flex items-start gap-2">
             <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
             <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
               The “Total payable” above is exactly what Paystack charges — no hidden fees. Access runs for the plan
               duration shown and does <span className="font-bold">not</span> renew automatically; you can purchase
               again when it expires.
             </p>
           </div>

           {!userProfile.isActivated && (
             <button
               onClick={() => navigate('/dashboard')}
               disabled={loading}
               className="w-full p-5 bg-white dark:bg-slate-800 rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-apex-500 hover:bg-apex-50 dark:hover:bg-apex-900/20 transition-all text-left flex justify-between items-center group active:scale-[0.98] disabled:opacity-50"
             >
               <div>
                 <p className="font-black text-slate-900 dark:text-white">Continue as Free</p>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">
                    10 questions per round · new round every 30 minutes
                 </p>
               </div>
               <div className="w-10 h-10 bg-slate-200 dark:bg-slate-700 rounded-xl flex items-center justify-center text-slate-600 dark:text-slate-300 group-hover:bg-apex-600 group-hover:text-white transition-all shrink-0">
                 <ArrowRight size={18} />
               </div>
             </button>
           )}

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
