import React, { useState } from 'react';
import { Star, Edit2, Trash2, HelpCircle, Info, Share2, Volume2 } from 'lucide-react';
import { motion, useMotionValue, useTransform } from 'framer-motion'; // eslint-disable-line no-unused-vars

const FlashcardCard = ({
  card, onEdit, onDelete, onToggleImportant, onShare,
  isStudyMode = false, isFullscreen = false,
  onSwipeLeft, onSwipeRight
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Swipe logic
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-25, 25]);
  const opacity = useTransform(x, [-200, -150, 0, 150, 200], [0, 1, 1, 1, 0]);

  const handleDragEnd = (event, info) => {
    if (info.offset.x < -100 && onSwipeLeft) {
      onSwipeLeft();
    } else if (info.offset.x > 100 && onSwipeRight) {
      onSwipeRight();
    }
  };

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
    <motion.div
      style={{ x, rotate, opacity }}
      drag={isStudyMode ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      className={`relative ${isFullscreen ? 'h-full' : 'h-72 sm:h-64'} w-full cursor-pointer group flashcard-container active:scale-[0.98] transition-transform`}
      onClick={() => {
        // Prevent flip if we just dragged
        if (isStudyMode && Math.abs(x.get()) > 5) return;
        handleFlip();
      }}
    >
      <div className={`flashcard-inner w-full h-full ${isFlipped ? 'flipped' : ''} transition-all duration-500 ease-out`}>
        {/* Front */}
        <div className={`flashcard-front absolute inset-0 bg-white dark:bg-slate-800 ${isFullscreen ? 'rounded-[2.5rem]' : 'rounded-2xl'} shadow-sm border border-slate-200 dark:border-slate-700 p-6 sm:p-10 flex flex-col justify-between overflow-hidden`}>
          <div>
            <div className="flex justify-between items-start mb-3">
              <span className="text-[10px] sm:text-xs font-bold px-2 py-1 bg-medical-50 text-medical-600 dark:bg-medical-900/40 dark:text-medical-300 rounded uppercase tracking-wide truncate max-w-[120px]">
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
            <p className="text-xs text-slate-400 dark:text-slate-500 font-bold mb-1 uppercase">{card.topic}</p>
            <h3 className="text-lg sm:text-xl font-bold text-slate-800 dark:text-white mt-2 leading-snug text-center">
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
                {showHint && (
                  <div
                    className="mt-2 text-sm text-slate-500 italic text-center bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800 animate-in fade-in slide-in-from-top-1"
                  >
                    {card.hint}
                  </div>
                )}
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
        <div className={`flashcard-back absolute inset-0 bg-medical-600 ${isFullscreen ? 'rounded-[2.5rem]' : 'rounded-2xl'} shadow-lg p-6 sm:p-10 flex flex-col items-center justify-center text-white text-center overflow-auto relative`}>
          <button
            onClick={(e) => handleSpeak(e, card.answer)}
            className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"
            title="Listen to answer"
          >
            <Volume2 size={20} />
          </button>
          <p className="text-[10px] uppercase tracking-wider mb-4 opacity-80 font-bold">Answer</p>
          <p className="text-base sm:text-lg font-medium leading-relaxed">
            {card.answer}
          </p>
          <p className="mt-6 text-[10px] opacity-60 font-bold uppercase tracking-widest">Click to flip back</p>
        </div>
      </div>
    </motion.div>
  );
};

export default FlashcardCard;
