import React from 'react';
import FlashcardLibrary from '../components/FlashcardLibrary';

const NmcnPrep = () => {
  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-8 rounded-3xl text-white shadow-lg">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-2">NMCN Council Prep</h1>
          <p className="opacity-90">
            Preparation for the Nursing and Midwifery Council of Nigeria exams. Focus on CBT formats and regional clinical standards.
          </p>
        </div>
      </div>
      <FlashcardLibrary initialCategory="NMCN" />
    </div>
  );
};

export default NmcnPrep;
