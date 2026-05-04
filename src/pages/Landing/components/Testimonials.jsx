import React from 'react';
import { motion } from 'framer-motion';

const testimonials = [
  {
    quote: "I used to fail past questions. After one week here, I understood patterns.",
    author: "Chioma",
    school: "Nursing Student (UNILAG)"
  },
  {
    quote: "The flashcards alone are worth it. I revise anywhere now.",
    author: "Musa",
    school: "Student Nurse"
  },
  {
    quote: "₦1999 is nothing compared to what I gained.",
    author: "Blessing",
    school: "Final Year"
  },
  {
    quote: "Apex Scholars made pharmacology so much easier to grasp.",
    author: "Ibrahim",
    school: "Nursing Student"
  }
];

const Testimonials = () => {
  return (
    <section className="bg-slate-900 py-24 border-y border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4">Trusted by Students</h2>
          <p className="text-slate-400">Join thousands of students who have upgraded their study game.</p>
        </div>

        <div className="relative overflow-hidden py-10">
          <motion.div
            className="flex gap-6"
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
          >
            {[...testimonials, ...testimonials].map((t, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-[350px] bg-slate-800/50 border border-slate-700 p-8 rounded-[2rem] backdrop-blur-sm"
              >
                <div className="flex gap-1 mb-6">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <div key={s} className="w-4 h-4 text-teal-400">
                      ★
                    </div>
                  ))}
                </div>
                <p className="text-white text-lg font-medium italic mb-8">
                  "{t.quote}"
                </p>
                <div>
                  <p className="text-white font-black">{t.author}</p>
                  <p className="text-teal-500 text-sm font-bold">{t.school}</p>
                </div>
              </div>
            ))}
          </motion.div>

          {/* Fade edges */}
          <div className="absolute top-0 left-0 w-32 h-full bg-gradient-to-r from-slate-900 to-transparent z-10" />
          <div className="absolute top-0 right-0 w-32 h-full bg-gradient-to-l from-slate-900 to-transparent z-10" />
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
