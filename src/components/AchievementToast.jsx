import React from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // eslint-disable-line no-unused-vars
import { Award } from './Icons';

// Lightweight celebration toast for achievements (identity unlocks, streaks,
// milestones). Fires from the top of the screen and auto-dismisses after a few
// seconds, or on tap. Props: toast { id?, emoji, title, subtitle?, tone? }.
const AchievementToast = ({ toast = null, onDismiss = null }) => {
  React.useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => { if (onDismiss) onDismiss(); }, 4000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.button
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          onClick={onDismiss}
          role="status"
          aria-live="polite"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] w-[calc(100%-2rem)] max-w-md flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-slate-800 shadow-2xl border border-slate-100 dark:border-slate-700 text-left"
        >
          <div className={`w-12 h-12 rounded-2xl ${toast.tone || 'bg-apex-600'} flex items-center justify-center text-2xl shrink-0 ${toast.tone && !toast.tone.startsWith('bg-') ? '' : ''}`}>
            {toast.emoji || <Award className="text-white" size={22} />}
          </div>
          <div className="min-w-0 flex-1">
            {toast.title && (
              <p className="font-black text-sm text-slate-900 dark:text-white leading-tight truncate">{toast.title}</p>
            )}
            {toast.subtitle && (
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium mt-0.5 line-clamp-2">{toast.subtitle}</p>
            )}
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
};

export default AchievementToast;
