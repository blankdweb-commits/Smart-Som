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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header>
        <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Professional Prep</h2>
        <p className="text-slate-600 dark:text-slate-400">Choose your examination track to begin intensive study.</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {tracks.map((track) => (
          <button
            key={track.title}
            onClick={() => navigate(track.path)}
            className={`p-8 rounded-2xl border ${track.color} shadow-sm hover:shadow-md transition-all text-left flex flex-col items-start group`}
          >
            <div className="p-4 bg-white dark:bg-slate-800 rounded-xl mb-4 shadow-sm group-hover:scale-110 transition-transform">
              {track.icon}
            </div>
            <h3 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">{track.title}</h3>
            <p className="text-slate-600 dark:text-slate-400">{track.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default Prep;
