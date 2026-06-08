import React from 'react';
import { TrendingUp, Users, BookOpen, CheckCircle2 } from './Icons';
import { useAppContext } from '../context/AppContext';

const AdminAnalytics = () => {
  const { allFlashcards = [] } = useAppContext();

  const subjects = [...new Set(allFlashcards.map(c => c.subject))];
  const totalQuestions = allFlashcards.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <AnalyticsCard title="Total Bank Size" value={totalQuestions} icon={<BookOpen />} color="text-medical-600 bg-medical-50" />
        <AnalyticsCard title="Active Subjects" value={subjects.length} icon={<TrendingUp />} color="text-amber-600 bg-amber-50" />
        <AnalyticsCard title="Verified Sources" value="12" icon={<CheckCircle2 />} color="text-emerald-600 bg-emerald-50" />
        <AnalyticsCard title="Daily Active Users" value="1.2k" icon={<Users />} color="text-indigo-600 bg-indigo-50" />
      </div>

      <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700">
        <h3 className="text-xl font-black mb-6 uppercase tracking-tight">Subject Coverage</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {subjects.slice(0, 9).map(sub => {
            const count = allFlashcards.filter(c => c.subject === sub).length;
            return (
              <div key={sub} className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 flex justify-between items-center">
                <span className="text-sm font-bold text-slate-600 dark:text-slate-300 truncate mr-4">{sub}</span>
                <span className="text-xs font-black bg-white dark:bg-slate-800 px-2 py-1 rounded-lg shadow-sm">{count} qs</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const AnalyticsCard = ({ title, value, icon, color }) => (
  <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700">
    <div className={`w-10 h-10 ${color} rounded-xl flex items-center justify-center mb-4`}>
      {React.cloneElement(icon, { size: 20 })}
    </div>
    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
    <p className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{value}</p>
  </div>
);

export default AdminAnalytics;
