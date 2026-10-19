// AdminPlansTab — real pricing + promo-offer controls (migration-v100).
//
// The "Subscription Plans" tab existed but rendered the same "Advanced Ledger
// Restricted" placeholder as every other non-overview tab, and the provider
// exported `updateSubscriptionPlan: () => {}` — a no-op stub. So pricing was
// editable in theory and in nothing else. Prices could only be changed by
// hand-running SQL against the database.
//
// Every write goes through a SECURITY DEFINER RPC that re-checks `is_admin()`
// and writes `admin_audit_log`. This UI is a convenience over those RPCs, not a
// second path to the data: the constraints and the validations live in SQL, so
// a hand-crafted request from a browser cannot set a price the form would have
// refused. The client-side checks below exist to give an admin a readable error
// before a round trip, never as the enforcement.
//
// The offer ships INACTIVE with no dates, so this form must be able to express
// "on, no deadline" as well as a window — and must never let an admin save a
// window that has already elapsed, because that produces an offer that is
// advertised as running and is dead on arrival.
import React, { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import { X, CheckCircle2, AlertCircle } from '../components/Icons';

// <input type="datetime-local"> speaks local wall time; the RPC speaks UTC.
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

const AdminPlansTab = () => {
  const { subscriptionPlans, premiumOffer, fetchPremiumOffer } = useAppContext();
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [offer, setOffer] = useState({
    enabled: false,
    starts_at: '',
    ends_at: '',
    headline: '',
    subline: '',
  });

  // Server is the source of truth for the offer; seed the form from it.
  useEffect(() => {
    setOffer({
      enabled: premiumOffer?.enabled === true,
      starts_at: toLocalInput(premiumOffer?.starts_at),
      ends_at: toLocalInput(premiumOffer?.ends_at),
      headline: premiumOffer?.headline || '',
      subline: premiumOffer?.subline || '',
    });
  }, [premiumOffer?.enabled, premiumOffer?.starts_at, premiumOffer?.ends_at, premiumOffer?.headline, premiumOffer?.subline]);

  const draftFor = (plan) => drafts[plan.id] || {
    price: String(plan.price ?? ''),
    reference_price: plan.reference_price == null ? '' : String(plan.reference_price),
  };
  // Takes the PLAN (not an id) so the untouched half of the draft is seeded from
  // the server row; keying off a bare id would write `{price: undefined}` over a
  // field the admin was not editing.
  const setDraft = (plan, patch) =>
    setDrafts((d) => ({ ...d, [plan.id]: { ...draftFor(plan), ...patch } }));

  const flash = useCallback((message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 6000);
  }, []);

  // ---- Plan pricing -------------------------------------------------------
  const savePricing = async (plan) => {
    const d = draftFor(plan);
    const price = Number(d.price);
    const refRaw = d.reference_price;
    const reference = refRaw === '' ? null : Number(refRaw);

    if (!Number.isFinite(price) || price < 0) {
      flash('Price must be zero or greater.', 'error');
      return;
    }
    if (reference !== null) {
      if (!Number.isFinite(reference) || reference < 0) {
        flash('Reference price must be zero or greater.', 'error');
        return;
      }
      if (reference <= price) {
        flash('A reference price must be HIGHER than the price it discounts, or leave it empty.', 'error');
        return;
      }
    }

    const key = `pricing:${plan.id}`;
    setBusy(key);
    try {
      const { data, error } = await supabase.rpc('admin_set_plan_pricing', {
        p_plan_id: plan.id,
        p_price: price,
        p_reference_price: reference,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.code || 'Refused');
      flash(`Saved ${plan.name}.`, 'success');
      setDrafts((prev) => { const n = { ...prev }; delete n[plan.id]; return n; });
    } catch (err) {
      flash(`Could not save: ${err.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  // ---- Promo offer --------------------------------------------------------
  const saveOffer = async () => {
    const starts_at = fromLocalInput(offer.starts_at);
    const ends_at = fromLocalInput(offer.ends_at);

    // Mirror of the SQL guards, for a readable message. The RPC re-checks all
    // of these regardless.
    if (offer.enabled && (!starts_at || !ends_at)) {
      flash('An active offer needs both a start and an end.', 'error');
      return;
    }
    if (offer.enabled && starts_at && ends_at && new Date(ends_at) <= new Date(starts_at)) {
      flash('The offer must end after it starts.', 'error');
      return;
    }
    if (offer.enabled && ends_at && new Date(ends_at).getTime() <= Date.now()) {
      flash('That end time is in the past, so the offer would never be active.', 'error');
      return;
    }

    setBusy('offer');
    try {
      const { data, error } = await supabase.rpc('admin_set_premium_offer', {
        p_enabled: offer.enabled,
        p_starts_at: starts_at,
        p_ends_at: ends_at,
        p_headline: offer.headline.trim() || null,
        p_subline: offer.subline.trim() || null,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.message || data?.code || 'Refused');
      flash(`Offer ${offer.enabled ? 'enabled' : 'disabled'}.`, 'success');
      await fetchPremiumOffer();
    } catch (err) {
      flash(`Could not save offer: ${err.message}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const offerState = premiumOffer?.state || 'inactive';

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {toast && (
        <div className={`flex items-start gap-2 p-3 rounded-xl border text-sm font-bold ${
          toast.type === 'error'
            ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
            : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
        }`}>
          {toast.type === 'error' ? <AlertCircle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
          <span className="flex-1">{toast.message}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      {/* ---- Offer ---- */}
      <div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-xl font-black uppercase tracking-tight">Promo Offer</h3>
          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
            offerState === 'active'
              ? 'bg-emerald-500 text-white'
              : offerState === 'scheduled'
                ? 'bg-amber-500 text-white'
                : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
          }`}>
            {offerState}
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4 max-w-2xl">
          Turns on promo pricing for the Student plans. While the offer is off,
          those plans still sell at their own price — no strikethrough reference
          is shown anywhere. Leave the dates empty and it runs open-ended.
        </p>

        <div className="space-y-4 p-5 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={offer.enabled}
              onChange={(e) => setOffer((o) => ({ ...o, enabled: e.target.checked }))}
              className="w-4 h-4 accent-medical-600"
            />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
              Offer is live
            </span>
          </label>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Starts</span>
              <input
                type="datetime-local"
                value={offer.starts_at}
                onChange={(e) => setOffer((o) => ({ ...o, starts_at: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Ends</span>
              <input
                type="datetime-local"
                value={offer.ends_at}
                onChange={(e) => setOffer((o) => ({ ...o, ends_at: e.target.value }))}
                className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Headline</span>
            <input
              type="text"
              value={offer.headline}
              maxLength={80}
              placeholder="Student promo pricing"
              onChange={(e) => setOffer((o) => ({ ...o, headline: e.target.value }))}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Subline</span>
            <input
              type="text"
              value={offer.subline}
              maxLength={140}
              placeholder="Optional supporting line"
              onChange={(e) => setOffer((o) => ({ ...o, subline: e.target.value }))}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
            />
          </label>

          <button
            type="button"
            onClick={saveOffer}
            disabled={busy === 'offer'}
            className="px-5 py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 text-white font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
          >
            {busy === 'offer' ? 'Saving…' : 'Save offer'}
          </button>
        </div>
      </div>

      {/* ---- Plans ---- */}
      <div>
        <h3 className="text-xl font-black uppercase tracking-tight mb-1">Plan Pricing</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 max-w-2xl">
          A <span className="font-bold">reference price</span> is the struck-through
          "was" figure. It must be higher than the price, and it should be the real
          cost of the same duration — a 7-day promo references the weekly plan, a
          30-day promo references the monthly one. Leave it empty for no strikethrough.
        </p>

        <div className="space-y-3">
          {subscriptionPlans.map((plan) => {
            const d = draftFor(plan);
            const key = `pricing:${plan.id}`;
            return (
              <div key={plan.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[160px]">
                  <p className="font-black text-sm text-slate-800 dark:text-slate-100">{plan.name}</p>
                  <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">
                    {plan.duration_days} days · order {plan.sort_order ?? 100}
                    {plan.offer_eligible ? ' · promo-eligible' : ''}
                  </p>
                </div>

                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Price (₦)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={d.price}
                    onChange={(e) => setDraft(plan, { price: e.target.value })}
                    className="mt-1 w-32 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </label>

                <label className="block">
                  <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">Reference (₦)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="none"
                    value={d.reference_price}
                    onChange={(e) => setDraft(plan, { reference_price: e.target.value })}
                    className="mt-1 w-32 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm"
                  />
                </label>

                <button
                  type="button"
                  onClick={() => savePricing(plan)}
                  disabled={busy === key}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white font-black uppercase tracking-widest text-[10px] disabled:opacity-50"
                >
                  {busy === key ? '…' : 'Save'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AdminPlansTab;