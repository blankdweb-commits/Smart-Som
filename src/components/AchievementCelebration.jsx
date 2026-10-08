import { useCallback, useEffect, useRef, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, useReducedMotion } from 'framer-motion';
import { useAppContext } from '../context/AppContext';
import { X, Award, Sparkles } from './Icons';
import { tierStyle } from '../utils/achievementEngine';
import { useNavigate } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Full-screen achievement celebration.
//
// One celebration is on screen at a time (AppContext owns the queue; this
// component only ever renders the ACTIVE payload). Everything shown here —
// name, description, icon, narrator, rarity tier, earned date — comes from the
// server-issued unlock enriched by the public definitions catalogue; NOTHING
// on this screen (or anywhere in the client) can award an achievement.
//
// Sequence (respects prefers-reduced-motion via MotionConfig + useReducedMotion):
//   backdrop → emblem spring → confetti burst (auto-removed) → heading →
//   title → description → rarity chip → narrator → identity → actions
// Dismiss via Continue / backdrop / Escape / X — all funnel through one
// close path that animates out BEFORE advancing the queue, so the next
// queued celebration starts on a fresh mount (AppContext keys the host).
// ---------------------------------------------------------------------------
const CONFETTI_COUNT = 44;

const ConfettiBurst = ({ accent, enabled }) => {
  const pieces = Array.from({ length: CONFETTI_COUNT }, (_, i) => {
    const angle = (Math.PI * 2 * i) / CONFETTI_COUNT + (i % 7) * 0.11;
    const distance = 110 + ((i * 37) % 160);
    return {
      id: i,
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.85 + 70,
      rotate: ((i * 121) % 720) - 360,
      size: 5 + ((i * 13) % 8),
      color: i % 3 === 0 ? accent : i % 3 === 1 ? '#fbbf24' : '#e2e8f0',
      delay: (i % 11) * 0.012,
      round: i % 3 === 2
    };
  });
  if (!enabled) return null;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {pieces.map(p => (
        <motion.span
          key={p.id}
          initial={{ opacity: 1, x: 0, y: 0, rotate: 0, scale: 1 }}
          animate={{ opacity: 0, x: p.x, y: p.y, rotate: p.rotate, scale: 0.5 }}
          transition={{ duration: 1.05, delay: p.delay, ease: [0.16, 0.8, 0.32, 1] }}
          style={{
            position: 'absolute',
            left: '50%',
            top: '38%',
            width: p.size,
            height: p.round ? p.size : p.size * 1.5,
            borderRadius: p.round ? '9999px' : '2px',
            background: p.color
          }}
        />
      ))}
    </div>
  );
};

