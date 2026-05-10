import React from 'react';
import { BookOpen, Brain, FileText, BarChart3, Clock, ShieldCheck } from 'lucide-react';

const values = [
  {
    icon: <BookOpen className="text-teal-400" size={32} />,
    title: "Structured nursing lessons",
    desc: "Everything you need, organized by year and subject."
  },
  {
    icon: <Brain className="text-medical-400" size={32} />,
    title: "Smart flashcards",
    desc: "Spaced-repetition tech for fast, permanent revision."
  },
  {
    icon: <FileText className="text-teal-400" size={32} />,
    title: "Exam simulations",
    desc: "Real past questions to practice under pressure."
  },
  {
    icon: <BarChart3 className="text-medical-400" size={32} />,
    title: "Progress tracking",
    desc: "See exactly where you stand in every subject."
  },
  {
    icon: <Clock className="text-teal-400" size={32} />,
    title: "Time-saving tools",
    desc: "Study 3x faster with focused curriculum paths."
  },
  {
    icon: <ShieldCheck className="text-medical-400" size={32} />,
    title: "Trusted content",
    desc: "Vetted by top nursing educators in Nigeria."
  }
];

const ValueStack = () => {
  return (
    <section className="bg-slate-900 py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-black text-white mb-4">Why Pay for Apex Scholars?</h2>
          <p className="text-slate-400">The investment that pays off in your results.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {values.map((v, i) => (
            <div key={i} className="bg-slate-800/30 border border-slate-700/50 p-8 rounded-[2rem] hover:bg-slate-800/50 transition-colors group">
              <div className="mb-6 p-4 bg-slate-900 w-fit rounded-2xl group-hover:scale-110 transition-transform">
                {v.icon}
              </div>
              <h3 className="text-xl font-black text-white mb-3">{v.title}</h3>
              <p className="text-slate-400 leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ValueStack;
