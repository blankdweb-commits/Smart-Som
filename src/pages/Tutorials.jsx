import React, { createElement, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle, ChevronLeft, Clock, Compass,
  Store, Swords, Target, Trophy, Users, X, Zap, FileText, History,
  CreditCard, Shield, Flag, Star, Book, BookOpen,
} from '../components/Icons';
import BrandLogo from '../components/BrandLogo';
import {
  TUTORIALS, tutorialByKey, readTutorialProgress, markTutorialDone,
} from '../data/tutorials';

// Step glyphs. Kept as a small map so the tutorial content can stay plain data
// (and therefore testable) without importing React here.
const GLYPH = {
  swords: Swords, target: Target, trophy: Trophy, users: Users, zap: Zap,
  clock: Clock, coins: Trophy, refresh: Clock, home: Compass,
  check: Check, star: Star, file: FileText, shield: Shield, flag: Flag,
  store: Store, book: Book, credit: CreditCard, history: History,
};
const glyphFor = (name) => GLYPH[name] || BookOpen;

// Resolve an icon by name. The lookup must NOT happen in the render body of a
// component (react-hooks/static-components), so this goes through
// createElement with a dynamic type rather than a JSX variable.
const Glyph = ({ name, size = 22, className }) =>
  createElement(glyphFor(name), { size, className, 'aria-hidden': true });

