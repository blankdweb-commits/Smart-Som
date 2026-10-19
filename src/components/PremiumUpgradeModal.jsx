// PremiumUpgradeModal — the contextual upgrade prompt.
//
// WHY THIS IS NOT A BANNER. Every Premium gate in the app was a bare
// `navigate('/activate')`: the user taps "Go Premium", the page changes, and
// nothing explains why the thing they were doing is locked. That is the whole
// complaint this prompt exists to fix, so it must know WHY it opened and lead
// with that reason rather than with a price.
//
// THE BENEFIT LIST IS A CONTRACT, NOT MARKETING. Each entry below is a
// capability that exists in the entitlement checks today. Premium does NOT grant
// unlimited questions, flashcards, Arena access, Smart Coins, or any exam
// advantage: flashcards are an ADMIN grant (`flashcard_access`) and the Arena is
// Smart-Coin gated, so advertising either under "Premium" would sell something
// that does not arrive and then be refunded in bad reviews. `is_activated` is
// likewise not a Premium benefit — it is a separate signup milestone.
//
// There is NO auto-renewal. The one line that says so is not a disclaimer, it is
// the most important sentence in the modal: a user who buys a "month" and is
// silently charged again has been sold something the product does not do.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Sparkles, Check, Clock, Lock, ArrowRight } from './Icons';
import Modal from './Modal';
import { useAppContext } from '../context/AppContext';
import { isPromptAllowed, notePromptShown } from '../utils/safeStorage';

// Frequency cap: at most 2 automatic appearances per surface per 7 days.
// A contextual prompt that appears on every failed attempt trains people to
// dismiss it without reading, which costs the upsell and annoys the user.
const PROMPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PROMPT_MAX_PER_WINDOW = 2;

const promptKey = (surface) => `premium-upsell:${surface}`;

// The truthful benefit list. Keep this in sync with the entitlement checks; if a
// capability is not enforced server-side, it does not belong here.
const PREMIUM_BENEFITS = [
  { id: 'cooldown', label: 'No 30-minute round cooldown', hint: 'Start another course straight away.' },
  { id: 'questions', label: 'Up to 30 questions per round', hint: 'Free rounds are limited to 10.' },
  { id: 'timers', label: 'Every timer, up to no time limit', hint: 'Free is capped at 15s per question.' },
  { id: 'encoded', label: 'Encoded Messages', hint: 'Send and receive private encoded notes.' },
  { id: 'duels', label: 'See the 1v1 scholar roster', hint: 'Challenge other Premium scholars directly.' },
  { id: 'marketplace', label: 'Premium marketplace items', hint: 'Products marked Premium-only become yours.' },
];

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

// "2d 14h left" — ONLY ever rendered when the server handed us a real end time.
// Returns null for an open-ended or inactive offer, which is what ships.
// `now` is passed explicitly so the caller controls the tick.
const formatRemaining = (endsAt, now, skew = 0) => {
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - (now + skew);
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d > 0) return `${d}d ${h}h left`;
  const m = Math.floor((ms % 3600000) / 60000);
  return m > 0 ? `${h}h ${m}m left` : `${m}m left`;
};

