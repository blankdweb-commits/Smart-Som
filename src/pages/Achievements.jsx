import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import { ArrowLeft, Award, Lock, Loader2 } from '../components/Icons';

const Achievements = () => {
  const { userAchievements, session } = useAppContext();
  const navigate = useNavigate();
  const [catalog, setCatalog] = useState([]); // [{ id, key, name, description, emoji }]
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!supabase) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.from('achievements').select('id, key, name, description, emoji').order('id');
      if (active) {
        if (!error) setCatalog(data || []);
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const unlockedByKey = useMemo(() => {
    const map = new Map();
    (userAchievements || []).forEach(u => map.set(String(u.achievement_id), u));
    return map;
  }, [userAchievements]);

  const unlockedCount = catalog.filter(c => unlockedByKey.has(String(c.id))).length;

  if (!session) return null;

  return (
    <div className="max-w-2xl mx-auto pb-32 px-4 animate-in fade-in duration-500 space-y-6">
      <header className="text-center pt-4 sm:pt-8">
        <button
          onClick={() => navigate(-1)}
          className="absolute left-4 top-4 sm:left-auto sm:top-8 inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <div className="w-14 h-14 mx-auto rounded-2xl bg-apex-600/10 border border-apex-600/30 flex items-center justify-center mb-4">
          <Award size={26} className="text-apex-600" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Achievements</h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mt-1">
          Milestones earned through real study — no grind, just consistency.
        </p>
      </header>

      <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Unlocked</p>
          <p className="text-3xl font-black text-slate-900 dark:text-white tracking-tighter">
            {unlockedCount}<span className="text-lg text-slate-400">/{catalog.length}</span>
          </p>
        </div>
        <div className="w-full max-w-[150px] h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden border border-slate-50 dark:border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-apex-500 to-apex-600 rounded-full transition-all duration-700"
            style={{ width: `${catalog.length ? Math.round((unlockedCount / catalog.length) * 100) : 0}%` }}
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
          <Loader2 size={28} className="animate-spin" />
          <p className="text-xs font-black uppercase tracking-widest">Loading the vault…</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {catalog.map(c => {
            const owned = unlockedByKey.has(String(c.id));
            return (
              <div
                key={c.id}
                className={`relative p-5 rounded-3xl border transition-all ${
                  owned
                    ? 'bg-white dark:bg-slate-800 shadow-clinical border-apex-600/40'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-100 dark:border-slate-700 opacity-80'
                }`}
              >
                {!owned && (
                  <div className="absolute top-4 right-4 text-slate-300 dark:text-slate-600">
                    <Lock size={14} />
                  </div>
                )}
                <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-xl mb-3 ${owned ? (c.tone || 'bg-apex-600/10') : 'bg-slate-100 dark:bg-slate-900 grayscale'}`}>
                  {c.emoji || '🏆'}
                </div>
                <h3 className={`text-sm font-black uppercase tracking-tight ${owned ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>
                  {c.name}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-1 leading-snug">{c.description}</p>
                {owned ? (
                  <p className="text-[9px] font-black uppercase tracking-widest text-apex-600 dark:text-apex-400 mt-2">Unlocked</p>
                ) : (
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-300 dark:text-slate-600 mt-2">Locked</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Achievements;