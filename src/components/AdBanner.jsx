import React, { useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';

// Google AdSense banner — loaded ONLY for free accounts and NEVER inside a
// quiz. The page must configure VITE_ADSENSE_CLIENT (e.g. ca-pub-XXXX) plus a
// per-placement slot (passed via the `slot` prop from env at the call site).
// Without a configured client the component renders nothing, so this feature
// is safe to ship before ads are enabled.

let scriptPromise = null;
const ensureAdsScript = (client) => {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
};

const AdBanner = ({ slot = '', format = 'auto' }) => {
  const client = import.meta.env.VITE_ADSENSE_CLIENT;
  const { isPremium } = useAppContext();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!client) return;
    let active = true;
    ensureAdsScript(client).then(ok => {
      if (active && ok) setReady(true);
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (!ready || !slot) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.warn('Ad push skipped:', err);
    }
  }, [ready, slot]);

  // Hard rules: no client configured → nothing; premium/subscribed → nothing;
  // quiz running (body.quiz-active) → nothing, regardless of placement.
  if (!client) return null;
  if (isPremium) return null;
  if (typeof document !== 'undefined' && document.body.classList.contains('quiz-active')) return null;

  return (
    <div className="rounded-3xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 overflow-hidden min-h-[92px] flex items-center justify-center">
      <div className="w-full text-center py-4 px-2">
        <p className="text-[8px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-600 mb-1">Sponsored</p>
        <ins
          className="adsbygoogle"
          style={{ display: 'block' }}
          data-ad-client={client}
          data-ad-slot={slot}
          data-ad-format={format}
          data-full-width-responsive="true"
        />
      </div>
    </div>
  );
};

export default AdBanner;