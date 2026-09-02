// src/utils/audio.js
// Reusable, local-only audio manager for the Apex Scholars quiz.
//
// - Bundles assets from /audio/** (see Part 20) — NO remote/hotlinked URLs.
// - Never crashes the quiz: every call is guarded and failures are logged once
//   (development only). Audio is enhancement, never a submission dependency.
// - Reuses a per-URL pool of Audio elements instead of instantiating new ones
//   on every render/play.
// - Respects an enabled flag (driven by the soundEnabled preference).
//
// iOS/Android note: browsers block autoplay, so call `unlock()` for the first
// time inside the START QUIZ user gesture, then `preload()`.

const AUDIO_PATHS = {
  intro: ['/audio/intro.mp3'],
  exit: ['/audio/exit.mp3'],
  correct: [
    '/audio/correct/correct-01.mp3',
    '/audio/correct/correct-02.mp3',
    '/audio/correct/correct-03.mp3',
    '/audio/correct/correct-04.mp3',
    '/audio/correct/correct-05.mp3',
    '/audio/correct/correct-06.mp3',
    '/audio/correct/correct-07.mp3'
  ],
  wrong: [
    '/audio/wrong/wrong-01.mp3',
    '/audio/wrong/wrong-02.mp3',
    '/audio/wrong/wrong-03.mp3',
    '/audio/wrong/wrong-04.mp3',
    '/audio/wrong/wrong-05.mp3',
    '/audio/wrong/wrong-06.mp3',
    '/audio/wrong/wrong-07.mp3',
    '/audio/wrong/wrong-08.mp3',
    '/audio/wrong/wrong-09.mp3',
    '/audio/wrong/wrong-10.mp3',
    '/audio/wrong/wrong-11.mp3',
    '/audio/wrong/wrong-12.mp3',
    '/audio/wrong/wrong-13.mp3',
    '/audio/wrong/wrong-14.mp3'
  ]
};

// 'timeout' behaviour matches the wrong-answer pool.
AUDIO_PATHS.timeout = AUDIO_PATHS.wrong;

const MAX_SOUND_SECONDS = 4;
const POOL_SIZE = 3; // elements cached per URL

// Name -> one-shot wrapper so callers can use readable methods.
const SINGLE = ['intro', 'exit'];

class AudioManager {
  constructor() {
    this.cache = {}; // url -> Audio[]
    this.timers = new Map(); // Audio -> timeout id
    this._enabled = true;
    this._logged = new Set();
    this._exitStopTimer = null;
  }

  setEnabled(v) {
    this._enabled = !!v;
    if (!this._enabled) this.stopAll();
  }

  get enabled() {
    return this._enabled;
  }

  _log(msg) {
    // Log once per message in development to avoid console spam.
    if (this._logged.has(msg)) return;
    this._logged.add(msg);
    if (import.meta.env && import.meta.env.DEV) {
      console.warn('[Audio]', msg);
    }
  }

  _clips(type) {
    return AUDIO_PATHS[type] || [];
  }

  _pick(type) {
    const clips = this._clips(type);
    if (clips.length === 0) return null;
    return clips[Math.floor(Math.random() * clips.length)];
  }

  _getOrCreate(url) {
    if (!this.cache[url]) {
      this.cache[url] = Array.from({ length: POOL_SIZE }).map(() => {
        const audio = new Audio(url);
        audio.preload = 'auto';
        return audio;
      });
    }
    return this.cache[url];
  }

  _stop(el) {
    const t = this.timers.get(el);
    if (t) {
      clearTimeout(t);
      this.timers.delete(el);
    }
    try {
      el.pause();
    } catch { /* ignore */ }
  }

  stopAll() {
    Object.values(this.cache).forEach((pool) => pool.forEach((el) => this._stop(el)));
  }

  stopExit() {
    if (this._exitStopTimer) {
      clearTimeout(this._exitStopTimer);
      this._exitStopTimer = null;
    }
    const pool = this._getOrCreate(AUDIO_PATHS.exit[0]);
    pool.forEach((el) => this._stop(el));
  }

  // Play a single clip from the given type. Returns true if a clip was played.
  play(type) {
    if (!this._enabled) return false;
    if (typeof Audio === 'undefined') return false;
    try {
      const url = this._pick(type);
      if (!url) return false;

      const pool = this._getOrCreate(url);
      let el = pool.find((a) => a.paused || a.ended) || pool[0];

      this._stop(el);
      el.currentTime = 0;
      el.volume = 1.0;
      const p = el.play();
      if (p !== undefined) {
        p.catch(() => this._log(`Play blocked: ${url}`));
      }

      // Hard-stop at MAX_SOUND_SECONDS regardless of source length.
      this.timers.set(el, setTimeout(() => this._stop(el), MAX_SOUND_SECONDS * 1000));
      return true;
    } catch (e) {
      this._log(`Play failed (${type}): ${e.message}`);
      return false;
    }
  }

  // Preload all clips into the cache (idempotent). Call after user gesture.
  preload() {
    if (typeof Audio === 'undefined') return;
    Object.values(AUDIO_PATHS).forEach((list) => list.forEach((url) => this._getOrCreate(url)));
  }

  // Unlock autoplay by playing + immediately pausing a silent buffer inside a
  // user-gesture handler. Safe to call; no-op if no gesture is active.
  unlock() {
    if (typeof Audio === 'undefined') return;
    try {
      const ctx = window.AudioContext || window.webkitAudioContext;
      if (ctx) {
        const ac = new ctx();
        if (ac.state === 'suspended') ac.resume();
        // keep a reference so it isn't GC'd / state persists
        this._ctx = ac;
      }
      const silent = new Audio();
      silent.volume = 0;
      const p = silent.play();
      if (p !== undefined) p.catch(() => {});
    } catch { /* ignore */ }
  }

  // Convenience wrappers.
  playIntro() { return this.play('intro'); }
  playExit() { return this.play('exit'); }
  playCorrect() { return this.play('correct'); }
  playWrong() { return this.play('wrong'); }

  // Start the exit sound. Returns true when a clip actually started.
  playExitForDialog() {
    return this.playExit();
  }

  // Produce a hard-stop of the exit sound after `ms` (used when the user does
  // actually leave — the dialog clip gets 2s to finish its phrase).
  scheduleExitStop(ms = 2000) {
    if (this._exitStopTimer) clearTimeout(this._exitStopTimer);
    this._exitStopTimer = setTimeout(() => this.stopExit(), ms);
  }
}

// Module-level singleton — never recreated per render.
export const audioManager = new AudioManager();

export { AUDIO_PATHS, MAX_SOUND_SECONDS };
