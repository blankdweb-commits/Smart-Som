import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, BookOpen, Volume2, Settings, Award, Users, Search, Brain, FileUp, Shield, ShieldCheck, Coins, Target, Trophy, Sparkles, Swords, Wallet, Calendar } from './Icons';
import { useAppContext } from '../context/AppContext';
import BrandLogo from './BrandLogo';

/**
 * navItemIsActive — decides which nav row is highlighted.
 *
 * NavLink's own `isActive` compares the PATHNAME only. The social hub put two
 * entries on the same pathname with different query strings:
 *
 *   "Leaderboard"        -> /leaderboard
 *   "Friends & Rivals"   -> /leaderboard?tab=friends
 *
 * so pathname matching alone lit BOTH up on every hub tab, and the plain
 * "Leaderboard" row stayed lit even on the Friends tab.
 *
 * The rule used here: an item with a query string is active only when every
 * one of its query params matches the current ones, AND - because
 * "Leaderboard" carries no query - it is active only when the current URL
 * carries no tab either. That keeps exactly one row lit at a time.
 */
const navItemIsActive = (item, location) => {
  const [base, query] = item.path.split('?');
  if (location.pathname !== base) return false;
  if (!query) {
    // No tab on this item: active only when the URL names no tab either.
    return !location.search;
  }
  const want = new URLSearchParams(query);
  const have = new URLSearchParams(location.search);
  for (const [k, v] of want.entries()) {
    if (have.get(k) !== v) return false;
  }
  return true;
};

const Sidebar = () => {
  const { userProfile, smartCoins } = useAppContext();
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
    { name: 'Flashcards', icon: BookOpen, path: '/flashcards' },
    { name: 'Quiz Mode', icon: Brain, path: '/quiz' },
    { name: 'Weakness Drill', icon: Target, path: '/weakness-drill' },
    // The SC War Hall is a real hub now, not a hidden 5-tap easter egg on the
    // Quiz page. The easter egg still routes here, so both paths work.
    { name: 'SC War Hall', icon: Swords, path: '/rumble' },
    // Friends & Rivals now lives as a TAB of the /leaderboard hub, so this entry
  // points straight at that tab rather than at /rivals and letting the route
  // redirect. /rivals still exists and still redirects - it is in people's
  // bookmarks - but a nav item should not need a redirect to arrive.
  { name: 'Friends & Rivals', icon: Users, path: '/leaderboard?tab=friends' },
    { name: 'Achievements', icon: Award, path: '/achievements' },
    { name: 'Nursing License', icon: ShieldCheck, path: '/license' },
    { name: 'Loan Shark', icon: Coins, path: '/loans' },
    { name: 'Smart Coins', icon: Wallet, path: '/wallet' },
    { name: 'Leaderboard', icon: Trophy, path: '/leaderboard' },
    { name: 'Challenges', icon: Target, path: '/challenges' },
    { name: 'Squads', icon: Users, path: '/squads' },
    { name: 'Party Rooms', icon: Sparkles, path: '/rooms' },
    { name: 'Marketplace', icon: FileUp, path: '/marketplace' },
    { name: 'Voting', icon: Award, path: '/voting' },
    // /reviews was reachable only by typing the URL - it had no nav entry
    // anywhere, so the feedback inbox (and the admin triage view on it) was
    // effectively undiscoverable. Also the place a user rates a service.
    { name: 'Reviews', icon: FileUp, path: '/reviews' },
    { name: 'How It Works', icon: BookOpen, path: '/tutorials' },
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
    { name: 'Marketplace', icon: FileUp, path: '/admin/marketplace' },
    { name: 'Live Events', icon: Calendar, path: '/admin/live-events' },
  ] : [];

  return (
    <>
      {/* Sidebar - hidden on mobile, visible on large screens */}
      <div className="hidden lg:block w-64 bg-white dark:bg-slate-800 border-r border-slate-100 dark:border-slate-800 transition-all duration-300">
        <div className="flex flex-col h-full sticky top-0">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-2">
              <BrandLogo variant="mark" size="xl" />
              <BrandLogo variant="short" size="lg" />
            </div>
            <p className="text-[10px] text-polynurse-600 dark:text-polynurse-400 mt-1 font-black uppercase tracking-widest">Your NCLEX Success Partner</p>
          </div>

          <nav className="flex-1 px-4 space-y-1 mt-4 overflow-y-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.name}
                to={item.path}
                className={({ isActive }) => `
                  flex items-center px-4 py-3 rounded-xl transition-all duration-200
                  ${isActive && navItemIsActive(item, location)
                    ? 'bg-polynurse-50 text-polynurse-700 dark:bg-polynurse-900/30 dark:text-polynurse-400 font-bold'
                    : 'text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-700/50'}
                `}
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={`mr-3 ${isActive && navItemIsActive(item, location) ? 'text-polynurse-600' : 'text-slate-400'}`} size={20} />
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
