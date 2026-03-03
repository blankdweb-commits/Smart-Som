import React from 'react';
import FlashcardLibrary from '../components/FlashcardLibrary';

const NmcnPrep = () => {
  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-800 p-10 sm:p-14 rounded-[2.5rem] text-white shadow-clinical relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl" />
        <div className="relative z-10 max-w-3xl">
          <span className="text-xs font-black uppercase tracking-[0.3em] text-emerald-200 mb-4 block">National Council Track</span>
          <h1 className="text-4xl sm:text-5xl font-black mb-6 tracking-tight">NMCN Council Excellence</h1>
          <p className="text-lg sm:text-xl font-medium text-emerald-50 leading-relaxed opacity-90">
            Professional licensure preparation for the Nursing and Midwifery Council of Nigeria. Strategic focus on CBT-based assessments and regional clinical standards.
          </p>
        </div>
      </div>
      <FlashcardLibrary initialCategory="NMCN" />
    </div>
  );
};

export default NmcnPrep;
