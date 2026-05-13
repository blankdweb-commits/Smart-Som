import React from 'react';
import { motion } from 'framer-motion';

const testimonials = [
  {
    quote: "I won’t lie, I was already tired. I kept reading but nothing was entering. After one week here, I started recognizing questions instead of guessing.",
    author: "Chioma E.",
    level: "Student Nurse",
    img: "https://i.pravatar.cc/150?img=32"
  },
  {
    quote: "₦1999.9 per week sounded small, but after using it, I understood the value immediately.",
    author: "Blessing O.",
    level: "Final Year",
    img: "https://i.pravatar.cc/150?img=44"
  },
  {
    quote: "I don’t have time to read everything. This helped me focus on what actually matters.",
    author: "Tunde K.",
    level: "Part-time Student",
    img: "https://i.pravatar.cc/150?img=12"
  },
  {
    quote: "The best part is I can study on the bus. No more carrying heavy textbooks everywhere.",
    author: "Ibrahim S.",
    level: "Year 2 Student",
    img: "https://i.pravatar.cc/150?img=11"
  }
];

const Testimonials = () => {
  return (
    <section className="bg-slate-900 py-24 border-y border-slate-800 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4">Real Students. Real Results.</h2>
          <p className="text-slate-400">Join thousands of Nigerian nursing students who have upgraded their study game.</p>
        </div>

        <div className="relative">
          <motion.div
            className="flex gap-6 py-10"
            animate={{
              x: [0, -1200],
            }}
            transition={{
              x: {
                repeat: Infinity,
                repeatType: "loop",
                duration: 40,
                ease: "linear",
              },
            }}
            whileHover={{ animationPlayState: 'paused' }}
          >
            {[...testimonials, ...testimonials, ...testimonials].map((t, i) => (
              <motion.div
                key={i}
                whileHover={{ scale: 1.05 }}
                className="flex-shrink-0 w-[350px] bg-slate-800/50 border border-slate-700 p-8 rounded-[2rem] backdrop-blur-sm transition-shadow hover:shadow-2xl hover:shadow-teal-500/10"
              >
                <div className="flex items-center gap-4 mb-6">
                  <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-teal-500/30">
                    <img src={t.img} alt={t.author} className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <p className="text-white font-black">{t.author}</p>
                    <p className="text-teal-500 text-xs font-bold uppercase tracking-widest">{t.level}</p>
                  </div>
                </div>

                <p className="text-slate-200 text-lg font-medium leading-relaxed mb-8">
                  "{t.quote}"
                </p>

                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <span key={s} className="text-teal-400 text-sm">★</span>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* Fade edges */}
          <div className="absolute top-0 left-0 w-32 h-full bg-gradient-to-r from-slate-900 to-transparent z-10 pointer-events-none" />
          <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-slate-900 to-transparent z-10 pointer-events-none" />
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
