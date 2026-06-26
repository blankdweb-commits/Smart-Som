import React from 'react';
import { Shield, CheckCircle2 } from './Icons';
import { motion } from 'framer-motion';

const SourceBadge = ({ source }) => {
  const getSourceStyle = (src) => {
    const s = src?.toLowerCase() || '';
    if (s.includes('richard')) return {
      bg: 'bg-gradient-to-r from-amber-400 to-yellow-600',
      text: 'text-white',
      glow: 'shadow-[0_0_15px_rgba(251,191,36,0.5)]',
      label: 'Verified Source: Richard\'s Bank'
    };
    if (s.includes('nmcn')) return {
      bg: 'bg-gradient-to-r from-blue-600 to-blue-800',
      text: 'text-white',
      glow: 'shadow-[0_0_15px_rgba(37,99,235,0.4)]',
      label: 'Official NMCN Resource'
    };
    if (s.includes('nclex')) return {
      bg: 'bg-gradient-to-r from-purple-600 to-indigo-700',
      text: 'text-white',
      glow: 'shadow-[0_0_15px_rgba(147,51,234,0.4)]',
      label: 'Professional NCLEX Prep'
    };
    if (s.includes('apex') || s.includes('core')) return {
      bg: 'bg-gradient-to-r from-emerald-500 to-teal-700',
      text: 'text-white',
      glow: 'shadow-[0_0_15px_rgba(16,185,129,0.4)]',
      label: 'Apex Scholars Core Bank'
    };
    if (s.includes('faculty') || s.includes('imported')) return {
      bg: 'bg-gradient-to-r from-slate-400 to-gray-600',
      text: 'text-white',
      glow: 'shadow-[0_0_15px_rgba(148,163,184,0.4)]',
      label: 'Imported Faculty Bank'
    };
    return {
      bg: 'bg-slate-100 dark:bg-slate-700',
      text: 'text-slate-600 dark:text-slate-300',
      glow: '',
      label: src || 'Standard Resource'
    };
  };

  const style = getSourceStyle(source);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full ${style.bg} ${style.text} ${style.glow} border border-white/20`}
    >
      <Shield size={10} className="shrink-0" />
      <span className="text-[8px] font-black uppercase tracking-widest whitespace-nowrap">
        {style.label}
      </span>
      <CheckCircle2 size={10} className="shrink-0 opacity-70" />
    </motion.div>
  );
};

export default SourceBadge;
