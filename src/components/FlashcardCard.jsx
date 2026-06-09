import React, { useState, memo } from 'react';
import { Star, Edit2, Trash2, HelpCircle, Info, Share2, Volume2 } from './Icons';
import { motion, useMotionValue, useTransform } from 'framer-motion';

const FlashcardCard = memo(({
  card, onEdit, onDelete, onToggleImportant, onShare,
  isStudyMode = false, isFullscreen = false,
  onSwipeLeft, onSwipeRight
}) => {
  if (!card) return null;

  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Swipe logic
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-25, 25]);
  const opacity = useTransform(x, [-200, -150, 0, 150, 200], [0, 1, 1, 1, 0]);

  const handleDragEnd = (event, info) => {
    const threshold = window.innerWidth < 768 ? 80 : 150;
    if (info.offset.x < -threshold && onSwipeLeft) {
      onSwipeLeft();
    } else if (info.offset.x > threshold && onSwipeRight) {
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
      style={{ x, rotate, opacity, touchAction: 'none' }}
      drag={isStudyMode ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      onDragEnd={handleDragEnd}
      className={`relative ${isFullscreen ? 'h-full flex items-center justify-center' : 'h-80 sm:h-64'} w-full cursor-pointer group flashcard-container active:scale-[0.98] transition-transform`}
      onClick={() => {
        if (isStudyMode && Math.abs(x.get()) > 5) return;
        handleFlip();
      }}
    >
      <div className={`flashcard-inner w-full h-full ${isFlipped ? 'flipped' : ''} transition-all duration-500 ease-out`}>
        <div className={`flashcard-front absolute inset-0 bg-white dark:bg-slate-800 ${isFullscreen ? 'rounded-[2rem] sm:rounded-[2.5rem] shadow-clinical border-4 border-medical-500/20' : 'rounded-[2rem] shadow-premium border border-slate-100 dark:border-slate-700'} p-5 sm:p-12 flex flex-col justify-between overflow-hidden transition-all duration-500`}>
          {isFullscreen && (
            <div className="absolute top-0 left-0 w-full h-1.5 bg-slate-100 dark:bg-slate-700">
              <motion.div className="h-full bg-medical-500" initial={{ width: 0 }} animate={{ width: '100%' }} transition={{ duration: 0.5 }} />
            </div>
          )}
          <div>
            <div className="flex justify-between items-start mb-6">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[10px] sm:text-xs font-black px-3 py-1 bg-medical-50 text-medical-600 dark:bg-medical-900/40 dark:text-medical-300 rounded-full uppercase tracking-[0.15em] border border-medical-100/50">
                    {card.subject || 'General'}
                  </span>
                  {card.source && (
                    <span className="text-[8px] sm:text-[9px] font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-300 px-2 py-0.5 rounded border border-indigo-100/50 uppercase tracking-tighter shadow-sm">
                      {card.source}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex space-x-2">
                {!isStudyMode && (
                  <>
                    <button onClick={(e) => { e.stopPropagation(); onToggleImportant(card.id); }} className={`p-1 rounded-full transition-colors ${card.important ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-400'}`}>
                      <Star size={18} fill={card.important ? 'currentColor' : 'none'} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onEdit(card); }} className="p-1 text-slate-400 hover:text-medical-600 transition-colors"><Edit2 size={18} /></button>
                  </>
                )}
                <button onClick={(e) => handleSpeak(e, card.question)} className="p-1 text-slate-400 hover:text-medical-600 transition-colors"><Volume2 size={18} /></button>
              </div>
            </div>
            <p className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500 font-bold mb-1 uppercase">{card.topic}</p>
            <h3 className={`${isFullscreen ? 'text-2xl sm:text-5xl' : 'text-lg sm:text-xl'} font-black text-slate-900 dark:text-white mt-4 sm:mt-8 leading-tight text-center tracking-tight drop-shadow-sm px-2`}>
              {card.question}
            </h3>
          </div>
          <div className="flex justify-center items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${card.difficulty === 'Easy' ? 'bg-green-100 text-green-700' : card.difficulty === 'Moderate' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
              {card.difficulty || 'Moderate'}
            </span>
          </div>
        </div>

        <div className={`flashcard-back absolute inset-0 bg-medical-600 ${isFullscreen ? 'rounded-[2rem] sm:rounded-[2.5rem] shadow-clinical ring-8 sm:ring-12 ring-medical-500/10' : 'rounded-2xl shadow-lg'} p-5 sm:p-12 flex flex-col items-center justify-center text-white text-center overflow-auto relative transition-all duration-500`}>
          <button onClick={(e) => handleSpeak(e, card.answer)} className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"><Volume2 size={20} /></button>
          <p className="text-[10px] uppercase tracking-wider mb-4 opacity-80 font-bold">Answer</p>
          <p className={`${isFullscreen ? 'text-xl sm:text-4xl' : 'text-base sm:text-lg'} font-black leading-tight tracking-tight drop-shadow-md max-w-3xl mx-auto px-2`}>
            {card.answer}
          </p>
          {card.rationale && (
            <div className="mt-4 p-4 bg-white/10 rounded-2xl border border-white/10 max-w-2xl animate-in fade-in zoom-in duration-500">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-2">Rationale</p>
              <p className="text-xs sm:text-sm font-medium leading-relaxed italic">{card.rationale}</p>
            </div>
          )}
          <div className="mt-auto pt-6 flex flex-col items-center gap-2">
            {card.source && (
              <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.2em] px-3 py-1 border border-white/10 rounded-full">
                ✓ VERIFIED SOURCE: {card.source}
              </span>
            )}
            <p className="text-[10px] opacity-60 font-bold uppercase tracking-widest">Click to flip back</p>
          </div>
        </div>
      </div>
    </motion.div>
  );
});

export default FlashcardCard;
