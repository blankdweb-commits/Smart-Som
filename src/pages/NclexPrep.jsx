import React from 'react';
import FlashcardLibrary from '../components/FlashcardLibrary';

const NclexPrep = () => {
  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-500">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-800 p-10 sm:p-14 rounded-[2.5rem] text-white shadow-clinical relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full -mr-20 -mt-20 blur-3xl" />
        <div className="relative z-10 max-w-3xl">
          <span className="text-xs font-black uppercase tracking-[0.3em] text-blue-200 mb-4 block">Professional License Track</span>
          <h1 className="text-4xl sm:text-5xl font-black mb-6 tracking-tight">NCLEX-RN Prep Suite</h1>
          <p className="text-lg sm:text-xl font-medium text-blue-50 leading-relaxed opacity-90">
            Intensive preparation for the National Council Licensure Examination. Mastering Next Generation (NGN) clinical judgment models and physiological integrity through high-fidelity clinical scenarios.
          </p>
        </div>
      </div>
      <FlashcardLibrary initialCategory="NCLEX" />
    </div>
  );
};

export default NclexPrep;
