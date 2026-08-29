import React, { useState } from 'react';
  // eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { ArrowLeft, Shuffle, Zap } from './Icons';

const COUNT_OPTIONS = [5, 10, 15, 20];

const FlashcardStudySetup = ({ cards, onStart, onBack }) => {
  const [count, setCount] = useState(null);
  const [shuffle, setShuffle] = useState(true);

  const handleStart = () => {
    let selected = [...cards];
    const n = count || selected.length;
    if (shuffle) selected.sort(() => Math.random() - 0.5);
    onStart(selected.slice(0, n));
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md space-y-8"
      >
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-bold text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-black text-white uppercase tracking-tight">Study Session</h2>
          <p className="text-sm text-slate-400 font-medium">{cards.length} cards available</p>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest text-center">How many cards?</p>
          <div className="grid grid-cols-5 gap-3">
            {COUNT_OPTIONS.map(n => (
              <button
                key={n}
                onClick={() => setCount(count === n ? null : n)}
                className={`py-3 rounded-xl font-black text-sm transition-all ${
                  count === n
                    ? 'bg-white text-slate-900 shadow-lg scale-105'
                    : n > cards.length
                    ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
                disabled={n > cards.length}
              >
                {n}
              </button>
            ))}
            <button
              onClick={() => setCount(null)}
              className={`py-3 rounded-xl font-black text-xs transition-all ${
                count === null
                  ? 'bg-white text-slate-900 shadow-lg scale-105'
                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              All
            </button>
          </div>
          <p className="text-center text-xs text-slate-500 font-medium">
            Studying {count || cards.length} cards
          </p>
        </div>

        <button
          onClick={() => setShuffle(!shuffle)}
          className={`w-full flex items-center justify-center gap-3 py-3 rounded-xl border transition-all font-bold text-xs uppercase tracking-widest ${
            shuffle
              ? 'bg-white/10 border-white/20 text-white'
              : 'bg-transparent border-slate-700 text-slate-500'
          }`}
        >
          <Shuffle size={16} className={shuffle ? 'text-emerald-400' : ''} />
          {shuffle ? 'Shuffled' : 'Original Order'}
        </button>

        <button
          onClick={handleStart}
          className="w-full py-4 bg-white text-slate-900 rounded-xl font-black uppercase tracking-widest text-xs shadow-lg hover:bg-slate-100 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
        >
          <Zap size={16} />
          Start Studying
        </button>
      </motion.div>
    </div>
  );
};

export default FlashcardStudySetup;
