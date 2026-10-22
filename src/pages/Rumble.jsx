import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Modal from "../components/Modal";
import { useAppContext } from "../context/AppContext";
import { useChallenge } from "../context/ChallengeContext";
import TutorialTip from '../components/TutorialTip';
import { useWarhallExit } from '../components/WarhallExitContext';
import { supabase } from "../utils/supabase";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Zap, Star, ChevronLeft, ArrowRight, Users, AlertCircle, RefreshCw, Trophy, Award, Shield, User, SkipForward, Check, X, Search, Swords } from "../components/Icons";
import { useMatchRealtime } from "../hooks/useMatchRealtime";
// ---------------------------------------------------------------------------
// Constants. The stake is FIXED and shown upfront: no wager selector, so nobody
// can be surprised and the >=10 SC high-wager confirmation can never fire.
// ---------------------------------------------------------------------------
const ARENA_STAKE = 2;
const BLITZ_DURATION_MS = 90 * 1000;   // one shared 90s wall-clock
const ARENA_POLL_MS = 1500;
const ARENA_HEARTBEAT_MS = 5000;
const SCHOLARS_POLL_MS = 4000;
// Typing a name should not fire a request per keystroke.
const SCHOLARS_SEARCH_DEBOUNCE_MS = 350;
// The server ignores a query shorter than this (1 char matches most of the
// roster), so mirror that here and say so instead of silently ignoring it.
const SCHOLAR_SEARCH_MIN = 2;
// How long to sit in the matchmaking queue before giving the player their stake
// back and telling them why. Without this, a failed enqueue (or an opponent who
// never readies) leaves the screen spinning with coins held.
const MATCHMAKING_TIMEOUT_MS = 45 * 1000;
const HISTORY_LIMIT = 5;
const ACTIVE_ARENA_KEY = "apex_active_arena";
const ARENA_DEBUG_KEY = "apex_arena_debug";
// Flow State paces, in seconds, exactly the v104 server range. Flow never
// touches the shared 90s clock: it only decides how long YOUR unanswered
// question sits before it is auto-skipped for 0 points.
const FLOW_PACES = [3, 6, 9, 12];
const FLOW_DEFAULT_PACE = 6;
const EMPTY_CARD = { answers: 0, correct: 0, wrong: 0, skipped: 0, points: 0 };

// Server error code -> something a player can act on. Anything unlisted falls
// back to a generic line, so a new server-side code can never render as "null".
const ARENA_ERROR_COPY = {
  NO_OPPONENT_FOUND: 'Nobody joined the arena in time. Your stake has been returned - pick someone below to challenge.',
  INSUFFICIENT_SC: 'You need at least 2 Smart Coins to enter the arena.',
  OPPONENT_INSUFFICIENT_SC: 'That scholar cannot cover a 2 SC stake right now.',
  OPPONENT_REQUIRED: 'Pick someone to challenge first.',
  INVALID_STAKE: 'That stake is not allowed.',
  PRACTICE_NEEDS_BOT: 'Free practice is only available against a tutor bot.',
  NOT_ACTIVATED: 'Activate your account before entering the arena.',
  ALREADY_IN_MATCH: 'You are already in a duel. Finish or cancel it first.',
  NETWORK_OR_RPC: 'Could not reach the arena. Check your connection and try again.',
};

// Tutor bots. Practice is FREE (stake 0): no escrow, no history row, no verified
// stats. They play the same 40-question board on the same clock with the same
// scoring and the same one-time Double - the client sends only the tutor id and
// the server answers them live, question by question.
//
// The win rate below is not decoration. migration-v86 rolls it ONCE per match on
// the server and then plays the bot's answers into that outcome, so the duel
// ends roughly as often as it says. The client sends nothing about it.
const BOT_OPPONENTS = [
  { key: 'house', name: 'The House', tier: 'Rookie', accent: 'from-slate-600 to-slate-800', icon: '🏛️', blurb: 'Wins about 4 duels in 10. A warm-up before you stake anything real.' },
  { key: 'zainab', name: 'Nurse Zainab', tier: 'Intermediate', accent: 'from-emerald-600 to-teal-700', icon: '🩺', blurb: 'Wins about 6 duels in 10. Steady hands — a real drill.' },
  { key: 'apollo', name: 'Prof. Apollo', tier: 'Expert', accent: 'from-rose-600 to-red-700', icon: '🎓', blurb: 'Wins about 9 duels in 10. Relentless. Only the sharp survive.' },
];

// Debug trace. The "sudden death pops up out of nowhere" class of bug is
// unfixable without a record of what fired and why, so every phase change logs
// its trigger. Enable with localStorage.setItem('apex_arena_debug', '1').
const arenaTrace = (event, detail = {}) => {
  if (typeof window === 'undefined') return;
  let on = false;
  try { on = window.localStorage.getItem(ARENA_DEBUG_KEY) === '1'; } catch { on = false; }
  if (!on) return;
  console.debug(`[arena] ${event}`, detail);
};

// A history row's colour follows the OUTCOME, never the sign of the delta. The
// v63 bug was that both were derived from different facts, so a loss could
// render a red icon next to a green "+0 SC".
const OUTCOME_META = {
  win: { icon: Trophy, tone: 'text-emerald-400', word: 'Win' },
  loss: { icon: X, tone: 'text-red-400', word: 'Loss' },
  draw: { icon: Award, tone: 'text-slate-400', word: 'Draw' },
};
const outcomeMeta = (o) => OUTCOME_META[o] || OUTCOME_META.draw;

// Which screen the header Back button returns to, one level up. The arena's
// screens are internal state (goPhase never pushes router history), so router
// back would leave /rumble instead of walking back through the Warhall. The hub
// is deliberately absent: from the hub, Back leaves the page.
const BACK_STEPS = {
  picker: { to: 'hub', label: 'War Hall' },
  bots: { to: 'picker', label: 'Arena' },
  'blitz-result': { to: 'hub', label: 'War Hall' },
};

const SCHOLAR_STATUS = {
  available: { dot: 'bg-emerald-400', label: 'Available', button: 'Challenge', buttonClass: 'bg-purple-600 hover:bg-purple-500 text-white' },
  in_match: { dot: 'bg-amber-400', label: 'In a match', button: 'Busy', buttonClass: 'bg-white/10 text-white/30' },
  offline: { dot: 'bg-slate-600', label: 'Offline', button: 'Unavailable', buttonClass: 'bg-white/5 text-white/20' },
};

