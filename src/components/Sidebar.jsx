import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Volume2, Settings, Sun, Moon, Menu, X, Award } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const Sidebar = ({ isOpen, setIsOpen }) => {
  const { darkMode, toggleDarkMode } = useAppContext();

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { name: 'Academic Cards', icon: BookOpen, path: '/flashcards' },
    { name: 'Professional Prep', icon: Award, path: '/prep' },
    { name: 'Exam Timetable', icon: Calendar, path: '/exams' },
    { name: 'Pronunciation', icon: Volume2, path: '/pronunciation' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <>
      {/* Sidebar - hidden on mobile, visible on large screens */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-white dark:bg-slate-800 shadow-xl transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:inset-0
      `}>
        <div className="flex flex-col h-full">
          <div className="p-6">
            <h1 className="text-2xl font-bold text-medical-600 dark:text-medical-400">NursingHub</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Medical Learning Suite</p>
          </div>

          <nav className="flex-1 px-4 space-y-2">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                onClick={() => setIsOpen(false)}
                className={({ isActive }) => `
                  flex items-center px-4 py-3 rounded-lg transition-colors
                  ${isActive
                    ? 'bg-medical-100 text-medical-700 dark:bg-medical-900/30 dark:text-medical-400'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'}
                `}
              >
                <item.icon className="mr-3" size={20} />
                <span className="font-medium">{item.name}</span>
              </NavLink>
            ))}
          </nav>

          <div className="p-4 border-t border-slate-200 dark:border-slate-700">
            <button
              onClick={toggleDarkMode}
              className="flex items-center w-full px-4 py-3 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700 transition-colors"
            >
              {darkMode ? (
                <>
                  <Sun className="mr-3" size={20} />
                  <span className="font-medium">Light Mode</span>
                </>
              ) : (
                <>
                  <Moon className="mr-3" size={20} />
                  <span className="font-medium">Dark Mode</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

    </>
  );
};

export default Sidebar;
