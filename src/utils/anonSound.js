// src/utils/anonSound.js
//
// Tiny, dependency-free sound cues for the Anonymous room, synthesised with the
// Web Audio API so no asset has to be downloaded (and nothing autoplays on
// load). Every cue is best-effort: if the browser blocks audio (no user
// gesture yet) or AudioContext is unavailable, the call is a silent no-op.
//
// Callers are responsible for respecting the user's sound setting and for
// de-duplicating events (one cue per genuinely new message, etc.).

let audioCtx = null;

const supportsAudio = () =>
  typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);

const getCtx = () => {
  if (!supportsAudio()) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    try {
      audioCtx = new AC();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

const blip = (ac, { freq, at = 0, dur = 0.12, gain = 0.12, type = 'sine' }) => {
  const start = ac.currentTime + at;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
};

// A soft two-note "pop" for a genuinely new incoming message.
export function playMessagePop() {
  const ac = getCtx();
  if (!ac) return;
  blip(ac, { freq: 660, at: 0, dur: 0.09, gain: 0.11 });
  blip(ac, { freq: 990, at: 0.06, dur: 0.11, gain: 0.09 });
}

// A short rising triad when a new member joins the room.
export function playJoinChime() {
  const ac = getCtx();
  if (!ac) return;
  blip(ac, { freq: 523.25, at: 0, dur: 0.14, gain: 0.1 });
  blip(ac, { freq: 659.25, at: 0.09, dur: 0.14, gain: 0.1 });
  blip(ac, { freq: 783.99, at: 0.18, dur: 0.2, gain: 0.11 });
}

// A gentle acknowledgement when the viewer sends a social action.
export function playSocialTone() {
  const ac = getCtx();
  if (!ac) return;
  blip(ac, { freq: 720, at: 0, dur: 0.1, gain: 0.09, type: 'triangle' });
  blip(ac, { freq: 1080, at: 0.05, dur: 0.12, gain: 0.07, type: 'triangle' });
}

export default { playMessagePop, playJoinChime, playSocialTone };
