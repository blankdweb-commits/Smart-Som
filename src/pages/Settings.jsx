import React from 'react';
import { useAppContext } from '../context/AppContext';
import { Save, Key } from 'lucide-react';

const Settings = () => {
  const { deepSeekApiKey, setDeepSeekApiKey } = useAppContext();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 dark:text-white">Settings</h1>
          <p className="text-slate-500 dark:text-slate-400 mt-1">Configure your learning experience</p>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-700 p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2 bg-medical-100 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 rounded-lg">
            <Key size={24} />
          </div>
          <h2 className="text-xl font-semibold text-slate-800 dark:text-white">AI Integration</h2>
        </div>

        <div className="space-y-4 max-w-2xl">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              DeepSeek API Key
            </label>
            <div className="relative">
              <input
                type="password"
                value={deepSeekApiKey}
                onChange={(e) => setDeepSeekApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full pl-4 pr-12 py-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-medical-500 focus:border-transparent transition-all dark:text-white"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                <Key size={18} />
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Your API key is stored locally on your device and is only used to generate flashcard content.
              Get a key from <a href="https://platform.deepseek.com/" target="_blank" rel="noopener noreferrer" className="text-medical-600 dark:text-medical-400 hover:underline">DeepSeek Platform</a>.
            </p>
          </div>
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
