import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { Sun, Moon, Calendar } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const Layout = ({ children }) => {
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { darkMode, toggleDarkMode } = useAppContext();

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-500 overflow-x-hidden">
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />

      <main className="flex-1 min-w-0 mb-32 lg:mb-0">
        {/* Top Header - Visible on all screens */}
        <header className="sticky top-0 z-50 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border-b border-slate-100 dark:border-slate-800 px-6 py-4 flex justify-between items-center transition-all">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              <div className="w-8 h-8 bg-medical-600 rounded-xl flex items-center justify-center text-white font-black text-xl">N</div>
            </button>
            <div className="hidden lg:flex items-center gap-2">
               <span className="text-xs font-black text-slate-400 uppercase tracking-[0.3em]">Session Active</span>
               <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-lg shadow-emerald-500/50" />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/exams"
              className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold transition-all active:scale-95 shadow-sm border ${
                location.pathname === '/exams'
                  ? 'bg-medical-600 text-white border-medical-500'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-50 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              <Calendar size={18} />
              <span className="text-sm hidden sm:inline">Exam Center</span>
            </Link>

            <button
              onClick={toggleDarkMode}
              className="p-3 rounded-2xl bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-50 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95 shadow-sm"
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={20} className="text-amber-500" /> : <Moon size={20} className="text-medical-600" />}
            </button>
          </div>
        </header>

        <div className="max-w-7xl mx-auto p-6 lg:p-12">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
};

export default Layout;
