import React from 'react';
import FlashcardLibrary from '../components/FlashcardLibrary';

const NmcnPrep = () => {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-8 rounded-3xl text-white shadow-lg mb-8">
        <h1 className="text-3xl font-bold mb-2">NMCN Council Prep</h1>
        <p className="max-w-2xl opacity-90">
          Prepare for the Nursing and Midwifery Council of Nigeria (NMCN) exams. Focus on CBT formats covering Anatomy, Physiology, Pharmacology, and Community Health in the Nigerian context.
        </p>
      </div>
      <FlashcardLibrary initialCategory="NMCN" />
    </div>
  );
};

export default NmcnPrep;
