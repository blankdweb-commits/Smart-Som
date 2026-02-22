import React from 'react';
import FlashcardLibrary from '../components/FlashcardLibrary';

const NclexPrep = () => {
  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 p-8 rounded-3xl text-white shadow-lg mb-8">
        <h1 className="text-3xl font-bold mb-2">NCLEX Preparation</h1>
        <p className="max-w-2xl opacity-90">
          The National Council Licensure Examination (NCLEX) is a nationwide, computerized adaptive test (CAT) required for nursing licensure. Master Next Generation (NGN) case studies and physiological adaptation questions here.
        </p>
      </div>
      <FlashcardLibrary initialCategory="NCLEX" />
    </div>
  );
};

export default NclexPrep;
