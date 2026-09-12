import React from 'react';
import { useAppContext } from '../context/AppContext';
import { Lock } from './Icons';
import { useNavigate } from 'react-router-dom';

// Flashcards are DISABLED as a study feature. This component ALWAYS renders the
// admin-granted gate — the HIGHLY CLASSIFIED screen. There is zero flashcard
// dataset loading: no bundled bank fetch, no lazy chunk, no dynamic import for
// flashcard cards. The gate JSX below is preserved verbatim from the previous
// implementation.
const FlashcardLibrary = () => {
  const { session } = useAppContext();
  const navigate = useNavigate();

  if (!session?.user) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 bg-slate-800 rounded-[2rem] flex items-center justify-center text-slate-400 mb-6"><Lock size={40} /></div>
        <h1 className="text-2xl font-black text-white uppercase tracking-tight">Sign in required</h1>
        <p className="text-slate-400 font-medium mt-2 max-w-sm">You must be signed in to access the Polynurse Flashcards vault.</p>
        <button onClick={() => navigate('/dashboard')} className="mt-8 px-6 py-3 bg-white text-slate-900 rounded-2xl font-bold text-sm">Back to Home</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center px-6 text-center">
      <div className="w-20 h-20 bg-red-600/20 border border-red-500/30 rounded-[2rem] flex items-center justify-center text-red-500 mb-6"><Lock size={40} /></div>
      <span className="text-[10px] font-black uppercase tracking-[0.4em] text-red-500 mb-4">HIGHLY CLASSIFIED</span>
      <h1 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-tight leading-tight max-w-md">
        This is highly classified.
      </h1>
      <p className="text-slate-400 font-semibold mt-4 max-w-md leading-relaxed">
        You are not authorised to access this area. Polynurse Flashcards access was not granted to this account.
      </p>
      <p className="text-slate-500 text-sm font-medium mt-3 max-w-sm leading-relaxed">
        If you believe this is a mistake, contact an administrator to request flashcard access.
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        className="mt-10 px-8 py-3.5 bg-red-600 text-white rounded-2xl font-black uppercase tracking-[0.2em] text-xs shadow-lg shadow-red-600/20 active:scale-95 transition-all"
      >
        Return to Home
      </button>
    </div>
  );
};

export default React.memo(FlashcardLibrary);