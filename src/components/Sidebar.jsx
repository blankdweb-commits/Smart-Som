import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Volume2, Settings, Sun, Moon, Menu, X, Award, Users } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const Sidebar = ({ isOpen, setIsOpen }) => {
  const { darkMode } = useAppContext();

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { name: 'Academic Cards', icon: BookOpen, path: '/flashcards' },
    { name: 'Professional Prep', icon: Award, path: '/prep' },
    { name: 'Exam Timetable', icon: Calendar, path: '/exams' },
    { name: 'Pronunciation', icon: Volume2, path: '/pronunciation' },
    { name: 'Community', icon: Users, path: '/community' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  return (
    <>
      {/* Sidebar - hidden on mobile, visible on large screens */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-72 bg-white dark:bg-slate-900 shadow-clinical transform transition-transform duration-500 ease-in-out border-r border-slate-100 dark:border-slate-800
        ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:inset-0
      `}>
        <div className="flex flex-col h-full">
          <div className="p-8">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 bg-medical-600 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-lg shadow-medical-500/20">N</div>
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">NursingHub</h1>
            </div>
            <p className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] ml-1">Clinical Suite v2.0</p>
          </div>

          <nav className="flex-1 px-6 space-y-3">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                onClick={() => setIsOpen(false)}
                className={({ isActive }) => `
                  flex items-center px-5 py-4 rounded-[1.25rem] transition-all duration-300 group
                  ${isActive
                    ? 'bg-medical-600 text-white shadow-clinical translate-x-1'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800'}
                `}
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={`mr-4 transition-transform group-hover:scale-110 ${isActive ? 'text-white' : 'text-slate-400 dark:text-slate-500'}`} size={22} />
                    <span className="font-bold tracking-tight">{item.name}</span>
                    {isActive && (
                      <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full shadow-lg" />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="p-8 mt-auto">
            <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-3xl border border-slate-100 dark:border-slate-800">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">Pro Member</p>
              <div className="flex items-center gap-2">
                <Award size={16} className="text-medical-600" />
                <span className="text-sm font-black dark:text-white">Exam Ready</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
