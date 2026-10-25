import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import { Lock, Loader2 } from './Icons';

const onlyDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 6);

const PinField = ({ label, value, onChange, autoFocus = false }) => (
  <label className="block">
    <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
      {label}
    </span>
    <input
      type="password"
      inputMode="numeric"
      autoComplete="off"
      autoFocus={autoFocus}
      maxLength={6}
      value={value}
      onChange={(e) => onChange(onlyDigits(e.target.value))}
      placeholder="••••••"
      className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center text-2xl font-black tracking-[0.45em] text-slate-900 focus:border-polynurse-400 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
    />
  </label>
);

const WalletPinDialog = ({
  isOpen,
  mode = 'unlock',
  busy = false,
  error = null,
  lockedForSeconds = 0,
  onClose,
  onSubmit,
  onForgot,
}) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setPin('');
    setConfirmPin('');
    setCurrentPin('');
  }, [isOpen, mode]);

  const title = {
    setup: 'Create your wallet PIN',
    unlock: 'Unlock your wallet',
    change: 'Change wallet PIN',
    reset: 'Reset wallet PIN',
  }[mode] || 'Wallet PIN';

  const submitLabel = {
    setup: 'Create PIN',
    unlock: 'Unlock',
    change: 'Change PIN',
    reset: 'Reset PIN',
  }[mode] || 'Continue';

  const needsConfirm = mode !== 'unlock';
  const isLocked = mode === 'unlock' && lockedForSeconds > 0;
  const valid = pin.length === 6
    && (!needsConfirm || confirmPin.length === 6)
    && (mode !== 'change' || currentPin.length === 6);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!valid || busy || isLocked) return;
    onSubmit?.({ pin, confirmPin, currentPin });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} label={title}>
      <form onSubmit={handleSubmit} className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-polynurse-100 text-polynurse-700 dark:bg-polynurse-900/40 dark:text-polynurse-300">
            <Lock size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-white">{title}</h2>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
              {mode === 'setup' && 'You will use this PIN for transfers and World Bank actions.'}
              {mode === 'unlock' && 'Your PIN stays in memory on this page only.'}
              {mode === 'change' && 'Confirm your current PIN, then choose a new one.'}
              {mode === 'reset' && 'Use the email reset link, then choose a new PIN.'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {mode === 'change' && (
            <PinField label="Current PIN" value={currentPin} onChange={setCurrentPin} autoFocus />
          )}
          <PinField
            label={mode === 'setup' ? 'New PIN' : mode === 'change' || mode === 'reset' ? 'New PIN' : 'Wallet PIN'}
            value={pin}
            onChange={setPin}
            autoFocus={mode !== 'change'}
          />
          {needsConfirm && <PinField label="Confirm PIN" value={confirmPin} onChange={setConfirmPin} />}
        </div>

        {isLocked && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700 dark:bg-amber-900/20 dark:text-amber-300">
            Too many wrong attempts. Try again in {Math.ceil(lockedForSeconds / 60)} min.
          </p>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!valid || busy || isLocked}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-polynurse-700 px-4 py-3 text-xs font-black uppercase tracking-widest text-white transition active:scale-[0.99] disabled:opacity-40"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? 'Checking…' : submitLabel}
        </button>

        {mode === 'unlock' && (
          <button
            type="button"
            onClick={onForgot}
            className="mt-3 w-full text-center text-[11px] font-black uppercase tracking-widest text-slate-500 hover:text-polynurse-700 dark:text-slate-400 dark:hover:text-polynurse-300"
          >
            Forgot PIN? Send a reset link
          </button>
        )}

        {mode !== 'setup' && mode !== 'reset' && (
          <button
            type="button"
            onClick={onClose}
            className="mt-2 w-full text-center text-[11px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            Cancel
          </button>
        )}
      </form>
    </Modal>
  );
};

export default WalletPinDialog;
