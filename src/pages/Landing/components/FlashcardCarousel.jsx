import React from 'react';
import { motion } from 'framer-motion';

const flashcards = [
  { q: "What is the primary function of the SA node?", a: "To act as the heart's natural pacemaker." },
  { q: "Define Nosocomial infection.", a: "An infection acquired in a hospital environment." },
  { q: "What is the normal range for adult pulse rate?", a: "60 to 100 beats per minute." },
  { q: "Name the 'Five Rights' of medication administration.", a: "Right Patient, Right Drug, Right Dose, Right Route, Right Time." },
  { q: "What is the first step in the Nursing Process?", a: "Assessment." },
];

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
      >
        {[...flashcards, ...flashcards].map((card, index) => (
          <div
            key={index}
            className="flex-shrink-0 w-72 h-44 bg-slate-800 border border-slate-700 p-6 rounded-[2rem] shadow-2xl flex flex-col justify-between"
          >
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
        ))}
      </motion.div>

      {/* Fade edges */}
      <div className="absolute top-0 left-0 w-20 h-full bg-gradient-to-r from-slate-900 to-transparent z-10" />
      <div className="absolute top-0 right-0 w-20 h-full bg-gradient-to-l from-slate-900 to-transparent z-10" />
    </div>
  );
};

export default FlashcardCarousel;
