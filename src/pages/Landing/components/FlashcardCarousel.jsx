import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const flashcards = [
  { q: "What is the primary function of the SA node?", a: "To act as the heart's natural pacemaker." },
  { q: "Define Nosocomial infection.", a: "An infection acquired in a hospital environment." },
  { q: "What is the normal range for adult pulse rate?", a: "60 to 100 beats per minute." },
  { q: "Name the 'Five Rights' of medication administration.", a: "Right Patient, Right Drug, Right Dose, Right Route, Right Time." },
  { q: "What is the first step in the Nursing Process?", a: "Assessment." },
];

const Flashcard = ({ card }) => {
  const [isFlipped, setIsFlipped] = useState(false);

  return (
    <div
      className="flex-shrink-0 w-72 h-44 perspective-1000 cursor-pointer"
      onMouseEnter={() => setIsFlipped(true)}
      onMouseLeave={() => setIsFlipped(false)}
      onClick={() => setIsFlipped(!isFlipped)}
    >
      <motion.div
        className="relative w-full h-full transition-all duration-500 preserve-3d"
        animate={{ rotateY: isFlipped ? 180 : 0 }}
      >
        {/* Front */}
        <div className="absolute inset-0 backface-hidden bg-slate-800 border border-slate-700 p-6 rounded-[2rem] shadow-2xl flex flex-col justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-teal-500 mb-2 block">Question Preview</span>
            <p className="text-white font-bold leading-tight line-clamp-3">
              {card.q}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500 font-bold italic">Tap to reveal answer</span>
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-teal-500" />
            </div>
          </div>
        </div>

        {/* Back */}
        <div
          className="absolute inset-0 backface-hidden bg-teal-500 border border-teal-400 p-6 rounded-[2rem] shadow-2xl flex flex-col justify-center items-center text-center rotate-y-180"
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-900 mb-2 block">Answer</span>
          <p className="text-slate-900 font-black leading-tight">
            {card.a}
          </p>
        </div>
      </motion.div>
    </div>
  );
};

const FlashcardCarousel = () => {
  return (
    <div className="relative w-full overflow-hidden py-10">
      <motion.div
        className="flex gap-6 px-4"
        animate={{
          x: [0, -1000],
        }}
        transition={{
          x: {
            repeat: Infinity,
            repeatType: "loop",
            duration: 30,
            ease: "linear",
          },
        }}
        whileHover={{ animationPlayState: 'paused' }}
      >
        {[...flashcards, ...flashcards, ...flashcards].map((card, index) => (
          <Flashcard key={index} card={card} />
        ))}
      </motion.div>

      {/* Fade edges */}
      <div className="absolute top-0 left-0 w-20 h-full bg-gradient-to-r from-slate-900 to-transparent z-10 pointer-events-none" />
      <div className="absolute top-0 right-0 w-20 h-full bg-gradient-to-l from-slate-900 to-transparent z-10 pointer-events-none" />

      <style jsx>{`
        .perspective-1000 { perspective: 1000px; }
        .preserve-3d { transform-style: preserve-3d; }
        .backface-hidden { backface-visibility: hidden; }
        .rotate-y-180 { transform: rotateY(180deg); }
      `}</style>
    </div>
  );
};

export default FlashcardCarousel;
