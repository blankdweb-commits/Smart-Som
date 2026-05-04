import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const StickyCTA = () => {
  return (
    <div className="lg:hidden fixed bottom-6 left-4 right-4 z-50">
      <motion.button
        initial={{ y: 100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="w-full py-4 bg-teal-500 text-slate-900 font-black rounded-2xl shadow-2xl shadow-teal-500/40 flex items-center justify-center gap-2 border-2 border-white/20 active:scale-95 transition-all"
      >
        <span>Start Now — ₦1999.9/week</span>
        <div className="w-5 h-5 rounded-full bg-slate-900 flex items-center justify-center text-teal-500 text-xs">
          →
        </div>
      </motion.button>
    </div>
  );
};

export default StickyCTA;
