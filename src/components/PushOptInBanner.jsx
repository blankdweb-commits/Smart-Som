import React, { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { BellRing, BellOff } from 'lucide-react';
import { Loader2, XCircle } from './Icons';
import {
  isPushSupported,
  isIosWebPush,
  isStandalonePwa,
  subscribeToPush,
  wasPrompted,
  markPrompted,
} from '../utils/notifications';

// One-time "enable push" banner shown on the Dashboard for push-capable
// browsers that haven't opted in yet. Fires the native permission pop-up only
// when the user taps the button (no surprise prompts on page load).
const PushOptInBanner = () => {
  const { session } = useAppContext();
  const [phase, setPhase] = useState('idle'); // idle | working | done | blocked
  const [message, setMessage] = useState('');
  const [dismissed, setDismissed] = useState(() => wasPrompted());

  if (dismissed || phase === 'done') return null;

  // iOS: Web Push only works after the app is added to the Home Screen.
  const supported = isPushSupported() && (!isIosWebPush() || isStandalonePwa());

  const enable = async () => {
    setPhase('working');
    setMessage('Requesting permission…');
    const result = await subscribeToPush(session);
    if (result.state === 'subscribed') {
      setPhase('done');
      markPrompted();
    } else if (result.state === 'blocked') {
      setPhase('blocked');
      setMessage('Notifications are blocked in your browser settings. Enable them there, then try again.');
    } else if (result.state === 'skipped') {
      setPhase('idle');
      markPrompted();
    } else {
      setPhase('blocked');
      setMessage(result.error || 'Could not enable notifications right now.');
    }
  };

  if (!supported) {
    if (!isPushSupported()) return null;
    // iOS browser, not installed -> hint, but do NOT nag on every visit.
    if (wasPrompted()) return null;
    return (
      <div className="mb-6 p-4 rounded-2xl border border-polynurse-200 bg-polynurse-50/60 dark:bg-slate-800 dark:border-slate-700 flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-polynurse-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
          <BellOff size={18} className="text-polynurse-700 dark:text-polynurse-300" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-black text-slate-800 dark:text-white">Get push reminders</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
            To receive notifications here, add Polynurse to your Home Screen (Share → “Add to Home Screen”), then open the app from there.
          </p>
        </div>
        <button onClick={() => { setDismissed(true); markPrompted(); }} aria-label="Dismiss" className="text-slate-300 hover:text-slate-500 p-1 shrink-0">
          <XCircle size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 p-4 rounded-2xl border border-polynurse-200 bg-polynurse-50/60 dark:bg-slate-800 dark:border-slate-700 flex items-start gap-3">
      <div className="w-9 h-9 rounded-xl bg-polynurse-100 dark:bg-slate-700 flex items-center justify-center shrink-0">
        {phase === 'blocked' ? (
          <XCircle size={18} className="text-red-500" />
        ) : phase === 'working' ? (
          <Loader2 size={18} className="text-polynurse-600 animate-spin" />
        ) : (
          <BellRing size={18} className="text-polynurse-600 dark:text-polynurse-300" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-black text-slate-800 dark:text-white">
          {phase === 'blocked' ? 'Notifications unavailable' : 'Get push reminders'}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5">
          {phase === 'blocked'
            ? message
            : 'Streak alerts, exam countdowns, daily challenges and achievements — right on your phone, even when the app is closed.'}
        </p>
        {phase === 'idle' && (
          <button
            onClick={enable}
            className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-polynurse-600 hover:bg-polynurse-700 text-white rounded-xl font-black text-xs uppercase tracking-widest"
          >
            <BellRing size={14} /> Enable notifications
          </button>
        )}
      </div>
      <button onClick={() => { if (phase !== 'working') { setDismissed(true); markPrompted(); } }} aria-label="Dismiss" className="text-slate-300 hover:text-slate-500 p-1 shrink-0">
        <XCircle size={16} />
      </button>
    </div>
  );
};

export default PushOptInBanner;