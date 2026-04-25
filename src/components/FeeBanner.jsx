import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { CreditCard, ArrowRight, AlertTriangle, CheckCircle2 } from './Icons';
import { motion, AnimatePresence } from 'framer-motion';

const FeeBanner = () => {
  const { feeDetails, userProfile } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();

  // Don't show if already paid or on certain pages
  const isDashboard = location.pathname === '/';
  const isSettings = location.pathname === '/settings';
  const isPayments = location.pathname === '/payments';

  if (feeDetails.status === 'Paid' && !isDashboard) return null;
  if (isPayments) return null;

  const balance = feeDetails.totalFee - feeDetails.amountPaid;
  const percentage = Math.round((feeDetails.amountPaid / feeDetails.totalFee) * 100);

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      className="bg-medical-600 dark:bg-medical-700 text-white overflow-hidden sticky top-[61px] z-30 shadow-lg"
    >
      <div className="max-w-7xl mx-auto px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="hidden sm:flex w-8 h-8 bg-white/20 rounded-lg items-center justify-center shrink-0">
            {feeDetails.status === 'Overdue' ? <AlertTriangle size={18} className="text-amber-300" /> : <CreditCard size={18} />}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-0 sm:gap-3 overflow-hidden">
            <span className="text-[10px] sm:text-xs font-black uppercase tracking-widest whitespace-nowrap">
              School Fees: {percentage}% Paid
            </span>
            <div className="hidden md:block w-32 h-1.5 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-white"
                initial={{ width: 0 }}
                animate={{ width: `${percentage}%` }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
            </div>
            <span className="text-[11px] font-bold opacity-90 truncate">
              Balance: {feeDetails.currency} {balance.toLocaleString()}
            </span>
          </div>
        </div>

        <button
          onClick={() => navigate('/payments')}
          className="px-4 py-1.5 bg-white text-medical-600 rounded-full text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-colors shadow-sm active:scale-95 shrink-0 flex items-center gap-1"
        >
          {feeDetails.status === 'Paid' ? 'View Receipt' : 'Pay Now'}
          <ArrowRight size={12} />
        </button>
      </div>
    </motion.div>
  );
};

export default FeeBanner;
