import React from 'react';
import { useAppContext } from '../context/AppContext';
import { Save, Key } from 'lucide-react';

const Settings = () => {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Settings</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Configure your learning experience</p>
        </div>
      </div>


      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-white mb-4">About NursingHub</h2>
        <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
          NursingHub is a modern learning management system tailored for nursing and midwifery students.
          It combines structured curriculum data with advanced learning techniques like Spaced Repetition (SRS)
          and AI-powered content generation to help you master complex medical topics.
        </p>
      </div>
    </div>
  );
};

export default Settings;
