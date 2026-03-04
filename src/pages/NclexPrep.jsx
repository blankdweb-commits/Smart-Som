import React from 'react';
import FlashcardLibrary from '../components/FlashcardLibrary';

const NclexPrep = () => {
  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-8 rounded-3xl text-white shadow-lg">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold mb-2">NCLEX-RN Preparation</h1>
          <p className="opacity-90">
            Intensive study tracks for the National Council Licensure Examination. Mastering Next Generation (NGN) clinical judgment models and physiological adaptation.
          </p>
        </div>
      </div>
      <FlashcardLibrary initialCategory="NCLEX" />
    </div>
  );
};

export default NclexPrep;
