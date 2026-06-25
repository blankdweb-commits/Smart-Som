import React from 'react';
import {
  Users,
  Info,
  Sparkles,
  Clock,
  MessageSquare
} from '../components/Icons';
import { motion } from 'framer-motion';

const Community = () => {
  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <div className="flex items-center gap-3 text-medical-600 mb-2">
           <Users size={32} />
           <span className="text-[10px] font-black uppercase tracking-[0.3em]">Student Network</span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Community Hub</h1>
        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Connect with 10,000+ nursing students across Nigeria.</p>
      </header>

      {/* Maintenance Mode Card */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="relative overflow-hidden bg-white dark:bg-slate-800 rounded-[3rem] border-2 border-dashed border-slate-200 dark:border-slate-700 p-12 text-center space-y-8 shadow-clinical"
      >
        <div className="w-24 h-24 bg-medical-50 dark:bg-medical-900/30 text-medical-600 rounded-[2rem] flex items-center justify-center mx-auto shadow-inner relative z-10">
           <Clock size={48} className="animate-bounce" />
        </div>

        <div className="space-y-4 relative z-10">
           <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Coming Soon</h2>
           <p className="max-w-md mx-auto text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
             We are building a moderated peer-to-peer learning environment. Soon you'll be able to share mnemonics, clinical findings, and study tips with verified nursing colleagues.
           </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 justify-center relative z-10">
           <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <Sparkles size={16} className="text-amber-500" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Feature: Verified Study Groups</span>
           </div>
           <div className="px-6 py-3 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <Info size={16} className="text-medical-600" />
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Release: Q4 2024</span>
           </div>
        </div>
      </motion.div>

      {/* Static Info Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
         <div className="bg-medical-600 rounded-[2.5rem] p-10 text-white space-y-6 shadow-xl relative overflow-hidden group">
            <div className="absolute -bottom-10 -right-10 opacity-10 group-hover:scale-110 transition-transform duration-700">
               <Users size={200} />
            </div>
            <h3 className="text-2xl font-black relative z-10">Collaborative Learning</h3>
            <p className="text-medical-50 leading-relaxed font-medium relative z-10">
              Research shows that explaining concepts to others increases your own retention by up to 90%. Our community hub is designed to facilitate this "Protege Effect".
            </p>
         </div>

         <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 border border-slate-100 dark:border-slate-700 space-y-6 shadow-clinical group">
            <h3 className="text-2xl font-black text-slate-900 dark:text-white">Professional Integrity</h3>
            <p className="text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
              Every post will be reviewed by clinical mentors to ensure medical accuracy and adherence to NMCN professional standards.
            </p>
            <div className="pt-6 border-t border-slate-100 dark:border-slate-700">
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Moderation</span>
               <p className="font-black text-medical-600 uppercase tracking-tighter">AI + Mentor Review Active</p>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Community;
