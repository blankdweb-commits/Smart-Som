import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Award, Users, Volume2, Search, Brain, FileUp } from './Icons';

const BottomNav = () => {
  const navItems = [
    { name: 'Home', icon: LayoutDashboard, path: '/' },
    { name: 'Quiz', icon: Brain, path: '/quiz' },
    { name: 'Cards', icon: BookOpen, path: '/flashcards' },
    { name: 'Exams', icon: Calendar, path: '/exams' },
    { name: 'Papers', icon: FileUp, path: '/papers' },
    { name: 'Circle', icon: Users, path: '/community' },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl border-t border-slate-100 dark:border-slate-800 pb-safe z-40">
      <div className="flex justify-around items-center h-16 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => `
              flex flex-col items-center justify-center flex-1 h-full transition-all duration-500 relative
              ${isActive
                ? 'text-medical-600 dark:text-medical-400'
                : 'text-slate-400 dark:text-slate-500 hover:text-medical-500'}
            `}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div className="absolute top-0 w-12 h-1 bg-medical-500 rounded-full animate-in fade-in slide-in-from-top-1 duration-500" />
                )}
                <div className={`p-2 rounded-2xl transition-all duration-500 ${isActive ? 'bg-medical-50 dark:bg-medical-900/30 scale-110 -translate-y-2 shadow-clinical ring-4 ring-white dark:ring-slate-900' : ''}`}>
                  <item.icon size={20} />
                </div>
                <span className={`text-[8px] font-black uppercase tracking-widest mt-0.5 transition-all duration-500 ${isActive ? 'opacity-100' : 'opacity-60 scale-90'}`}>
                  {item.name}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;
