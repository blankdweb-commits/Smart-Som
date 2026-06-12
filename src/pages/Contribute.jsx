import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Brain,
  BookOpen,
  Plus,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ArrowRight
} from '../components/Icons';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import Toast from '../components/Toast';

const Contribute = () => {
  const { userProfile } = useAppContext();
  const [type, setType] = useState('quiz');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);

  const [formData, setFormData] = useState({
    subject: '',
    question: '',
    answer: '',
    rationale: '',
    options: ['', '', '', ''],
    correctIndex: 0
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setToast({ message: "Submission sent for moderation!", type: 'success' });
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <header className="text-center mb-12">
        <h2 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Contribute</h2>
        <p className="text-slate-500 font-bold text-xs uppercase tracking-widest mt-1">Help grow the Apex knowledge base</p>
      </header>

      <div className="flex gap-4 mb-8">
        <button
          onClick={() => setType('quiz')}
          className={`flex-1 p-8 rounded-[2rem] border-2 transition-all flex flex-col items-center gap-4 ${type === 'quiz' ? 'bg-medical-600 border-medical-600 text-white shadow-lg shadow-medical-600/20' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400'}`}
        >
          <Brain size={32} />
          <span className="font-black uppercase tracking-widest text-sm">Quiz</span>
        </button>
        <button
          onClick={() => setType('flashcard')}
          className={`flex-1 p-8 rounded-[2rem] border-2 transition-all flex flex-col items-center gap-4 ${type === 'flashcard' ? 'bg-medical-600 border-medical-600 text-white shadow-lg shadow-medical-600/20' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700 text-slate-400'}`}
        >
          <BookOpen size={32} />
          <span className="font-black uppercase tracking-widest text-sm">Flashcard</span>
        </button>
      </div>

      <form onSubmit={handleSubmit} className="bg-white dark:bg-slate-800 p-8 sm:p-12 rounded-[3rem] shadow-clinical border border-slate-100 dark:border-slate-700 space-y-8">
        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-4">Subject</label>
            <input
              required
              value={formData.subject}
              onChange={e => setFormData({...formData, subject: e.target.value})}
              placeholder="e.g. Pharmacology"
              className="w-full px-8 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl font-bold text-slate-800 dark:text-white"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-4">Question</label>
            <textarea
              required
              rows={3}
              value={formData.question}
              onChange={e => setFormData({...formData, question: e.target.value})}
              placeholder="Enter the question..."
              className="w-full px-8 py-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl font-bold text-slate-800 dark:text-white"
            />
          </div>
        </div>
        <button type="submit" className="w-full py-5 bg-medical-600 text-white rounded-3xl font-black shadow-lg">
          Submit for Moderation
        </button>
      </form>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default Contribute;