// The tutorial centre + the step player. One page, two modes:
//   - index: the three tours with their completion state
//   - player: one tour, one step at a time
const Tutorials = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [progress, setProgress] = useState(() => readTutorialProgress());
  const [openKey, setOpenKey] = useState(null);
  const [step, setStep] = useState(0);
  const [announce, setAnnounce] = useState('');

  // Deep link: /tutorials?t=arena opens straight into that tour.
  useEffect(() => {
    const wanted = params.get('t');
    if (wanted && tutorialByKey(wanted)) setOpenKey(wanted);
  }, [params]);

  const tour = useMemo(() => tutorialByKey(openKey), [openKey]);
  const total = tour?.steps.length || 0;

  // Reset the step whenever the tour changes.
  useEffect(() => {
    setStep(0);
    setAnnounce('');
  }, [openKey]);

  const open = useCallback((key) => {
    setOpenKey(key);
  }, []);

  const close = useCallback(() => {
    setOpenKey(null);
    setStep(0);
    setAnnounce('');
  }, []);

  const next = useCallback(() => {
    if (!tour) return;
    if (step + 1 >= total) {
      markTutorialDone(tour.key);
      setProgress(readTutorialProgress());
      setAnnounce(`${tour.title} complete.`);
      close();
      return;
    }
    setStep((s) => s + 1);
    setAnnounce(`Step ${step + 2} of ${total}`);
  }, [tour, step, total, close]);

  const prev = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
    setAnnounce('');
  }, []);

  const finish = useCallback(() => {
    if (!tour) return;
    markTutorialDone(tour.key);
    setProgress(readTutorialProgress());
    setAnnounce(`${tour.title} complete.`);
    close();
  }, [tour, close]);

  // --- Player mode -------------------------------------------------------
  if (tour) {
    const current = tour.steps[Math.min(step, total - 1)];
    const pct = total ? Math.round(((step + 1) / total) * 100) : 0;

    return (
      <div className="min-h-[100dvh] bg-slate-950 text-slate-200 flex flex-col">
        <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800">
          <div className="max-w-2xl mx-auto px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={close}
                className="flex items-center gap-1.5 text-slate-400 hover:text-white font-black text-[11px] uppercase tracking-widest min-h-[44px] px-2 -ml-2 rounded-lg transition"
              >
                <ChevronLeft size={16} aria-hidden="true" /> Back
              </button>
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 tabular-nums">
                {step + 1} / {total}
              </span>
              <button
                onClick={close}
                aria-label="Close tutorial"
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-slate-200 rounded-lg transition"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {/* Progress bar — also the "progress indicator" for the tour. */}
            <div
              className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${tour.title} progress`}
            >
              <div
                className="h-full rounded-full bg-apex-500 transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-6 pb-44">
          <p className="text-[10px] font-black uppercase tracking-widest text-apex-400">{tour.title}</p>

          <div className="mt-4 rounded-[1.75rem] border border-slate-800 bg-slate-900/60 p-6">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-apex-500/15 text-apex-300 mb-4">
              <Glyph name={current?.icon} size={24} />
            </span>
            <h2 className="text-xl font-black text-white leading-snug">{current?.title}</h2>
            <p className="mt-3 text-[15px] text-slate-300 leading-relaxed">{current?.body}</p>
          </div>

          {/* Dot navigation, keyboard reachable, never wider than the screen. */}
          <div className="mt-5 flex flex-wrap justify-center gap-2" role="group" aria-label="Tutorial steps">
            {tour.steps.map((s, i) => (
              <button
                key={s.title}
                onClick={() => { setStep(i); setAnnounce(`Step ${i + 1} of ${total}`); }}
                aria-label={`Step ${i + 1}: ${s.title}`}
                aria-current={i === step ? 'step' : undefined}
                className={`w-8 h-8 rounded-full text-[10px] font-black transition ${
                  i === step
                    ? 'bg-apex-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <p className="sr-only" role="status" aria-live="polite">{announce}</p>
        </main>

        <div className="fixed bottom-0 inset-x-0 z-20 bg-slate-950/95 backdrop-blur border-t border-slate-800">
          <div className="max-w-2xl mx-auto px-4 py-3 space-y-2.5">
            <div className="flex gap-2.5">
              <button
                onClick={prev}
                disabled={step === 0}
                className="min-h-[44px] px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 font-black text-xs uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Back
              </button>
              <button
                onClick={next}
                className="flex-1 min-h-[44px] px-5 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest hover:bg-apex-500 transition"
              >
                {step + 1 >= total ? "Got it" : 'Next'}
              </button>
            </div>
            <div className="flex gap-2.5">
              <button
                onClick={finish}
                className="flex-1 min-h-[44px] px-4 py-2 rounded-xl text-slate-500 hover:text-slate-300 text-[11px] font-black uppercase tracking-widest transition"
              >
                Finish tour
              </button>
              <button
                onClick={close}
                className="flex-1 min-h-[44px] px-4 py-2 rounded-xl text-slate-500 hover:text-slate-300 text-[11px] font-black uppercase tracking-widest transition"
              >
                Skip
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- Index mode --------------------------------------------------------
  const doneCount = TUTORIALS.filter((t) => progress[t.key]).length;

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-slate-200 pb-10">
      <header className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="flex items-center gap-1.5 text-slate-400 hover:text-white font-black text-[11px] uppercase tracking-widest min-h-[44px] px-2 -ml-2 rounded-lg transition"
          >
            <ArrowLeft size={16} aria-hidden="true" /> Back
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 tabular-nums">
            {doneCount} of {TUTORIALS.length} done
          </span>
          <span className="min-w-[44px]" />
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-6">
        <h1 className="text-2xl font-black text-white">How PolyNurse Works</h1>
        <p className="text-sm text-slate-400 mt-2 leading-relaxed">
          Three short tours of the parts of the app that take a minute to get used to.
          Each one describes what the app actually does today — take them in any order,
          and replay any of them whenever you like.
        </p>

        <ul className="mt-6 space-y-3">
          {TUTORIALS.map((t) => {
            const done = progress[t.key];
            return (
              <li key={t.key}>
                <button
                  onClick={() => open(t.key)}
                  className="w-full text-left rounded-[1.5rem] border border-slate-800 bg-slate-900/60 hover:border-apex-500/50 active:scale-[0.995] transition"
                >
                  <div className="flex items-center gap-3.5 p-4">
                    <span className="shrink-0 inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-apex-500/15 text-apex-300">
                      <Glyph name={t.icon} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-black text-white truncate">{t.title}</span>
                        {done && (
                          <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-400">
                            <CheckCircle size={10} aria-hidden="true" /> Done
                          </span>
                        )}
                      </span>
                      <span className="block text-xs text-slate-400 mt-0.5 leading-snug">
                        {t.blurb} · {t.steps.length} steps
                      </span>
                    </span>
                    <ArrowRight size={18} className="shrink-0 text-slate-600" aria-hidden="true" />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-6 text-center">
          <button
            onClick={() => navigate('/settings')}
            className="min-h-[44px] px-4 py-2 text-slate-500 hover:text-slate-300 text-[11px] font-black uppercase tracking-widest transition"
          >
            Replay a tour from Settings
          </button>
        </p>

        <div className="mt-8 flex justify-center">
          <BrandLogo variant="mark" size="md" />
        </div>
      </main>
    </div>
  );
};

export default Tutorials;