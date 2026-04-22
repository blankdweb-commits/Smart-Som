import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Volume2, Settings, Award, Users, Search, Brain } from './Icons';

const Sidebar = () => {

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { name: 'Flashcards', icon: BookOpen, path: '/flashcards' },
    { name: 'Quiz Mode', icon: Brain, path: '/quiz' },
    { name: 'Exam Timetable', icon: Calendar, path: '/exams' },
    { name: 'Pronunciation', icon: Volume2, path: '/pronunciation' },
    { name: 'Community', icon: Users, path: '/community' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <>
      {/* Sidebar - hidden on mobile, visible on large screens */}
      <div className="hidden lg:block w-64 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-800 transition-all duration-300">
        <div className="flex flex-col h-full sticky top-0">
          <div className="p-6">
            <h1 className="text-2xl font-bold text-medical-600 dark:text-medical-400">NursingHub</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-bold uppercase tracking-widest">Medical Learning</p>
          </div>

          <nav className="flex-1 px-4 space-y-1 mt-4">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) => `
                  flex items-center px-4 py-3 rounded-xl transition-all duration-200
                  ${isActive
                    ? 'bg-medical-50 text-medical-700 dark:bg-medical-900/30 dark:text-medical-400 font-bold'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50'}
                `}
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={`mr-3 ${isActive ? 'text-medical-600' : 'text-slate-400'}`} size={20} />
                    <span>{item.name}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
