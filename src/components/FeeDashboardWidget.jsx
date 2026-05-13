import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { CreditCard, CheckCircle2, Clock, AlertTriangle, ArrowRight, TrendingUp } from './Icons';
import { motion } from 'framer-motion';

const FeeDashboardWidget = () => {
  const { feeDetails, userProfile } = useAppContext();
  const navigate = useNavigate();

  const balance = feeDetails.totalFee - feeDetails.amountPaid;
  const percentage = Math.round((feeDetails.amountPaid / feeDetails.totalFee) * 100);

  const getStatusColor = () => {
    if (feeDetails.status === 'Paid') return 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20';
    if (feeDetails.status === 'Partial') return 'text-amber-500 bg-amber-50 dark:bg-amber-900/20';
    if (feeDetails.status === 'Overdue') return 'text-red-500 bg-red-50 dark:bg-red-900/20';
    return 'text-slate-500 bg-slate-50 dark:bg-slate-900/20';
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden group"
    >
      <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
        <CreditCard size={120} />
      </div>

      <div className="relative z-10">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">School Payments</h3>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mt-1">{feeDetails.pendingItems} Pending Charges</p>
          </div>
          <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${getStatusColor()}`}>
            {feeDetails.status}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div className="space-y-6">
            <div className="flex items-end gap-2">
              <span className="text-4xl font-black text-slate-900 dark:text-white">
                {feeDetails.currency} {(feeDetails.totalFee - feeDetails.amountPaid).toLocaleString()}
              </span>
              <span className="text-slate-400 font-bold text-sm mb-1 uppercase tracking-widest">Balance</span>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                <span>Payment Progress</span>
                <span>{percentage}%</span>
              </div>
              <div className="w-full h-4 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden p-1">
                <motion.div
                  className="h-full bg-medical-500 rounded-full shadow-sm"
                  initial={{ width: 0 }}
                  animate={{ width: `${percentage}%` }}
                  transition={{ duration: 1.5, ease: "circOut" }}
                />
              </div>
            </div>

            <div className="flex gap-4">
              <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-800">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Due</p>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{feeDetails.currency} {feeDetails.totalFee.toLocaleString()}</p>
              </div>
              <div className="flex-1 p-4 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-800">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Paid</p>
                <p className="text-sm font-bold text-emerald-600">{feeDetails.currency} {feeDetails.amountPaid.toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-4 text-sm font-medium text-slate-600 dark:text-slate-400">
              <div className="w-10 h-10 bg-blue-50 dark:bg-blue-900/20 text-blue-500 rounded-xl flex items-center justify-center shrink-0">
                <Clock size={20} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</p>
                <p className="text-slate-900 dark:text-white font-bold">Official Payment Hub</p>
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm font-medium text-slate-600 dark:text-slate-400">
              <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-500 rounded-xl flex items-center justify-center shrink-0">
                <TrendingUp size={20} />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Installment Plan</p>
                <p className="text-slate-900 dark:text-white font-bold">Flexible Options Available</p>
              </div>
            </div>

            <button
              onClick={() => navigate('/payments')}
              className="w-full mt-4 py-4 bg-medical-600 hover:bg-medical-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-600/20 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              Make Payment
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default FeeDashboardWidget;
