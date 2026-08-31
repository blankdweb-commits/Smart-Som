import React from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles } from './Icons';

// Full-screen celebratory unlock shown the first time a user reaches a new
// identity tier. Props: identity (from identities.js), onClose.
const IdentityUnlockModal = ({ identity = null, onClose }) => {
  if (!identity) return null;
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
        role="dialog"
        aria-modal="true"
        aria-label={`New identity unlocked: ${identity.name}`}
      >
        <motion.div
          initial={{ scale: 0.85, y: 30, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.9, y: 20, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
          className="relative w-full max-w-md bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 text-center shadow-2xl"
        >
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            <X size={20} />
          </button>

          <div className="flex items-center justify-center gap-2 mb-3">
            <Sparkles className="text-amber-400" size={20} />
            <p className="text-[10px] font-black text-amber-500 uppercase tracking-[0.25em]">Identity Unlocked</p>
          </div>

          <div className={`w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br ${identity.color} flex items-center justify-center text-6xl shadow-xl mb-5`}>
            <span aria-hidden>{identity.emoji}</span>
          </div>

          <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2">{identity.name}</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium italic">{identity.tagline}</p>

          <button
            onClick={onClose}
            className="mt-7 w-full px-6 py-3.5 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-[11px] hover:bg-apex-700 transition-all active:scale-95"
          >
            Continue the Mission
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default IdentityUnlockModal;
