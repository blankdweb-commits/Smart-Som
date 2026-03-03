import React from 'react';
import { useAppContext } from '../context/AppContext';
import { Save, Key } from 'lucide-react';

const Settings = () => {
  return (
    <div className="space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <header className="py-4">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">System Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 font-medium text-lg mt-1">Manage your professional study environment.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-soft border border-slate-100 dark:border-slate-700 p-10 overflow-hidden relative">
          <div className="absolute top-0 right-0 w-32 h-32 bg-medical-50 dark:bg-medical-900/10 rounded-full -mr-16 -mt-16" />
          <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-6 relative z-10 flex items-center gap-3">
            <Key className="text-medical-600" />
            Core Architecture
          </h2>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed font-medium text-lg relative z-10">
            NursingHub utilizes a Clinical Learning Architecture, integrating high-fidelity curriculum data with
            Spaced Repetition Systems (SM-2) and AI-driven content synthesis.
          </p>
          <div className="mt-10 pt-10 border-t border-slate-50 dark:border-slate-700 relative z-10">
            <div className="flex items-center gap-4 p-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl">
              <div className="w-12 h-12 bg-white dark:bg-slate-800 rounded-xl flex items-center justify-center shadow-sm">
                <Save className="text-medical-600" size={24} />
              </div>
              <div>
                <p className="text-sm font-black text-slate-900 dark:text-white">Local Persistence</p>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">Auto-save active</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-medical-600 rounded-[2.5rem] shadow-clinical p-10 text-white relative overflow-hidden group">
          <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '24px 24px' }} />
          <h2 className="text-2xl font-black mb-6 relative z-10">Clinical Support</h2>
          <p className="text-white/80 leading-relaxed font-medium text-lg relative z-10 mb-10">
            Encountering a technical discrepancy? Our specialized nursing support team is available to assist with curriculum navigation and technical diagnostics.
          </p>
          <button className="w-full py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 relative z-10">
            Contact Diagnostic Support
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
