// ConsentManager — cookie / local-storage consent for PolyNurse.
//
// Replaces CookieConsentBanner.jsx. Mounted once at the app root (App.jsx).
//
// Design decisions, each tied to a requirement:
//
//   * Obstructing (NDPC GAID 2025 Art. 7(l)) — the notice must significantly
//     obstruct the middle / left / right of the homepage; a bottom banner is
//     explicitly insufficient. This renders as a centred Modal over a backdrop,
//     so it cannot be overlooked.
//   * No dismiss-by-close — Escape and the backdrop are inert
//     (Modal `dismissible={false}`). The only way out is an explicit affirmative
//     action: Accept All, Reject Optional, or saving customised choices.
//   * Per-category, nothing preselected (FCCPC Reg. 4 — guidance; exposure draft):
//     Strictly Necessary is informational/always on; Preferences, Analytics,
//     Marketing default to OFF. Rejection is as easy as acceptance (two equal
//     bulk buttons).
//   * Persistent control — Settings opens this same manager again
//     ("Cookie & privacy preferences"), so the user can change/withdraw later.
//   * Single source of truth — useCookieConsent owns the localStorage record
//     {version, timestamp, categories, source}; cross-tab changes sync via the
//     `storage` event. No second consent record is ever written.
//   * Accessible — role=dialog/aria-modal via Modal, role=switch toggles with
//     aria-checked, one bounded polite status announcement (no chatty live
//     updates), focus trapped and restored by Modal.
//
// Hook-safety note: ConsentManager always runs its hooks; ConsentDialog runs
// all of its hooks unconditionally whenever it is rendered. The conditional
// show/hide happens by rendering or not rendering ConsentDialog, never by
// skipping hooks inside a component.

import React, { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import { useCookieConsent } from '../hooks/useCookieConsent';
import { useConsentUI } from '../context/ConsentUIContext';
import { CATEGORIES, categoryById } from '../config/cookieManifest';

const ConsentManager = () => {
  const { hasDecided } = useCookieConsent();
  const { isOpen: uiOpen } = useConsentUI();
  if (!hasDecided && !uiOpen) return null;
  return <ConsentDialog forceOpen={uiOpen} />;
};

const ConsentDialog = ({ forceOpen = false }) => {
  const { granted, grantCategory, acceptAll, rejectOptional } = useCookieConsent();
  const { setIsOpen: setUiOpen } = useConsentUI();
  const [status, setStatus] = useState(null); // {message, kind}

  // One bounded, polite announcement per decision — never chatty.
  useEffect(() => {
    if (!status) return undefined;
    const t = setTimeout(() => setStatus(null), 3000);
    return () => clearTimeout(t);
  }, [status]);

  const toggle = useCallback(
    (id) => {
      grantCategory(id, !granted(id));
      setStatus({ message: categoryById(id).label + ' ' + (!granted(id) ? 'allowed' : 'not allowed'), kind: 'info' });
    },
    [grantCategory, granted]
  );

  const handleAcceptAll = useCallback(() => {
    acceptAll();
    setStatus({ message: 'All categories allowed.', kind: 'success' });
  }, [acceptAll]);

  const handleRejectOptional = useCallback(() => {
    rejectOptional();
    setStatus({ message: 'Optional technologies turned off.', kind: 'success' });
  }, [rejectOptional]);

  const necessary = categoryById('necessary');
  const optional = CATEGORIES.filter((c) => c.optional);

  const closePreferences = () => {
    setUiOpen(false);
  };

  return (
    <Modal
      isOpen
      dismissible={false}
      lockScroll
      label="Cookie and local-storage consent"
      panelClassName="max-w-lg p-6"
      onClose={closePreferences}
    >
      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <span className="w-10 h-10 rounded-xl bg-medical-100 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" className="w-5 h-5"><circle cx="12" cy="12" r="10"/><path d="M12 2v20m0-20h20"/></svg>
          </span>
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">Cookie &amp; local-storage consent</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
              PolyNurse stores session, theme and preference data in your browser
              (localStorage). Required items keep you signed in and secure.
              Optional items remember your preferences and — only if you allow it —
              show non-intrusive ads on the Dashboard, Community and Voting pages.
              Ads never appear during a quiz. You can change this at any time in
              Settings &rarr; Cookie &amp; privacy preferences.
            </p>
          </div>
        </div>

        {status && (
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-lg ${
              status.kind === 'success' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
            }`}
          >
            {status.message}
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
            <span className="text-sm font-bold text-slate-900 dark:text-white">{necessary.label}</span>
            <span className="text-[10px] font-black text-slate-400">Always on</span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">{necessary.description}</p>

          {optional.map((cat) => (
            <div
              key={cat.id}
              className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 last:border-0"
            >
              <div className="flex-1 space-y-1">
                <label
                  className="flex items-center gap-2 cursor-pointer select-none"
                  onClick={() => toggle(cat.id)}
                >
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{cat.label}</span>
                </label>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{cat.description}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={granted(cat.id)}
                aria-label={cat.label + (granted(cat.id) ? ', on' : ', off')}
                onClick={() => toggle(cat.id)}
                className={`shrink-0 w-11 h-6 rounded-full transition-colors relative ${granted(cat.id) ? 'bg-medical-600' : 'bg-slate-300 dark:bg-slate-600'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${granted(cat.id) ? 'translate-x-5' : ''}`}
                  aria-hidden="true"
                />
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-2">
          Required items are always on. Turning off Advertising &amp; marketing
          blocks AdSense entirely; no ad script runs on your device.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 mt-4">
          {forceOpen ? (
            <button
              type="button"
              onClick={closePreferences}
              className="flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleRejectOptional}
                className="flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                Reject optional
              </button>
              <button
                type="button"
                onClick={handleAcceptAll}
                className="flex-1 py-3 rounded-xl font-black uppercase tracking-widest text-[10px] bg-medical-600 hover:bg-medical-700 text-white transition-colors active:scale-95"
              >
                Accept all
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ConsentManager;
