import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Volume2, Award } from 'lucide-react';

const BottomNav = () => {
  const navItems = [
    { name: 'Home', icon: LayoutDashboard, path: '/' },
    { name: 'Cards', icon: BookOpen, path: '/flashcards' },
    { name: 'Prep', icon: Award, path: '/prep' },
    { name: 'Exams', icon: Calendar, path: '/exams' },
    { name: 'Audio', icon: Volume2, path: '/pronunciation' },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 pb-safe z-50">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => `
              flex flex-col items-center justify-center flex-1 h-full transition-colors
              ${isActive
                ? 'text-medical-600 dark:text-medical-400'
                : 'text-slate-500 dark:text-slate-400 hover:text-medical-500'}
            `}
          >
            <item.icon size={20} className="mb-1" />
            <span className="text-[10px] font-bold uppercase tracking-wider">{item.name}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
};

export default BottomNav;
