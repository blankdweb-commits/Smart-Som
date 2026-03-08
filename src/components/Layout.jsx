import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { Sun, Moon, Calendar, Menu, Settings } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const Layout = ({ children }) => {
  const location = useLocation();
  const { darkMode, toggleDarkMode } = useAppContext();

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-500 overflow-x-hidden">
      <Sidebar />

      <main className="flex-1 min-w-0 mb-20 lg:mb-0">
        {/* Top Header - Visible on all screens */}
        <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-medical-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shrink-0">N</div>
              <span className="font-bold text-slate-800 dark:text-white truncate">NursingHub</span>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              to="/settings"
              className={`p-2 rounded-lg transition-all ${
                location.pathname === '/settings'
                  ? 'bg-medical-100 text-medical-700 dark:bg-medical-900/30'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Settings size={20} />
            </Link>

            <button
              onClick={toggleDarkMode}
              className="p-2 rounded-lg text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800"
              aria-label="Toggle dark mode"
            >
              {darkMode ? <Sun size={20} className="text-amber-500" /> : <Moon size={20} className="text-medical-600" />}
            </button>
          </div>
        </header>

        <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
};

export default Layout;
