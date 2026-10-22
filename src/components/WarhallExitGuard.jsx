import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Modal from './Modal';
import { AlertTriangle, Swords } from './Icons';
import { WarhallExitContext } from './WarhallExitContext';

const WARHALL_ROUTES = ['/rumble'];

const isWarhallRoute = (pathname) => {
  if (!pathname) return false;
  return WARHALL_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
};

export const WarhallExitProvider = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [isInActiveDuel, setIsInActiveDuel] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showDuelConfirm, setShowDuelConfirm] = useState(false);
  const [pendingDestination, setPendingDestination] = useState(null);

  const isInWarhall = isWarhallRoute(location.pathname);

  const registerDuelState = useCallback((active) => {
    setIsInActiveDuel(!!active);
  }, []);

  const confirmLeave = useCallback(() => {
    setShowExitConfirm(false);
    setShowDuelConfirm(false);
    if (pendingDestination) {
      navigate(pendingDestination);
      setPendingDestination(null);
    }
  }, [pendingDestination, navigate]);

  const cancelLeave = useCallback(() => {
    setShowExitConfirm(false);
    setShowDuelConfirm(false);
    setPendingDestination(null);
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (isInWarhall && isInActiveDuel) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isInWarhall, isInActiveDuel]);

  const value = {
    isInWarhall,
    isInActiveDuel,
    registerDuelState,
  };

  return (
    <WarhallExitContext.Provider value={value}>
      {children}
      <Modal isOpen={showExitConfirm} onClose={cancelLeave} label="Leaving the Warhall">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">Leaving the Warhall?</h2>
            </div>
          </div>
          <p className="text-slate-600 dark:text-slate-300 font-medium">
            You're about to leave the Warhall and return to the main PolyNurse experience. Are you sure you want to continue?
            {pendingDestination && (
              <span className="block mt-2 text-sm text-slate-500 dark:text-slate-400">
                Destination: {pendingDestination}
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={cancelLeave}
              className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white font-black uppercase tracking-widest text-xs hover:bg-slate-200 dark:hover:bg-slate-600 transition"
            >
              Stay in Warhall
            </button>
            <button
              onClick={confirmLeave}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black uppercase tracking-widest text-xs hover:shadow-lg transition"
            >
              Leave Warhall
            </button>
          </div>
        </div>
      </Modal>
      <Modal isOpen={showDuelConfirm} onClose={cancelLeave} label="Leave your active duel">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-red-500/20 flex items-center justify-center">
              <Swords className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">Leave your active duel?</h2>
            </div>
          </div>
          <p className="text-slate-600 dark:text-slate-300 font-medium">
            Leaving now may interrupt your current duel. Your match result and Smart Coin settlement follow the server's match rules. Do you want to leave?
          </p>
          <div className="flex gap-2">
            <button
              onClick={cancelLeave}
              className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white font-black uppercase tracking-widest text-xs hover:bg-slate-200 dark:hover:bg-slate-600 transition"
            >
              Continue Duel
            </button>
            <button
              onClick={confirmLeave}
              className="flex-1 py-3 rounded-xl bg-red-600 text-white font-black uppercase tracking-widest text-xs hover:bg-red-700 transition"
            >
              Leave Duel
            </button>
          </div>
        </div>
      </Modal>
    </WarhallExitContext.Provider>
  );
};

export default WarhallExitProvider;
