import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import {
  Save,
  Key,
  User,
  Shield,
  TrendingUp,
  ChevronRight,
  Lock,
  Trash2,
  Info,
  CheckCircle2,
  AlertCircle,
  Volume2,
  VolumeX,
  Sun,
  Moon,
  LayoutDashboard,
  Settings as SettingsIcon,
  Database
} from '../components/Icons';
import { motion } from 'framer-motion';
import Toast from '../components/Toast';

const Settings = () => {
  const {
    userProfile, updateProfile,
    darkMode, toggleDarkMode,
    soundEnabled, toggleSound
  } = useAppContext();
  const navigate = useNavigate();
  const [toast, setToast] = useState(null);

  const toggleAdminMode = () => {
    const isAdmin = !userProfile.isAdmin;
    updateProfile({ isAdmin });
    setToast({
      message: isAdmin ? 'Admin mode enabled' : 'Admin mode disabled',
      type: 'info'
    });
  };

  return (
    <div className="space-y-8 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700 max-w-6xl mx-auto px-4">
      <header>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Personalize your clinical training environment.</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">

          {/* Preferences Section */}
          <section className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
            <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-8 flex items-center gap-3">
              <LayoutDashboard className="text-medical-600" size={24} />
              Preferences
            </h2>

            <div className="space-y-4">
              {/* Theme Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-xl ${darkMode ? 'bg-amber-100 text-amber-600' : 'bg-medical-100 text-medical-600'}`}>
                    {darkMode ? <Sun size={20} /> : <Moon size={20} />}
                  </div>
                  <div>
                    <p className="font-black text-slate-900 dark:text-white text-sm">Theme</p>
                    <p className="text-[10px] text-slate-500 font-medium">{darkMode ? 'Light mode available' : 'Dark mode available'}</p>
                  </div>
                </div>
                <button
                  onClick={toggleDarkMode}
                  className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${darkMode ? 'bg-white text-slate-900 shadow-sm' : 'bg-slate-900 text-white'}`}
                >
                  {darkMode ? 'Switch to Light' : 'Switch to Dark'}
                </button>
              </div>

              {/* Sound Toggle */}
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-xl ${soundEnabled ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                    {soundEnabled ? <Volume2 size={20} /> : <VolumeX size={20} />}
                  </div>
                  <div>
                    <p className="font-black text-slate-900 dark:text-white text-sm">Sound Effects</p>
                    <p className="text-[10px] text-slate-500 font-medium">{soundEnabled ? 'Interactive audio active' : 'Audio muted'}</p>
                  </div>
                </div>
                <button
                  onClick={toggleSound}
                  className={`px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${soundEnabled ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' : 'bg-slate-200 text-slate-500'}`}
                >
                  {soundEnabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            </div>
          </section>

          {/* Admin Access Section */}
          {userProfile.isAdmin && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-medical-50 dark:bg-medical-900/20 rounded-[2.5rem] p-8 shadow-clinical border border-medical-100 dark:border-medical-800/50"
            >
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight mb-6 flex items-center gap-2">
                <Shield className="text-medical-600" /> Administrative Access
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => navigate('/admin/finance')}
                  className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-medical-200 dark:border-medical-900 flex items-center justify-between group hover:border-medical-500 transition-all shadow-sm"
                >
                  <div className="flex items-center gap-4 text-left">
                    <div className="w-12 h-12 bg-medical-50 dark:bg-medical-900/30 text-medical-600 rounded-xl flex items-center justify-center">
                      <TrendingUp size={24} />
                    </div>
                    <div>
                      <p className="font-black text-slate-900 dark:text-white text-sm">Finance</p>
                      <p className="text-[10px] text-slate-500 font-medium">Monitor fees</p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-medical-600" />
                </button>

                <button
                  onClick={() => navigate('/admin/questions')}
                  className="p-6 bg-white dark:bg-slate-800 rounded-2xl border border-medical-200 dark:border-medical-900 flex items-center justify-between group hover:border-medical-500 transition-all shadow-sm"
                >
                  <div className="flex items-center gap-4 text-left">
                    <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-xl flex items-center justify-center">
                      <Database size={24} />
                    </div>
                    <div>
                      <p className="font-black text-slate-900 dark:text-white text-sm">Question Bank</p>
                      <p className="text-[10px] text-slate-500 font-medium">Manage content</p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 group-hover:text-medical-600" />
                </button>
              </div>
            </motion.section>
          )}

          <section className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
            <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-8">System Tools</h2>
            <div className="space-y-3">
              <button
                onClick={toggleAdminMode}
                className="w-full flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-all group"
              >
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${userProfile.isAdmin ? 'bg-medical-100 text-medical-600' : 'bg-slate-200 text-slate-500'}`}>
                    <Shield size={20} />
                  </div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {userProfile.isAdmin ? 'Disable Admin Mode' : 'Enable Admin Mode (Mock)'}
                  </span>
                </div>
                <ChevronRight size={18} className="text-slate-300" />
              </button>

              <button
                className="w-full flex items-center justify-between p-5 bg-slate-50 dark:bg-slate-900/50 rounded-2xl hover:bg-red-50 dark:hover:bg-red-900/10 transition-all group"
                onClick={() => {
                   if(window.confirm('This will wipe all local data. Continue?')) {
                     localStorage.clear();
                     window.location.reload();
                   }
                }}
              >
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-red-100 text-red-500 rounded-lg">
                    <Trash2 size={20} />
                  </div>
                  <span className="text-sm font-bold text-red-500">Reset Local Data</span>
                </div>
              </button>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <div className="bg-indigo-600 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-10 group-hover:scale-110 transition-transform">
              <Info size={120} />
            </div>
            <h2 className="text-2xl font-black mb-4 relative z-10">About</h2>
            <p className="text-indigo-100 leading-relaxed font-medium relative z-10">
              Apex Scholars is a clinical learning suite designed for Nursing and Midwifery students, featuring integrated curriculum data and spaced repetition tools.
            </p>
            <div className="mt-8 pt-8 border-t border-white/20 relative z-10">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60">Version</p>
              <p className="text-sm font-bold">4.2.0 (Clinical Build)</p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-8 shadow-clinical border border-slate-100 dark:border-slate-700">
             <div className="flex items-center gap-3 text-emerald-500 mb-4">
                <CheckCircle2 size={24} />
                <h4 className="font-black uppercase tracking-tight">System Healthy</h4>
             </div>
             <p className="text-xs text-slate-500 font-medium leading-relaxed">
                All local modules are operational. Spaced repetition engine is active.
             </p>
          </div>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
};

export default Settings;
