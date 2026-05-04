import React from 'react';
import { motion } from 'framer-motion';

const StudentGallery = () => {
  return (
    <section className="bg-slate-900 py-24 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div className="relative">
            <div className="grid grid-cols-2 gap-4">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="aspect-[3/4] rounded-[2rem] overflow-hidden shadow-2xl relative group"
              >
                <img
                  src="https://images.unsplash.com/photo-1523240715632-d984bb4b970e?q=80&w=1000&auto=format&fit=crop"
                  alt="Student Studying"
                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-60" />
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="aspect-[3/4] rounded-[2rem] overflow-hidden shadow-2xl mt-8 relative group"
              >
                <img
                  src="https://images.unsplash.com/photo-1543269865-cbf427effbad?q=80&w=1000&auto=format&fit=crop"
                  alt="Group Study"
                  className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-transparent to-transparent opacity-60" />
              </motion.div>
            </div>

            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20">
              <div className="bg-teal-500 text-slate-900 px-6 py-4 rounded-2xl shadow-2xl font-black text-xl rotate-[-5deg] whitespace-nowrap">
                “Late-night prep. Early success.”
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <h2 className="text-3xl md:text-5xl font-black text-white leading-tight">
              Built for the <br />
              <span className="text-teal-400">Next Generation</span> <br />
              of Nigerian Nurses.
            </h2>
            <p className="text-lg text-slate-400 leading-relaxed">
              We know how demanding nursing school is. That's why we built Apex Scholars—to give you the edge you need to master your curriculum and crush your exams.
            </p>
            <div className="space-y-4">
              {['Realistic Exam Scenarios', 'Nigerian Curriculum Focused', 'Study Anywhere, Anytime'].map((item, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-full bg-teal-500/20 border border-teal-500/50 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-teal-400" />
                  </div>
                  <span className="text-white font-bold">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default StudentGallery;