const lastSeenLabel = (iso) => {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const s = Math.round(ms / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const cardFrom = (c) => ({
  answers: Number(c?.answers) || 0,
  correct: Number(c?.correct) || 0,
  wrong: Number(c?.incorrect) || 0,
  skipped: Number(c?.skipped) || 0,
  points: Number(c?.points) || 0,
});

// `Number(x) ?? fallback` is a bug, not a fallback: Number(undefined) is NaN and
// NaN is never nullish, so the "fallback" silently became NaN.
const numOr = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

// A per-request id makes the Flow toggle idempotent: a double tap (or a retry
// after a dropped response) is answered as a replay instead of a second event.
const flowRequestId = () => {
  try { return globalThis.crypto?.randomUUID?.() || null; } catch { return null; }
};

// ---------------------------------------------------------------------------
// Scorecard. Deliberately three numbers only: answered (big), correct, wrong.
// "seen" / "skip" / "Double available" / "Racing" were clutter - skip and the
// Double are already legible from the Skip button and the Double button.
// ---------------------------------------------------------------------------
const ScoreCard = ({ title, card, tone, sub }) => {
  const cls = tone === 'you'
    ? 'bg-emerald-500/10 border-emerald-500/20'
    : 'bg-indigo-500/10 border-indigo-500/20';
  const head = tone === 'you' ? 'text-emerald-300' : 'text-indigo-300';
  const big = tone === 'you' ? 'text-emerald-300' : 'text-indigo-300';
  return (
    <div className={`rounded-2xl border p-4 text-center ${cls}`}>
      <p className={`truncate text-[10px] font-black uppercase tracking-widest ${head}`}>{title}</p>
      <p className={`text-4xl font-black tabular-nums leading-none mt-1 ${big}`}>{card.answers}</p>
      <p className="mt-1 text-[9px] font-bold uppercase tracking-widest text-white/35">answered</p>
      <div className="mt-2 flex items-center justify-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] font-black tabular-nums text-emerald-300">
          <Check size={11} /> {card.correct}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2.5 py-1 text-[10px] font-black tabular-nums text-red-300">
          <X size={11} /> {card.wrong}
        </span>
      </div>
      {sub ? <p className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-white/30">{sub}</p> : null}
    </div>
  );
};

const Rumble = () => {
  // The context carries a complete no-op default, so the hook never throws
  // and is always called in the same order.
  const { registerDuelState } = useWarhallExit();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    session,
    smartCoins, syncAchievements, refreshSmartCoins,
    arenaCreateMatch, arenaReady, arenaStart, arenaAnswer, arenaHeartbeat,
    arenaForfeit, arenaCancel, arenaSettle, arenaState, arenaEnqueue, arenaFlow,
    arenaInvite, arenaInvites, arenaInviteRespond, arenaInviteCancel,
    arenaLeaveQueue, arenaRoster,
  } = useAppContext();

  // ChallengeContext owns the invite poll, the popup, and the accepted-match
  // handoff. The Arena is the only thing that can act on that handoff, which is
  // why these two are wired together rather than each polling on its own.
  // handoffTick wakes this drain when a handoff lands while the Arena is
  // already mounted at the same phase — a ref alone cannot re-run an effect.
  const { consumeAdopt, setMatchLive, handoffTick } = useChallenge();

  // ---- shell --------------------------------------------------------------
  const [phase, setPhase] = useState('hub');
  const phaseRef = useRef('hub');
  const [meId, setMeId] = useState(null);
  const [duelHistory, setDuelHistory] = useState([]);

  // Who the player was sent here to challenge, from /rumble?challenge=<userId>.
  // The hub sends this after a successful arenaInvite so the Arena can confirm
  // what happened to that specific challenge instead of dropping the player on
  // a list they now have to find the person on again.
  const challengeTargetId = searchParams.get('challenge');
  const [handoffDismissed, setHandoffDismissed] = useState(false);

  // ---- lobby --------------------------------------------------------------
  const [roster, setRoster] = useState({ players: [], online: 0, searching: false });
  const [rosterLoading, setRosterLoading] = useState(false);
  // Scholars search (migration v75). `scholarQuery` is what the box holds;
  // `activeQuery` is the debounced value actually sent to the server, so the
  // 4s poll cannot fire mid-keystroke.
  const [scholarQuery, setScholarQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');

  // ---- match --------------------------------------------------------------
  const [opponent, setOpponent] = useState('Rival Scholar');
  const [finding, setFinding] = useState(null);   // 'human' | 'bot' | null
  // Why the last attempt failed. null means "nothing went wrong yet". Populated
  // by arenaFailure so a refused start explains itself instead of hanging.
  const [phaseError, setPhaseError] = useState(null);
  // Pending invites (migration v78). Both directions, so the sender can cancel
  // and the recipient can accept/decline without leaving the page.
  const [invites, setInvites] = useState({ incoming: [], outgoing: [], windowSeconds: 600 });
  const [inviteBusy, setInviteBusy] = useState(null);
  const [countdown, setCountdown] = useState(3);
  const [blitzMatch, setBlitzMatch] = useState(null);
  const [blitzQuestions, setBlitzQuestions] = useState([]);
  const [blitzIndex, setBlitzIndex] = useState(0);
  const [myCard, setMyCard] = useState(EMPTY_CARD);
  const [oppCard, setOppCard] = useState(EMPTY_CARD);
  const [blitzAnswers, setBlitzAnswers] = useState([]);
  const [doubleArmed, setDoubleArmed] = useState(false);
  const [doubleUsed, setDoubleUsed] = useState(false);
  const [blitzTimeLeft, setBlitzTimeLeft] = useState(BLITZ_DURATION_MS);
  const [blitzResult, setBlitzResult] = useState(null);
  const [achievements, setAchievements] = useState([]);
  const [arenaReview, setArenaReview] = useState(null);
  const [oppDown, setOppDown] = useState(false);
  const [graceSeconds, setGraceSeconds] = useState(15);
  const [forfeitOpen, setForfeitOpen] = useState(false);
  const [userAnswerState, setUserAnswerState] = useState(null);
  const [txState, setTxState] = useState(null);

  // ---- Flow State (migration v104) ----------------------------------------
  // PER-PLAYER. The server stores the caller's own toggle/pace events, so this
  // ring can never be imposed on the opponent. `paceTick` only exists to
  // re-render the ring every 100ms; the deadline itself is wall-clock.
  //
  // `preferredPace` is chosen BEFORE the match, on the picker, and survives
  // clearMatch (it is a user preference, not match state). `flowPace` is the
  // pace the SERVER currently has for this player in THIS match; the picker
  // seeds it and every flow RPC can overwrite it. In-match, do not offer a
  // second set of chips — the pace is decided once, before the clock starts.
  const [flowActive, setFlowActive] = useState(false);
  const [flowPace, setFlowPace] = useState(FLOW_DEFAULT_PACE);
  const [preferredPace, setPreferredPace] = useState(FLOW_DEFAULT_PACE);
  const [flowBusy, setFlowBusy] = useState(false);
  const [paceTick, setPaceTick] = useState(0);
  const [showPaceSheet, setShowPaceSheet] = useState(false);
  const [tempPace, setTempPace] = useState(FLOW_DEFAULT_PACE);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const matchIdRef = useRef(null);
  const lastOptionRef = useRef(null);
  const settleDoneRef = useRef(false);
  const paceShownAtRef = useRef(0);
  const paceShownIndexRef = useRef(-1);
  const paceSkipForRef = useRef(-1);
  const paceKeyRef = useRef('');
  // A poll that lands WHILE our own toggle is still in flight can carry the
  // pre-toggle snapshot; ignoring flow fields during the write prevents the
  // switch from flickering back off. The RPC response is the next truth.
  const flowBusyRef = useRef(false);

  // Every phase change records WHY, so an unexpected transition is traceable.
  const goPhase = useCallback((next, trigger) => {
    arenaTrace('phase', { from: phaseRef.current, to: next, trigger, matchId: matchIdRef.current });
    phaseRef.current = next;
    setPhase(next);
  }, []);

  // Back must return to the PREVIOUS screen, not a hardcoded home route.
  // window.history.state.idx is React Router's depth counter; a fresh tab or a
  // direct URL load has no history to go back to, so fall back to /dashboard.
  const goBack = useCallback(() => {
    const idx = typeof window !== 'undefined' ? window.history?.state?.idx : null;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else { 
      arenaTrace('back', { fallback: '/dashboard', reason: 'no router history' }); 
      setShowExitConfirm(true);
    }
  }, [navigate]);

  // The arena's screens are internal state, NOT router entries: goPhase never
  // pushes history. So router back would leave /rumble entirely. Each screen
  // therefore names the screen ONE level up, and the header button walks that
  // step; only the hub itself falls through to the router (leaving the Warhall).
  const backStep = BACK_STEPS[phase] || null;

  // While a stake is escrowed the Back button is HIDDEN for the whole staked
  // span — waiting (opponent not confirmed), the countdown, and the live round.
  // Cancel/Forfeit is the only deliberate exit and it settles the pot; a Back
  // button here could strand two players' stakes. On the result screen the
  // button returns as a plain "return home", because the match is settled.
  const STAKED_PHASES = ['blitz-waiting', 'blitz-countdown', 'blitz-play'];
  const stakeHeld = STAKED_PHASES.includes(phase);
  useEffect(() => {
    registerDuelState?.(stakeHeld);
  }, [stakeHeld, registerDuelState]);
  const showBack = !stakeHeld && phase !== 'scholars';
  const handleBack = useCallback(() => {
    const step = BACK_STEPS[phase];
    if (step) {
      arenaTrace('back', { from: phase, to: step.to });
      goPhase(step.to, `back-${phase}`);
    } else {
      goBack();
    }
  }, [phase, goPhase, goBack]);

  // The current user's id is already in the auth session, synchronously.
  // Do NOT call supabase.auth.getUser() here: it takes GoTrue's navigator
  // lock across a network round-trip, and StrictMode double-invokes this
  // effect — two effects doing that produced a 4-deep queue that tripped
  // gotrue's "lock was not released within 5000ms" recovery. Reading the
  // session costs no network and takes no lock.
  useEffect(() => {
    setMeId(session?.user?.id || null);
  }, [session?.user?.id]);

  // ---- duel history: the LAST 5, newest first ---------------------------
  const fetchHistory = useCallback(async () => {
    if (!supabase) return;
    try {
      // `duels` is SELECT-own-only (migration-v33), so the filter below is a
      // correctness no-op that also keeps the row shape explicit. The userId
      // comes from the caller — never re-resolved over the network here.
      let userId = session?.user?.id || null;
      let query = supabase
        .from('duels')
        .select('id, opponent, mode, stake, outcome, delta, created_at')
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT);
      if (userId) query = query.eq('user_id', userId);
      const { data } = await query;
      if (data) setDuelHistory(data);
    } catch { /* ignore */ }
  }, [session?.user?.id]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // ---- arena state plumbing ---------------------------------------------
  const streakOf = useCallback((rows) => {
    let s = 0;
    for (const r of rows || []) {
      if (r?.skipped) continue;
      s = r?.isCorrect ? s + 1 : 0;
    }
    return s;
  }, []);

  const applyArenaState = useCallback((data) => {
    if (!data) return;
    setMyCard(cardFrom(data.myScore));
    setOppCard(cardFrom(data.opponentScore));
    setOppDown(!!data.opponentDisconnected);
    if (data.graceSeconds != null) setGraceSeconds(Number(data.graceSeconds) || 15);
    // Flow is restored from the server on reconnect/resume. Absent fields mean
    // "leave the current local value alone" (e.g. an older snapshot), and a
    // snapshot that raced our own in-flight toggle is ignored.
    if (!flowBusyRef.current) {
      if (data.flowActive != null) setFlowActive(!!data.flowActive);
      if (data.pace != null) setFlowPace(numOr(data.pace, FLOW_DEFAULT_PACE));
    }
  }, []);

  // Adopt a freshly created (or replayed) match and declare MY readiness. The
  // clock only opens once the server says both sides are ready.
  const adoptArena = useCallback(async (created, oppLabel) => {
    if (!created || !created.matchId) return false;
    const mid = created.matchId;
    matchIdRef.current = mid;
    const questions = created.questions || [];
    setBlitzMatch({
      matchId: mid,
      questions,
      questionCount: numOr(created.questionCount, questions.length),
      startsAt: null,
      endsAt: null,
      stake: numOr(created.stake, ARENA_STAKE),
      practice: !!created.practice,
      escrowed: created.escrowed ?? 0,
    });
    setBlitzQuestions(questions);
    setBlitzIndex(0);
    setMyCard(EMPTY_CARD);
    setOppCard(EMPTY_CARD);
    setBlitzAnswers([]);
    setDoubleArmed(false);
    setDoubleUsed(false);
    setBlitzResult(null);
    setAchievements([]);
    setArenaReview(null);
    setOppDown(false);
    setBlitzTimeLeft(BLITZ_DURATION_MS);
    setFlowActive(false);
    setFlowPace(FLOW_DEFAULT_PACE);
    paceShownIndexRef.current = -1;
    paceSkipForRef.current = -1;
    paceKeyRef.current = '';
    settleDoneRef.current = false;
    if (oppLabel) setOpponent(oppLabel);

    const ready = await arenaReady(mid);
    // Reconciled after a MATCH_NOT_WAITING: the match already advanced out of
    // waiting/ready. Surface the authoritative state instead of forcing a
    // readiness mutation.
    if (ready?.reconciled) {
      matchIdRef.current = mid;
      const st = ready.state;
      setBlitzMatch((m) => ({
        ...(m || {}),
        matchId: mid,
        startsAt: st.startsAt || null,
        endsAt: st.endsAt || null,
        stake: numOr(st.stake, ARENA_STAKE),
        practice: !!st.practice,
        escrowed: st.escrowed ?? 0,
      }));
      applyArenaState(st);
      if (st.status === 'active' && st.endsAt) {
        setBlitzTimeLeft(Math.max(0, Date.parse(st.endsAt) - Date.now()));
        goPhase('blitz-play', 'reconciled-active');
      } else if (st.status === 'ready') {
        goPhase('blitz-countdown', 'reconciled-ready'); setCountdown(3);
      } else if (st.status === 'completed' || st.status === 'abandoned') {
        settleDoneRef.current = true;
        const res = await arenaSettle(mid);
        finishArena(res);
      } else {
        goPhase('blitz-waiting', 'reconciled-waiting');
      }
      return true;
    }
    try {
      sessionStorage.setItem(ACTIVE_ARENA_KEY, JSON.stringify({ matchId: mid, stake: created.stake }));
    } catch { /* ignore */ }

    if (ready?.canStart) { goPhase('blitz-countdown', 'both-ready'); setCountdown(3); }
    else { goPhase('blitz-waiting', 'awaiting-opponent-ready'); }
    return true;
  }, [arenaReady, goPhase]);

  // Resume a match we were already in (ALREADY_IN_MATCH hands back the id).
  const resumeArena = useCallback(async (mid) => {
    if (!mid) return;
    const st = await arenaState(mid);
    if (!st?.ok) return;
    matchIdRef.current = mid;
    const questions = st.questions || [];
    setBlitzMatch((m) => ({
      ...(m || {}),
      matchId: mid,
      questions,
      questionCount: numOr(st.questionCount, questions.length),
      startsAt: st.startsAt || null,
      endsAt: st.endsAt || null,
      stake: numOr(st.stake, ARENA_STAKE),
      practice: !!st.practice,
      escrowed: st.escrowed ?? 0,
    }));
    setBlitzQuestions(questions);
    setOpponent(st.opponentName || 'Rival Scholar');
    applyArenaState(st);
    setArenaReview(Array.isArray(st.review) ? st.review : null);
    if (st.status === 'active' && st.endsAt) {
      setBlitzTimeLeft(Math.max(0, Date.parse(st.endsAt) - Date.now()));
      goPhase('blitz-play', 'resume-active');
    } else if (st.status === 'ready') {
      goPhase('blitz-countdown', 'resume-ready'); setCountdown(3);
    } else if (st.status === 'completed' || st.status === 'abandoned') {
      settleDoneRef.current = true;
      const res = await arenaSettle(mid);
      finishArena(res);
    } else {
      goPhase('blitz-waiting', 'resume-waiting');
    }
  }, [arenaState, arenaSettle, applyArenaState, goPhase]);

  // ---- THE ACCEPTED-CHALLENGE HANDOFF -------------------------------------
  // This is the function that was missing, and its absence is why two players
  // never actually started together.
  //
  // The server half was already correct: migration-v84 gives the inviter a
  // `ready[]` entry when their challenge is accepted, and ChallengeContext
  // polls it, acknowledges it with arena_invite_ready, and parks the match id
  // in a ref. Then... nothing read that ref. `consumeAdopt` and `setMatchLive`
  // had ZERO callers in the codebase. The inviter was told "Opening the
  // duel…" and stayed where they were, forever.
  //
  // Two things are needed, not one:
  //   1. READY. The accepter is made `creator_id` by arena_invite_respond and
  //      readies itself. The clock only opens when the server says BOTH sides
  //      are ready, so the inviter must declare readiness too. Without this
  //      the match sits in 'waiting' and the 9.4 never-readied sweep eventually
  //      refunds both as a no-show.
  //   2. RESUME. `arenaReady` returns canStart, but the questions and the
  //      authoritative state come from `arena_state`, so we resume afterwards
  //      rather than trying to rebuild the board from the ready response.
  //
  const joinAdopted = useCallback(async (mid) => {
    if (!mid || !arenaReady || !arenaState) return;
    matchIdRef.current = mid;
    setPhaseError(null);
    arenaTrace('adopt-challenge', { matchId: mid });
    await arenaReady(mid);
    await resumeArena(mid);
  }, [arenaReady, arenaState, resumeArena]);

  // Mount, every phase change, AND every handoffTick: the handoff can land
  // while the Arena is already mounted at the same phase (popup accept on
  // /rumble, or an inviter handoff arriving mid-picker), and a ref alone
  // cannot re-run an effect. A live duel is NEVER interrupted — the ref
  // stays parked and the next phase change drains it.
  useEffect(() => {
    if (phaseRef.current === 'blitz-play' || phaseRef.current === 'blitz-countdown') return;
    const adopted = consumeAdopt?.();
    if (adopted) joinAdopted(adopted);
  }, [phase, handoffTick, consumeAdopt, joinAdopted]);

  // Tell ChallengeContext a duel is running so the incoming-challenge popup
  // stays suppressed. Derived from the phase rather than set at each call site:
  // a missed call here means a popup covering a live 90-second duel.
  useEffect(() => {
    setMatchLive?.(phase === 'blitz-play');
  }, [phase, setMatchLive]);

  // One invite read on arrival, to resolve the ?challenge= handoff.
  //
  // This used to be a 2.5s interval for as long as the scholars screen was
  // mounted. It is now a single call, because ChallengeContext already polls
  // app-wide and the popup is what actually acts on new invites. Net effect on
  // request count is negative.
  useEffect(() => {
    refreshInvites();
    // Intentionally mount-only: re-running on every invites change would
    // re-trigger itself, since refreshInvites writes invites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- entry points -------------------------------------------------------
  const enterArena = useCallback(() => goPhase('scholars', 'enter-arena'), [goPhase]);

  // ONE failure path for every arena entry point. `arenaRpc` returns null when
  // the RPC itself fails (a missing/renamed signature surfaces as PGRST202) and
  // `{ok:false,error}` when the server refuses, so a bare `else` used to leave
  // the player sitting on "Waiting for an opponent..." forever with coins held.
  // Every caller now lands back on a real screen with a readable reason.
  const arenaFailure = useCallback((trigger, res, backTo) => {
    const code = res?.error || (res === null ? 'NETWORK_OR_RPC' : 'UNKNOWN');
    arenaTrace(trigger, { error: code });
    setPhaseError(code);
    if (backTo) goPhase(backTo, `${trigger}-failed`);
  }, [goPhase]);

  // Practice vs a tutor. stake 0 / p_practice: the server forces it, so no
  // coins are held, no history row is written and no verified stat is recorded.
  const startVsBot = useCallback(async (botKey, botName) => {
    setPhaseError(null);
    setFinding('bot');
    setOpponent(botName);
    goPhase('blitz-waiting', 'practice');
    const res = await arenaCreateMatch({ stake: 0, bot: botKey, practice: true });
    if (res?.matchId) { await adoptArena(res, botName); return; }
    if (res?.error === 'ALREADY_IN_MATCH' && res.matchId) { await resumeArena(res.matchId); return; }
    arenaFailure('practice', res, 'bots');
  }, [arenaCreateMatch, adoptArena, resumeArena, goPhase, arenaFailure]);

  // Cancel is the ONLY exit while a stake is held. It ALWAYS leaves the
  // matchmaking queue first: the queued path used to call resetToBetting,
  // which left the arena_queue row behind and could auto-pair the player into a
  // match they had walked away from.

  // ---- invitations (migration v78) ---------------------------------------
  const refreshInvites = useCallback(async () => {
    const r = await arenaInvites();
    setInvites(r);
    return r;
  }, [arenaInvites]);

  // The `?challenge=` handoff, resolved against the live invite list rather
  // than assumed. It renders ONLY the state it can actually prove: that the
  // invite still exists and is waiting for an answer.
  //
  // There is deliberately no "not sent" / "declined" branch here. Inferring one
  // from an absent row would be guessing, because an absent row has five causes
  // (never created, accepted, declined, expired, already answered) and this
  // page cannot tell them apart. Guessing would have meant a banner telling
  // someone their challenge was declined at the exact moment it was accepted
  // and the duel was opening.
  const handoffTarget = useMemo(() => {
    if (!challengeTargetId || handoffDismissed) return null;
    const outgoing = (invites?.outgoing || []).find((i) => i.userId === challengeTargetId);
    return outgoing ? { name: outgoing.name || 'that scholar', stake: outgoing.stake } : null;
  }, [challengeTargetId, handoffDismissed, invites]);

  const dismissHandoff = useCallback(() => {
    setHandoffDismissed(true);
    // Scrub the query so a reload does not resurrect the banner.
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  // Sending an invite moves NO coins. That is the whole point of the flow: the
  // stake is held only when the other player accepts.
  const inviteScholar = useCallback(async (scholar) => {
    if (ARENA_STAKE > smartCoins) {
      setPhaseError('INSUFFICIENT_SC');
      return;
    }
    setPhaseError(null);
    setInviteBusy(scholar.userId);
    const res = await arenaInvite({ userId: scholar.userId, stake: ARENA_STAKE });
    setInviteBusy(null);
    if (res?.ok) { await refreshInvites(); return; }
    arenaFailure('invite', res, null);
  }, [smartCoins, arenaInvite, refreshInvites, arenaFailure]);

  const answerInvite = useCallback(async (invite, accept) => {
    setPhaseError(null);
    setInviteBusy(invite.inviteId);
    const res = await arenaInviteRespond({ inviteId: invite.inviteId, accept });
    if (!res?.ok && accept) {
      setInviteBusy(null);
      await refreshInvites();
      arenaFailure('invite-accept', res, null);
      return;
    }
    setInviteBusy(null);
    await refreshInvites();
    // Accepting returns the create result, so the match can be adopted without
    // another round trip. Escrow has already happened server-side.
    if (accept && res?.matchId) {
      setFinding('human');
      setOpponent(invite.name || 'Rival Scholar');
      await adoptArena(res, invite.name);
    }
  }, [arenaInviteRespond, refreshInvites, arenaFailure, adoptArena]);

  const cancelInvite = useCallback(async (invite) => {
    setInviteBusy(invite.inviteId);
    await arenaInviteCancel({ inviteId: invite.inviteId });
    setInviteBusy(null);
    await refreshInvites();
  }, [arenaInviteCancel, refreshInvites]);

  const cancelArena = useCallback(async () => {
    const mid = matchIdRef.current;
    await arenaLeaveQueue();
    if (!mid) { resetToPicker('cancel-queued'); return; }
    const res = await arenaCancel(mid);
    if (res?.ok) { setBlitzResult(res); goPhase('blitz-result', 'cancel'); }
    else resetToPicker('cancel-failed');
  }, [arenaCancel, arenaLeaveQueue, goPhase]);

  // Match channel is a "refresh now" trigger only. The authoritative scorecard
  // always comes from arena_state / the heartbeat, never from an
  // opponent-supplied payload.
  const { sendState: sendMatch } = useMatchRealtime({
    topic: blitzMatch ? `match:${blitzMatch.matchId}` : null,
    enabled: !!blitzMatch && !!meId && (phase === 'blitz-countdown' || phase === 'blitz-play'),
    sessionId: meId,
    track: { inMatch: true },
    onEvent: (type) => {
      if (type === 'answer' && phaseRef.current === 'blitz-play') pollArena();
    },
    onReconcile: () => {},
  });

  const pollArena = useCallback(async () => {
    const mid = matchIdRef.current;
    if (!mid) return null;
    const st = await arenaState(mid);
    if (!st?.ok) return null;
    applyArenaState(st);
    return st;
  }, [arenaState, applyArenaState]);

  // Waiting loop. Two distinct waits share this phase:
  //   * in the matchmaking queue  -> keep re-enqueueing until paired
  //   * already matched, opponent hasn't confirmed -> poll until both ready
  useEffect(() => {
    if (phase !== 'blitz-waiting' || !meId) return;
    let stopped = false;

    const pump = async () => {
      if (stopped) return;

      if (matchIdRef.current) {
        const st = await pollArena();
        if (!st || stopped) return;
        if (st.status === 'ready') { goPhase('blitz-countdown', 'opponent-ready'); setCountdown(3); }
        else if (st.status === 'completed' || st.status === 'abandoned') {
          settleDoneRef.current = true;
          const res = await arenaSettle(st.matchId);
          finishArena(res);
        }
        return;
      }

      const res = await arenaEnqueue({ stake: ARENA_STAKE });
      if (stopped) return;
      if (res?.matchId) { await adoptArena(res); return; }
      if (res?.error === 'ALREADY_IN_MATCH' && res.matchId) { await resumeArena(res.matchId); return; }
      // A refused enqueue must NOT be retried forever: report it and get the
      // player (and their stake) back to a real screen.
      if (res && res.ok === false) { arenaFailure('enqueue', res, 'scholars'); return; }
      // Still queued - keep the slot warm.
      const r = await arenaRoster({ stake: ARENA_STAKE });
      if (!stopped) setRoster(r);
    };

    pump();
    const iv = setInterval(pump, ARENA_POLL_MS);
    return () => { stopped = true; clearInterval(iv); };
  }, [phase, meId, pollArena, arenaEnqueue, arenaRoster, adoptArena, resumeArena, arenaSettle, goPhase, arenaFailure]);

  // Nobody-pairing watchdog. A queued player whose stake is escrowed must not
  // sit on "Waiting for an opponent..." indefinitely: after the window we leave
  // the queue (which refunds), say so plainly, and send them back to the list.
  // The server has its own never-readied sweep; this is the client-side half so
  // the player is told immediately rather than discovering it on the next poll.
  useEffect(() => {
    if (phase !== 'blitz-waiting') return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      // A matched opponent who is merely slow is not a failure - only give up
      // while we are still just a queue slot.
      if (matchIdRef.current) return;
      if (Date.now() - startedAt < MATCHMAKING_TIMEOUT_MS) return;
      arenaLeaveQueue().then(() => {
        arenaFailure('matchmaking-timeout', { error: 'NO_OPPONENT_FOUND' }, 'scholars');
      });
    }, 2000);
    return () => clearInterval(t);
  }, [phase, arenaLeaveQueue, arenaFailure]);

  // Scholars search box -> debounced query actually sent to the server.
  // A query shorter than SCHOLAR_SEARCH_MIN is dropped (the server would
  // ignore it anyway, so this keeps the UI honest about what is filtered).
  useEffect(() => {
    const trimmed = scholarQuery.trim();
    if (trimmed.length < SCHOLAR_SEARCH_MIN) {
      setActiveQuery('');
      return;
    }
    const t = setTimeout(() => setActiveQuery(trimmed), SCHOLARS_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [scholarQuery]);

  // Leaving the scholars page clears the box, so returning starts unfiltered.
  useEffect(() => {
    if (phase !== 'scholars' && (scholarQuery || activeQuery)) {
      setScholarQuery('');
      setActiveQuery('');
    }
  }, [phase, scholarQuery, activeQuery]);

  // Scholars list poll. The server stamps presence on every call, so browsing
  // this page is itself what makes you show up as Available. It re-runs
  // whenever the debounced query changes, so results appear without waiting
  // for the next 4s tick.
  //
  // It deliberately does NOT poll invites. It used to, on its own faster tick,
  // and that was pure duplicated load: ChallengeContext already runs
  // arena_invites_list app-wide every 2.5s from a provider that sits ABOVE the
  // Arena, so the poll here could never see anything the popup had not already
  // seen, and two ticks writing the same state is how the "your challenge was
  // accepted" message and this list used to disagree.
  useEffect(() => {
    if (phase !== 'scholars') return;
    let stopped = false;
    const load = async () => {
      setRosterLoading(true);
      const r = await arenaRoster({ stake: ARENA_STAKE, query: activeQuery });
      if (!stopped) { setRoster(r); setRosterLoading(false); }
    };
    load();
    // While searching, poll less aggressively: the list is filtered and a
    // single target rarely changes status, and presence is still stamped on
    // the first call.
    const period = activeQuery ? SCHOLARS_POLL_MS * 3 : SCHOLARS_POLL_MS;
    const iv = setInterval(load, period);
    return () => { stopped = true; clearInterval(iv); };
  }, [phase, arenaRoster, activeQuery]);

  // Countdown -> open the shared clock (requires BOTH players ready server-side).
  useEffect(() => {
    if (phase !== 'blitz-countdown') return;
    if (countdown <= 0) { startTheArena(); return; }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  const startTheArena = useCallback(async () => {
    const mid = matchIdRef.current;
    if (!mid) return;
    let res = await arenaStart(mid);
    if (!res?.ok) {
      // The opponent may already have opened it - take the server's clock.
      const st = await arenaState(mid);
      if (st?.startsAt && st?.endsAt) res = { ok: true, startsAt: st.startsAt, endsAt: st.endsAt };
    }
    if (!res?.startsAt || !res?.endsAt) { goPhase('blitz-waiting', 'start-deferred'); return; }
    setBlitzMatch((m) => ({ ...(m || {}), startsAt: res.startsAt, endsAt: res.endsAt }));
    setBlitzTimeLeft(Math.max(0, Date.parse(res.endsAt) - Date.now()));
    goPhase('blitz-play', 'clock-open');
  }, [arenaStart, arenaState, goPhase]);

  // 90s shared wall-clock + heartbeat.
  //
  // The heartbeat is what keeps the reconnect-grace timer alive on the server
  // AND re-syncs the authoritative scorecard and the balance. Without it a
  // player on a slow connection would be forfeited while still playing.
  useEffect(() => {
    if (phase !== 'blitz-play' || !blitzMatch?.endsAt) return;
    const ends = Date.parse(blitzMatch.endsAt);
    const tick = () => {
      const remain = Math.max(0, ends - Date.now());
      setBlitzTimeLeft(remain);
      if (remain <= 0) settleArena();
    };
    tick();
    const iv = setInterval(tick, 250);
    const hb = setInterval(async () => {
      const mid = matchIdRef.current;
      if (!mid) return;
      const beat = await arenaHeartbeat(mid);
      if (!beat?.ok) return;
      if (beat.status === 'completed' || beat.status === 'abandoned') { settleArena(mid); return; }
      setMyCard(cardFrom(beat.myScore));
      setOppCard(cardFrom(beat.opponentScore));
      setOppDown(!!beat.opponentDisconnected);
      if (beat.graceSeconds != null) setGraceSeconds(Number(beat.graceSeconds) || 15);
    }, ARENA_HEARTBEAT_MS);
    return () => { clearInterval(iv); clearInterval(hb); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, blitzMatch]);

  // Opponent connection state is tracked for the UI only. (Gameplay sound was
  // removed: the arena is a timed 90-second duel and the cues bled across
  // questions.)
  useEffect(() => {
    if (oppDown) arenaTrace('opponent-disconnected');
  }, [oppDown]);

  const finishArena = useCallback(async (res) => {
    if (!res?.ok) return;
    setBlitzResult(res);
    try { sessionStorage.removeItem(ACTIVE_ARENA_KEY); } catch { /* ignore */ }
    const mid = matchIdRef.current;
    if (mid) {
      const st = await arenaState(mid);
      if (st?.ok) { setArenaReview(Array.isArray(st.review) ? st.review : null); applyArenaState(st); }
    }
    // The wallet is the whole point of a duel: make sure the pill is right even
    // if this tab missed the settlement payload.
    refreshSmartCoins();
    // A verified win is a learning signal: re-run the SERVER achievement
    // evaluation (only evaluate_achievements can unlock) and surface it.
    if (res.youWon && !res.draw) {
      try {
        const payloads = await syncAchievements();
        setAchievements(Array.isArray(payloads) ? payloads : []);
      } catch { /* non-fatal */ }
    }
    goPhase('blitz-result', 'settled');
    fetchHistory();
    try { sendMatch({ type: 'end', id: meId }); } catch { /* ignore */ }
  }, [arenaState, applyArenaState, fetchHistory, refreshSmartCoins, syncAchievements, sendMatch, meId, goPhase]);

  const settleArena = useCallback(async (midArg) => {
    const mid = midArg || matchIdRef.current;
    if (!mid || settleDoneRef.current) return;
    settleDoneRef.current = true;
    const res = await arenaSettle(mid);
    if (res?.ok) { await finishArena(res); return; }
    if (res?.error === 'BLITZ_NOT_ENDED' && res.remainingMs != null) {
      setBlitzTimeLeft(Number(res.remainingMs) || 0);
      settleDoneRef.current = false;
      return;
    }
    settleDoneRef.current = false;
  }, [arenaSettle, finishArena]);

  // Voluntary forfeit: immediate, no grace. The leaver loses the stake and the
  // other player is refunded - both decided server-side.
  const forfeitArena = useCallback(async () => {
    const mid = matchIdRef.current;
    setForfeitOpen(false);
    if (!mid) return;
    const res = await arenaForfeit(mid);
    if (res?.ok) { settleDoneRef.current = true; await finishArena(res); }
  }, [arenaForfeit, finishArena]);

  // Reconnect resume: rejoin the SAME battle from the server, never reset.
  useEffect(() => {
    let live = true;
    const resume = async () => {
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(ACTIVE_ARENA_KEY) || 'null'); } catch { /* ignore */ }
      if (!saved?.matchId || !meId) return;
      if (phaseRef.current === 'blitz-play' || phaseRef.current === 'blitz-result') return;
      try {
        const st = await arenaState(saved.matchId);
        if (!live || !st?.ok) return;
        matchIdRef.current = saved.matchId;
        const questions = st.questions || [];
        setBlitzMatch({
          matchId: st.matchId, questions,
          questionCount: numOr(st.questionCount, questions.length),
          startsAt: st.startsAt || null, endsAt: st.endsAt || null,
          stake: numOr(st.stake, saved.stake ?? ARENA_STAKE),
          practice: !!st.practice,
          escrowed: st.escrowed ?? 0,
        });
        setBlitzQuestions(questions);
        setOpponent(st.opponentName || 'Rival Scholar');
        applyArenaState(st);

        const mine = Array.isArray(st.myAnswers) ? st.myAnswers : [];
        const done = new Set(mine.map((a) => a.index));
        let next = 0;
        while (done.has(next)) next += 1;
        setBlitzIndex(next);
        setBlitzAnswers(mine.map((a) => ({
          index: a.index, correct: a.skipped ? null : !!a.isCorrect,
          multiplier: a.multiplier, delta: a.points ?? 0, skipped: !!a.skipped,
        })));
        setDoubleUsed(mine.some((a) => a.multiplier === 2));
        setArenaReview(Array.isArray(st.review) ? st.review : null);

        if (st.status === 'active' && st.endsAt) {
          const remain = Math.max(0, Date.parse(st.endsAt) - Date.now());
          setBlitzTimeLeft(remain);
          // A clock that already ran out must settle immediately, not sit on a
          // frozen 0:00 the player cannot answer.
          if (remain <= 0) { settleArena(st.matchId); return; }
          goPhase('blitz-play', 'reconnect-active');
        } else if (st.status === 'ready') {
          goPhase('blitz-countdown', 'reconnect-ready'); setCountdown(3);
        } else if (st.status === 'completed' || st.status === 'abandoned') {
          settleDoneRef.current = true;
          const res = await arenaSettle(st.matchId);
          if (live) await finishArena(res);
        } else {
          goPhase('blitz-waiting', 'reconnect-waiting');
        }
      } catch { /* ignore */ }
    };
    resume();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId]);

  const blitzPick = useCallback(async (option) => {
    if (!blitzMatch || userAnswerState !== null) return;
    if (blitzTimeLeft <= 0) return;
    const mid = blitzMatch.matchId;
    const idx = blitzIndex;
    const isSkip = option === null || option === undefined;
    const armed = doubleArmed;

    // The Double is consumed the MOMENT it is spent, so it can never leak into
    // the next question. It is restored only if the submit itself failed and
    // the question is still open.
    setDoubleArmed(false);
    setUserAnswerState(isSkip ? 'timeout' : 'answered');
    lastOptionRef.current = isSkip ? null : option;
    setTxState('pending');

    let res = null;
    try {
      res = await arenaAnswer({
        matchId: mid, questionIndex: idx,
        selected: isSkip ? null : option, double: armed, skipped: isSkip,
      });
    } catch (err) {
      console.warn('Arena answer failed:', err?.message);
    }

    if (!res?.ok) {
      setUserAnswerState(null);
      setTxState(null);
      if (armed) setDoubleArmed(true);
      return;
    }

    if (res.multiplier === 2) setDoubleUsed(true);

    setMyCard(cardFrom(res.myScore));
    setBlitzAnswers((prev) => [...prev, {
      index: idx, correct: isSkip ? null : !!res.isCorrect,
      multiplier: res.multiplier, delta: res.points ?? 0, skipped: isSkip,
    }]);
    if (res.botTurn) arenaTrace('bot-turn');

    setTxState('done');
    setTimeout(() => {
      setUserAnswerState(null);
      setTxState(null);
      setBlitzIndex((i) => i + 1);
      // Clear any armed Double again in case the timer raced the click.
      setDoubleArmed(false);
    }, res.replay ? 150 : 450);
  }, [blitzMatch, blitzIndex, blitzTimeLeft, userAnswerState, doubleArmed, arenaAnswer]);

  // ---- Flow State: ring lifetime + exactly-once auto-skip ------------------
  // The deadline is wall-clock and starts when a question is first shown (or
  // the moment Flow is switched on). The ring is per-player: the opponent's
  // answers, pace and toggles are never read here.
  useEffect(() => {
    if (phase !== 'blitz-play') return;
    const key = `${flowActive ? 'on' : 'off'}:${blitzIndex}`;
    if (paceKeyRef.current === key) return;
    paceKeyRef.current = key;
    paceShownIndexRef.current = blitzIndex;
    paceShownAtRef.current = Date.now();
    setPaceTick((n) => n + 1);
  }, [phase, flowActive, blitzIndex]);

  // Re-render the ring while it is running. The interval does NOT decide the
  // skip; it only redraws, so a throttled background tab cannot add time.
  useEffect(() => {
    if (phase !== 'blitz-play' || !flowActive) return undefined;
    const id = setInterval(() => setPaceTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [phase, flowActive]);

  useEffect(() => {
    if (phase !== 'blitz-play' || !flowActive) return undefined;
    if (userAnswerState !== null || txState === 'pending') return undefined;
    if (paceShownIndexRef.current !== blitzIndex) return undefined;
    // One auto-skip per question. If the submit fails the guard stays armed, so
    // a dead connection cannot produce a skip loop; the player can still tap.
    if (paceSkipForRef.current === blitzIndex) return undefined;
    const left = flowPace * 1000 - (Date.now() - paceShownAtRef.current);
    if (left > 0) return undefined;
    paceSkipForRef.current = blitzIndex;
    arenaTrace('flow-auto-skip', { index: blitzIndex, pace: flowPace });
    blitzPick(null);
    return undefined;
  }, [phase, flowActive, flowPace, blitzIndex, userAnswerState, txState, paceTick, blitzPick]);

  const toggleFlow = useCallback(async () => {
    const mid = matchIdRef.current || blitzMatch?.matchId;
    if (!mid || flowBusy) return;
    const next = !flowActive;
    setFlowBusy(true);
    flowBusyRef.current = true;
    setFlowActive(next);
    // Turning Flow ON applies the pace chosen on the picker. Turning it off
    // sends a null pace, which leaves the stored pace untouched server-side.
    if (next) setFlowPace(preferredPace);
    paceShownIndexRef.current = blitzIndex;
    paceShownAtRef.current = Date.now();
    setPaceTick((n) => n + 1);
    try {
      const res = await arenaFlow(mid, next, next ? preferredPace : null, flowRequestId());
      if (!res?.ok) {
        setFlowActive(!next);
        arenaTrace('flow-toggle-failed', { error: res?.error });
      } else if (next && res.pace != null) {
        setFlowPace(numOr(res.pace, preferredPace));
      }
    } catch {
      setFlowActive(!next);
    } finally {
      flowBusyRef.current = false;
      setFlowBusy(false);
    }
  }, [arenaFlow, blitzMatch, blitzIndex, flowActive, flowBusy, preferredPace]);

  // The pace is chosen on the PICKER, before the match, and stored as a
  // preference. There is deliberately no in-match pace control: the ring's
  // speed is decided once, so a live round has no chip to tap that could
  // distract from the question (and no second way to change a server setting
  // once the clock is already running).
  const openPaceSheet = useCallback(() => {
    setTempPace(preferredPace);
    setShowPaceSheet(true);
  }, [preferredPace]);

  const savePace = useCallback(() => {
    if (flowBusy) return;
    setPreferredPace(tempPace);
    setShowPaceSheet(false);
  }, [flowBusy, tempPace]);

  const paceRemainingMs = useMemo(() => {
    if (!flowActive || phase !== 'blitz-play') return flowPace * 1000;
    if (paceShownIndexRef.current !== blitzIndex) return flowPace * 1000;
    return Math.max(0, flowPace * 1000 - (Date.now() - paceShownAtRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowActive, flowPace, phase, blitzIndex, paceTick]);

  // ---- resets -------------------------------------------------------------
  const clearMatch = useCallback(() => {
    matchIdRef.current = null;
    settleDoneRef.current = false;
    setBlitzMatch(null);
    setBlitzQuestions([]);
    setBlitzIndex(0);
    setBlitzResult(null);
    setAchievements([]);
    setArenaReview(null);
    setMyCard(EMPTY_CARD);
    setOppCard(EMPTY_CARD);
    setBlitzAnswers([]);
    setDoubleArmed(false);
    setDoubleUsed(false);
    setOppDown(false);
    setForfeitOpen(false);
    setUserAnswerState(null);
    setTxState(null);
    setBlitzTimeLeft(BLITZ_DURATION_MS);
    setFlowActive(false);
    setFlowPace(FLOW_DEFAULT_PACE);
    setFlowBusy(false);
    flowBusyRef.current = false;
    paceShownAtRef.current = 0;
    paceShownIndexRef.current = -1;
    paceSkipForRef.current = -1;
    paceKeyRef.current = '';
    lastOptionRef.current = null;
    try { sessionStorage.removeItem(ACTIVE_ARENA_KEY); } catch { /* ignore */ }
  }, []);

  const resetToHub = useCallback((trigger = 'reset-hub') => {
    clearMatch();
    setFinding(null);
    setOpponent('Rival Scholar');
    goPhase('hub', trigger);
    fetchHistory();
  }, [clearMatch, goPhase, fetchHistory]);

  const resetToPicker = useCallback((trigger = 'reset-picker') => {
    clearMatch();
    setFinding(null);
    goPhase('picker', trigger);
  }, [clearMatch, goPhase]);

  // ---- derived ------------------------------------------------------------
  const boardSize = Number(blitzMatch?.questionCount) || 0;

  // "All questions answered" must never fire on a board that has not loaded.
  // The old check compared the LOCAL INDEX against the total, so a board whose
  // total was 0 was already "finished" at index 0 - the "All questions answered"
  // panel at 0 seen / 0 right. The guard is the total being greater than zero
  // AND the SERVER-REPORTED graded count reaching it.
  const allAnswered = boardSize > 0 && myCard.answers >= boardSize;
  const boardMissing = boardSize > 0 && blitzQuestions.length === 0;

  const fmtBlitzTime = (ms) => {
    const s = Math.ceil((ms || 0) / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  };

  const streak = useMemo(() => streakOf(blitzAnswers), [blitzAnswers, streakOf]);
  const reviewList = useMemo(() => (Array.isArray(arenaReview) ? arenaReview : []), [arenaReview]);

  // The result screen's scorecard comes from the SERVER's breakdown - one shape
  // for a human opponent and for a tutor, so it renders identically.
  const resultForMe = useMemo(() => {
    if (!blitzResult) return null;
    const bd = Array.isArray(blitzResult.breakdown) ? blitzResult.breakdown : [];
    const me = bd.find((p) => p.playerId && p.playerId === meId);
    const opp = bd.find((p) => !p.playerId || p.playerId !== meId);
    return {
      status: blitzResult.status,
      reason: blitzResult.reason || null,
      youWon: !!blitzResult.youWon && !blitzResult.draw,
      draw: !!blitzResult.draw,
      winner: opp?.name || 'Your opponent',
      oppIsBot: !!opp?.isBot,
      you: cardFrom(me),
      opp: cardFrom(opp),
      delta: Number(blitzResult.myDelta ?? blitzResult.delta) || 0,
      stake: Number(blitzResult.stake ?? blitzMatch?.stake ?? 0),
    };
  }, [blitzResult, meId, blitzMatch]);

  // Fallback when the server review has not arrived (e.g. a very fast settle):
  // the local mirror still shows which questions were missed.
  const missedList = useMemo(() => {
    const fromServer = reviewList.filter((r) => !r.skipped && r.isCorrect === false);
    if (fromServer.length) return fromServer;
    return blitzAnswers
      .filter((a) => a.correct === false && a.index != null)
      .map((a) => ({
        index: a.index,
        question: blitzQuestions[a.index]?.question ?? '…',
        multiplier: a.multiplier,
      }));
  }, [reviewList, blitzAnswers, blitzQuestions]);

  const canAffordStake = smartCoins >= ARENA_STAKE;

  // =======================================================================
  // RENDER
  // =======================================================================
  return (
    <div className="min-h-screen bg-slate-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/10 blur-[150px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-amber-500/8 blur-[120px] rounded-full" />
      </div>

      <div className="relative z-10 max-w-2xl mx-auto px-4 pt-10 pb-32">
        {/* The ?challenge= handoff. Shown on the two screens a player can be
            sitting on right after the hub sends them here. When they accept,
            handoffTarget goes null by itself because the invite stops being
            pending - no extra state to keep in sync. */}
        {handoffTarget && (phase === 'hub' || phase === 'scholars') && (
          <div
            role="status"
            className="mb-5 flex items-start gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3"
          >
            <Swords size={16} className="shrink-0 mt-0.5 text-emerald-300" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black text-white">
                Challenge sent to {handoffTarget.name}
              </p>
              <p className="text-[11px] font-bold text-emerald-200/80 leading-snug">
                Nothing is held until they accept. You can leave this page — the
                challenge waits for them{typeof handoffTarget.stake === 'number'
                  ? `, and the ${handoffTarget.stake} SC is only taken when the duel starts`
                  : ''}.
              </p>
            </div>
            <button
              onClick={dismissHandoff}
              aria-label="Dismiss challenge confirmation"
              className="shrink-0 text-[10px] font-black uppercase tracking-widest text-emerald-300/80 hover:text-white transition"
            >
              Dismiss
            </button>
          </div>
        )}

        {phase === 'hub' && (
          <div className="mb-6">
            <TutorialTip tutorialKey="arena">
              Never played? The 1v1 tour covers the 90-second clock, how scoring works, and what your Smart Coins are doing.
            </TutorialTip>
          </div>
        )}
        <div className="flex items-center justify-between mb-10">
          {showBack ? (
            <button onClick={handleBack} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors font-bold text-sm px-4 py-2 bg-white/5 rounded-2xl active:scale-95">
              <ChevronLeft size={18} /> {backStep ? backStep.label : 'Back'}
            </button>
          ) : (
            // Deliberate placeholder: while a stake is escrowed (waiting,
            // countdown, or the live round) Back is hidden so the only way out
            // is Cancel/Forfeit, which settles the pot.
            <span className="w-[84px]" aria-hidden="true" />
          )}
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
            <Star size={16} className="text-amber-400" fill="currentColor" />
            <span className="text-amber-400 font-black text-sm tabular-nums">{smartCoins.toLocaleString()} SC</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {/* ============================================================
              PAGE 1 - the War Hall hub
              ============================================================ */}
          {phase === 'hub' && (
            <motion.div key="hub" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="text-center mb-10">
                <div className="flex items-center justify-center gap-3 mb-4">
                  <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-2xl shadow-purple-500/40 animate-pulse">
                    <Brain size={64} className="text-white w-16 h-16 sm:w-20 sm:h-20 drop-shadow-[0_0_26px_rgba(216,180,254,1)]" />
                  </div>
                </div>
                <h1 className="text-4xl font-black tracking-tight uppercase">SC War Hall</h1>
                <p className="text-slate-400 font-medium mt-2 text-sm">One arena. One clock. Winner takes the pot.</p>
              </div>

              {/* The one highlighted action. */}
              <button onClick={() => goPhase('picker', 'hub-1v1')}
                className="relative w-full text-left p-7 rounded-[2rem] bg-gradient-to-br from-indigo-600 to-purple-700 border border-indigo-500/30 shadow-2xl shadow-indigo-500/40 active:scale-[0.98] transition-all overflow-hidden group"
                style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)' }}
              >
                <div className="absolute inset-0 bg-gradient-to-br from-indigo-600 to-purple-700 opacity-20" />
                <div className="relative flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-3xl">⚔️</span>
                      <span className="text-xl font-black tracking-tight">1v1</span>
                    </div>
                    <p className="text-white/60 font-medium text-sm">Challenge a scholar or practise a tutor</p>
                    <div className="flex items-center gap-2 mt-4">
                      <Users size={14} className="text-white/40" />
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/40">{ARENA_STAKE} SC per match</span>
                    </div>
                  </div>
                  <ArrowRight size={24} className="text-white/30 group-hover:text-white/80 transition-colors shrink-0 ml-4" />
                </div>
              </button>

              {/* Tournament: not built yet, and NOT tappable. */}
              <div aria-disabled="true"
                className="relative w-full text-left p-7 rounded-[2rem] bg-white/[0.02] border-2 border-dashed border-white/10 opacity-60 select-none cursor-not-allowed"
              >
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-3xl">🔱</span>
                    <span className="text-xl font-black tracking-tight">Tournament</span>
                    <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-amber-300">Coming soon</span>
                  </div>
                  <p className="text-white/40 font-medium text-sm">Three-way and bracket formats are on the way.</p>
                </div>
              </div>

              {/* Last 5 duels. Colour follows the OUTCOME. */}
              <div className="p-6 rounded-[2rem] bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy size={16} className="text-amber-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400">Last 5</span>
                </div>
                {duelHistory.length === 0 ? (
                  <p className="text-slate-400 text-sm font-medium text-center py-4">No duels yet. Enter the arena above.</p>
                ) : (
                  <div className="space-y-2">
                    {duelHistory.map((d) => {
                      const meta = outcomeMeta(d.outcome);
                      const Icon = meta.icon;
                      const delta = Number(d.delta) || 0;
                      return (
                        <div key={d.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                          <div className="flex items-center gap-2 min-w-0">
                            <Icon size={14} className={`${meta.tone} shrink-0`} />
                            <span className="text-sm font-bold truncate">vs {d.opponent}</span>
                            <span className="text-[10px] text-white/40 uppercase">{d.mode === 'triple' ? 'Triple' : '1v1'}</span>
                          </div>
                          <span className={`font-black text-sm tabular-nums ${meta.tone}`}>
                            {delta > 0 ? `+${delta} SC` : delta < 0 ? `${delta} SC` : '0 SC'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ============================================================
              PAGE 2 - the 1v1 Arena picker
              ============================================================ */}
          {phase === 'picker' && (
            <motion.div key="picker" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-700 flex items-center justify-center shadow-xl shadow-purple-500/30">
                    <Zap size={24} />
                  </div>
                </div>
                <h1 className="text-3xl font-black tracking-tight uppercase">1v1 Arena</h1>
                <p className="text-slate-400 font-medium mt-2 text-sm">40 NMCN questions · one shared 90-second clock</p>
              </div>

              {/* Flow pace is chosen HERE, before the match. It is a per-player
                  aid: it only auto-skips YOUR unanswered question, never touches
                  the shared clock, and is never imposed on the opponent. */}
              <div className="flex justify-center">
                <button
                  onClick={openPaceSheet}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-500/15 border border-indigo-400/40 text-indigo-200 font-black uppercase tracking-widest text-[10px] shadow-lg shadow-indigo-500/10 active:scale-95 transition-all"
                  aria-label="Change Flow State pace"
                >
                  <Zap size={12} fill="currentColor" />
                  <span>FLOW STATE · {preferredPace} s</span>
                </button>
              </div>

              {!canAffordStake ? (
                <div className="rounded-[2rem] p-6 bg-amber-500/10 border border-amber-500/30 text-center space-y-4">
                  <div className="text-4xl">🪙</div>
                  <div>
                    <h3 className="font-black text-amber-300 text-lg">Not enough Smart Coins</h3>
                    <p className="text-sm text-white/60 font-medium mt-1">
                      A 1v1 match costs {ARENA_STAKE} SC and you have {smartCoins} SC. You can still practise a tutor for free.
                    </p>
                  </div>
                  <button onClick={() => goPhase('hub', 'picker-earn')} className="w-full py-4 rounded-2xl bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all">Back to the War Hall</button>
                </div>
              ) : (
                <>
                  <button onClick={enterArena} disabled={!canAffordStake}
                    className="w-full py-7 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-[0.25em] text-sm shadow-2xl shadow-indigo-500/30 active:scale-[0.98] transition-all disabled:opacity-30 disabled:pointer-events-none flex flex-col items-center gap-2"
                  >
                    <span className="flex items-center gap-3"><Zap size={18} fill="currentColor" /> Enter Arena</span>
                    <span className="text-[10px] tracking-[0.2em] text-white/60 font-bold">{ARENA_STAKE} SC stake · real scholars</span>
                  </button>

                  <button onClick={() => goPhase('bots', 'picker-practice')}
                    className="w-full py-5 rounded-[2rem] bg-white/5 border border-white/10 font-black uppercase tracking-[0.2em] text-xs text-white/70 hover:bg-white/10 active:scale-[0.98] transition-all flex items-center justify-center gap-3"
                  >
                    <Shield size={16} /> Practise vs a Bot
                  </button>

                  <p className="text-center text-[11px] text-amber-400/80 font-bold leading-relaxed pt-2">
                    Real Smart Coins. {ARENA_STAKE} SC is only held when a match actually starts — decline, cancel or walk away and it comes straight back.
                  </p>
                </>
              )}
            </motion.div>
          )}

          {/* Tutor picker. */}
          {phase === 'bots' && (
            <motion.div key="bots" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-5">
              <button onClick={() => goPhase('picker', 'bots-back')} className="text-slate-400 hover:text-white text-sm font-bold flex items-center gap-1 transition-colors">
                <ChevronLeft size={16} /> Arena
              </button>
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tight">Practise vs a bot</h2>
                <p className="text-slate-400 font-medium mt-1 text-sm">Same 40-question board, same clock, same scoring and Double. No coins.</p>
              </div>
              <div className="space-y-3">
                {BOT_OPPONENTS.map((b) => (
                  <button key={b.key} onClick={() => startVsBot(b.key, b.name)}
                    className={`w-full text-left p-4 rounded-2xl bg-gradient-to-br ${b.accent} border border-white/10 shadow-lg active:scale-[0.98] transition-all`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-2xl">{b.icon}</span>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-black truncate">{b.name}</span>
                            <span className="rounded-full bg-black/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-white/70">{b.tier}</span>
                          </div>
                          <p className="text-white/60 text-xs font-medium truncate">{b.blurb}</p>
                        </div>
                      </div>
                      <ArrowRight size={18} className="text-white/50 shrink-0" />
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* ============================================================
              PAGE 3 - online scholars
              ============================================================ */}
          {phase === 'scholars' && (
            <motion.div key="scholars" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-5">
              <button onClick={() => goPhase('picker', 'scholars-back')} className="text-slate-400 hover:text-white text-sm font-bold flex items-center gap-1 transition-colors">
                <ChevronLeft size={16} /> Arena
              </button>

              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-black uppercase tracking-tight">Online scholars</h2>
                  <p className="text-slate-400 font-medium mt-1 text-sm">
                    <span className="text-emerald-300 font-black tabular-nums">{roster.online}</span> online
                  </p>
                </div>
                <span className="rounded-full bg-amber-500/10 border border-amber-500/25 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-amber-300 whitespace-nowrap">
                  {ARENA_STAKE} SC per match
                </span>
              </div>

              {/* Scholars search. Matches the name a user chose, their real
                  name, or the Scholar-xxxxxx handle. Never email. */}
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                <input
                  type="search"
                  value={scholarQuery}
                  onChange={(e) => setScholarQuery(e.target.value)}
                  placeholder="Find a scholar by name…"
                  aria-label="Find a scholar by name"
                  className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-10 pr-10 text-sm font-bold text-white placeholder:text-white/25 focus:outline-none focus:border-purple-400/60 focus:bg-white/[0.07] transition"
                />
                {scholarQuery && (
                  <button
                    onClick={() => setScholarQuery('')}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {activeQuery && (
                <p className="text-[10px] font-black uppercase tracking-widest text-purple-300/80 -mt-2">
                  {rosterLoading
                    ? 'Searching…'
                    : `${roster.players.length} ${roster.players.length === 1 ? 'match' : 'matches'} for "${activeQuery}"`}
                </p>
              )}
              {scholarQuery.trim() && scholarQuery.trim().length < SCHOLAR_SEARCH_MIN && (
                <p className="text-[10px] font-bold text-white/30 -mt-2">
                  Type at least {SCHOLAR_SEARCH_MIN} characters to search.
                </p>
              )}

              <div className="space-y-2">
                {roster.players.length === 0 ? (
                  <p className="text-slate-500 text-sm font-medium text-center py-6">
                    {rosterLoading
                      ? 'Looking for scholars…'
                      : activeQuery
                        ? `No scholar matches "${activeQuery}". Try part of their name or their Scholar-xxxxxx handle.`
                        : 'No scholars signed in right now.'}
                  </p>
                ) : (
                  roster.players.map((p) => {
                    const st = SCHOLAR_STATUS[p.status] || SCHOLAR_STATUS.offline;
                    const dimmed = p.status === 'offline';
                    return (
                      <div key={p.userId} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${dimmed ? 'bg-white/[0.02] border-white/5 opacity-60' : 'bg-white/5 border-white/10'}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`relative w-9 h-9 rounded-lg flex items-center justify-center font-black text-xs shrink-0 ${dimmed ? 'bg-white/5 text-white/30' : 'bg-purple-500/20 text-purple-200'}`}>
                            {String(p.name || 'S')[0]}
                            <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-950 ${st.dot}`} />
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-sm block truncate">{p.name || 'Scholar'}</span>
                            <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">
                              {dimmed ? `last seen ${lastSeenLabel(p.lastSeenAt)}` : st.label}
                            </span>
                          </div>
                        </div>
                        <button
                          disabled={p.status !== 'available' || !p.canChallenge || inviteBusy === p.userId}
                          onClick={() => inviteScholar(p)}
                          title={`Challenge ${p.name || 'this scholar'} to a ${ARENA_STAKE} SC duel. Nothing is held until they accept.`}
                          className={`rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-all disabled:pointer-events-none ${st.buttonClass}`}
                        >
                          {p.status === 'available' && !p.canChallenge
                            ? 'Too Low'
                            : inviteBusy === p.userId ? 'Sending…' : 'Challenge'}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Pending invites (migration v78). Consent happens HERE, and the stakes are
                  only held server-side once the recipient accepts. */}
              {(invites.incoming.length > 0 || invites.outgoing.length > 0) && (
                <div className="space-y-2">
                  {invites.incoming.map((iv) => (
                    <div key={`in-${iv.inviteId}`} className="flex items-center justify-between gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3">
                      <div className="min-w-0">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-emerald-300">
                          Duel challenge
                        </span>
                        <span className="block truncate text-sm font-bold text-white">
                          {iv.name || 'A scholar'} challenges you to {iv.stake} SC
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => answerInvite(iv, false)}
                          disabled={inviteBusy === iv.inviteId}
                          className="rounded-full border border-white/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white/60 active:scale-95 transition-all disabled:opacity-40"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => answerInvite(iv, true)}
                          disabled={inviteBusy === iv.inviteId}
                          className="rounded-full bg-emerald-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 transition-all disabled:opacity-40"
                        >
                          {inviteBusy === iv.inviteId ? 'Starting…' : `Accept · ${iv.stake} SC`}
                        </button>
                      </div>
                    </div>
                  ))}
                  {invites.outgoing.map((iv) => (
                    <div key={`out-${iv.inviteId}`} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                      <div className="min-w-0">
                        <span className="block text-[10px] font-black uppercase tracking-widest text-white/40">
                          Waiting for a reply
                        </span>
                        <span className="block truncate text-sm font-bold text-white/80">
                          Challenged {iv.name || 'a scholar'} to {iv.stake} SC — nothing held yet
                        </span>
                      </div>
                      <button
                        onClick={() => cancelInvite(iv)}
                        disabled={inviteBusy === iv.inviteId}
                        className="rounded-full border border-white/15 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white/60 active:scale-95 transition-all disabled:opacity-40 shrink-0"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Quick Match is gone: it dropped the player into an open queue
                  where a refusal or an empty roster left them waiting forever
                  with coins escrowed. Challenges are explicit, and tutor
                  practice is the guaranteed fallback. */}
              {phaseError && (
                <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-[11px] font-bold text-amber-200">
                  {ARENA_ERROR_COPY[phaseError] || 'That did not go through.'}
                  {phaseError !== 'NO_OPPONENT_FOUND' && (
                    <button
                      onClick={() => setPhaseError(null)}
                      className="ml-2 underline underline-offset-2 hover:text-white"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              )}

              <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
                <button onClick={() => goPhase('bots', 'scholars-bot')}
                  className="px-4 py-2.5 rounded-full border border-white/10 bg-white/5 text-[10px] font-black uppercase tracking-widest text-white/50 active:scale-95 transition-all">
                  Nobody around? Practise vs a bot
                </button>
              </div>
            </motion.div>
          )}

          {/* ---- searching for an opponent ------------------------------- */}
          {phase === 'blitz-waiting' && (
            <motion.div key="blitz-waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center min-h-[45vh] gap-5 text-center">
              <div className="flex items-center gap-2 text-amber-400">
                <Zap size={16} fill="currentColor" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em]">Blitz Duel · 40 NMCN · 90s</span>
              </div>
              <div className="flex items-center gap-3 text-white/70">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                <span className="text-sm font-bold animate-pulse">Finding your opponent…</span>
              </div>
              <motion.div key={opponent} initial={{ scale: 1.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.3 }}
                className="text-2xl font-black flex items-center gap-2"
              >
                {finding === 'bot' ? <Shield size={20} className="text-indigo-300" /> : <User size={20} className="text-indigo-300" />}
                vs {opponent}
              </motion.div>
              <p className="text-slate-500 text-xs font-medium max-w-xs">
                {finding === 'bot'
                  ? 'Tutor match — no coins are wagered in a practice duel.'
                  : `Both scholars get the same 40 NMCN questions and one shared 90-second clock. ${ARENA_STAKE} SC is held per side and refunded in full if you cancel.`}
              </p>
              <button onClick={cancelArena}
                className="mt-2 px-8 py-4 rounded-2xl bg-white/10 hover:bg-white/15 font-black uppercase tracking-widest text-xs flex items-center gap-2 active:scale-95 transition-all"
              >
                Cancel{matchIdRef.current ? ' & refund both' : ''}
              </button>
            </motion.div>
          )}

          {/* ---- countdown ---------------------------------------------- */}
          {phase === 'blitz-countdown' && (
            <motion.div key="blitz-countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center min-h-[45vh] gap-6 text-center">
              <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-sm">Blitz begins in</p>
              <motion.div key={countdown} initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}
                className="text-[120px] font-black text-white leading-none" style={{ textShadow: '0 0 60px rgba(139,92,246,0.8)' }}
              >{countdown}</motion.div>
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm">
                {finding === 'bot' ? <Shield size={16} /> : <User size={16} />} vs {opponent}
              </div>
              <p className="text-slate-500 text-sm font-medium">Both clocks start when the countdown hits zero.</p>
            </motion.div>
          )}

          {/* ---- the duel ------------------------------------------------ */}
          {phase === 'blitz-play' && blitzMatch && (
            <motion.div key="blitz-play" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex justify-between items-center bg-white/5 border border-white/10 p-4 rounded-2xl">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <Zap className="text-amber-500 animate-pulse" size={18} fill="currentColor" />
                    <span className="text-xs font-black uppercase tracking-widest text-amber-500">BLITZ DUEL</span>
                  </div>
                  <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">
                    Q {Math.min(blitzIndex + 1, boardSize)}/{boardSize}
                    {blitzMatch.practice ? ' · practice · no coins' : ` · ${blitzMatch.stake} SC held in escrow`}
                  </span>
                </div>
                <div className={`font-black tabular-nums text-2xl ${blitzTimeLeft <= 10000 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                  {fmtBlitzTime(blitzTimeLeft)}
                </div>
              </div>

              {/* Flow State — YOUR rhythm. It never pauses or extends the shared
                  90s clock; it only auto-skips YOUR unanswered question (0 pts)
                  once the ring runs out. The pace was chosen on the picker and
                  is server-validated (3-12s); here it is shown, not edited. */}
              <div className={`rounded-2xl border p-3.5 transition-all ${flowActive ? 'bg-indigo-500/10 border-indigo-400/40' : 'bg-white/[0.03] border-white/10'}`}>
                <div className="flex items-center justify-between gap-3">
                  <button onClick={toggleFlow} disabled={flowBusy}
                    className="flex items-center gap-2 text-left active:scale-95 transition-all disabled:opacity-50">
                    <span className={`w-9 h-5 rounded-full p-0.5 transition-colors ${flowActive ? 'bg-indigo-500' : 'bg-white/15'}`}>
                      <span className={`block w-4 h-4 rounded-full bg-white transition-transform ${flowActive ? 'translate-x-4' : ''}`} />
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-white/70">Flow State</span>
                  </button>
                  <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-black tabular-nums text-white/50">
                    {flowActive ? `${flowPace}s pace` : `off · ${preferredPace}s set`}
                  </span>
                </div>
                {flowActive && (
                  <div className="mt-2.5">
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full bg-indigo-400 transition-[width] duration-100 ease-linear"
                        style={{ width: `${Math.max(0, Math.min(100, (paceRemainingMs / (flowPace * 1000)) * 100))}%` }} />
                    </div>
                    <p className="mt-1.5 text-[9px] font-bold uppercase tracking-widest text-white/30">
                      {userAnswerState
                        ? 'Answer sent — the ring resets on the next question'
                        : `Auto-skip in ${(paceRemainingMs / 1000).toFixed(1)}s`}
                    </p>
                  </div>
                )}
              </div>

              {oppDown && (
                <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                  <AlertCircle size={16} className="text-amber-400 shrink-0 animate-pulse" />
                  <p className="text-xs font-bold text-amber-200 leading-snug">
                    {opponent} lost connection. They have {graceSeconds}s to come back — if they don't, they forfeit and your stake is refunded.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <ScoreCard title="You" card={myCard} tone="you" sub={streak >= 2 ? `🔥 ${streak}` : null} />
                <ScoreCard title={blitzMatch.practice ? `${opponent} · tutor` : opponent} card={oppCard} tone="opp" sub={oppDown ? 'Disconnected' : null} />
              </div>

              {boardMissing ? (
                <div className="text-center p-8 rounded-[2rem] bg-white/5 border border-white/10 space-y-3">
                  <AlertCircle size={28} className="mx-auto text-amber-400" />
                  <p className="font-black">The question board did not load</p>
                  <p className="text-slate-400 text-sm font-medium">
                    The match is still live and your stake is safe. Refresh to rejoin it.
                  </p>
                  <button onClick={() => window.location.reload()}
                    className="mt-2 px-6 py-3 rounded-2xl bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all">
                    Refresh
                  </button>
                </div>
              ) : allAnswered ? (
                <div className="text-center p-8 rounded-[2rem] bg-white/5 border border-white/10 space-y-2">
                  <Trophy size={28} className="mx-auto text-amber-400" />
                  <p className="font-black text-lg">All questions answered</p>
                  <p className="text-slate-400 text-sm font-medium">The clock decides the rest — your opponent is still racing.</p>
                </div>
              ) : (
                <>
                  <div className="text-center p-6 bg-gradient-to-br from-slate-900 to-slate-950 rounded-[2rem] border border-white/10 shadow-2xl">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                      Question {Math.min(blitzIndex + 1, boardSize)} of {boardSize}
                    </p>
                    <h2 className="text-2xl font-black leading-snug">{blitzQuestions[blitzIndex]?.question ?? '…'}</h2>
                  </div>

                  {/* Double sits with the options, not detached above them. It is
                      consumed by the very next submit and can never carry over. */}
                  {!doubleUsed && (
                    <button onClick={() => setDoubleArmed((a) => !a)}
                      className={`w-full py-2.5 rounded-2xl border-2 transition-all font-black text-xs flex items-center justify-center gap-2 ${doubleArmed ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.3)]' : 'bg-white/5 border-white/10 text-white/50 hover:border-white/30'}`}>
                      <Zap size={14} fill={doubleArmed ? 'currentColor' : 'none'} />
                      {doubleArmed ? 'Double armed ×2 — tap to cancel' : 'Double — one answer ×2 (once per duel)'}
                    </button>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    {(blitzQuestions[blitzIndex]?.options || []).map((opt, idx) => {
                      let btnState = 'bg-white/5 border-white/10 hover:bg-white/10';
                      if (userAnswerState) {
                        btnState = lastOptionRef.current === opt
                          ? 'bg-amber-500/25 border-amber-500 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]'
                          : 'bg-white/5 border-white/5 text-white/30 opacity-50';
                      }
                      return (
                        <button key={idx} disabled={userAnswerState !== null} onClick={() => blitzPick(opt)}
                          className={`w-full p-5 rounded-2xl border transition-all text-left font-bold ${btnState}`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  {userAnswerState === null && (
                    <button onClick={() => blitzPick(null)}
                      className="w-full p-3.5 rounded-2xl bg-white/5 border border-white/10 text-white/40 font-bold text-xs uppercase tracking-widest hover:text-white/70 hover:border-white/25 flex items-center justify-center gap-2 active:scale-95 transition-all">
                      <SkipForward size={14} /> Skip (0 pts)
                    </button>
                  )}
                  {txState === 'pending' && <p className="text-center text-xs text-amber-400 font-bold animate-pulse">Grading…</p>}

                  <button onClick={() => setForfeitOpen(true)}
                    className="w-full p-3 rounded-2xl bg-red-500/5 border border-red-500/20 text-red-400/70 font-bold text-[10px] uppercase tracking-widest hover:bg-red-500/10 hover:text-red-300 active:scale-95 transition-all">
                    Forfeit — lose your {blitzMatch.stake} SC stake
                  </button>

                  {forfeitOpen && (
                    <div className="rounded-2xl p-5 bg-red-500/10 border border-red-500/30 space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                        <p className="text-sm text-white/70 font-medium leading-snug">
                          Forfeit now? Your <span className="text-red-300 font-black">{blitzMatch.stake} SC</span> stake is lost and {opponent} is refunded theirs. This cannot be undone.
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <button onClick={() => setForfeitOpen(false)}
                          className="py-3 rounded-2xl bg-white/10 font-black uppercase tracking-widest text-xs hover:bg-white/15 active:scale-95 transition-all">Keep playing</button>
                        <button onClick={forfeitArena}
                          className="py-3 rounded-2xl bg-red-600 font-black uppercase tracking-widest text-xs shadow-lg shadow-red-500/30 active:scale-95 transition-all">Forfeit</button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ---- the result --------------------------------------------- */}
          {phase === 'blitz-result' && blitzResult && (() => {
            const r = resultForMe;
            if (!r) return null;

            if (blitzResult.status === 'abandoned') {
              const ABANDON_COPY = {
                forfeit: ['You Forfeited', 'You left the duel, so your stake is gone and your opponent was refunded theirs.'],
                grace_expired: ['Opponent Forfeited', `${opponent} dropped out and did not come back inside the ${graceSeconds}s reconnect window. Their stake is gone and yours was refunded.`],
                cancel: ['Battle Voided', 'The duel was cancelled before the clock opened, so both stakes were refunded in full.'],
                no_show: ['Opponent Never Arrived', `${opponent} never confirmed the wager, so both stakes were refunded in full.`],
                both_away: ['Battle Voided', 'Both players lost connection, so both stakes were refunded in full.'],
                v63_pre_migration_void: ['Battle Voided', 'This duel was voided by a system upgrade. Nothing was wagered.'],
              };
              const [title, copy] = ABANDON_COPY[r.reason] || ABANDON_COPY.v63_pre_migration_void;
              return (
                <motion.div key="blitz-result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
                  <div className="p-8 rounded-[2rem] text-center bg-white/5 border border-white/10 space-y-3">
                    <AlertCircle size={40} className="mx-auto text-amber-400" />
                    <h2 className="text-2xl font-black uppercase tracking-tight text-amber-300">{title}</h2>
                    <p className="text-white/60 font-medium text-sm leading-relaxed">{copy}</p>
                    <div className="grid grid-cols-2 gap-3 mt-4">
                      <button onClick={() => resetToHub('abandoned-home')} className="py-4 rounded-2xl bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all">War Hall</button>
                      <button onClick={() => resetToPicker('abandoned-rematch')} className="py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">Fight Again</button>
                    </div>
                  </div>
                </motion.div>
              );
            }

            const youWon = r.youWon && !r.draw;
            const cardTone = youWon
              ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_70px_-24px_rgba(16,185,129,0.75)] ring-1 ring-emerald-400/40'
              : r.draw
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-red-500/10 border-red-500/30';
            return (
              <motion.div key="blitz-result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
                <div className={`p-8 rounded-[2rem] text-center relative overflow-hidden ${cardTone}`}>
                  <div className="text-5xl mb-4">{youWon ? '🏆' : r.draw ? '🤝' : '💀'}</div>
                  <h2 className={`text-3xl font-black uppercase tracking-tight ${youWon ? 'text-emerald-400' : r.draw ? 'text-amber-300' : 'text-red-400'}`}>
                    {youWon ? 'Victory!' : r.draw ? 'Draw!' : 'Eliminated'}
                  </h2>
                  {youWon && (
                    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                      <Trophy size={12} /> Winner
                    </span>
                  )}
                  <p className="text-white/50 mt-2 font-medium">
                    {youWon ? 'Higher points on the 40-question board.' : r.draw ? 'Level on points — both stakes returned, nothing lost.' : `${r.winner} took the pot.`}
                  </p>
                  {r.stake > 0 && (
                    <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-lg ${r.delta > 0 ? 'bg-emerald-500/15 text-emerald-400' : r.delta < 0 ? 'bg-red-500/15 text-red-400' : 'bg-white/10 text-white/60'}`}>
                      {r.delta !== 0 ? `${r.delta > 0 ? '+' : ''}${r.delta} SC` : '0 SC'}
                    </div>
                  )}
                </div>

                {achievements.length > 0 && (
                  <div className="mt-2 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">Win + Achievement Unlocked</p>
                    <div className="mt-3 space-y-2">
                      {achievements.map((a) => (
                        <div key={a.key || a.name} className="flex items-center justify-center gap-2 rounded-xl border bg-white/5 px-3 py-2" style={{ borderColor: `${a.accent}59` }}>
                          <span className="text-lg" aria-hidden="true">{a.icon}</span>
                          <span className="text-sm font-black text-white">{a.name}</span>
                          <span className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
                            style={{ color: a.accent, borderColor: `${a.accent}66`, background: `${a.accent}14` }}>
                            {a.tierLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <ScoreCard title="You" card={r.you} tone="you" />
                  <ScoreCard title={r.oppIsBot ? `${r.winner} · tutor` : r.winner} card={r.opp} tone="opp" />
                </div>

                {reviewList.length > 0 && (
                  <div className="p-5 rounded-[2rem] bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2 mb-3">
                      <Brain size={14} className="text-indigo-300" />
                      <span className="text-[10px] font-black uppercase tracking-[0.25em] text-indigo-300">Question review</span>
                    </div>
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                      {reviewList.map((rv) => (
                        <div key={rv.index} className={`rounded-xl p-3 text-sm ${rv.skipped ? 'bg-white/[0.03]' : rv.isCorrect ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
                          <p className="font-bold text-white/90 leading-snug">Q{rv.index + 1}. {rv.question ?? '…'}</p>
                          <div className="mt-1.5 space-y-1 text-xs">
                            <p className={rv.skipped ? 'text-white/40 font-bold' : rv.isCorrect ? 'text-emerald-300 font-bold' : 'text-red-300 font-bold'}>
                              {rv.skipped ? 'Skipped · 0 pts' : rv.isCorrect ? `Correct · ${rv.points} pt${rv.points === 1 ? '' : 's'}${rv.multiplier === 2 ? ' (doubled)' : ''}` : `Incorrect · 0 pts${rv.multiplier === 2 ? ' (doubled, still 0)' : ''}`}
                            </p>
                            {rv.selected && !rv.isCorrect && <p className="text-white/40 font-medium">Your answer: {rv.selected}</p>}
                            {rv.correctAnswer && !rv.isCorrect && !rv.skipped && <p className="text-emerald-200 font-bold">Correct answer: {rv.correctAnswer}</p>}
                            {rv.explanation && <p className="text-slate-300 font-medium leading-relaxed pt-1">{rv.explanation}</p>}
                            {!rv.explanation && rv.hint && <p className="text-slate-400 italic font-medium pt-1">Hint: {rv.hint}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {missedList.length > 0 && (
                  <div className="p-5 rounded-[2rem] bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle size={14} className="text-red-400" />
                      <span className="text-[10px] font-black uppercase tracking-[0.25em] text-red-300">Missed questions</span>
                    </div>
                    <div className="space-y-2">
                      {missedList.map((m) => (
                        <div key={m.index} className="rounded-xl bg-white/5 p-3 text-sm font-bold text-white/90">
                          Q{m.index + 1}. {m.question}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => resetToPicker('rematch')}
                    className="py-5 rounded-[2rem] bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all hover:bg-white/15 flex items-center justify-center gap-2"><RefreshCw size={14} /> Rematch</button>
                  <button onClick={() => resetToHub('hub')}
                    className="py-5 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">War Hall</button>
                </div>
              </motion.div>
            );
          })(          )}
        </AnimatePresence>
      </div>

      <Modal isOpen={showPaceSheet} onClose={() => setShowPaceSheet(false)} label="Flow State pace" variant="bottom">
        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 flex items-center gap-2">
                <Zap size={12} fill="currentColor" /> Flow State pace
              </p>
              <p className="text-lg font-black text-slate-900 dark:text-white mt-1">Auto-skip your unanswered question</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Applies to Enter Arena and Practise vs a bot</p>
            </div>
            <button
              onClick={() => setShowPaceSheet(false)}
              className="p-2 rounded-full bg-slate-100 dark:bg-slate-700"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Seconds per question</span>
              <span className="text-xl font-black tabular-nums text-indigo-500">{tempPace} s</span>
            </div>
            <input
              type="range"
              min={3}
              max={12}
              step={3}
              value={tempPace}
              onChange={(e) => setTempPace(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
              {FLOW_PACES.map((p) => (
                <span key={p}>{p}s</span>
              ))}
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              Default {FLOW_DEFAULT_PACE}s · server-checked 3–12s
            </p>
          </div>
          <button
            onClick={savePace}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-[0.98] transition-all"
          >
            Save pace
          </button>
        </div>
      </Modal>

      <Modal isOpen={showExitConfirm} onClose={() => setShowExitConfirm(false)} label="Exit War Hall">
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">Exit War Hall?</h2>
            </div>
          </div>
          <p className="text-slate-600 dark:text-slate-300 font-medium">
            Are you sure you want to exit the SC War Hall and return to the dashboard?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowExitConfirm(false)}
              className="flex-1 py-3 rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-white font-black uppercase tracking-widest text-xs hover:bg-slate-200 dark:hover:bg-slate-600 transition"
            >
              Stay
            </button>
            <button
              onClick={() => {
                setShowExitConfirm(false);
                navigate('/dashboard');
              }}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-black uppercase tracking-widest text-xs hover:shadow-lg transition"
            >
              Exit to Dashboard
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Rumble;
