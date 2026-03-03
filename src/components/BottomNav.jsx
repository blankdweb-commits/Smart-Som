import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Award, Users, Volume2 } from 'lucide-react';

const BottomNav = () => {
  const navItems = [
    { name: 'Home', icon: LayoutDashboard, path: '/' },
    { name: 'Cards', icon: BookOpen, path: '/flashcards' },
    { name: 'Prep', icon: Award, path: '/prep' },
    { name: 'Audio', icon: Volume2, path: '/pronunciation' },
    { name: 'Chat', icon: Users, path: '/community' },
  ];

  return (
    <nav className="lg:hidden fixed bottom-6 left-4 right-4 bg-white/90 dark:bg-slate-800/90 backdrop-blur-xl border border-white/20 dark:border-slate-700/50 rounded-[2rem] shadow-clinical z-50 h-20 px-2 overflow-hidden">
      <div className="flex justify-around items-center h-full">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => `
              flex flex-col items-center justify-center flex-1 h-full transition-all relative
              ${isActive
                ? 'text-medical-600 dark:text-medical-400 scale-110'
                : 'text-slate-400 dark:text-slate-500 hover:text-medical-500'}
            `}
          >
            {({ isActive }) => (
              <>
                <div className={`p-2 rounded-xl transition-all ${isActive ? 'bg-medical-50 dark:bg-medical-900/40 shadow-sm mb-1' : 'mb-1'}`}>
                  <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'opacity-100' : 'opacity-60'}`}>{item.name}</span>
                {isActive && (
                  <div className="absolute -bottom-1 w-1.5 h-1.5 bg-medical-500 rounded-full shadow-lg shadow-medical-500/50" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;
