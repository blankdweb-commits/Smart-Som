import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Calendar, Award, Users, Volume2, Search, Brain, FileUp } from './Icons';

const BottomNav = () => {
  const [quizActive, setQuizActive] = useState(() =>
    typeof document !== 'undefined' && document.body.classList.contains('quiz-active')
  );

  // Hide the bottom navigation while an immersive quiz is in progress. The
  // Quiz page toggles the 'quiz-active' class on <body>; observe it so the nav
  // disappears the moment a quiz starts (and reappears when it ends).
  useEffect(() => {
    const target = document.body;
    const update = () => setQuizActive(target.classList.contains('quiz-active'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (quizActive) return null;

  const navItems = [
    { name: 'Home', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Quiz', icon: Brain, path: '/quiz' },
    { name: 'Cards', icon: BookOpen, path: '/flashcards' },
    { name: 'Exams', icon: Calendar, path: '/exams' },
    { name: 'Papers', icon: FileUp, path: '/papers' },
    { name: 'Circle', icon: Users, path: '/community' },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border-t border-slate-100 dark:border-slate-800 pb-safe z-40 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
      <div className="flex justify-around items-center h-16 px-2">
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            className={({ isActive }) => `
              flex flex-col items-center justify-center flex-1 h-full transition-all duration-300 relative
              ${isActive
                ? 'text-medical-600 dark:text-medical-400'
                : 'text-slate-400 dark:text-slate-500'}
            `}
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <div className="absolute top-0 w-10 h-1 bg-medical-500 rounded-full animate-in fade-in slide-in-from-top-1 duration-300" />
                )}
                <div className={`p-2 rounded-xl transition-all duration-300 ${isActive ? 'bg-medical-50 dark:bg-medical-900/40 scale-110 -translate-y-1' : 'active:scale-90'}`}>
                  <item.icon size={22} />
                </div>
                <span className={`text-[9px] font-black uppercase tracking-widest mt-0.5 transition-all duration-300 ${isActive ? 'opacity-100' : 'opacity-50 scale-95'}`}>
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
