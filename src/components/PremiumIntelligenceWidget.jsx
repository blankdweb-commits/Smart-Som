import React, { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { Target, TrendingDown, BookOpen, ChevronRight, Zap, AlertTriangle } from './Icons';
import { useNavigate } from 'react-router-dom';

const PremiumIntelligenceWidget = () => {
  const { userProfile, flashcards, studyStats } = useAppContext();
  const navigate = useNavigate();

  const isMonthly = userProfile.subscriptionTier === 'monthly';

  // Mock weakness tracking for demonstration (would normally come from analytics engine)
  const weaknesses = useMemo(() => {
    const subjects = [...new Set(flashcards.map(c => c.subject))];
    return subjects
      .map(s => ({
        name: s,
        accuracy: Math.floor(Math.random() * 40) + 30, // 30-70%
        count: flashcards.filter(c => c.subject === s).length
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 2);
  }, [flashcards]);

  if (!isMonthly) {
    return (
      <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden group border border-white/5">
        <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:rotate-12 transition-transform">
           <Zap size={100} />
        </div>
        <div className="relative z-10">
           <h3 className="text-xl font-black mb-2 tracking-tight uppercase">Monthly Premium</h3>
           <p className="text-white/60 text-sm font-medium mb-8 max-w-[240px]">
              Unlock Intelligent Weakness Tracking and Priority Revision suggestions.
           </p>
           <button
             onClick={() => navigate('/activate')}
             className="px-6 py-3 bg-apex-600 text-white rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all"
           >
             Upgrade to Monthly
           </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
       {/* Weakness Tracking */}
       <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
          <div className="flex items-center justify-between mb-8">
             <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                <Target size={20} className="text-red-500" />
                Focus Areas
             </h3>
             <span className="text-[10px] font-black text-red-500 bg-red-50 px-3 py-1 rounded-full uppercase tracking-widest">Action Required</span>
          </div>

          <div className="space-y-6">
             {weaknesses.map((w, i) => (
                <div key={i} className="group cursor-pointer">
                   <div className="flex justify-between items-end mb-2">
                      <div>
                         <p className="text-xs font-black text-slate-800 dark:text-white truncate max-w-[150px]">{w.name}</p>
                         <p className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">{w.count} cards in vault</p>
                      </div>
                      <div className="text-right">
                         <p className="text-sm font-black text-red-600">{w.accuracy}% Mastery</p>
                      </div>
                   </div>
                   <div className="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: `${w.accuracy}%` }} />
                   </div>
                </div>
             ))}
          </div>
       </div>

       {/* Priority Suggestion */}
       <div className="bg-indigo-600 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden group">
          <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:scale-110 transition-transform">
             <AlertTriangle size={120} />
          </div>
          <div className="relative z-10">
             <div className="flex items-center gap-2 mb-4">
                <Zap size={16} className="text-amber-400" />
                <h4 className="text-[10px] font-black uppercase tracking-widest text-white/80">Priority Revision</h4>
             </div>
             <p className="text-lg font-black mb-6 leading-tight tracking-tight">
                Master <span className="text-amber-400">"{weaknesses[0]?.name}"</span> fundamentals before your next exam cycle.
             </p>
             <button
                onClick={() => navigate(`/flashcards?subject=${encodeURIComponent(weaknesses[0]?.name)}`)}
                className="px-6 py-3 bg-white text-indigo-600 rounded-xl font-black uppercase tracking-widest text-[10px] shadow-lg active:scale-95 transition-all flex items-center gap-2"
             >
                Start Revision <ChevronRight size={14} />
             </button>
          </div>
       </div>
    </div>
  );
};

export default PremiumIntelligenceWidget;
