import React from 'react';
import { motion } from 'framer-motion';
import FlashcardCarousel from './FlashcardCarousel';

const HeroSection = () => {
  return (
    <section className="relative bg-slate-900 pt-20 pb-32 overflow-hidden">
      {/* Background patterns */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-teal-500 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-medical-600 blur-[120px]" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-block px-4 py-1.5 mb-6 text-xs font-black uppercase tracking-[0.2em] text-teal-400 border border-teal-400/30 rounded-full bg-teal-400/5 backdrop-blur-sm">
              Pass Your Nursing Exams in Weeks — Not Months
            </span>
            <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-white leading-tight mb-6">
              Nursing Success <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-medical-400">Simplified.</span>
            </h1>
            <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-400 mb-10 leading-relaxed">
              Structured lessons, real exam questions, and smart revision tools used by serious Nigerian students.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button className="w-full sm:w-auto px-8 py-4 bg-teal-500 hover:bg-teal-400 text-slate-900 font-black rounded-2xl shadow-xl shadow-teal-500/20 transition-all active:scale-95 text-lg">
                Start Weekly Access — ₦1999.9
              </button>
              <div className="flex items-center gap-2 px-4 py-2">
                <div className="flex -space-x-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="w-8 h-8 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center overflow-hidden">
                      <img src={`https://i.pravatar.cc/100?img=${i+10}`} alt="Student" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
                <span className="text-sm font-bold text-slate-400">Join 1,000+ focused students</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="mt-20"
          >
            <FlashcardCarousel />
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
