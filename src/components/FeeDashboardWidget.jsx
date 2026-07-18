import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { CreditCard, CheckCircle2, Clock, AlertTriangle, ArrowRight, TrendingUp, Lock } from './Icons';
import { motion } from 'framer-motion';

const FeeDashboardWidget = () => {
  const { feeDetails, userProfile } = useAppContext();
  const navigate = useNavigate();
  const DEV_MODE =  (import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true');

  if (DEV_MODE) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden group flex items-center justify-center min-h-[250px]"
    >
      <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
        <CreditCard size={120} />
      </div>

      <div className="relative z-10 text-center">
        <div className="w-16 h-16 mx-auto bg-slate-50 dark:bg-slate-900/50 text-slate-400 rounded-2xl flex items-center justify-center mb-4">
           <Lock size={32} />
        </div>
        <h3 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">School Payments</h3>
        <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mt-2 max-w-md mx-auto">
          The official payment hub is currently undergoing security upgrades and institutional verification. 
        </p>
        <span className="inline-block mt-6 px-4 py-1.5 bg-medical-100 text-medical-700 rounded-full text-[10px] font-black uppercase tracking-widest">
          Coming Soon
        </span>
      </div>
    </motion.div>
  );
};

export default FeeDashboardWidget;
