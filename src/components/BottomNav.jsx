import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Award, Users, Volume2 } from 'lucide-react';

const BottomNav = () => {
  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/' },
    { name: 'Cards', icon: BookOpen, path: '/flashcards' },
    { name: 'Timetable', icon: Calendar, path: '/exams' },
    { name: 'Pronounce', icon: Volume2, path: '/pronunciation' },
    { name: 'Community', icon: Users, path: '/community' },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 pb-safe z-40">
      <div className="flex justify-around items-center h-16">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => `
              flex flex-col items-center justify-center flex-1 h-full transition-all duration-300
              ${isActive
                ? 'text-medical-600 dark:text-medical-400 scale-110'
                : 'text-slate-500 dark:text-slate-400 hover:text-medical-500'}
            `}
          >
            {({ isActive }) => (
              <>
                <div className={`p-1.5 rounded-xl transition-all duration-300 ${isActive ? 'bg-medical-50 dark:bg-medical-900/30' : ''}`}>
                  <item.icon size={isActive ? 22 : 20} className="mb-0" />
                </div>
                <span className={`text-[9px] font-black uppercase tracking-tighter mt-1 transition-all ${isActive ? 'opacity-100' : 'opacity-70'}`}>
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
