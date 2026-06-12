import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  Calendar,
  Settings,
  Users,
  Brain,
  FileUp,
  Award,
  Sparkles,
  ShieldCheck,
  CreditCard
} from './Icons';
import { useAppContext } from '../context/AppContext';

const Sidebar = () => {
  const { isAdministrator, isFinancialAdmin } = useAppContext();

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Flashcards', icon: BookOpen, path: '/flashcards' },
    { name: 'Quiz Mode', icon: Brain, path: '/quiz' },
    { name: 'Contribute', icon: Sparkles, path: '/contribute' },
    { name: 'Exams', icon: Calendar, path: '/exams' },
    { name: 'Papers AI', icon: FileUp, path: '/papers' },
    { name: 'Institutional', icon: Award, path: '/institution' },
    { name: 'Community', icon: Users, path: '/community' },
    { name: 'Settings', icon: Settings, path: '/settings' },
  ];

  const adminItems = [
    ...(isAdministrator ? [{ name: 'Admin Hub', icon: ShieldCheck, path: '/admin' }] : []),
    ...(isFinancialAdmin ? [{ name: 'Finance', icon: CreditCard, path: '/admin/finance' }] : []),
  ];

  return (
    <div className="hidden lg:block w-72 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-800 transition-all duration-300">
      <div className="flex flex-col h-full sticky top-0">
        <div className="p-8">
          <h1 className="text-3xl font-black text-apex-600 dark:text-apex-400 tracking-tighter">Apex Scholars</h1>
          <div className="flex items-center gap-2 mt-1">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
             <p className="text-[10px] text-slate-400 dark:text-slate-500 font-black uppercase tracking-widest">Mastery Engine Active</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="px-4 mb-4">
             <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Learning</p>
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center px-4 py-3.5 rounded-2xl transition-all duration-200 group
                ${isActive
                  ? 'bg-medical-50 text-medical-700 dark:bg-medical-900/30 dark:text-medical-400 font-black shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700/50 hover:text-slate-900 font-bold'}`
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className={`mr-4 transition-colors ${isActive ? 'text-medical-600' : 'text-slate-400 group-hover:text-slate-600'}`} size={22} />
                  <span>{item.name}</span>
                </>
              )}
            </NavLink>
          ))}

          {adminItems.length > 0 && (
            <>
              <div className="px-4 mt-8 mb-4">
                 <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Management</p>
              </div>
              {adminItems.map((item) => (
                <NavLink
                  key={item.name}
                  to={item.path}
                  className={({ isActive }) =>
                    `flex items-center px-4 py-3.5 rounded-2xl transition-all duration-200 group
                    ${isActive
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-black shadow-sm'
                      : 'text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-700/50 hover:text-slate-900 font-bold'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={`mr-4 transition-colors ${isActive ? 'text-amber-600' : 'text-slate-400 group-hover:text-slate-600'}`} size={22} />
                      <span>{item.name}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </>
          )}
        </nav>

        <div className="p-4 mt-auto">
           <div className="bg-slate-50 dark:bg-slate-900/50 rounded-3xl p-6 border border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3 mb-4">
                 <div className="w-10 h-10 bg-apex-100 dark:bg-apex-900/30 rounded-xl flex items-center justify-center text-apex-600">
                    <Award size={20} />
                 </div>
                 <div>
                    <p className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-tight">Pro Plan</p>
                    <p className="text-[10px] text-slate-500 font-bold">24 days remaining</p>
                 </div>
              </div>
              <button className="w-full py-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-xl text-xs font-black uppercase tracking-widest border border-slate-200 dark:border-slate-700 shadow-sm active:scale-95 transition-all">
                Extend Access
              </button>
           </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
