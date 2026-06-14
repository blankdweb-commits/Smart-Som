import React, { useState } from 'react';
import { motion, useMotionValue, useTransform } from 'framer-motion';
import {
  Star,
  Edit2,
  Share2,
  Trash2,
  Volume2,
  HelpCircle,
  Info,
  CheckCircle2,
  XCircle,
  Bookmark,
  Zap,
  RefreshCw
} from './Icons';

const FlashcardCard = React.memo(({
  card,
  onEdit,
  onDelete,
  onShare,
  onToggleImportant,
  isStudyMode = false,
  isFullscreen = false,
  onSwipeLeft,
  onSwipeRight,
  onSwipeUp,
  onSwipeDown
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-25, 25]);
  const opacity = useTransform([x, y], ([latestX, latestY]) => Math.max(1 - Math.sqrt(latestX*latestX + latestY*latestY)/500, 0.5));

  const handleDragEnd = (event, info) => {
    const threshold = 100;
    const { offset } = info;
    if (Math.abs(offset.x) > Math.abs(offset.y)) {
      if (offset.x < -threshold) {
        if (onSwipeLeft) onSwipeLeft();
      } else if (offset.x > threshold) {
        if (onSwipeRight) onSwipeRight();
      }
    } else {
      if (offset.y < -threshold) {
        if (onSwipeUp) onSwipeUp();
      } else if (offset.y > threshold) {
        if (!isFlipped) setIsFlipped(true);
        if (onSwipeDown) onSwipeDown();
      }
    }
    x.set(0);
    y.set(0);
  };

  const handleFlip = () => { setIsFlipped(!isFlipped); setShowHint(false); };
  const handleSpeak = (e, text) => {
    e.stopPropagation();
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  };

  const isRichard = card.source?.toLowerCase().includes('richard');

  return (
    <motion.div
      style={{ x, y, rotate, opacity, touchAction: 'none' }}
      drag={isStudyMode}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={handleDragEnd}
      className={`relative ${isFullscreen ? 'h-full flex items-center justify-center' : 'h-80 sm:h-64'} w-full cursor-pointer group flashcard-container active:scale-[0.98] transition-transform`}
      onClick={() => { if (isStudyMode && (Math.abs(x.get()) > 5 || Math.abs(y.get()) > 5)) return; handleFlip(); }}
    >
      {/* Gesture Overlays & Indicators */}
      {isStudyMode && (
         <>
            {/* RIGHT -> MASTERED */}
            <motion.div
               style={{ opacity: useTransform(x, [0, 100], [0, 1]) }}
               className="absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-center bg-emerald-500/20 rounded-[2rem] border-4 border-emerald-500/50"
            >
               <CheckCircle2 size={80} className="text-emerald-500 mb-2" />
               <span className="text-xl font-black text-emerald-600 uppercase tracking-widest">Mastered</span>
            </motion.div>

            {/* LEFT -> REVIEW */}
            <motion.div
               style={{ opacity: useTransform(x, [0, -100], [0, 1]) }}
               className="absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-center bg-red-500/20 rounded-[2rem] border-4 border-red-500/50"
            >
               <RefreshCw size={80} className="text-red-500 mb-2" />
               <span className="text-xl font-black text-red-600 uppercase tracking-widest">Review Later</span>
            </motion.div>

            {/* UP -> BOOKMARK */}
            <motion.div
               style={{ opacity: useTransform(y, [0, -100], [0, 1]) }}
               className="absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-center bg-amber-500/20 rounded-[2rem] border-4 border-amber-500/50"
            >
               <Bookmark size={80} className="text-amber-500 mb-2" />
               <span className="text-xl font-black text-amber-600 uppercase tracking-widest">Bookmarked</span>
            </motion.div>

            {/* DOWN -> RATIONALE */}
            <motion.div
               style={{ opacity: useTransform(y, [0, 100], [0, 1]) }}
               className="absolute inset-0 z-30 pointer-events-none flex flex-col items-center justify-center bg-indigo-500/20 rounded-[2rem] border-4 border-indigo-500/50"
            >
               <Zap size={80} className="text-indigo-500 mb-2" />
               <span className="text-xl font-black text-indigo-600 uppercase tracking-widest">Show Rationale</span>
            </motion.div>
         </>
      )}
      <div className={`flashcard-inner w-full h-full ${isFlipped ? 'flipped' : ''} transition-all duration-500 ease-out`}>
        <div className={`flashcard-front absolute inset-0 bg-white dark:bg-slate-800 ${isFullscreen ? 'rounded-[2rem] sm:rounded-[2.5rem] shadow-clinical border-4 border-medical-500/20' : 'rounded-[2rem] shadow-premium border border-slate-100 dark:border-slate-700'} p-5 sm:p-12 flex flex-col justify-between overflow-hidden`}>
          <div>
            <div className="flex justify-between items-start mb-6">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] sm:text-xs font-black px-3 py-1 bg-medical-50 text-medical-600 shadow-[0_0_10px_rgba(16,185,129,0.2)] dark:bg-medical-900/40 dark:text-medical-300 rounded-full uppercase tracking-[0.15em] border border-medical-100/50">
                  {card.subject}
                </span>
              </div>
              <div className="flex space-x-2">
                {!isStudyMode && (
                  <button onClick={(e) => { e.stopPropagation(); onToggleImportant(card.id); }} className={`p-1 rounded-full transition-colors ${card.important ? 'text-yellow-500' : 'text-slate-300 hover:text-yellow-400'}`}><Star size={18} fill={card.important ? 'currentColor' : 'none'} /></button>
                )}
                <button onClick={(e) => handleSpeak(e, card.question)} className="p-1 text-slate-400 hover:text-medical-600 transition-colors"><Volume2 size={18} /></button>
              </div>
            </div>

            <div className="flex justify-center mb-4">
               <div className="px-4 py-1.5 bg-indigo-500/10 text-indigo-500 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] animate-pulse shadow-[0_0_10px_rgba(99,102,241,0.3)] border border-indigo-500/20">
                  SOURCE: {card.source || "RICHARD’S BANK"}
               </div>
            </div>

            <h3 className={`${isFullscreen ? 'text-2xl sm:text-5xl' : 'text-lg sm:text-xl'} font-black text-slate-900 dark:text-white mt-4 sm:mt-8 leading-tight text-center tracking-tight drop-shadow-sm px-2`}>
              {card.question}
            </h3>

            {card.hint && (
              <div className="mt-4 flex flex-col items-center">
                <button onClick={(e) => { e.stopPropagation(); setShowHint(!showHint); }} className="flex items-center text-xs font-bold text-medical-600 dark:text-medical-400 hover:text-medical-700 transition-colors uppercase tracking-wider"><HelpCircle size={14} className="mr-1" /> {showHint ? 'Hide Hint' : 'Show Hint'}</button>
                {showHint && <div className="mt-2 text-sm text-slate-500 italic text-center bg-slate-50 dark:bg-slate-900/50 p-2 rounded-lg border border-slate-100 dark:border-slate-800 animate-in fade-in slide-in-from-top-1">{card.hint}</div>}
              </div>
            )}
          </div>
          <div className="flex justify-center items-center gap-2">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${card.difficulty === 'Easy' ? 'bg-green-100 text-green-700' : card.difficulty === 'Moderate' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{card.difficulty}</span>
          </div>
        </div>
        <div className={`flashcard-back absolute inset-0 bg-medical-600 ${isFullscreen ? 'rounded-[2rem] sm:rounded-[2.5rem] shadow-clinical ring-8 sm:ring-12 ring-medical-500/10' : 'rounded-2xl shadow-lg'} p-5 sm:p-12 flex flex-col items-center justify-center text-white text-center overflow-auto`}>
          <button onClick={(e) => handleSpeak(e, card.answer)} className="absolute top-4 right-4 p-2 text-white/50 hover:text-white transition-colors"><Volume2 size={20} /></button>
          <p className="text-[10px] uppercase tracking-wider mb-4 opacity-80 font-bold">Answer</p>
          <p className={`${isFullscreen ? 'text-xl sm:text-3xl' : 'text-base sm:text-lg'} font-black leading-tight tracking-tight drop-shadow-md max-w-3xl mx-auto px-2`}>{card.answer}</p>
          {card.rationale && (
            <div className="mt-4 p-4 bg-white/10 rounded-2xl border border-white/10 max-w-2xl animate-in fade-in zoom-in duration-500">
              <p className="text-[10px] font-black uppercase tracking-widest text-white/60 mb-2">Rationale</p>
              <p className="text-xs sm:text-sm font-medium leading-relaxed italic">{card.rationale}</p>
            </div>
          )}
          <p className="mt-6 text-[10px] opacity-60 font-bold uppercase tracking-widest">Click to flip back</p>
        </div>
      </div>
    </motion.div>
  );
});

export default FlashcardCard;
