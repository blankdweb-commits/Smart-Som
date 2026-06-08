import React from 'react';
import { motion } from 'framer-motion';
import {
  CreditCard,
  AlertTriangle,
  Settings,
  ArrowLeft,
  Clock,
  ShieldCheck
} from '../components/Icons';
import { useNavigate } from 'react-router-dom';

const Payments = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="flex justify-between items-center mb-8 sm:mb-12">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/dashboard')}
            className="w-10 h-10 sm:w-12 sm:h-12 bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 active:scale-95 transition-all"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
              Payments
            </h1>
            <p className="text-xs sm:text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">Financial Management</p>
          </div>
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-slate-800 rounded-[2.5rem] sm:rounded-[3rem] p-8 sm:p-16 shadow-clinical border border-slate-100 dark:border-slate-700 text-center relative overflow-hidden"
      >
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-medical-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 space-y-8">
          <div className="w-24 h-24 sm:w-32 sm:h-32 bg-amber-50 dark:bg-amber-900/20 text-amber-500 rounded-[2rem] sm:rounded-[2.5rem] flex items-center justify-center mx-auto shadow-sm border border-amber-100 dark:border-amber-900/30">
            <Settings size={48} className="animate-spin-slow sm:w-16 sm:h-16" />
          </div>

          <div className="space-y-4">
            <h2 className="text-3xl sm:text-5xl font-black text-slate-900 dark:text-white tracking-tight leading-tight">
              Payment & Subscription Services <br className="hidden sm:block" />
              <span className="text-amber-500">Currently Under Maintenance</span>
            </h2>
            <p className="text-base sm:text-xl text-slate-500 dark:text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed">
              We are upgrading activation, subscription management and payment reliability to provide a more seamless experience for our scholars.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
            <div className="flex items-center gap-3 px-6 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
              <ShieldCheck size={20} className="text-medical-500" />
              <span className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">Secure Updates</span>
            </div>
            <div className="flex items-center gap-3 px-6 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
              <Clock size={20} className="text-amber-500" />
              <span className="text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest">Back Soon</span>
            </div>
          </div>

          <div className="pt-8">
            <button
              onClick={() => navigate('/dashboard')}
              className="px-10 py-5 bg-slate-900 dark:bg-slate-700 text-white rounded-2xl font-black uppercase tracking-widest text-xs shadow-xl hover:bg-slate-800 dark:hover:bg-slate-600 active:scale-95 transition-all"
            >
              Return to Dashboard
            </button>
          </div>

          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest pt-8">
            Apex Scholars • Institutional Stability Protocol
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Payments;