const PremiumUpgradeModal = ({
  isOpen,
  onClose,
  surface = 'unknown',
  // Why the user hit the wall, e.g. "Longer timers are a Premium feature."
  reason = null,
  // Set false for a prompt the user explicitly asked for (a Settings button),
  // which must not be frequency-capped or it would silently do nothing.
  automatic = true,
}) => {
  const { subscriptionPlans, premiumOffer, trackConversion, isPremium } = useAppContext();
  const [now, setNow] = useState(Date.now());
  const countedRef = useRef(false);

  // Ticking only while an offer is genuinely live; otherwise there is no
  // countdown to keep fresh.
  const offerLive = premiumOffer?.enabled === true && !!premiumOffer?.ends_at;
  useEffect(() => {
    if (!isOpen || !offerLive) return undefined;
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, [isOpen, offerLive]);

  // Frequency gate. Read on OPEN, not on render, so reopening within the same
  // session re-evaluates rather than caching a stale decision.
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    if (!isOpen) return;
    if (!automatic) { setAllowed(true); return; }
    setAllowed(isPromptAllowed(promptKey(surface), {
      windowMs: PROMPT_WINDOW_MS, maxPerWindow: PROMPT_MAX_PER_WINDOW, now: Date.now(),
    }));
  }, [isOpen, automatic, surface]);

  // One `modal_view` per open, not per render.
  useEffect(() => {
    if (!isOpen || !allowed || countedRef.current) return;
    countedRef.current = true;
    if (automatic) {
      notePromptShown(promptKey(surface), {
        windowMs: PROMPT_WINDOW_MS, maxPerWindow: PROMPT_MAX_PER_WINDOW, now: Date.now(),
      });
    }
    trackConversion('modal_view', { surface });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, allowed, automatic, surface]);

  // Re-arm the one-shot counter when the modal closes, so the next open counts.
  useEffect(() => {
    if (!isOpen) countedRef.current = false;
  }, [isOpen]);

  // Clock skew, measured ONCE against the server timestamp the RPC returns. A
  // device whose clock is hours out would otherwise count down to a deadline
  // that has already passed (or render "12d left" for an offer that ended).
  // Held in a ref so the 30s tick does not re-measure it.
  const skewRef = useRef(0);
  useEffect(() => {
    if (premiumOffer?.server_now) {
      const parsed = new Date(premiumOffer.server_now).getTime();
      if (Number.isFinite(parsed)) skewRef.current = parsed - Date.now();
    }
  }, [premiumOffer?.server_now]);

  const remaining = useMemo(
    () => formatRemaining(premiumOffer?.ends_at, now, skewRef.current),
    // `now` IS read inside `now`-aware formatRemaining, but eslint cannot see
    // through the call, and dropping it would freeze the countdown.
    [premiumOffer?.ends_at, now],
  );

  const goToPlans = useCallback(() => {
    trackConversion('upgrade_click', { surface });
    onClose?.();
  }, [trackConversion, surface, onClose]);

  const dismiss = useCallback(() => {
    trackConversion('modal_dismiss', { surface });
    onClose?.();
  }, [trackConversion, surface, onClose]);

  // The headline leads with the blocked ACTION, not the price. "Why can't I do
  // this" is the question the user actually arrived with.
  const annual = useMemo(
    () => subscriptionPlans.find((p) => Number(p.duration_days) >= 365) || null,
    [subscriptionPlans],
  );
  const cheapest = useMemo(() => {
    const usable = subscriptionPlans.filter((p) => p.is_active !== false);
    if (!usable.length) return null;
    return usable.reduce((lo, p) => (Number(p.price) < Number(lo.price) ? p : lo));
  }, [subscriptionPlans]);

  const promoPlans = useMemo(
    () => subscriptionPlans.filter((p) => p.is_promo || p.offer_eligible),
    [subscriptionPlans],
  );

  // EVERY hook is now above. A subscriber has no reason to see an upsell, and a
  // frequency-suppressed prompt must render nothing — but both of those early
  // returns used to sit ABOVE these hooks, which means the hook order changed
  // the moment `isPremium` flipped (lapsing mid-session) and React would throw
  // "Rendered fewer hooks than expected".
  if (isPremium) return null;
  if (isOpen && automatic && !allowed) return null;

  // A promo plan may only be SHOWN while the server says the offer is live.
  // The plans exist in the table always; displaying them against an inactive
  // offer is advertising a discount nobody gets.
  const showPromo = premiumOffer?.enabled === true && promoPlans.length > 0;

  return (
    <Modal isOpen={isOpen} onClose={dismiss} label="Upgrade to Premium" panelClassName="p-0">
      <div className="p-6 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-apex-600 text-white flex items-center justify-center shrink-0">
              <Sparkles size={18} />
            </span>
            <div>
              <h3 className="font-black text-slate-900 dark:text-white leading-tight">
                {reason ? reason : 'Go Premium'}
              </h3>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">
                One-time payment
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors shrink-0"
          >
            <X size={18} />
          </button>
        </div>

        {/* Only rendered when the server supplied a real end time. */}
        {premiumOffer?.enabled === true && (
          <div className="mt-4 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 flex items-center gap-2">
            <Clock size={14} className="text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
              {premiumOffer.headline || 'Limited-time offer'}
              {remaining ? ` · ${remaining}` : ''}
            </p>
          </div>
        )}

        <ul className="mt-4 space-y-2.5">
          {PREMIUM_BENEFITS.map((b) => (
            <li key={b.id} className="flex items-start gap-2.5">
              <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <Check size={11} strokeWidth={3} />
              </span>
              <div>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-snug">{b.label}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">{b.hint}</p>
              </div>
            </li>
          ))}
        </ul>

        {showPromo && (
          <div className="mt-4 rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300">
              {premiumOffer.headline || 'Student promo pricing'}
            </p>
            <div className="mt-2 space-y-1.5">
              {promoPlans.map((p) => (
                <div key={p.id} className="flex items-baseline justify-between gap-3">
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    {p.name}
                    <span className="ml-1.5 font-normal text-slate-500 dark:text-slate-400">
                      / {Number(p.duration_days)} days
                    </span>
                  </span>
                  <span className="text-xs shrink-0">
                    {p.reference_price != null && (
                      <span className="text-slate-400 line-through mr-1.5">
                        {naira(p.reference_price)}
                      </span>
                    )}
                    <span className="font-black text-amber-700 dark:text-amber-300">{naira(p.price)}</span>
                  </span>
                </div>
              ))}
            </div>
            {premiumOffer.subline && (
              <p className="text-[11px] text-amber-700/90 dark:text-amber-200/90 mt-2">{premiumOffer.subline}</p>
            )}
          </div>
        )}

        {/* The no-auto-renewal sentence. Placed above the CTA so it is read
            BEFORE the purchase, not discovered afterwards. */}
        <div className="mt-4 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
          <Lock size={13} className="text-slate-400 mt-0.5 shrink-0" />
          <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
            <span className="font-black">This does not auto-renew.</span>{' '}
            Premium lasts for the window you buy and then your account returns to Free.
            Nothing is charged again unless you buy again.
          </p>
        </div>
      </div>

      <div className="px-6 pb-6 pt-1 flex flex-col gap-2">
        <button
          type="button"
          onClick={goToPlans}
          className="w-full flex items-center justify-center gap-2 bg-apex-600 hover:bg-apex-700 text-white font-black py-3.5 rounded-xl transition-colors active:scale-[0.99]"
        >
          See plans
          <ArrowRight size={16} />
        </button>
        <p className="text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {annual ? `${naira(annual.price)} a year` : ''}
          {annual && cheapest && Number(cheapest.price) < Number(annual.price)
            ? ` · or ${naira(cheapest.price)} for ${Number(cheapest.duration_days)} days`
            : ''}
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="w-full py-2 text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        >
          Not now
        </button>
      </div>
    </Modal>
  );
};

export default PremiumUpgradeModal;