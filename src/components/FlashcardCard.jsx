import React, { useState } from 'react';
import {
  Star,
  Volume2,
  HelpCircle
} from './Icons';

const FlashcardCard = ({
  card,
  isFullscreen = false,
  isFlipped = false,
  onFlip,
  onToggleImportant
}) => {
  const [showHint, setShowHint] = useState(false);

  const handleSpeak = (e, text) => {
    e.stopPropagation();
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div
      className="w-full h-full cursor-pointer flashcard-container"
      onClick={(e) => { e.stopPropagation(); onFlip && onFlip(); }}
    >
      <div className={`flashcard-inner w-full h-full ${isFlipped ? 'flipped' : ''}`}>
        <div className={`flashcard-front absolute inset-0 bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-5 sm:p-8 flex flex-col justify-between overflow-y-auto`}>
          <div>
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black px-3 py-1 bg-teal-50 text-teal-600 dark:bg-teal-900/40 dark:text-teal-300 rounded-full uppercase tracking-[0.15em] border border-teal-100/50">
                {card.subject}
              </span>
              <div className="flex space-x-1">
                {onToggleImportant && (
                  <button onClick={(e) => { e.stopPropagation(); onToggleImportant(card.id); }} className={`p-1 rounded-full transition-colors ${card.important ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-400'}`}>
                    <Star size={18} fill={card.important ? 'currentColor' : 'none'} />
                  </button>
                )}
                <button onClick={(e) => handleSpeak(e, card.question)} className="p-1 text-slate-400 hover:text-teal-600 transition-colors">
                  <Volume2 size={18} />
                </button>
              </div>
            </div>

            <h3 className={`${isFullscreen ? 'text-xl sm:text-3xl' : 'text-lg sm:text-xl'} font-black text-slate-900 dark:text-white leading-tight text-center tracking-tight px-2 break-words`}>
              {card.question}
            </h3>

            {card.hint && (
              <div className="mt-4 flex flex-col items-center">
                <button onClick={(e) => { e.stopPropagation(); setShowHint(!showHint); }} className="flex items-center text-xs font-bold text-teal-600 dark:text-teal-400 hover:text-teal-700 transition-colors uppercase tracking-wider">
                  <HelpCircle size={14} className="mr-1" /> {showHint ? 'Hide Hint' : 'Show Hint'}
                </button>
                {showHint && (
                  <div onClick={(e) => e.stopPropagation()} className="mt-2 text-sm text-slate-500 italic text-center bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                    {card.hint}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-between items-center">
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${card.difficulty === 'Easy' ? 'bg-green-100 text-green-700' : card.difficulty === 'Moderate' ? 'bg-yellow-100 text-yellow-700' : card.difficulty === 'Hard' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
              {card.difficulty}
            </span>
            {card.source && (
              <span className="text-[9px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-600 truncate max-w-[50%]">{card.source}</span>
            )}
          </div>
        </div>

        <div className={`flashcard-back absolute inset-0 bg-teal-600 rounded-[2rem] shadow-clinical p-6 sm:p-8 flex flex-col items-center justify-center text-white text-center overflow-auto`}>
          <button onClick={(e) => handleSpeak(e, card.answer)} className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors">
            <Volume2 size={20} />
          </button>
          <p className="text-[10px] uppercase tracking-widest mb-4 opacity-80 font-bold">Answer</p>
          <p className={`${isFullscreen ? 'text-lg sm:text-2xl' : 'text-base sm:text-lg'} font-black leading-tight tracking-tight max-w-3xl mx-auto px-2 break-words`}>{card.answer}</p>
          {card.rationale && (
            <div className="mt-4 p-3 sm:p-4 bg-white/10 rounded-2xl border border-white/10 max-w-2xl">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-1">Rationale</p>
              <p className="text-xs sm:text-sm font-medium leading-relaxed italic">{card.rationale}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default React.memo(FlashcardCard);
