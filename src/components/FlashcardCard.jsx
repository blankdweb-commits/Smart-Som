import React, { useState } from 'react';
import { Star, Edit2, Trash2, HelpCircle, Info, Share2, Volume2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const FlashcardCard = ({ card, onEdit, onDelete, onToggleImportant, onShare, isStudyMode = false }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
    setShowHint(false);
  };

  const handleSpeak = (e, text) => {
    e.stopPropagation();
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div className={`relative h-[320px] sm:h-72 w-full cursor-pointer group flashcard-container`} onClick={handleFlip}>
      <div className={`flashcard-inner w-full h-full ${isFlipped ? 'flipped' : ''}`}>
        {/* Front */}
        <div className="flashcard-front absolute inset-0 bg-white dark:bg-slate-800 rounded-3xl shadow-soft border border-slate-100 dark:border-slate-700 p-6 sm:p-8 flex flex-col justify-between overflow-hidden">
          {/* Decorative clinical element */}
          <div className="absolute top-0 left-0 w-1 bg-medical-500 h-full opacity-50" />

          <div>
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] sm:text-xs font-bold px-3 py-1 bg-medical-50 text-medical-700 dark:bg-medical-900/40 dark:text-medical-300 rounded-full border border-medical-100 dark:border-medical-800 uppercase tracking-wider truncate max-w-[140px]">
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
                      onClick={(e) => { e.stopPropagation(); onShare(card); }}
                      className="p-1 text-slate-400 hover:text-indigo-500 transition-colors"
                      title="Copy card data"
                    >
                      <Share2 size={18} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
                      className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={18} />
                    </button>
                  </>
                )}
                <button
                  onClick={(e) => handleSpeak(e, card.question)}
                  className="p-1 text-slate-400 hover:text-medical-600 transition-colors"
                  title="Listen to question"
                >
                  <Volume2 size={18} />
                </button>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 dark:text-slate-500 font-bold mb-1 uppercase tracking-tight">{card.topic}</p>
            <h3 className="text-xl sm:text-2xl font-extrabold text-slate-900 dark:text-white mt-4 leading-snug">
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
        <div className="flashcard-back absolute inset-0 bg-medical-600 rounded-3xl shadow-clinical p-8 flex flex-col items-center justify-center text-white text-center overflow-auto relative">
          {/* Pattern Overlay */}
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />

          <button
            onClick={(e) => handleSpeak(e, card.answer)}
            className="absolute top-6 right-6 p-2 bg-white/10 rounded-xl text-white/80 hover:bg-white/20 transition-all z-10"
            title="Listen to answer"
          >
            <Volume2 size={24} />
          </button>

          <div className="relative z-10">
            <p className="text-xs font-bold uppercase tracking-[0.2em] mb-6 text-white/60">Correct Answer</p>
            <p className="text-xl sm:text-2xl font-bold leading-relaxed">
              {card.answer}
            </p>
            <div className="mt-8 flex justify-center">
              <div className="px-4 py-1.5 bg-white/10 rounded-full text-xs font-bold border border-white/20">
                Tap to Flip Back
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FlashcardCard;
