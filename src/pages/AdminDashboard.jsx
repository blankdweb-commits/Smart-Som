import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck,
  Check,
  X,
  Brain,
  BookOpen,
  User,
  Clock,
  ArrowRight,
  Loader2,
  Filter
} from '../components/Icons';
import { supabase } from '../utils/supabase';
import Toast from '../components/Toast';

const AdminDashboard = () => {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('pending');

  return (
    <div className="max-w-6xl mx-auto pb-20">
      <header className="flex justify-between items-center mb-10">
        <div>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Content Moderation</h2>
          <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">Review and approve student contributions</p>
        </div>
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
          {['pending', 'approved', 'rejected'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${filter === f ? 'bg-white dark:bg-slate-700 text-medical-600 shadow-sm' : 'text-slate-400'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      <div className="bg-white dark:bg-slate-800 p-20 rounded-[3rem] text-center shadow-clinical border border-slate-100 dark:border-slate-700">
         <div className="w-20 h-20 bg-slate-50 dark:bg-slate-900 rounded-full flex items-center justify-center mx-auto mb-6 text-slate-300">
            <Check size={40} />
         </div>
         <h3 className="text-2xl font-black text-slate-900 dark:text-white">Queue is Empty</h3>
         <p className="text-slate-500 mt-2 font-medium">No {filter} submissions found. Good job!</p>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default AdminDashboard;
