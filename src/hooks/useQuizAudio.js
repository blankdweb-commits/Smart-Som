// src/hooks/useQuizAudio.js
// React hook that exposes the shared AudioManager and keeps it in sync with the
// user's soundEnabled preference. Safe to call anywhere; returns stable refs so
// it never causes re-renders of its own.
import { useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { audioManager } from '../utils/audio';

export function useQuizAudio() {
  const { soundEnabled, toggleSound } = useAppContext();

  // Keep the singleton's enabled flag in sync with context/preference.
  useEffect(() => {
    audioManager.setEnabled(soundEnabled);
  }, [soundEnabled]);

  const api = useMemo(
    () => ({
      manager: audioManager,
      unlock: () => audioManager.unlock(),
      preload: () => audioManager.preload(),
      playIntro: () => audioManager.playIntro(),
      playExit: () => audioManager.playExit(),
      playExitForDialog: () => audioManager.playExitForDialog(),
      stopExit: () => audioManager.stopExit(),
      scheduleExitStop: (ms) => audioManager.scheduleExitStop(ms),
      playCorrect: () => audioManager.playCorrect(),
      playWrong: () => audioManager.playWrong(),
      play: (type) => audioManager.play(type),
      stopAll: () => audioManager.stopAll(),
      soundEnabled,
      toggleSound
    }),
    [soundEnabled, toggleSound]
  );

  return api;
}
