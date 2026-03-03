import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Award, CheckCircle } from 'lucide-react';

const Prep = () => {
  const navigate = useNavigate();

  const tracks = [
    {
      title: 'NCLEX-RN Prep',
      description: 'Standardized examination for the licensing of nurses in the US and Canada.',
      path: '/nclex',
      icon: <Award className="text-blue-600" size={32} />,
      color: 'bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800'
    },
    {
      title: 'NMCN Council Prep',
      description: 'Professional exams for Nursing and Midwifery Council of Nigeria.',
      path: '/nmcn',
      icon: <CheckCircle className="text-emerald-600" size={32} />,
      color: 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
    }
  ];

  return (
    <div className="space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="py-4">
        <h2 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">Professional Certification</h2>
        <p className="text-slate-500 dark:text-slate-400 font-medium text-lg mt-1">High-yield prep tracks for international and national licensure exams.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {tracks.map((track) => (
          <button
            key={track.title}
            onClick={() => navigate(track.path)}
            className={`p-10 rounded-[2.5rem] border-2 shadow-soft hover:shadow-clinical ${track.color} transition-all text-left flex flex-col items-start group relative overflow-hidden`}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-white/20 dark:bg-black/10 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform" />

            <div className="p-5 bg-white dark:bg-slate-800 rounded-2xl mb-8 shadow-sm group-hover:scale-110 transition-transform relative z-10">
              {track.icon}
            </div>
            <h3 className="text-3xl font-black text-slate-900 dark:text-white mb-3 relative z-10">{track.title}</h3>
            <p className="text-slate-600 dark:text-slate-400 text-lg leading-relaxed relative z-10">{track.description}</p>

            <div className="mt-10 flex items-center font-bold text-slate-900 dark:text-white relative z-10 uppercase tracking-widest text-sm">
              Start Intensive Prep <BookOpen size={18} className="ml-2 group-hover:translate-x-1 transition-transform" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Prep;
