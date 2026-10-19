// ============================================================================
// src/components/SignupWizard.jsx
//
// The guided registration flow. Replaces the single-page sign-up form that used
// to live inside pages/Auth.jsx.
//
// DESIGN INTENT (one task per step, no wall of fields):
//   welcome → name → email → password → confirm → review → done
// The welcome step is an intro and is NOT numbered; the six numbered steps are
// what the progress indicator counts, so a user mid-flow reads "Step 3 of 6"
// and can tell exactly how much is left.
//
// FOUR REQUIRED FIELDS, NO MORE: name, email, password, confirmPassword. All
// rules live in utils/signupValidation.js so this component and
// CommunityAuthModal can never disagree about what a valid registration is.
//
// THINGS THAT ARE DELIBERATE AND EASY TO BREAK:
//   * The four aria-labels ("Full name", "Email address", "Password",
//     "Confirm password") are a STABLE CONTRACT. scripts/e2e-utils.mjs exports
//     selectors built from them and ~15 browser suites fill them. Changing the
//     wording silently breaks every one of those suites. Use
//     scripts/e2e-utils.mjs signupFlow rather than hand-rolling selectors.
//   * The password is held in React state only while the user is on the
//     password/confirm steps and is NEVER rendered, never logged, never sent
//     anywhere except the signUp call. The review step shows name, a masked
//     email and a character count — never the password.
//   * "Back" never clears anything. Values live in one object, so navigating
//     back and forward is lossless.
//   * Continue is NEVER disabled on a field step. A disabled button gives a
//     user no way to find out WHY it is disabled; clicking it and reading the
//     inline error is both more accessible and more informative.
//   * We never claim an account is verified unless Supabase returned a
//     session. Email confirmation is OFF on this project today (every e2e
//     creates users with email_confirm: true), so the common path is a real
//     session; the verification screen exists for the day it is turned on and
//     it does not pretend the account is usable before it is confirmed.
// ============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion'; // eslint-disable-line no-unused-vars
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CheckCircle2,
  Eye,
  EyeOff,
  Info,
  Key,
  Loader2,
  Lock,
  Mail,
  MessageCircle,
  ShieldCheck,
  Swords,
  User,
} from './Icons';
import BrandLogo from './BrandLogo';
import { supabase } from '../utils/supabase';
import { usePrefersReducedMotion } from '../utils/reducedMotion';
import {
  STEP_VALIDATORS,
  firstNameOf,
  isDuplicateAccountError,
  maskEmail,
  passwordStrength,
} from '../utils/signupValidation';

// The intro step is unnumbered; the six field/review/terminal steps are what the
// progress indicator counts.
const STEPS = [
  { id: 'welcome', kind: 'intro', numbered: false },
  { id: 'name', kind: 'field', numbered: true },
  { id: 'email', kind: 'field', numbered: true },
  { id: 'password', kind: 'field', numbered: true },
  { id: 'confirm', kind: 'field', numbered: true },
  { id: 'review', kind: 'review', numbered: true },
];

const NUMBERED_TOTAL = STEPS.filter((s) => s.numbered).length;

const EMPTY_VALUES = { fullName: '', email: '', password: '', confirmPassword: '' };

const DUPLICATE_COPY = 'An account with this email already exists. Sign in instead.';

// The four things a new scholar can do. Written against features that actually
// ship — every one of these routes exists today. Nothing here promises a
// feature the app does not have (the rule src/data/tutorials.js follows).
const PREVIEW_CARDS = [
  {
    icon: Brain,
    title: 'Learn & quiz',
    body: 'NMCN and NCLEX questions across every level and subject, graded on the server.',
  },
  {
    icon: Swords,
    title: 'The 1v1 Arena',
    body: 'Forty questions, one shared 90-second clock, a real opponent or a free tutor bot.',
  },
  {
    icon: MessageCircle,
    title: 'Friends & rivals',
    body: 'Add scholars, hold a leaderboard, and challenge the people you meet.',
  },
  {
    icon: ShieldCheck,
    title: 'Live community',
    body: 'Anonymous rooms that open for a set window, then close on the server’s clock.',
  },
];

