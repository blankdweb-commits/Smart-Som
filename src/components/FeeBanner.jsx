import React from 'react';
import { useLocation } from 'react-router-dom';
import { CreditCard, Clock } from './Icons';
import { motion } from 'framer-motion';

const FeeBanner = () => {
  const location = useLocation();
  const isPayments = location.pathname === '/payments';

  if (isPayments) return null;

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      className="bg-medical-600 dark:bg-medical-700 text-white overflow-hidden sticky top-[61px] z-30 shadow-lg"
    >
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex w-8 h-8 bg-white/20 rounded-lg items-center justify-center shrink-0">
            <Clock size={18} />
          </div>
          <div>
            <p className="text-[10px] sm:text-xs font-black uppercase tracking-widest leading-tight">
              School Fees: Coming Soon
            </p>
            <p className="text-[9px] sm:text-[10px] font-bold opacity-80 leading-tight">
              Institutional payment plans are currently under maintenance.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default FeeBanner;
