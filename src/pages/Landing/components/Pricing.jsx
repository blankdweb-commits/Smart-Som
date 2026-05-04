import React from 'react';
import CountdownTimer from './CountdownTimer';

const Pricing = () => {
  return (
    <section className="bg-slate-900 py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl mx-auto bg-gradient-to-br from-slate-800 to-slate-900 border border-teal-500/30 rounded-[3rem] p-8 md:p-12 shadow-2xl relative overflow-hidden">
          {/* Urgency Badge */}
          <div className="absolute top-6 right-[-40px] rotate-45 bg-teal-500 text-slate-900 px-12 py-1 text-xs font-black uppercase tracking-widest shadow-lg">
            Limited
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl font-black text-white mb-2 uppercase tracking-widest">Weekly Access</h2>
            <p className="text-slate-400">Unlock everything for 7 days</p>
          </div>

          <div className="flex items-center justify-center gap-4 mb-8">
            <span className="text-2xl text-slate-500 line-through font-bold">₦3000</span>
            <div className="flex flex-col items-center">
              <span className="text-6xl font-black text-white tracking-tighter">₦1999.9</span>
              <span className="text-teal-400 font-bold text-xs uppercase tracking-widest mt-1">Special Offer</span>
            </div>
          </div>

          <div className="space-y-4 mb-10">
            {[
              'Full Curriculum Library',
              'Smart SRS Flashcards',
              'Past Exam Database',
              'Performance Analytics',
              'Priority Support'
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-5 h-5 rounded-full bg-teal-500/10 flex items-center justify-center text-teal-400">
                  ✓
                </div>
                <span className="text-slate-300 font-medium">{item}</span>
              </div>
            ))}
          </div>

          <button className="w-full py-5 bg-teal-500 hover:bg-teal-400 text-slate-900 font-black rounded-2xl shadow-xl shadow-teal-500/20 transition-all active:scale-95 text-xl mb-6">
            Get Access Now — ₦1999.9
          </button>

          <div className="text-center">
            <p className="text-teal-400 font-black text-sm uppercase tracking-widest mb-4">Price resets in</p>
            <CountdownTimer />
            <p className="text-slate-500 text-xs mt-4 italic">“Limited student pricing — may increase soon”</p>
            <p className="text-teal-500/70 text-[10px] mt-2 font-bold uppercase tracking-tighter">Students are locking in this rate now</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Pricing;