export default function AchievementCelebration() {
  const { activeCelebration, dismissCelebration, userProfile, identity } = useAppContext();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const [burstVisible, setBurstVisible] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef(null);

  const achievement = activeCelebration;
  const tier = tierStyle(achievement?.tier);

  // Confetti burst appears with the emblem and is REMOVED from the DOM when it
  // has played (no particles accumulate across a queue of celebrations). The
  // host remounts this component per celebration (React key), so state always
  // starts fresh — no synchronous setState needed here.
  useEffect(() => {
    if (!achievement || reduced) return undefined;
    const show = setTimeout(() => setBurstVisible(true), 380);
    const hide = setTimeout(() => setBurstVisible(false), 1900);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [achievement, reduced]);

  // Body scroll lock while the celebration owns the screen (always restored).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // Single close path: animate out first, THEN tell the context to advance the
  // queue (the host unmounts this component when the queue empties).
  const requestClose = useCallback(() => {
    if (!achievement || closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      dismissCelebration();
    }, reduced ? 60 : 260);
  }, [achievement, closing, dismissCelebration, reduced]);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  // Escape dismisses (Accessibility requirement for modals).
  useEffect(() => {
    const onKeyDown = (e) => { if (e.key === 'Escape') requestClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

  if (!achievement) return null;

  const delay = (sec) => (reduced ? 0 : sec);
  const fade = (at) => ({
    initial: { opacity: 0, y: reduced ? 0 : 14 },
    animate: { opacity: closing ? 0 : 1, y: 0 },
    transition: { duration: reduced ? 0.18 : 0.45, delay: closing ? 0 : delay(at) }
  });
  const earnedLabel = (() => {
    try {
      return new Date(achievement.earnedAt).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric'
      });
    } catch { return 'Just now'; }
  })();
  const ownerName = userProfile?.fullName || 'Scholar';
  const identityName = identity?.name ? ` · ${identity.name}` : '';

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-hidden p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
      {/* Dimmed backdrop (click to dismiss) */}
      <motion.button
        type="button"
        aria-label="Dismiss achievement celebration"
        onClick={requestClose}
        className="absolute inset-0 cursor-default bg-slate-950/80 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: closing ? 0 : 1 }}
        transition={{ duration: reduced ? 0.15 : 0.3 }}
      />

      {/* Confetti layer sits above the card but under nothing interactive */}
      <ConfettiBurst accent={tier.accent} enabled={!reduced && burstVisible && !closing} />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="apex-achievement-title"
        className="relative w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overflow-x-hidden rounded-[1.75rem] border p-5 text-center sm:p-7"
        style={{
          background: 'linear-gradient(180deg, #111827 0%, #0b1220 100%)',
          borderColor: `${tier.accent}59`,
          boxShadow: `0 24px 70px -28px ${tier.glow}`
        }}
        initial={{ opacity: 0, y: reduced ? 0 : 26, scale: reduced ? 1 : 0.96 }}
        animate={closing
          ? { opacity: 0, y: reduced ? 0 : 18, scale: 0.97 }
          : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduced ? 0.18 : 0.5, ease: [0.16, 0.8, 0.32, 1] }}
      >
        {/* Close button — 44px+ touch target, always available */}
        <button
          type="button"
          onClick={requestClose}
          aria-label="Close celebration"
          className="absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
        >
          <X size={20} />
        </button>

        {/* Emblem */}
        <motion.div
          className="mx-auto mt-2 flex h-24 w-24 items-center justify-center rounded-full border-2 sm:h-28 sm:w-28"
          style={{
            borderColor: tier.accent,
            background: `radial-gradient(circle at 50% 40%, ${tier.glow}, rgba(2,6,23,0.9) 70%)`,
            boxShadow: `0 0 42px -8px ${tier.glow}`
          }}
          initial={{ opacity: 0, scale: reduced ? 1 : 0.4 }}
          animate={closing ? { opacity: 0.4, scale: 0.95 } : { opacity: 1, scale: 1 }}
          transition={closing
            ? { duration: 0.2 }
            : { type: 'spring', stiffness: 260, damping: 16, delay: delay(0.12) }}
        >
          <span className="text-5xl leading-none sm:text-6xl" role="img" aria-label={achievement.name}>
            {achievement.icon}
          </span>
        </motion.div>

        {/* Heading */}
        <motion.p
          {...fade(0.42)}
          className="mt-5 text-xs font-bold uppercase tracking-[0.25em]"
          style={{ color: tier.accent }}
        >
          Achievement Unlocked
        </motion.p>

        {/* Title */}
        <motion.h2
          id="apex-achievement-title"
          {...fade(0.5)}
          className="mt-2 text-2xl font-extrabold text-white sm:text-3xl"
        >
          {achievement.name}
        </motion.h2>

        {/* Description */}
        {achievement.description ? (
          <motion.p {...fade(0.62)} className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-slate-300">
            {achievement.description}
          </motion.p>
        ) : null}

        {/* Rarity chip */}
        <motion.div {...fade(0.72)} className="mt-4 flex justify-center">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${tier.modal.text} ${tier.modal.border} ${tier.modal.bg}`}
          >
            <Sparkles size={13} />
            {achievement.tierLabel}
          </span>
        </motion.div>

        {/* Server-authored narrator line (when the definition ships one) */}
        {achievement.narrator ? (
          <motion.p {...fade(0.82)} className="mx-auto mt-4 max-w-sm text-xs italic leading-relaxed text-slate-400">
            “{achievement.narrator}”
          </motion.p>
        ) : null}

        {/* Identity + earned date */}
        <motion.div
          {...fade(0.9)}
          className="mt-5 flex items-center justify-center gap-3 border-t border-white/10 pt-4"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-bold text-white"
            style={{ borderColor: tier.accent, background: `${tier.accent}26` }}
            aria-hidden="true"
          >
            {ownerName.charAt(0).toUpperCase()}
          </span>
          <span className="text-left text-xs leading-tight text-slate-300">
            <span className="block font-semibold text-white">{ownerName}{identityName}</span>
            <span className="text-slate-500">Earned {earnedLabel}</span>
          </span>
        </motion.div>

        {/* Actions */}
        <motion.div {...fade(1.0)} className="mt-5 flex flex-col gap-2.5 sm:flex-row">
          <button
            type="button"
            onClick={requestClose}
            autoFocus
            className="min-h-[48px] flex-1 rounded-xl px-4 text-sm font-bold text-slate-950 transition-transform active:scale-[0.98]"
            style={{ background: tier.accent }}
          >
            <span className="inline-flex items-center justify-center gap-2">
              <Award size={16} />
              Continue
            </span>
          </button>
          <button
            type="button"
            onClick={() => { dismissCelebration(); navigate('/achievements'); }}
            className="min-h-[48px] flex-1 rounded-xl border border-white/15 bg-white/5 px-4 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/10"
          >
            View achievements
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