const COPY = {
  welcome: {
    eyebrow: 'Welcome to PolyNurse',
    title: 'Your next chapter starts here.',
    body: 'PolyNurse is where nursing scholars learn, compete and meet. Setting up takes about a minute.',
  },
  name: {
    eyebrow: 'Let’s start with you',
    title: 'First, what should we call you?',
    body: 'This is your legal name. You can choose a different display name later in Settings.',
  },
  email: {
    eyebrow: 'Stay in touch',
    title: 'Where can we reach you?',
    body: 'Use an address you can actually open on this device. It is how you sign in and reset your password.',
  },
  password: {
    eyebrow: 'Keep it safe',
    title: 'Create a password.',
    body: 'Six characters minimum. A short phrase you will remember beats a short word.',
  },
  confirm: {
    eyebrow: 'One more time',
    title: 'Confirm your password.',
    body: 'Type exactly what you typed above. We compare both entries as written.',
  },
  review: {
    eyebrow: 'Check it over',
    title: 'Ready to create your account?',
    body: 'Have a look before we set it up.',
  },
};

// Field ids that hold a real error slot, in form order.
const FIELD_STEPS = ['name', 'email', 'password', 'confirm'];

// Colour is never the only signal — every strength row also carries a label and
// an icon, so these classes are decoration rather than meaning.
const TONE_TEXT = {
  rose: 'text-rose-400',
  amber: 'text-amber-400',
  medical: 'text-medical-400',
  emerald: 'text-emerald-400',
  slate: 'text-slate-400',
};
const TONE_BG = {
  rose: 'bg-rose-500',
  amber: 'bg-amber-500',
  medical: 'bg-medical-500',
  emerald: 'bg-emerald-500',
  slate: 'bg-white/20',
};

// --- shared input shell -----------------------------------------------------
// One implementation for all four fields so the icon inset, the focus ring, the
// error border and the live region can never drift apart between steps.
// eslint-disable-next-line no-unused-vars
function FieldShell({ id, icon: Icon, error, hint, children, trailing }) {
  return (
    <div>
      <div className="relative">
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 pointer-events-none" />
        {children}
        {trailing ? <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</div> : null}
      </div>
      {/* aria-live so a validation error is announced the moment it appears,
          not only when focus happens to land back on the field. */}
      {error ? (
        <p id={`${id}-error`} role="alert" aria-live="polite" className="mt-1.5 text-[11px] font-semibold text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[11px] font-medium text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function PrimaryButton({ children, type = 'button', onClick, disabled, loading, icon: Icon = ArrowRight }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className="w-full bg-gradient-to-r from-medical-600 to-blue-600 hover:from-medical-500 hover:to-blue-500 text-white font-semibold py-4 rounded-xl shadow-lg shadow-medical-500/25 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100 min-h-[52px]"
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          Creating your account…
        </>
      ) : (
        <>
          {children}
          <Icon className="w-5 h-5" />
        </>
      )}
    </button>
  );
}

