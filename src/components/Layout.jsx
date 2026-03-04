import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { Sun, Moon, Calendar, Menu } from 'lucide-react';
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

      <main className="flex-1 min-w-0 mb-20 lg:mb-0">
        {/* Top Header - Visible on all screens */}
        <header className="sticky top-0 z-40 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-2 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg"
            >
              <Menu size={24} className="text-slate-600 dark:text-slate-400" />
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-medical-600 rounded-lg flex items-center justify-center text-white font-bold text-xl shrink-0">N</div>
              <span className="font-bold text-slate-800 dark:text-white truncate">NursingHub</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/exams"
              className={`p-2 rounded-lg transition-all ${
                location.pathname === '/exams'
                  ? 'bg-medical-100 text-medical-700 dark:bg-medical-900/30'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Calendar size={20} />
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
