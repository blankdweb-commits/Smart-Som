import React, { useCallback, useEffect, useState } from 'react';
import { Bell, X } from './Icons';
import { pushSupported, getPushState, enablePush } from '../utils/push';

// One-time, dismissible prompt that asks the signed-in user to enable Web Push.
// It is a REAL user gesture path into enablePush (browsers reject a permission
// request that is not triggered by a tap). Dismissal is remembered per device.
const DISMISS_KEY = 'apex:pushOptInDismissed';

const PushOptInBanner = ({ session }) => {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    let active = true;
    if (!session?.user || !pushSupported()) return () => { active = false; };
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS_KEY) === '1'; } catch { dismissed = false; }
    if (dismissed) return () => { active = false; };
    getPushState().then((state) => {
      if (!active) return;
      // Nothing to ask if already subscribed or the user has hard-denied.
      if (state.supported && !state.subscribed && state.permission !== 'denied') setVisible(true);
    });
    return () => { active = false; };
  }, [session]);

  const dismiss = useCallback(() => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable */ }
  }, []);

  const enable = useCallback(async () => {
    setBusy(true);
    setNote('');
    const res = await enablePush(session);
    setBusy(false);
    if (res.ok) {
      setVisible(false);
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage unavailable */ }
      return;
    }
    if (res.reason === 'denied') { setNote('Notifications are blocked in your browser settings.'); return; }
    if (res.reason === 'not_configured') { setNote('Push is not configured on this server yet.'); return; }
    setNote('We could not enable notifications. Please try again.');
  }, [session]);

  if (!visible) return null;

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-polynurse-200 dark:border-polynurse-800 bg-gradient-to-r from-polynurse-600 to-polynurse-800 p-5 sm:p-6 text-white shadow-xl">
      <button onClick={dismiss} aria-label="Dismiss" className="absolute right-4 top-4 p-1.5 rounded-full bg-white/15 hover:bg-white/25 transition-colors">
        <X size={16} />
      </button>
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-2xl bg-white/15 shrink-0">
          <Bell size={22} />
        </div>
        <div className="min-w-0">
          <p className="font-black text-sm sm:text-base tracking-tight">Turn on notifications</p>
          <p className="text-xs sm:text-sm text-white/80 mt-0.5">
            Get notified the moment someone replies to you, mentions you, or joins your anonymous room — even when the app is closed.
          </p>
          {note && <p className="text-[11px] font-semibold text-amber-200 mt-1">{note}</p>}
          <div className="flex flex-wrap gap-2 mt-3">
            <button onClick={enable} disabled={busy}
              className="px-4 py-2 rounded-full bg-white text-polynurse-700 text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-60">
              {busy ? 'Enabling…' : 'Enable notifications'}
            </button>
            <button onClick={dismiss} className="px-4 py-2 rounded-full bg-white/10 text-white text-xs font-black uppercase tracking-widest hover:bg-white/20 active:scale-95 transition-all">
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PushOptInBanner;
