import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Volume2, Settings, Award, Users, Search, Brain, FileUp, Shield } from './Icons';
import { useAppContext } from '../context/AppContext';

const Sidebar = () => {
  const { userProfile } = useAppContext();

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Flashcards', icon: BookOpen, path: '/flashcards' },
    { name: 'Quiz Mode', icon: Brain, path: '/quiz' },
    { name: 'Exam Timetable', icon: Calendar, path: '/exams' },
    { name: 'Past Questions', icon: FileUp, path: '/papers' },
    { name: 'Pronunciation', icon: Volume2, path: '/pronunciation' },
    { name: 'Community', icon: Users, path: '/community' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  // Admin surfaces are only linked for elevated roles; routes stay technically
  // open by design (dashboard-first), but are not discoverable here.
  const adminItems = userProfile.isAdmin ? [
    { name: 'Finance Admin', icon: Shield, path: '/admin/finance' },
    { name: 'Question Bank', icon: Search, path: '/admin/questions' },
  ] : [];

  return (
    <>
      {/* Sidebar - hidden on mobile, visible on large screens */}
      <div className="hidden lg:block w-64 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-800 transition-all duration-300">
        <div className="flex flex-col h-full sticky top-0">
          <div className="p-6">
            <h1 className="text-2xl font-black text-apex-600 dark:text-apex-400 tracking-tighter">Apex Scholars</h1>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1 font-black uppercase tracking-widest">Rise to Excellence</p>
          </div>

          <nav className="flex-1 px-4 space-y-1 mt-4 overflow-y-auto">
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

            {adminItems.length > 0 && (
              <>
                <div className="pt-4 pb-1 px-4">
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-[0.2em] border-t border-slate-100 dark:border-slate-700 pt-3">Administration</p>
                </div>
                {adminItems.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.path}
                    className={({ isActive }) => `
                      flex items-center px-4 py-3 rounded-xl transition-all duration-200
                      ${isActive
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 font-bold'
                        : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50'}
                    `}
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={`mr-3 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} size={20} />
                        <span>{item.name}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </>
            )}
          </nav>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
