import React from 'react';
import { motion } from 'framer-motion';
import { CreditCard, ArrowLeft, Clock } from '../components/Icons';
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
            <p className="text-xs sm:text-sm font-bold text-slate-400 uppercase tracking-widest mt-1">Coming Soon</p>
          </div>
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-12 shadow-clinical border border-slate-100 dark:border-slate-700 text-center"
      >
        <div className="w-24 h-24 bg-medical-50 dark:bg-medical-900/20 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto mb-8">
          <CreditCard size={48} />
        </div>
        <h2 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Payments System Coming Soon</h2>
        <p className="text-slate-500 mt-4 max-w-md mx-auto">We are currently finalizing the secure institutional payment gateway for student tuition and resource access.</p>

        <div className="mt-8 flex items-center justify-center gap-2 text-amber-500 font-bold">
          <Clock size={20} />
          <span>Finalizing Integration</span>
        </div>
      </motion.div>
    </div>
  );
};

export default Payments;
