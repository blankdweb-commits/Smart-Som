import React from 'react';
import { motion } from 'framer-motion';

const DashboardPreview = () => {
  return (
    <section className="bg-slate-900 py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4">Your Dashboard is Waiting</h2>
          <p className="text-slate-400 italic">“Your dashboard is ready — unlock access to continue”</p>
        </div>

        <div className="relative group">
          {/* Blurred UI Preview */}
          <div className="bg-slate-800 rounded-[3rem] p-8 border border-slate-700 blur-md pointer-events-none opacity-40 transition-all group-hover:opacity-30">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-24 bg-slate-700 rounded-2xl" />
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 h-96 bg-slate-700 rounded-3xl" />
              <div className="h-96 bg-slate-700 rounded-3xl" />
            </div>
          </div>

          {/* Overlay CTA */}
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="bg-slate-900/80 backdrop-blur-xl border border-teal-500/30 p-12 rounded-[3rem] shadow-2xl text-center max-w-lg mx-4"
            >
              <div className="w-20 h-20 bg-teal-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                <div className="w-10 h-10 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
              </div>
              <h3 className="text-2xl font-black text-white mb-4 uppercase tracking-widest">Awaiting Activation</h3>
              <p className="text-slate-400 mb-8 font-medium">
                We've prepared your personalized learning path. Complete your weekly subscription to unlock all features immediately.
              </p>
              <button className="w-full py-4 bg-teal-500 hover:bg-teal-400 text-slate-900 font-black rounded-2xl shadow-xl shadow-teal-500/20 transition-all active:scale-95 text-lg">
                Unlock Weekly Access — ₦1999.9
              </button>
            </motion.div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default DashboardPreview;
