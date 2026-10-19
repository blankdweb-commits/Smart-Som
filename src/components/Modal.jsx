// Modal — the shared overlay primitive.
//
// This app had no Modal: every overlay was bespoke, and `PlayerSheet.jsx` records
// the consequence — "No existing overlay in this app does either" (Escape, Tab
// trap). `AchievementCelebration.jsx` added body-scroll locking on its own. Four
// separate implementations meant a new upgrade prompt would have been the fifth,
// each with a slightly different set of the same three behaviours.
//
// This primitive gathers the ones that already exist in the codebase rather than
// inventing new ones:
//
//   * Escape closes and Tab is trapped  — PlayerSheet.jsx:105-124, verbatim
//     approach (the focusable query and the first/last wrap are the same).
//   * Body scroll is locked while open and ALWAYS restored, including when the
//     modal is torn down mid-open — AchievementCelebration.jsx:88-93.
//
//   * `role="dialog" aria-modal="true"`, `tabIndex={-1}`, backdrop as a
//     separate element — PlayerSheet.jsx:161-168.
//
// Escape is OPT-OUT via `dismissible={false}`. The anonymous-room 18+ gate sets
// that: a gate that can be dismissed with Escape is not a gate (that file builds
// its own raw dialog for exactly this reason).
import React, { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * @param {boolean} isOpen
 * @param {Function} onClose
 * @param {boolean} [dismissible=true] false ⇒ Escape AND the backdrop are inert.
 * @param {boolean} [lockScroll=true]
 * @param {string}  [label] accessible name for the dialog.
 * @param {string}  [panelClassName] extra classes on the panel.
 * @param {'center'|'bottom'} [variant='center']
 */
const Modal = ({
  isOpen,
  onClose,
  children,
  dismissible = true,
  lockScroll = true,
  label,
  panelClassName = '',
  variant = 'center',
}) => {
  const panelRef = useRef(null);

  // Body scroll lock. The previous value is captured on open and restored on
  // cleanup, so nesting (or a close that races an unmount) cannot leave the
  // document permanently unscrollable.
  useEffect(() => {
    if (!isOpen || !lockScroll) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen, lockScroll]);

  const requestClose = useCallback(() => {
    if (dismissible) onClose?.();
  }, [dismissible, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (!dismissible) return;
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll(FOCUSABLE);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, dismissible, onClose]);

  if (!isOpen) return null;

  const centered = variant === 'center';

  return (
    <div
      className={`fixed inset-0 z-[100] role="presentation" ${
        centered
          ? 'flex items-center justify-center p-4'
          : 'flex items-end sm:items-center sm:justify-center p-0 sm:p-4'
      }`}
    >
      <div
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`relative w-full ${
          centered ? 'max-w-md' : 'max-w-md rounded-t-[2rem] sm:rounded-[2rem]'
        } bg-white dark:bg-slate-800 shadow-2xl border border-slate-100 dark:border-slate-700 ${
          centered ? 'rounded-3xl' : ''
        } max-h-[90vh] overflow-y-auto outline-none ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
};

export default Modal;