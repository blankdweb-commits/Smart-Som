import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Volume2, Settings, Award, Users, Search, Brain, FileUp, Shield, Coins, Target } from './Icons';
import { useAppContext } from '../context/AppContext';

const Sidebar = () => {
  const { userProfile, smartCoins } = useAppContext();

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Flashcards', icon: BookOpen, path: '/flashcards' },
    { name: 'Quiz Mode', icon: Brain, path: '/quiz' },
    { name: 'Weakness Drill', icon: Target, path: '/weakness-drill' },
    { name: 'Achievements', icon: Award, path: '/achievements' },
    { name: 'Exam Timetable', icon: Calendar, path: '/exams' },
    { name: 'Marketplace', icon: FileUp, path: '/marketplace' },
    { name: 'Voting', icon: Award, path: '/voting' },
    { name: 'Pronunciation', icon: Volume2, path: '/pronunciation' },
    { name: 'Community', icon: Users, path: '/community' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  // Admin surfaces are only linked for elevated roles; routes stay technically
  // open by design (dashboard-first), but are not discoverable here.
  const adminItems = userProfile.isAdmin ? [
    { name: 'Finance Admin', icon: Shield, path: '/admin/finance' },
    { name: 'User Management', icon: Users, path: '/admin/users' },
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

          {/* Smart Coin wallet badge */}
          <div className="p-4 mt-2 border-t border-slate-100 dark:border-slate-700">
            <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
              <div className="flex items-center">
                <Coins className="mr-2 text-amber-500" size={20} />
                <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wide">Smart Coins</span>
              </div>
              <span className="text-lg font-black text-amber-600 dark:text-amber-400">{smartCoins}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Sidebar;
