import React, { useState } from 'react';
import { Star, Edit2, Trash2, HelpCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const FlashcardCard = ({ card, onEdit, onDelete, onToggleImportant, isStudyMode = false }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
    setShowHint(false);
  };

  return (
    <div className={`relative h-64 w-full cursor-pointer group flashcard-container`} onClick={handleFlip}>
      <div className={`flashcard-inner w-full h-full duration-500 ${isFlipped ? 'flipped' : ''}`}>
        {/* Front */}
        <div className="flashcard-front absolute inset-0 bg-white dark:bg-slate-800 rounded-xl shadow-md border border-slate-200 dark:border-slate-700 p-6 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-semibold px-2 py-1 bg-medical-100 text-medical-700 dark:bg-medical-900/40 dark:text-medical-300 rounded uppercase">
                {card.subject}
              </span>
              <div className="flex space-x-2">
                {!isStudyMode && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); onToggleImportant(card.id); }}
                      className={`p-1 rounded-full transition-colors ${card.important ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-400'}`}
                    >
                      <Star size={18} fill={card.important ? 'currentColor' : 'none'} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(card); }}
                      className="p-1 text-slate-400 hover:text-medical-600 transition-colors"
                    >
                      <Edit2 size={18} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
                      className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mb-1">{card.topic}</p>
            <h3 className="text-xl font-bold text-slate-800 dark:text-white mt-4 text-center">
              {card.question}
            </h3>

            {card.hint && (
              <div className="mt-4 flex flex-col items-center">
                <button
                  onClick={(e) => { e.stopPropagation(); setShowHint(!showHint); }}
                  className="flex items-center text-xs font-bold text-medical-600 dark:text-medical-400 hover:text-medical-700 transition-colors uppercase tracking-wider"
                >
                  <HelpCircle size={14} className="mr-1" /> {showHint ? 'Hide Hint' : 'Show Hint'}
                </button>
                <AnimatePresence>
                  {showHint && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 text-sm text-slate-500 italic text-center bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800"
                    >
                      {card.hint}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
          <div className="flex justify-center items-center gap-2">
            {card.srs?.reps > 0 && (
              <div className="flex items-center text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded-full">
                <Info size={10} className="mr-1" /> {card.srs.reps} reviews
              </div>
            )}
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
              card.difficulty === 'Easy' ? 'bg-green-100 text-green-700' :
              card.difficulty === 'Moderate' ? 'bg-yellow-100 text-yellow-700' :
              'bg-red-100 text-red-700'
            }`}>
              {card.difficulty}
            </span>
          </div>
        </div>

        {/* Back */}
        <div className="flashcard-back absolute inset-0 bg-medical-600 rounded-xl shadow-md p-6 flex flex-col items-center justify-center text-white text-center">
          <p className="text-xs uppercase tracking-wider mb-4 opacity-80">Answer</p>
          <p className="text-lg font-medium">
            {card.answer}
          </p>
          <p className="mt-8 text-xs opacity-60">Click to flip back</p>
        </div>
      </div>
    </div>
  );
};

export default FlashcardCard;