export default function SignupWizard({ onComplete, onCreated, onDuplicateAccount, onSwitchToSignIn }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [outcome, setOutcome] = useState(null); // { kind: 'session' } | { kind: 'verify', email }
  const [resendIn, setResendIn] = useState(0);
  const [resendState, setResendState] = useState(null); // 'sent' | 'error'
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));

  const step = STEPS[index];
  const headingRef = useRef(null);
  // Four individual refs rather than one object literal built during render: an
  // object built inline is a NEW value every render, so putting it in the focus
  // effect's dependency array would re-run that effect on every keystroke and
  // yank focus back to the input mid-typing. Ref objects themselves are stable.
  const nameRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);

  // A ref, not just state: React state is not updated synchronously, so two
  // rapid activations of "Create my account" would both read `false` from the
  // closure and fire two signUp calls — and the profile trigger is on
  // `on conflict do nothing`, so the second one is a silent no-op the user
  // cannot see. The visible disabled state is the accessible half of the same
  // protection; this ref is the half that actually closes the window.
  const submittingRef = useRef(false);
  // Whether we have already told the parent that this wizard owns the
  // post-signup destination. A ref so the claim happens synchronously.
  const claimedRef = useRef(false);

  // --- navigation -----------------------------------------------------------
  const goto = useCallback((next) => {
    setDirection(next > index ? 1 : -1);
    setIndex(next);
    setSubmitError(null);
  }, [index]);

  // Focus follows the step. A field step focuses its input so a keyboard user
  // can type immediately; an intro or review step focuses the heading so a
  // screen reader announces the new question instead of silently landing on
  // the Continue button.
  //
  // The RETRY is not defensive padding, it is required. AnimatePresence runs in
  // mode="wait": the outgoing step must finish EXITING before the incoming step
  // mounts, so on the very first effect run after a step change the new input's
  // ref is still null and a single focus() call silently does nothing — the
  // focus stays wherever the old step left it, usually <body>. Polling for the
  // node for up to a second covers the ~220ms exit without ever needing
  // mode="sync" (which would briefly put two inputs sharing an aria-label in
  // the DOM and break Playwright's strict-mode locators).
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const refForStep =
      step.id === 'name' ? nameRef
        : step.id === 'email' ? emailRef
          : step.id === 'password' ? passwordRef
            : step.id === 'confirm' ? confirmRef
              : headingRef;
    const tryFocus = () => {
      if (cancelled) return;
      const target = refForStep.current;
      if (!target) {
        if (attempts < 20) {
          attempts += 1;
          setTimeout(tryFocus, 50);
        }
        return;
      }
      try {
        target.focus({ preventScroll: true });
      } catch {
        target.focus();
      }
    };
    const t = setTimeout(tryFocus, prefersReducedMotion ? 0 : 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [index, step.id, prefersReducedMotion, nameRef, emailRef, passwordRef, confirmRef, headingRef]);

  // Land at the top of the card on every step change, so a tall previous step
  // cannot leave the new heading above the fold on a 360x640 phone.
  //
  // INSTANT, never 'smooth'. A smooth scroll here is a real defect, not a
  // taste call: it animates for ~300ms after the step swaps, so a fast second
  // tap lands on whatever moved under the finger, and any automated driver that
  // resolves a button's box and then clicks races the scroll and clicks stale
  // coordinates — which is exactly how the Continue button was found to be
  // dead while Enter-in-the-field worked fine. The step transition already
  // supplies the visual continuity; the scroll should just put us at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [index]);

  // --- connectivity ---------------------------------------------------------
  // An offline device gets an honest message instead of a signUp that fails
  // with an opaque network error.
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // --- resend countdown -----------------------------------------------------
  useEffect(() => {
    if (resendIn <= 0) return undefined;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // --- validation -----------------------------------------------------------
  const setField = useCallback((key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    // Clear a field's error the moment it is edited — a stale red border next
    // to a value the user just fixed is the most common source of "this form
    // thinks I'm wrong".
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }, []);

  const validateStep = useCallback((stepId) => {
    const validate = STEP_VALIDATORS[stepId];
    if (!validate) return true;
    const { valid, error } = validate(values);
    setErrors((e) => ({ ...e, [stepId]: valid ? undefined : error }));
    return valid;
  }, [values]);

  // --- the actual registration ---------------------------------------------
  const handleCreateAccount = useCallback(async () => {
    if (submittingRef.current) return;
    if (!supabase) {
      setSubmitError('Authentication is unavailable. Please try again later.');
      return;
    }
    // Re-check the WHOLE form, not just the review step: the user may have gone
    // back, edited a field, and jumped forward again.
    for (const id of FIELD_STEPS) {
      const { valid, error } = STEP_VALIDATORS[id](values);
      if (!valid) {
        setErrors((e) => ({ ...e, [id]: error }));
        const badIndex = STEPS.findIndex((s) => s.id === id);
        setDirection(-1);
        setIndex(badIndex);
        return;
      }
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    // Claim the redirect BEFORE the network call (see the note on the claim
    // effect below). Idempotent, so a retry after a recoverable failure does
    // not fire it twice.
    if (!claimedRef.current) {
      claimedRef.current = true;
      onCreated?.();
    }

    const bailToSignIn = () => {
      if (onDuplicateAccount) {
        onDuplicateAccount({ email: values.email.trim(), message: DUPLICATE_COPY });
      } else {
        setSubmitError(DUPLICATE_COPY);
      }
    };

    try {
      const { data, error } = await supabase.auth.signUp({
        email: values.email.trim(),
        password: values.password,
        options: {
          data: { full_name: values.fullName.trim() },
          // Was never passed before. Email confirmation is currently OFF on
          // this project, so this changes nothing today — but if the Supabase
          // dashboard toggle is ever flipped, the confirmation link would
          // otherwise land on the project's Site URL with no handler for the
          // token fragment.
          emailRedirectTo: `${window.location.origin}/activate`,
        },
      });

      // Supabase reports an existing email as an auth error (or user:null for an
      // unconfirmed user). Both mean the account already exists.
      if (isDuplicateAccountError(error)) {
        bailToSignIn();
        return;
      }
      if (error) throw error;

      // Two honest outcomes, never conflated:
      //   session → the account exists AND we hold a working session. We do not
      //            call that "verified"; we say what is true.
      //   verify  → the account exists but needs email confirmation. We say so
      //            and we navigate nowhere that requires a session.
      if (data?.session) {
        setOutcome({ kind: 'session' });
        return;
      }
      const { data: recovered } = await supabase.auth.getSession();
      if (recovered?.session) setOutcome({ kind: 'session' });
      else if (data?.user) setOutcome({ kind: 'verify', email: values.email.trim() });
      else bailToSignIn();
    } catch (err) {
      // Recoverable: every field is kept, we stay on review, and we say why.
      setSubmitError(err?.message || 'We could not create your account. Please try again.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [values, onDuplicateAccount, onCreated]);

  const handleResend = useCallback(async () => {
    if (resendIn > 0 || submittingRef.current) return;
    submittingRef.current = true;
    setResendState(null);
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email: values.email.trim() });
      if (error) throw error;
      setResendState('sent');
      // Client-side courtesy cooldown ONLY. There is deliberately no serverless
      // function for this: the Vercel Hobby plan caps api/*.js at 12 and the
      // project is already at 12/12, so adding one is not an option. The real
      // rate limit is Supabase's own auth limiter; this timer stops a person
      // hammering the button in between.
      setResendIn(45);
    } catch (err) {
      setResendState('error');
      setSubmitError(err?.message || 'We could not resend the verification email.');
    } finally {
      submittingRef.current = false;
    }
  }, [resendIn, values.email]);

  const handleContinue = useCallback(() => {
    if (submittingRef.current) return;
    if (step.id === 'review') {
      handleCreateAccount();
      return;
    }
    if (!validateStep(step.id)) return;
    goto(index + 1);
  }, [step.id, validateStep, goto, index, handleCreateAccount]);

  const handleBack = useCallback(() => {
    if (submittingRef.current || index === 0) return;
    goto(index - 1);
  }, [index, goto]);

  const greetingName = useMemo(() => firstNameOf(values.fullName), [values.fullName]);
  const strength = useMemo(() => passwordStrength(values.password), [values.password]);
  const numberedPosition = useMemo(
    () => STEPS.slice(0, index).filter((s) => s.numbered).length + (step.numbered ? 1 : 0),
    [index, step.numbered],
  );

  // Claim the post-signup destination BEFORE calling signUp.
  //
  // signUp resolves into a live session, and the parent (Auth.jsx) redirects
  // any authenticated visitor away from /signup while also unmounting whatever
  // it renders. Both are right for a returning visitor and wrong for us:
  // without this call the wizard is torn down the instant signUp resolves, the
  // success screen never renders, and the user is dropped on the dashboard with
  // no confirmation and no hand-off to /activate.
  //
  // Claiming up front, before we know whether the response carries a session,
  // is safe: the parent only consults the claim when `session` is truthy, and a
  // failed signUp leaves it falsy so there is nothing to redirect away from.
  useEffect(() => {
    if (outcome?.kind === 'session' && !claimedRef.current) {
      claimedRef.current = true;
      onCreated?.();
    }
  }, [outcome, onCreated]);

  // Reduced motion does not get a faster animation — it gets NO animation.
  // Animating the same slide faster is exactly what a motion-sensitive user is
  // asking you not to do.
  const motionProps = prefersReducedMotion
    ? { initial: false, animate: {}, exit: {}, transition: { duration: 0 } }
    : {
        custom: direction,
        variants: {
          initial: (dir) => ({ opacity: 0, x: dir * 28 }),
          animate: { opacity: 1, x: 0 },
          exit: (dir) => ({ opacity: 0, x: dir * -28 }),
        },
        initial: 'initial',
        animate: 'animate',
        exit: 'exit',
        transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
      };

  // --- terminal: the account exists and we hold a session -------------------
  if (outcome?.kind === 'session') {
    return (
      <Shell online={online}>
        <div className="text-center">
          <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">
            {greetingName ? `Welcome to PolyNurse, ${greetingName}.` : 'Welcome to PolyNurse.'}
          </h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-6">
            Your account is ready. Next, choose how you want to study — free, or unlock everything.
          </p>
          <PrimaryButton onClick={() => onComplete?.()}>Continue</PrimaryButton>
          <LegalFooter />
        </div>
      </Shell>
    );
  }

  // --- terminal: the account needs email confirmation -----------------------
  if (outcome?.kind === 'verify') {
    return (
      <Shell online={online}>
        <div className="text-center">
          <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-medical-500/15 border border-medical-500/30 flex items-center justify-center">
            <Mail className="w-8 h-8 text-medical-300" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Check your email</h1>
          <p className="text-slate-400 text-sm leading-relaxed mb-1">
            We sent a confirmation link to <span className="text-white font-semibold">{outcome.email}</span>.
          </p>
          <p className="text-slate-500 text-xs leading-relaxed mb-6">
            Your account exists, but it is not usable until you open that link — and we will not
            tell you it is confirmed until you have.
          </p>

          {resendState === 'sent' && (
            <p role="status" className="text-emerald-400 text-sm font-semibold mb-4">
              Sent. Check your inbox again in a moment.
            </p>
          )}
          {submitError && (
            <p role="alert" className="text-rose-400 text-sm bg-rose-400/10 border border-rose-400/20 rounded-lg p-3 mb-4">
              {submitError}
            </p>
          )}

          <button
            type="button"
            onClick={handleResend}
            disabled={resendIn > 0}
            className="w-full bg-gradient-to-r from-medical-600 to-blue-600 hover:from-medical-500 hover:to-blue-500 text-white font-semibold py-4 rounded-xl shadow-lg shadow-medical-500/25 flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-60 disabled:active:scale-100 min-h-[52px]"
          >
            <Key className="w-5 h-5" />
            {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend the email'}
          </button>

          <button
            type="button"
            onClick={() => onSwitchToSignIn?.()}
            className="mt-3 w-full text-slate-400 hover:text-white transition-colors text-sm font-medium py-3"
          >
            Use a different email
          </button>
          <LegalFooter />
        </div>
      </Shell>
    );
  }

  // --- the flow -------------------------------------------------------------
  return (
    <Shell online={online}>
      {step.numbered && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Step {numberedPosition} of {NUMBERED_TOTAL}
            </span>
            <span className="text-[10px] font-black uppercase tracking-widest text-polynurse-400">
              {greetingName || 'Scholar'}
            </span>
          </div>
          {/* aria-hidden: a segmented bar of divs conveys nothing to a screen
              reader, but the "Step 3 of 6" text above already does. */}
          <div className="flex gap-1" aria-hidden="true">
            {STEPS.filter((s) => s.numbered).map((s, i) => (
              <div
                key={s.id}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i + 1 < numberedPosition
                    ? 'bg-polynurse-500'
                    : i + 1 === numberedPosition
                      ? 'bg-gradient-to-r from-medical-500 to-blue-500'
                      : 'bg-white/10'
                }`}
              />
            ))}
          </div>
        </div>
      )}

      {/* One form for the whole flow so Enter submits from every step, which is
          what a keyboard user expects from a one-task-per-screen flow. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleContinue();
        }}
        noValidate
      >
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div key={step.id} {...motionProps}>
            {/* ---------------- welcome ---------------- */}
            {step.id === 'welcome' && (
              <div>
                <StepHeading
                  eyebrow={COPY.welcome.eyebrow}
                  title={COPY.welcome.title}
                  body={COPY.welcome.body}
                  headingRef={headingRef}
                />
                <div className="grid grid-cols-2 gap-2.5 my-6">
                  {PREVIEW_CARDS.map(
                    // eslint-disable-next-line no-unused-vars
                    ({ icon: Icon, title, body }) => (
                      <div key={title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <Icon className="w-5 h-5 text-polynurse-400 mb-2" />
                        <p className="text-[11px] font-black text-white uppercase tracking-wide leading-tight">
                          {title}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1 leading-snug">{body}</p>
                      </div>
                    ),
                  )}
                </div>
                <PrimaryButton type="submit">Start my journey</PrimaryButton>
                <button
                  type="button"
                  onClick={() => onSwitchToSignIn?.()}
                  className="mt-2 w-full text-slate-400 hover:text-white transition-colors text-sm font-medium py-3"
                >
                  Already have an account? Sign in
                </button>
              </div>
            )}

            {/* ---------------- name ---------------- */}
            {step.id === 'name' && (
              <div>
                <StepHeading eyebrow={COPY.name.eyebrow} title={COPY.name.title} body={COPY.name.body} headingRef={headingRef} />
                <div className="mt-6">
                  <FieldShell id="name" icon={User} error={errors.name} hint="For example: Amaka Okonkwo">
                    <input
                      ref={nameRef}
                      type="text"
                      placeholder="e.g. Amaka Okonkwo"
                      aria-label="Full name"
                      aria-invalid={!!errors.name}
                      aria-describedby={errors.name ? 'name-error' : 'name-hint'}
                      autoComplete="name"
                      // 16px minimum stops iOS Safari zooming the viewport on
                      // focus — the most common cause of a "broken" mobile form.
                      className={INPUT_CLASS(errors.name)}
                      value={values.fullName}
                      onChange={(e) => setField('fullName', e.target.value)}
                      onBlur={() => {
                        setTouched((t) => ({ ...t, name: true }));
                        if (values.fullName.trim()) validateStep('name');
                      }}
                    />
                  </FieldShell>
                </div>
                {/* A RESERVED SLOT, and that is the whole point of the wrapper.
                    The feedback line used to be conditionally rendered, so
                    blurring the input made it appear, which pushed the Continue
                    button DOWN by ~36px between a tap's mousedown and mouseup —
                    the click then landed above the button and did nothing. It
                    reproduces for a real user as a Continue button that
                    silently ignores the first tap. The min-h reserves the row
                    permanently, so feedback can change the words on screen but
                    never the layout. */}
                <div className="mt-4 min-h-[20px]" role="status" aria-live="polite">
                  {touched.name && values.fullName.trim() && !errors.name && (
                    <p className="text-sm text-emerald-400 font-semibold">
                      Welcome to PolyNurse, {greetingName}!
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ---------------- email ---------------- */}
            {step.id === 'email' && (
              <div>
                <StepHeading eyebrow={COPY.email.eyebrow} title={COPY.email.title} body={COPY.email.body} headingRef={headingRef} />
                <div className="mt-6">
                  <FieldShell
                    id="email"
                    icon={Mail}
                    error={errors.email}
                    hint="We use it to sign you in and to reset your password."
                  >
                    <input
                      ref={emailRef}
                      type="email"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck="false"
                      placeholder="e.g. amaka@gmail.com"
                      aria-label="Email address"
                      aria-invalid={!!errors.email}
                      aria-describedby={errors.email ? 'email-error' : 'email-hint'}
                      autoComplete="email"
                      className={INPUT_CLASS(errors.email)}
                      value={values.email}
                      onChange={(e) => setField('email', e.target.value)}
                      onBlur={() => {
                        setTouched((t) => ({ ...t, email: true }));
                        if (values.email.trim()) validateStep('email');
                      }}
                    />
                  </FieldShell>
                </div>
                {/* Reserved slot — see the note on the name step for why this
                    must never collapse to zero height. */}
                <div className="mt-4 min-h-[20px]" role="status" aria-live="polite">
                  {touched.email && !errors.email && values.email.trim() && (
                    <p className="text-sm text-emerald-400 font-semibold">That address looks right.</p>
                  )}
                </div>
              </div>
            )}

            {/* ---------------- password ---------------- */}
            {step.id === 'password' && (
              <div>
                <StepHeading
                  eyebrow={COPY.password.eyebrow}
                  title={COPY.password.title}
                  body={COPY.password.body}
                  headingRef={headingRef}
                />
                <div className="mt-6">
                  <FieldShell
                    id="password"
                    icon={Lock}
                    error={errors.password}
                    hint="Six characters minimum. A short phrase you will remember beats a short word."
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        aria-pressed={showPassword}
                        className="px-3 py-3 text-slate-400 hover:text-white transition-colors"
                      >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    }
                  >
                    <input
                      ref={passwordRef}
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Your password"
                      aria-label="Password"
                      aria-invalid={!!errors.password}
                      aria-describedby={errors.password ? 'password-error' : 'password-hint'}
                      autoComplete="new-password"
                      className={`${INPUT_CLASS(errors.password)} pr-14`}
                      value={values.password}
                      onChange={(e) => setField('password', e.target.value)}
                      onBlur={() => {
                        setTouched((t) => ({ ...t, password: true }));
                        if (values.password) validateStep('password');
                      }}
                    />
                  </FieldShell>
                </div>

                {/* Strength is GUIDANCE, never a gate. The only rule that can
                    block submission is the six-character policy the server
                    enforces. Refusing a valid password would teach people to
                    reuse one short password everywhere. */}
                {values.password.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                        Strength
                      </span>
                      <span className={`text-[10px] font-black uppercase tracking-widest ${TONE_TEXT[strength.tone]}`}>
                        {strength.label}
                      </span>
                    </div>
                    <div className="flex gap-1" aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => (
                        <div
                          key={i}
                          className={`h-1.5 flex-1 rounded-full transition-colors ${
                            i < strength.score ? TONE_BG[strength.tone] : 'bg-white/10'
                          }`}
                        />
                      ))}
                    </div>
                    <ul className="mt-2.5 space-y-1">
                      {strength.checks.slice(0, 3).map((c) => (
                        <li key={c} className="text-[11px] text-slate-400 flex items-start gap-1.5">
                          <CheckCircle2 className="w-3 h-3 shrink-0 mt-px text-slate-600" />
                          {c}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-[10px] text-slate-600">Guidance only — length is the rule.</p>
                  </div>
                )}
              </div>
            )}

            {/* ---------------- confirm ---------------- */}
            {step.id === 'confirm' && (
              <div>
                <StepHeading
                  eyebrow={COPY.confirm.eyebrow}
                  title={COPY.confirm.title}
                  body={COPY.confirm.body}
                  headingRef={headingRef}
                />
                <div className="mt-6">
                  <FieldShell
                    id="confirm"
                    icon={Lock}
                    error={errors.confirm}
                    hint="Must match the password above, exactly as you typed it."
                    trailing={
                      <button
                        type="button"
                        onClick={() => setShowConfirm((v) => !v)}
                        aria-label={showConfirm ? 'Hide password confirmation' : 'Show password confirmation'}
                        aria-pressed={showConfirm}
                        className="px-3 py-3 text-slate-400 hover:text-white transition-colors"
                      >
                        {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    }
                  >
                    <input
                      ref={confirmRef}
                      type={showConfirm ? 'text' : 'password'}
                      placeholder="Type it again"
                      aria-label="Confirm password"
                      aria-invalid={!!errors.confirm}
                      aria-describedby={errors.confirm ? 'confirm-error' : 'confirm-hint'}
                      autoComplete="new-password"
                      className={`${INPUT_CLASS(errors.confirm)} pr-14`}
                      value={values.confirmPassword}
                      onChange={(e) => setField('confirmPassword', e.target.value)}
                      onBlur={() => {
                        setTouched((t) => ({ ...t, confirm: true }));
                        if (values.confirmPassword) validateStep('confirm');
                      }}
                    />
                  </FieldShell>
                </div>
                {/* Reserved slot — see the note on the name step for why this
                    must never collapse to zero height. */}
                <div className="mt-4 min-h-[20px]" role="status" aria-live="polite">
                  {values.confirmPassword.length > 0 && !errors.confirm && values.confirmPassword === values.password && (
                    <p className="text-sm text-emerald-400 font-semibold">They match.</p>
                  )}
                </div>
              </div>
            )}

            {/* ---------------- review ---------------- */}
            {step.id === 'review' && (
              <div>
                <StepHeading
                  eyebrow={COPY.review.eyebrow}
                  title={COPY.review.title}
                  body={COPY.review.body}
                  headingRef={headingRef}
                />

                <dl className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] divide-y divide-white/5">
                  <ReviewRow icon={User} label="Name" value={values.fullName.trim()} onEdit={() => goto(1)} />
                  <ReviewRow icon={Mail} label="Email" value={maskEmail(values.email)} onEdit={() => goto(2)} />
                  <ReviewRow
                    icon={Lock}
                    label="Password"
                    value={`${values.password.length} characters, hidden`}
                    onEdit={() => goto(3)}
                  />
                </dl>

                <p className="mt-4 text-[11px] text-slate-500 flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400 mt-px" />
                  Your password goes straight to our authentication service. It is never stored in
                  this app, never displayed again, and never written to a database table of ours.
                </p>

                {submitError && (
                  <p
                    role="alert"
                    aria-live="assertive"
                    className="mt-4 text-rose-400 text-sm bg-rose-400/10 border border-rose-400/20 rounded-lg p-3"
                  >
                    {submitError}
                  </p>
                )}

                <div className="mt-6">
                  <PrimaryButton type="submit" loading={submitting}>
                    Create my account
                  </PrimaryButton>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Footer controls live INSIDE the form. They used to sit outside it,
            which made `type="submit"` a no-op: a submit button that is not
            inside a form submits nothing, so Continue silently did nothing on
            all four field steps. Only the four field steps get a footer
            Continue — the welcome and review steps each own their primary
            action, and rendering a second one would put two identical buttons
            on screen. */}
        {step.kind === 'field' && (
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="shrink-0 inline-flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm font-medium px-4 py-3 min-h-[48px]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="flex-1">
              <PrimaryButton type="submit">Continue</PrimaryButton>
            </div>
          </div>
        )}
        {step.kind === 'review' && (
          <div className="mt-4">
            <button
              type="button"
              onClick={handleBack}
              className="w-full inline-flex items-center justify-center gap-1.5 text-slate-400 hover:text-white transition-colors text-sm font-medium py-3 min-h-[48px]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to edit
            </button>
          </div>
        )}
      </form>

      <LegalFooter />
    </Shell>
  );
}

// --- small pieces -----------------------------------------------------------

// Every input shares this class so the focus ring, the error border and the
// 16px font (iOS zoom guard) cannot drift between steps.
function INPUT_CLASS(hasError) {
  return `w-full bg-slate-800/50 border rounded-xl py-3 pl-12 pr-4 text-white text-base placeholder:text-slate-400 focus:outline-none transition-colors ${
    hasError ? 'border-rose-500/60 focus:border-rose-400' : 'border-white/10 focus:border-medical-500'
  }`;
}

function StepHeading({ eyebrow, title, body, headingRef }) {
  return (
    <div>
      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-polynurse-400 mb-2">{eyebrow}</p>
      <h1 ref={headingRef} tabIndex={-1} className="text-2xl sm:text-3xl font-bold text-white mb-2 outline-none">
        {title}
      </h1>
      <p className="text-slate-400 text-sm leading-relaxed">{body}</p>
    </div>
  );
}

// eslint-disable-next-line no-unused-vars
function ReviewRow({ icon: Icon, label, value, onEdit }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <Icon className="w-4 h-4 text-slate-500 shrink-0" />
      <dt className="text-[10px] font-black uppercase tracking-widest text-slate-500 w-16 shrink-0">{label}</dt>
      <dd className="text-sm text-white font-semibold truncate flex-1 min-w-0">{value}</dd>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-[11px] font-black uppercase tracking-widest text-medical-400 hover:text-medical-300 transition-colors px-2 py-2"
      >
        Edit
      </button>
    </div>
  );
}

function LegalFooter() {
  return (
    <>
      <p className="mt-6 text-slate-500 text-[11px] leading-relaxed">
        By creating an account, you agree to our{' '}
        <Link to="/legal/terms" className="text-medical-400 underline">Terms of Service</Link>,{' '}
        <Link to="/legal/privacy" className="text-medical-400 underline">Privacy Policy</Link> and{' '}
        <Link to="/legal/cookies" className="text-medical-400 underline">Cookie Policy</Link>.
      </p>
      <div className="flex items-center justify-center gap-3 text-slate-500 text-xs pt-4">
        <Link to="/legal/terms" className="hover:text-slate-300 transition-colors">Terms</Link>
        <span className="text-slate-700">•</span>
        <Link to="/legal/privacy" className="hover:text-slate-300 transition-colors">Privacy</Link>
        <span className="text-slate-700">•</span>
        <Link to="/legal/cookies" className="hover:text-slate-300 transition-colors">Cookies</Link>
      </div>
    </>
  );
}

// The card plus the ambient background. items-start on small screens is
// deliberate: a centred flex child taller than the viewport clips at BOTH ends
// with no way to scroll to either.
//
// THE GENEROUS BOTTOM PADDING IS A BUG FIX, not styling. CookieConsentBanner is
// `fixed bottom-0` at z-60 and spans the full width, so at 360x640 it sat
// directly ON TOP of the "Start my journey" button — the primary action of the
// whole flow was unclickable for a first-time visitor on a phone. Found by
// Playwright refusing the click ("intercepts pointer events"); it would have
// been reported as a flaky test rather than a dead button. pb-32 clears the
// banner with room to spare on the shortest supported viewport.
function Shell({ children, online }) {
  return (
    <div className="min-h-screen flex items-start sm:items-center justify-center bg-slate-950 px-4 pt-6 pb-32 sm:py-8 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full" aria-hidden="true">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-medical-500/10 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[120px]" />
      </div>

      {!online && (
        <div
          role="status"
          className="absolute top-3 inset-x-3 z-20 mx-auto max-w-md flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500/95 text-slate-950 text-[11px] font-black uppercase tracking-widest shadow-xl"
        >
          <Info className="w-3.5 h-3.5 shrink-0" />
          You are offline — we need a connection to create your account
        </div>
      )}

      <div className="w-full max-w-md z-10">
        <div className="bg-slate-900/50 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl">
          <div className="flex items-center justify-center gap-2 mb-6">
            <BrandLogo variant="mark" size="xl" />
            <BrandLogo variant="short" size="lg" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
