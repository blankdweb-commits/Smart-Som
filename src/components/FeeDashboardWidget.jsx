import React from 'react';
import { CreditCard } from './Icons';
import { motion } from 'framer-motion';

const FeeDashboardWidget = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden group min-h-[300px] flex items-center justify-center text-center"
    >
      <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
        <CreditCard size={120} />
      </div>

      <div className="relative z-10 max-w-sm">
        <div className="w-16 h-16 bg-medical-50 dark:bg-medical-900/30 text-medical-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-inner">
           <CreditCard size={32} />
        </div>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight uppercase mb-3">Coming Soon</h3>
        <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
          This feature is currently undergoing enhancement to provide a better experience.
        </p>
        <p className="text-slate-400 dark:text-slate-500 text-xs mt-4 font-bold italic">
          Please check back in future updates.
        </p>
      </div>
    </motion.div>
  );
};

export default FeeDashboardWidget;