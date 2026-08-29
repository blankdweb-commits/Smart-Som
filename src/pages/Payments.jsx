import React from 'react';
import {
  CreditCard,
  Info,
  AlertCircle,
  Clock,
  Zap
} from '../components/Icons';
  // eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';

const Payments = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <div className="flex items-center gap-3 text-medical-600 mb-2">
           <CreditCard size={32} />
           <span className="text-[10px] font-black uppercase tracking-[0.3em]">Financial Terminal</span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Payments</h1>
        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Manage institutional fees and premium clinical access.</p>
      </header>

      {/* Maintenance Mode Card */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative overflow-hidden bg-white dark:bg-slate-800 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-700 p-12 text-center space-y-8 shadow-clinical"
      >
        <div className="w-24 h-24 bg-amber-50 dark:bg-amber-900/30 text-amber-500 rounded-[2rem] flex items-center justify-center mx-auto shadow-inner relative z-10">
           <Clock size={48} className="animate-pulse" />
        </div>

        <div className="space-y-4 relative z-10">
           <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Coming Soon</h2>
           <p className="max-w-md mx-auto text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
             Our payment infrastructure is currently undergoing an institutional security enhancement to support multi-bank verification and direct NMCN receipt generation.
           </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
           <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700 flex items-center gap-3">
              <Info size={16} className="text-medical-600" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Expected Release: Q4 2024</span>
           </div>
           <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-700 flex items-center gap-3">
              <AlertCircle size={16} className="text-amber-500" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Access: Free Testing Mode</span>
           </div>
        </div>
      </motion.div>

      {/* Static Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
         <div className="bg-indigo-600 rounded-[2.5rem] p-10 text-white space-y-6 shadow-xl relative overflow-hidden group">
            <div className="absolute -bottom-10 -right-10 opacity-10 group-hover:scale-110 transition-transform duration-700">
               <Zap size={200} />
            </div>
            <h3 className="text-2xl font-black relative z-10">Institutional Access</h3>
            <p className="text-indigo-100 leading-relaxed font-medium relative z-10">
              When active, this terminal will allow you to pay school fees, clinical levies, and professional NMCN examination fees directly through Paystack.
            </p>
            <div className="pt-6 border-t border-white/20 relative z-10">
               <span className="text-[10px] font-black uppercase tracking-widest opacity-60">Status</span>
               <p className="font-black">Development Phase</p>
            </div>
         </div>

         <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 border border-slate-100 dark:border-slate-700 space-y-6 shadow-clinical group">
            <h3 className="text-2xl font-black text-slate-900 dark:text-white">Secure Verification</h3>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
              We are working with financial partners to ensure all transactions are audited and instantly reflected on your institutional portal.
            </p>
            <div className="pt-6 border-t border-slate-100 dark:border-slate-700">
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Security</span>
               <p className="font-black text-medical-600 uppercase tracking-tighter">AES-256 Encryption Active</p>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Payments;
