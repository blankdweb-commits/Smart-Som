import React from 'react';
import { motion } from 'framer-motion';
import { Rocket, Clock, ChevronLeft } from './Icons';
import { useNavigate } from 'react-router-dom';

const ComingSoon = ({ title, description }) => {
  const navigate = useNavigate();

  return (
    <div className="min-h-[80vh] flex flex-col items-center justify-center p-6 text-center">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="w-24 h-24 bg-indigo-100 dark:bg-indigo-900/30 rounded-[2rem] flex items-center justify-center text-indigo-600 dark:text-indigo-400 mb-8 shadow-2xl shadow-indigo-500/20"
      >
        <Rocket size={48} />
      </motion.div>

      <motion.h2
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
        className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white uppercase tracking-tighter mb-4"
      >
        {title || "Protocol Under Development"}
      </motion.h2>

      <motion.p
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="text-slate-500 dark:text-slate-400 font-medium max-w-md mb-12 leading-relaxed"
      >
        {description || "Our Clinical Engineering team is finalizing this module. Expected deployment in the next development cycle."}
      </motion.p>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex-1 py-4 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-2xl font-black uppercase text-[10px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2"
        >
          <ChevronLeft size={16} /> Return to Dashboard
        </button>
        <div className="flex-1 py-4 bg-indigo-50 dark:bg-indigo-900/10 text-indigo-600 dark:text-indigo-400 rounded-2xl font-black uppercase text-[10px] flex items-center justify-center gap-2 border border-indigo-100 dark:border-indigo-900/20">
          <Clock size={16} /> Coming Soon
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="mt-16 pt-8 border-t border-slate-100 dark:border-slate-800 w-full max-w-xs"
      >
        <p className="text-[10px] font-black uppercase text-slate-400 tracking-[0.3em]">Apex Scholars Research Lab</p>
      </motion.div>
    </div>
  );
};

export default ComingSoon;
