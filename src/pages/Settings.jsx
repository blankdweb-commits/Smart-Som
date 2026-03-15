import React from 'react';
import { Save, Key } from 'lucide-react';

const Settings = () => {
  return (
    <div className="space-y-6 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header>
        <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 mt-1">Manage your study portal configuration.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4 flex items-center gap-2">
            <Key className="text-medical-600" size={20} />
            Application Status
          </h2>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            NursingHub is configured for local data persistence. Your study progress and flashcards are stored securely in your browser.
          </p>
          <div className="mt-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl flex items-center gap-3">
            <Save className="text-medical-600" size={20} />
            <span className="text-sm font-bold text-slate-700 dark:text-slate-300">Auto-save Enabled</span>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-8">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white mb-4">About</h2>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            NursingHub is a clinical learning suite designed for Nursing and Midwifery students, featuring integrated curriculum data and spaced repetition tools.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Settings;
