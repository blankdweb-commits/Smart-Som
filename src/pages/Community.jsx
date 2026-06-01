import React from 'react';
import { Users, MessageSquare, Share2, BookOpen, Award, LayoutDashboard as Globe } from '../components/Icons';
import { motion } from 'framer-motion';

const Community = () => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 sm:py-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="text-center space-y-8">
        {/* Animated Icon Header */}
        <div className="relative inline-block">
          <div className="absolute inset-0 bg-medical-500/20 blur-3xl rounded-full scale-150 animate-pulse" />
          <div className="relative w-24 h-24 sm:w-32 sm:h-32 bg-white dark:bg-slate-800 rounded-[2.5rem] flex items-center justify-center text-medical-600 mx-auto shadow-2xl border border-slate-100 dark:border-slate-700">
            <Users size={48} className="sm:hidden" />
            <Users size={64} className="hidden sm:block" />
          </div>
        </div>

        {/* Coming Soon Text */}
        <div className="space-y-4">
          <h2 className="text-4xl sm:text-6xl font-black text-slate-900 dark:text-white tracking-tighter">
            Community Hub
          </h2>
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-full text-xs font-black uppercase tracking-widest border border-amber-200 dark:border-amber-800/50">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            Coming Soon
          </div>
        </div>

        <p className="text-lg sm:text-xl text-slate-500 dark:text-slate-400 font-medium max-w-2xl mx-auto leading-relaxed">
          We are building a professional nursing student community where you will be able to connect, share, and excel together.
        </p>

        {/* Features List */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto pt-10">
          <ComingSoonFeature
            icon={<Users size={20} />}
            text="Connect with classmates"
          />
          <ComingSoonFeature
            icon={<Share2 size={20} />}
            text="Share study materials"
          />
          <ComingSoonFeature
            icon={<MessageSquare size={20} />}
            text="Discuss nursing topics"
          />
          <ComingSoonFeature
            icon={<BookOpen size={20} />}
            text="Participate in clinical discussions"
          />
          <ComingSoonFeature
            icon={<Globe size={20} />}
            text="Join institution-specific groups"
            fullWidth
          />
        </div>

        {/* Call to Action or Footer Info */}
        <div className="pt-12">
          <div className="p-8 bg-slate-50 dark:bg-slate-900/50 rounded-[3rem] border border-slate-100 dark:border-slate-800/50">
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest mb-2">Stay Tuned</p>
            <p className="text-slate-600 dark:text-slate-400 font-medium italic">
              "Individually, we are a drop. Together, we are an ocean."
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

const ComingSoonFeature = ({ icon, text, fullWidth }) => (
  <div className={`flex items-center gap-4 p-5 bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm transition-all hover:shadow-md ${fullWidth ? 'sm:col-span-2' : ''}`}>
    <div className="w-10 h-10 rounded-xl bg-medical-50 dark:bg-medical-900/20 flex items-center justify-center text-medical-600 shrink-0">
      {icon}
    </div>
    <span className="font-bold text-slate-700 dark:text-slate-200 text-sm text-left">{text}</span>
  </div>
);

export default Community;
