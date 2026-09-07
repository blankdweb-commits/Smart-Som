import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie, X } from 'lucide-react';
import { safeGet, safeSet } from '../utils/safeStorage';

const CONSENT_KEY = 'apex_cookie_consent';

// Read the stored consent decision. `null` means "not decided yet".
const readConsent = () => {
  const raw = safeGet(CONSENT_KEY, { parsed: true });
  if (!raw || typeof raw !== 'object') return null;
  return { accepted: !!raw.accepted, at: raw.at || null };
};

const CookieConsentBanner = () => {
  const [consent, setConsent] = useState(() => readConsent());

  if (consent) return null;

  const decide = (accepted) => {
    safeSet(CONSENT_KEY, JSON.stringify({ accepted, at: new Date().toISOString() }));
    setConsent({ accepted, at: new Date().toISOString() });
  };

  return (
    <div className="fixed bottom-0 inset-x-0 z-[60]">
      <div className="mx-auto max-w-3xl mb-4 px-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex items-start gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-medical-50 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 flex items-center justify-center shrink-0">
              <Cookie size={18} />
            </div>
            <div className="sm:hidden">
              <p className="font-black text-slate-900 dark:text-white text-sm">We use local storage</p>
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <p className="hidden sm:block font-black text-slate-900 dark:text-white text-sm mb-1">
              We use local storage to remember your session and preferences
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Required items keep you signed in and secure. Functional items remember things like
              your theme, quiz sounds, and dismissed notifications. We never sell your data.
              <Link to="/legal/cookies" className="text-medical-600 dark:text-medical-400 font-semibold underline ml-1">
                Cookie &amp; Local Storage Policy
              </Link>
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => decide(false)}
              className="px-4 py-2.5 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 dark:text-slate-300 text-xs font-bold uppercase tracking-wider transition-colors"
            >
              Decline
            </button>
            <button
              onClick={() => decide(true)}
              className="px-5 py-2.5 rounded-xl bg-medical-600 hover:bg-medical-700 text-white text-xs font-bold uppercase tracking-wider transition-all active:scale-95"
            >
              Accept All
            </button>
          </div>

          <button
            onClick={() => decide(true)}
            aria-label="Accept and close"
            className="hidden sm:flex absolute top-3 right-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
