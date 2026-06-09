import React from 'react';
import { CreditCard, Clock } from './Icons';
import { motion } from 'framer-motion';

const FeeDashboardWidget = () => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-12 shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden text-center"
    >
      <div className="absolute top-0 right-0 p-8 opacity-5">
        <CreditCard size={120} />
      </div>

      <div className="relative z-10 space-y-6">
        <div className="w-20 h-20 bg-medical-50 dark:bg-medical-900/20 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8">
          <Clock size={40} />
        </div>
        <div>
          <h3 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">School Fees: Coming Soon</h3>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-lg mt-4 max-w-md mx-auto">
            Institutional payment plans are currently under maintenance. Please check back later.
          </p>
        </div>
      </div>
    </motion.div>
  );
};

export default FeeDashboardWidget;
