import React, { useState } from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { Sun, Moon } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const Layout = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { darkMode, toggleDarkMode } = useAppContext();

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      {/* Mobile Backdrop */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <Sidebar isOpen={isSidebarOpen} setIsOpen={setIsSidebarOpen} />

      <main className="flex-1 overflow-auto mb-16 lg:mb-0">
        {/* Top Header - Visible on all screens */}
        <header className="sticky top-0 z-20 bg-white/80 dark:bg-slate-800/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-700 p-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-medical-600 rounded-lg flex items-center justify-center text-white font-bold text-xl">N</div>
            <span className="font-bold text-slate-800 dark:text-white">NursingHub</span>
          </div>

          <button
            onClick={toggleDarkMode}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600 transition-all active:scale-95"
            aria-label="Toggle dark mode"
          >
            {darkMode ? <Sun size={20} className="text-amber-500" /> : <Moon size={20} className="text-medical-600" />}
          </button>
        </header>

        <div className="max-w-7xl mx-auto p-4 lg:p-8">
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
};

export default Layout;
