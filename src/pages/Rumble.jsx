import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { supabase } from "../utils/supabase";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Zap, Star, ChevronLeft, ArrowRight, Users, AlertCircle, RefreshCw, Trophy, Award, Shield, User, SkipForward } from "../components/Icons";
import { useMatchRealtime } from "../hooks/useMatchRealtime";
import { audioManager } from "../utils/audio";

// One-shot arena cues. Every call is safe when sound is disabled (the manager
// no-ops) and never blocks the UI.
const playArenaSfx = (cue) => {
  try { audioManager.play(`arena_${cue}`); } catch { /* ignore */ }
};

const DUEL_MODES = [
  { id: "duel", title: "1v1 Duel", subtitle: "Live lobby · 40 NMCN questions · 90 seconds", players: 2, color: "from-indigo-600 to-purple-700", glow: "shadow-indigo-500/40", border: "border-indigo-500/30", icon: "⚔️" },
  { id: "triple", title: "Triple Threat", subtitle: "Three-way war. Winner takes all.", players: 3, color: "from-amber-500 to-orange-600", glow: "shadow-amber-500/40", border: "border-amber-500/30", icon: "🔱" },
];
const SC_STAKES = [1, 2, 5, 10, 20];
const QUESTION_SECONDS = 20;
const WAIT_FOR_HUMAN_MS = 3000;
// ---- Tutor bots (1v1, migration v60 -> v63) ----
// Tutors now play the SAME blitz format as a human: same 40-question board,
// same 90s clock, same scoring, same one-time Double. The client sends only the
// tutor id; the server answers them live, question by question.
const BOT_OPPONENTS = [
  { key: 'house', name: 'The House', tier: 'Rookie', accent: 'from-slate-600 to-slate-800', icon: '🏛️', blurb: 'The classic. Plays fair — a warm-up duel.' },
  { key: 'zainab', name: 'Nurse Zainab', tier: 'Intermediate', accent: 'from-emerald-600 to-teal-700', icon: '🩺', blurb: 'Steady hands, sharp recall. A real drill.' },
  { key: 'apollo', name: 'Prof. Apollo', tier: 'Expert', accent: 'from-rose-600 to-red-700', icon: '🎓', blurb: 'Relentless. Only the sharp survive.' },
];
const ROSTER_POLL_MS = 4000;
// ---- Arena (1v1, migration v63) ----
// One format, one clock, one economy. The server owns all of it.
const BLITZ_DURATION_MS = 90 * 1000; // 90s shared wall-clock
const BLITZ_QUESTION_COUNT = 40;
const ARENA_POLL_MS = 1500;
const ARENA_HEARTBEAT_MS = 5000;
const ACTIVE_ARENA_KEY = "apex_active_arena";
const EMPTY_CARD = { points: 0, correct: 0, incorrect: 0, skipped: 0, answers: 0 };

const Rumble = () => {
  const navigate = useNavigate();
  const { smartCoins, createCompetitiveMatch, submitCompetitiveAnswer, completeCompetitiveMatch, syncAchievements, arenaCreateMatch, arenaReady, arenaStart, arenaAnswer, arenaHeartbeat, arenaForfeit, arenaCancel, arenaSettle, arenaState, arenaEnqueue, arenaLeaveQueue, arenaRoster } = useAppContext();
  const [meId, setMeId] = useState(null);
  const [phase, setPhase] = useState("lobby");
  const [mode, setMode] = useState(null);
  const [stake, setStake] = useState(2);
  const [countdown, setCountdown] = useState(3);
  const [result, setResult] = useState(null);
  const [duelHistory, setDuelHistory] = useState([]);
  const [finding, setFinding] = useState(null); // 'house' | 'human' | 'bot' | null
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(QUESTION_SECONDS);
  const [userAnswerState, setUserAnswerState] = useState(null);
  const [opponent, setOpponent] = useState("The House");
  const [txState, setTxState] = useState(null); // null | 'pending' | 'done'
  const [confirmHighWager, setConfirmHighWager] = useState(false); // confirm modal for stakes >= 10
  const [roster, setRoster] = useState([]); // live eligible scholars (premium + SC), from duel_roster
  const [rosterLoading, setRosterLoading] = useState(false);
  const pendingArenaRef = useRef(null); // action deferred behind the high-wager confirm
  const [battleQuestions, setBattleQuestions] = useState([]); // questions from batch API
  const ownWaitingKeyRef = useRef(null); // id of my duel_waiting row (to clean up)
  const matchIdRef = useRef(null); // server match id for the current battle
  const lastOptionRef = useRef(null); // the option I picked (post-answer highlight)
  const phaseRef = useRef("lobby");

  // ---- Blitz (1v1 Duel Lobby) state ----
  const [blitzMatch, setBlitzMatch] = useState(null); // { matchId, questions, questionCount, startsAt, endsAt }
  const [blitzQuestions, setBlitzQuestions] = useState([]);
  const [blitzIndex, setBlitzIndex] = useState(0);
  const [blitzScore, setBlitzScore] = useState(0);
  const [blitzWrongs, setBlitzWrongs] = useState(0);
  const [blitzRight, setBlitzRight] = useState(0);
  const [blitzSkipped, setBlitzSkipped] = useState(0);
  const [blitzAnswered, setBlitzAnswered] = useState(0);
  const [blitzStreak, setBlitzStreak] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [oppWrongs, setOppWrongs] = useState(0);
  const [oppRight, setOppRight] = useState(0);
  const [oppSkipped, setOppSkipped] = useState(0);
  const [oppAnswered, setOppAnswered] = useState(0);
  const [oppStreak, setOppStreak] = useState(0);
  const [blitzAnswers, setBlitzAnswers] = useState([]); // my per-index run (review is server-authoritative; this is the instant-feedback mirror)
  const [doubleArmed, setDoubleArmed] = useState(false);
  const [doubleUsed, setDoubleUsed] = useState(false);
  const [blitzTimeLeft, setBlitzTimeLeft] = useState(BLITZ_DURATION_MS);
  const [blitzResult, setBlitzResult] = useState(null);
  const [arenaReview, setArenaReview] = useState(null); // post-match review (answer key)
  const [oppDown, setOppDown] = useState(false);       // opponent inside the reconnect grace
  const [lobbyOnline, setLobbyOnline] = useState(null); // scholars currently waiting
  const [forfeitOpen, setForfeitOpen] = useState(false); // forfeit confirmation
  const settleDoneRef = useRef(false);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // My user id (used in realtime payloads / mirror filters).
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (live && data?.user?.id) setMeId(data.user.id);
      } catch { /* ignore */ }
    })();
    return () => { live = false; };
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!supabase) return;
    try {
      let userId = null;
      try {
        userId = (await supabase.auth.getUser()).data.user?.id;
      } catch { /* ignore */ }
      let query = supabase
        .from('duels')
        .select('id, opponent, mode, stake, outcome, delta, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
      if (userId) query = query.eq('user_id', userId);
      const { data } = await query;
      if (data) setDuelHistory(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  // Clean up my waiting row when leaving/closing the arena.
  useEffect(() => {
    return () => {
      if (supabase && ownWaitingKeyRef.current) {
        supabase.from('duel_waiting').delete().eq('id', ownWaitingKeyRef.current).then(() => {});
      }
    };
  }, []);

  const clearWaiting = async () => {
    if (supabase && ownWaitingKeyRef.current) {
      const id = ownWaitingKeyRef.current;
      ownWaitingKeyRef.current = null;
      await supabase.from('duel_waiting').delete().eq('id', id).then(() => {});
    }
  };

  // ============================================================
  // 1v1 ARENA — one blitz format for humans AND bots (migration v63)
  //
  // The server owns everything that matters: the board, the grading, the
  // escrow, the verdict. This layer only renders server state and dispatches
  // intents. It never computes a score or decides an outcome.
  // ============================================================

  // Scorecards are SERVER-COMPUTED. Streaks are cosmetic only and are derived
  // locally from the answer log; they never affect scoring or the verdict.
  const streakOf = useCallback((rows) => {
    let s = 0;
    for (const r of rows || []) {
      if (r?.skipped) continue;
      s = r?.isCorrect ? s + 1 : 0;
    }
    return s;
  }, []);

  const setMyCardFrom = useCallback((card) => {
    const c = card || EMPTY_CARD;
    setBlitzScore(Number(c.points) || 0);
    setBlitzRight(Number(c.correct) || 0);
    setBlitzWrongs(Number(c.incorrect) || 0);
    setBlitzSkipped(Number(c.skipped) || 0);
    setBlitzAnswered(Number(c.answers) || 0);
  }, []);
  const setOppCardFrom = useCallback((card) => {
    const c = card || EMPTY_CARD;
    setOppScore(Number(c.points) || 0);
    setOppRight(Number(c.correct) || 0);
    setOppWrongs(Number(c.incorrect) || 0);
    setOppSkipped(Number(c.skipped) || 0);
    setOppAnswered(Number(c.answers) || 0);
  }, []);

  const applyArenaState = useCallback((data) => {
    if (!data) return;
    setMyCardFrom(data.myScore);
    setOppCardFrom(data.opponentScore);
    if (Array.isArray(data.myAnswers)) setBlitzStreak(streakOf(data.myAnswers));
    if (Array.isArray(data.opponentAnswers)) setOppStreak(streakOf(data.opponentAnswers));
    setOppDown(!!data.opponentDisconnected);
  }, [setMyCardFrom, setOppCardFrom, streakOf]);

  // Adopt a freshly created (or replayed) match and declare MY readiness.
  // The clock only opens once the server says both sides are ready.
  const adoptArena = useCallback(async (created, oppLabel) => {
    if (!created || !created.matchId) return false;
    const mid = created.matchId;
    matchIdRef.current = mid;
    const questions = created.questions || [];
    setBlitzMatch({
      matchId: mid,
      questions,
      questionCount: created.questionCount || questions.length,
      startsAt: null,
      endsAt: null,
      stake,
      escrowed: created.escrowed ?? stake * 2,
    });
    setBlitzQuestions(questions);
    setBlitzIndex(0);
    setMyCardFrom(null); setOppCardFrom(null);
    setBlitzAnswers([]);
    setDoubleArmed(false);
    setDoubleUsed(false);
    setBlitzResult(null);
    setArenaReview(null);
    setOppDown(false);
    setBlitzStreak(0); setOppStreak(0);
    setBlitzTimeLeft(BLITZ_DURATION_MS);
    settleDoneRef.current = false;
    if (oppLabel) setOpponent(oppLabel);

    const ready = await arenaReady(mid);
    try {
      sessionStorage.setItem(ACTIVE_ARENA_KEY, JSON.stringify({ matchId: mid, stake }));
    } catch { /* ignore */ }

    if (ready?.canStart) { setPhase('blitz-countdown'); setCountdown(3); }
    else { setPhase('blitz-waiting'); }
    return true;
  }, [stake, arenaReady, setMyCardFrom, setOppCardFrom]);

  // Resume a match we were already in (ALREADY_IN_MATCH hands back the id).
  const resumeArena = useCallback(async (mid, questionsOverride) => {
    if (!mid) return;
    const st = await arenaState(mid);
    if (!st?.ok) return;
    matchIdRef.current = mid;
    const questions = st.questions || questionsOverride || [];
    setBlitzMatch((m) => ({
      ...(m || {}),
      matchId: mid,
      questions,
      questionCount: st.questionCount || questions.length,
      startsAt: st.startsAt || null,
      endsAt: st.endsAt || null,
      stake: st.stake ?? stake,
      escrowed: st.escrowed ?? null,
    }));
    setBlitzQuestions(questions);
    setOpponent(st.opponentName || "Rival Scholar");
    applyArenaState(st);
    setArenaReview(Array.isArray(st.review) ? st.review : null);
    if (st.status === 'active' && st.endsAt) {
      setBlitzTimeLeft(Math.max(0, Date.parse(st.endsAt) - Date.now()));
      setPhase('blitz-play');
    } else if (st.status === 'ready') {
      setPhase('blitz-countdown'); setCountdown(3);
    } else if (st.status === 'completed' || st.status === 'abandoned') {
      settleDoneRef.current = true;
      const res = await arenaSettle(mid);
      finishArena(res);
    } else {
      setPhase('blitz-waiting');
    }
  }, [stake, arenaState, arenaSettle, applyArenaState]);

  // ---- entry points (1v1 only) ----
  const startQuickMatch = useCallback(async () => {
    if (!meId || stake > smartCoins) return;
    setFinding('human');
    setOpponent("Rival Scholar");
    setPhase('blitz-waiting');
    const res = await arenaEnqueue({ stake });
    if (res?.matchId) await adoptArena(res);
    else if (res?.error === 'ALREADY_IN_MATCH' && res.matchId) await resumeArena(res.matchId);
  }, [meId, stake, smartCoins, arenaEnqueue, adoptArena, resumeArena]);

  const startVsBot = useCallback(async (botKey, botName) => {
    if (stake > smartCoins) return;
    setFinding('bot');
    setOpponent(botName);
    const res = await arenaCreateMatch({ stake, bot: botKey });
    if (res?.matchId) await adoptArena(res, botName);
    else if (res?.error === 'ALREADY_IN_MATCH' && res.matchId) await resumeArena(res.matchId, null);
  }, [stake, smartCoins, arenaCreateMatch, adoptArena, resumeArena]);

  const challengeScholar = useCallback(async (scholar) => {
    if (stake > smartCoins) return;
    setFinding('human');
    setOpponent(scholar.name || "Rival Scholar");
    const res = await arenaCreateMatch({ stake, opponentId: scholar.userId });
    if (res?.matchId) await adoptArena(res, scholar.name);
    else if (res?.error === 'ALREADY_IN_MATCH' && res.matchId) await resumeArena(res.matchId, null);
  }, [stake, smartCoins, arenaCreateMatch, adoptArena, resumeArena]);

  const cancelArena = useCallback(async () => {
    const mid = matchIdRef.current;
    if (!mid) { setPhase('betting'); return; }
    await arenaLeaveQueue();
    const res = await arenaCancel(mid);
    if (res?.ok) { setBlitzResult(res); setPhase('blitz-result'); }
    else setPhase('betting');
  }, [arenaCancel, arenaLeaveQueue]);

  // Lobby presence: shows how many scholars are queued. Presence is a nicety —
  // pairing itself is decided server-side by arena_enqueue.
  const { online: lobbyOnlineMembers } = useMatchRealtime({
    topic: 'match-lobby:duel:blitz',
    enabled: !!meId && phase === 'blitz-waiting' && !matchIdRef.current,
    sessionId: meId,
    track: { waiting: true, stake },
    onEvent: () => {},
    onReconcile: () => {},
  });
  useEffect(() => { setLobbyOnline(lobbyOnlineMembers); }, [lobbyOnlineMembers]);

  // Match channel is a "refresh now" trigger only. The authoritative scorecard
  // always comes from arena_state, never from an opponent-supplied payload.
  const { sendState: sendMatch } = useMatchRealtime({
    topic: blitzMatch ? `match:${blitzMatch.matchId}` : null,
    enabled: !!blitzMatch && !!meId && (phase === 'blitz-countdown' || phase === 'blitz-play'),
    sessionId: meId,
    track: { inMatch: true },
    onEvent: (type) => {
      if (type === 'answer' && phaseRef.current === 'blitz-play') {
        pollArena();
      }
    },
    onReconcile: () => {},
  });

  // Refresh the server-authoritative state of the match I'm in.
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
    if (phase !== "blitz-waiting" || !meId) return;
    let stopped = false;

    const pump = async () => {
      if (stopped) return;

      if (matchIdRef.current) {
        const st = await pollArena();
        if (!st || stopped) return;
        if (st.status === 'ready') { setPhase('blitz-countdown'); setCountdown(3); }
        else if (st.status === 'completed' || st.status === 'abandoned') {
          settleDoneRef.current = true;
          const res = await arenaSettle(st.matchId);
          finishArena(res);
        }
        return;
      }

      const res = await arenaEnqueue({ stake });
      if (stopped) return;
      if (res?.matchId) { await adoptArena(res); return; }
      if (res?.error === 'ALREADY_IN_MATCH' && res.matchId) { await resumeArena(res.matchId); return; }
      // Still queued — keep the slot warm.
      const roster = await arenaRoster({ stake });
      if (!stopped) setRoster(Array.isArray(roster) ? roster : []);
    };

    pump();
    const iv = setInterval(pump, ARENA_POLL_MS);
    return () => { stopped = true; clearInterval(iv); };
  }, [phase, stake, meId, pollArena, arenaEnqueue, arenaRoster, adoptArena, resumeArena, arenaSettle]);

  // Countdown -> open the shared clock (requires BOTH players ready server-side).
  useEffect(() => {
    if (phase !== "blitz-countdown") return;
    if (countdown <= 0) {
      startTheArena();
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  const startTheArena = useCallback(async () => {
    const mid = matchIdRef.current;
    if (!mid) return;
    let res = await arenaStart(mid);
    if (!res?.ok) {
      // The opponent may already have opened it — take the server's clock.
      const st = await arenaState(mid);
      if (st?.startsAt && st?.endsAt) res = { ok: true, startsAt: st.startsAt, endsAt: st.endsAt };
    }
    if (!res?.startsAt || !res?.endsAt) { setPhase('blitz-waiting'); return; }
    setBlitzMatch((m) => ({ ...(m || {}), startsAt: res.startsAt, endsAt: res.endsAt }));
    setBlitzTimeLeft(Math.max(0, Date.parse(res.endsAt) - Date.now()));
    setPhase('blitz-play');
  }, [arenaStart, arenaState]);

  // 90s shared wall-clock + heartbeat.
  //
  // The heartbeat is what keeps the reconnect-grace timer alive on the server
  // AND re-syncs the authoritative scorecard. Without it a player on a slow
  // connection would be forfeited while still playing.
  useEffect(() => {
    if (phase !== "blitz-play" || !blitzMatch?.endsAt) return;
    const ends = Date.parse(blitzMatch.endsAt);
    const tick = () => {
      const remain = Math.max(0, ends - Date.now());
      setBlitzTimeLeft(remain);
      if (remain <= 0) settleArena();
    };
    tick();
    const iv = setInterval(tick, 250);
    // One heartbeat does the work of three things: it keeps the reconnect-grace
    // timer alive on the server, re-syncs the authoritative scorecards, and
    // reports whether the opponent has dropped. Without it a player on a slow
    // connection would be forfeited while still playing.
    const hb = setInterval(async () => {
      const mid = matchIdRef.current;
      if (!mid) return;
      const beat = await arenaHeartbeat(mid);
      if (!beat?.ok) return;
      if (beat.status === 'completed' || beat.status === 'abandoned') { settleArena(mid); return; }
      setMyCardFrom(beat.myScore);
      setOppCardFrom(beat.opponentScore);
      setOppDown(!!beat.opponentDisconnected);
    }, ARENA_HEARTBEAT_MS);
    return () => { clearInterval(iv); clearInterval(hb); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, blitzMatch]);

  // A single disconnect edge fires the alert tone once (not on every poll).
  const wasDownRef = useRef(false);
  useEffect(() => {
    if (oppDown && !wasDownRef.current) playArenaSfx('disconnect');
    wasDownRef.current = oppDown;
  }, [oppDown]);

  const finishArena = useCallback(async (res) => {
    if (res?.ok) {
      setBlitzResult(res);
      try { sessionStorage.removeItem(ACTIVE_ARENA_KEY); } catch { /* ignore */ }
      const mid = matchIdRef.current;
      if (mid) {
        const st = await arenaState(mid);
        if (st?.ok) { setArenaReview(Array.isArray(st.review) ? st.review : null); applyArenaState(st); }
      }
      setPhase('blitz-result');
      fetchHistory();
      try { sendMatch({ type: 'end', id: meId }); } catch { /* ignore */ }
    }
  }, [arenaState, applyArenaState, fetchHistory, sendMatch, meId]);

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
  // other player is refunded — both decided server-side.
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
          questionCount: st.questionCount || questions.length,
          startsAt: st.startsAt || null, endsAt: st.endsAt || null,
          stake: st.stake ?? saved.stake, escrowed: st.escrowed ?? null,
        });
        setBlitzQuestions(questions);
        setOpponent(st.opponentName || "Rival Scholar");
        applyArenaState(st);

        const mine = Array.isArray(st.myAnswers) ? st.myAnswers : [];
        const done = new Set(mine.map(a => a.index));
        let next = 0;
        while (done.has(next)) next += 1;
        setBlitzIndex(next);
        setBlitzAnswers(mine.map(a => ({
          index: a.index, correct: a.skipped ? null : !!a.isCorrect,
          multiplier: a.multiplier, delta: a.points ?? 0, skipped: !!a.skipped,
        })));
        setDoubleUsed(mine.some(a => a.multiplier === 2));
        setArenaReview(Array.isArray(st.review) ? st.review : null);

        if (st.status === 'active' && st.endsAt) {
          setBlitzTimeLeft(Math.max(0, Date.parse(st.endsAt) - Date.now()));
          setPhase('blitz-play');
        } else if (st.status === 'ready') {
          setPhase('blitz-countdown'); setCountdown(3);
        } else if (st.status === 'completed' || st.status === 'abandoned') {
          settleDoneRef.current = true;
          const res = await arenaSettle(st.matchId);
          if (live) await finishArena(res);
        } else {
          setPhase('blitz-waiting');
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
    if (armed) playArenaSfx('double');

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
    if (isSkip) playArenaSfx('skip');
    else if (!res.replay) playArenaSfx(res.isCorrect ? 'correct' : 'wrong');

    setMyCardFrom(res.myScore);
    setBlitzAnswers((prev) => [...prev, {
      index: idx, correct: isSkip ? null : !!res.isCorrect,
      multiplier: res.multiplier, delta: res.points ?? 0, skipped: isSkip,
    }]);
    // The opponent advanced too (server resolved their turn in the same call).
    if (res.botTurn) playArenaSfx('opponent');

    setTxState('done');
    setTimeout(() => {
      setUserAnswerState(null);
      setTxState(null);
      setBlitzIndex((i) => i + 1);
      // Clear any armed Double again in case the timer raced the click.
      setDoubleArmed(false);
    }, res.replay ? 150 : 450);
  }, [blitzMatch, blitzIndex, blitzTimeLeft, userAnswerState, doubleArmed, arenaAnswer, setMyCardFrom]);

  // ============================================================
  // TRIPLE THREAT (sudden-death) — unchanged flow
  // ============================================================

  const startBattle = useCallback(async () => {
    if (!mode) return;
    setCountdown(3);
    setFinding('house');
    // Declare intent to the realtime queue, then immediately look for a human.
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('duel_waiting')
          .upsert({ user_id: (await supabase.auth.getUser()).data.user?.id, mode: mode.id, stake, format: 'sudden_death' }, { onConflict: 'user_id' })
          .select('id');
        if (!error && data && data[0]) ownWaitingKeyRef.current = data[0].id;
      } catch { /* ignore */ }
    }
    await tryMatchHuman();
  }, [mode, stake]);

  const tryMatchHuman = useCallback(async () => {
    if (!supabase) return finishVsHouse();
    let opponent = null;
    try {
      const me = (await supabase.auth.getUser()).data.user?.id;
      const { data } = await supabase
        .from('duel_waiting')
        .select('user_id, created_at, id')
        .eq('mode', mode.id)
        .eq('stake', stake)
        .eq('format', 'sudden_death')
        .neq('user_id', me)
        .order('created_at', { ascending: true })
        .limit(1);
      if (data && data[0]) opponent = data[0];
    } catch { /* ignore */ }
    if (opponent) {
      // Fetch opponent display name via the public identity view (profiles
      // SELECT is RLS-scoped to self/admin, so direct reads always fail here).
      let name = "Rival Scholar";
      try {
        const { data: prof } = await supabase.from('community_profiles').select('display_name').eq('id', opponent.user_id).single();
        if (prof && prof.display_name) name = prof.display_name;
      } catch { /* ignore */ }
      await clearWaiting();
      setOpponent(name);
      setFinding('human');
      await startCountdownPhaseWithBatch(name, opponent.user_id);
      return;
    }
    // No waiting human — play a tutor after a short grace window so a
    // challenger can jump in. Non-blitz 1v1 falls back to the skill-graded
    // "The House" bot (migration v60); Triple Threat keeps the legacy
    // no-bot fallback (3-way, never bot-graded).
    setTimeout(() => {
      if (ownWaitingKeyRef.current) {
        // still alone
        const fallbackBot = mode?.id === 'duel' ? 'house' : null;
        setOpponent("The House");
        startCountdownPhaseWithBatch("The House", null, fallbackBot);
      }
    }, WAIT_FOR_HUMAN_MS);
  }, [mode, stake]);

  const finishVsHouse = async () => {
    setOpponent("The House");
    await startCountdownPhaseWithBatch("The House", null, null);
  };

  // Route every real-stakes entry through the same high-wager confirmation.
  //
  // The stake is CAPTURED with the deferred action, not read from live state
  // when the modal is confirmed: tapping a different tier while the modal is
  // open used to display one amount and wager another.
  const requestArena = useCallback((action) => {
    const capturedStake = stake;
    const run = () => action(capturedStake);
    if (capturedStake >= 10) {
      pendingArenaRef.current = { run, stake: capturedStake };
      setConfirmHighWager(true);
      return;
    }
    run();
  }, [stake]);

  // Triple Threat still uses the v38 sudden-death engine. 1v1 no longer does:
  // sudden-death was removed from the arena in v63 (one blitz format only).
  const startCountdownPhaseWithBatch = async (oppName, oppId, bot = null) => {
    try {
      const matchResult = await createCompetitiveMatch({ mode: mode?.id, stake, opponentId: oppId || null, format: 'sudden_death', bot: bot || null });
      if (!matchResult || !matchResult.ok || !matchResult.questions?.length) {
        setPhase("lobby");
        return;
      }
      matchIdRef.current = matchResult.matchId;
      setBattleQuestions(matchResult.questions);
      setCurrentQuestion(matchResult.questions[0]);
    } catch (err) {
      console.warn('Server match creation failed:', err?.message);
      setPhase("lobby");
      return;
    }
    setPhase("countdown");
    setCountdown(3);
  };

  // Live eligible-scholar roster (premium + Smart Coins available), shown on the
  // non-blitz 1v1 betting screen so a scholar can challenge a real opponent.
  useEffect(() => {
    if (phase !== 'betting' || mode?.id !== 'duel' || !meId || smartCoins <= 0) {
      setRoster([]);
      return;
    }
    let stopped = false;
    const load = async () => {
      setRosterLoading(true);
      let players = [];
      try {
        players = await arenaRoster({ stake });
      } catch { /* ignore */ }
      if (!stopped) {
        setRoster(Array.isArray(players) ? players : []);
        setRosterLoading(false);
      }
    };
    load();
    const iv = setInterval(load, ROSTER_POLL_MS);
    return () => { stopped = true; clearInterval(iv); };
  }, [phase, mode, stake, meId, smartCoins, arenaRoster]);

  // Pre-game Countdown -> move to question
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      // Batch question is already set from startCountdownPhaseWithBatch
      // Just transition to question phase
      if (!currentQuestion && battleQuestions.length > 0) {
        setCurrentQuestion(battleQuestions[0]);
      }
      setPhase("question");
      setQuestionTimeLeft(QUESTION_SECONDS);
      setUserAnswerState(null);
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  // Question Timer
  useEffect(() => {
    if (phase !== "question" || userAnswerState !== null) return;
    if (questionTimeLeft <= 0) {
      handleAnswer(null); // timeout = no answer = graded by the server
      return;
    }
    const t = setTimeout(() => setQuestionTimeLeft(c => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, questionTimeLeft, userAnswerState]);

  const handleAnswer = useCallback(async (option) => {
    if (userAnswerState !== null) return;
    setUserAnswerState(option === null ? 'timeout' : 'answered');
    lastOptionRef.current = option ?? null;
    setTxState('pending');

    // The battle is SERVER-GOVERNED (migration v38): the server grades my
    // stored answer and resolves the winner from the facts on record. The
    // client never sends a `won`, a score, or the correct answer.
    let outcome = 'draw';
    let delta = 0;
    let youWon = false;
    let draw = false;
    let winner = opponent;
    let breakdown = [];
    let settled = false;
    const matchId = matchIdRef.current;
    const qIndex = currentQuestion?.index ?? 0;

    try {
      if (matchId) {
        await submitCompetitiveAnswer({ matchId, questionIndex: qIndex, selected: option ?? null });
      }
      const res = matchId ? await completeCompetitiveMatch(matchId) : null;
      if (res && res.ok) {
        youWon = !!res.youWon;
        draw = !!res.draw;
        if (res.outcome) outcome = res.outcome;
        if (res.delta != null) delta = Number(res.delta) || 0;
        if (res.winner) winner = res.winner;
        if (Array.isArray(res.breakdown)) breakdown = res.breakdown;
        settled = !!res.settled;
      }
    } catch (err) {
      console.warn('Competitive settlement failed:', err?.message);
    }

    setTxState('done');

    // A verified WIN is a learning signal: re-run the SERVER achievement
    // evaluation (migration v35 — only evaluate_achievements can unlock) and
    // capture any fresh unlocks so the result screen can show the
    // "WIN + ACHIEVEMENT UNLOCKED" moment.
    let achievements = [];
    if (outcome === 'win') {
      try {
        const payloads = await syncAchievements();
        achievements = Array.isArray(payloads) ? payloads : [];
      } catch (err) {
        console.warn('Post-win achievements skipped:', err?.message);
      }
    }

    setResult({
      winner,
      youWon,
      draw,
      outcome,
      delta,
      settled,
      players: mode?.players || 2,
      breakdown,
      achievements,
    });
    setPhase("result");
    fetchHistory();
  }, [userAnswerState, currentQuestion, mode, opponent, fetchHistory, submitCompetitiveAnswer, completeCompetitiveMatch, syncAchievements]);

  const resetToLobby = () => {
    setPhase("lobby");
    setResult(null);
    setCountdown(3);
    setMode(null);
    setCurrentQuestion(null);
    setBattleQuestions([]);
    matchIdRef.current = null;
    lastOptionRef.current = null;
    setOpponent("The House");
    setTxState(null);
    setFinding(null);
    setBlitzMatch(null);
    setBlitzQuestions([]);
    setBlitzIndex(0);
    setBlitzResult(null);
    setUserAnswerState(null);
  };

  const resetToBetting = () => {
    setPhase("betting");
    setResult(null);
    setCountdown(3);
    setCurrentQuestion(null);
    setBattleQuestions([]);
    matchIdRef.current = null;
    lastOptionRef.current = null;
    setTxState(null);
    setFinding(null);
    setBlitzMatch(null);
    setBlitzQuestions([]);
    setBlitzIndex(0);
    setBlitzResult(null);
    setArenaReview(null);
    setDoubleArmed(false);
    setDoubleUsed(false);
    setOppDown(false);
    setForfeitOpen(false);
    setUserAnswerState(null);
    try { sessionStorage.removeItem(ACTIVE_ARENA_KEY); } catch { /* ignore */ }
  };

  const fmtBlitzTime = (ms) => {
    const s = Math.ceil((ms || 0) / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  // The breakdown is the SERVER's final scorecard — one shape for a human
  // opponent and for a tutor, so the result screen renders identically.
  const blitzResultForMe = () => {
    if (!blitzResult) return null;
    const bd = Array.isArray(blitzResult.breakdown) ? blitzResult.breakdown : [];
    const me = bd.find((p) => p.playerId && p.playerId === meId);
    const opp = bd.find((p) => !p.playerId || p.playerId !== meId);
    const card = (c) => ({
      points: Number(c?.points) || 0,
      correct: Number(c?.correct) || 0,
      incorrect: Number(c?.incorrect) || 0,
      skipped: Number(c?.skipped) || 0,
      answers: Number(c?.answers) || 0,
    });
    return {
      status: blitzResult.status,
      reason: blitzResult.reason || null,
      youWon: !!blitzResult.youWon && !blitzResult.draw,
      draw: !!blitzResult.draw,
      winner: opp?.name || "Your opponent",
      you: card(me),
      opp: card(opp),
      oppIsBot: !!opp?.isBot,
      delta: Number(blitzResult.myDelta ?? blitzResult.delta) || 0,
      myOutcome: blitzResult.myOutcome || 'draw',
      settled: true,
    };
  };

  // Post-match review: every question, what you picked, the correct answer and
  // the explanation/hint when the bank has one. Nothing is invented.
  const reviewList = () => (Array.isArray(arenaReview) ? arenaReview : []);

  // Fallback when the server review has not arrived (e.g. a very fast settle):
  // the local mirror still shows which questions were missed.
  const missedList = () => {
    const fromServer = reviewList().filter((r) => !r.skipped && r.isCorrect === false);
    if (fromServer.length) return fromServer;
    return blitzAnswers.filter((a) => a.correct === false && a.index != null).map((a) => ({
      index: a.index,
      question: blitzQuestions[a.index]?.question ?? '…',
      selected: null,
      correctAnswer: null,
      explanation: null,
      hint: null,
      isCorrect: false,
      skipped: false,
      multiplier: a.multiplier,
      points: a.delta,
    }));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/10 blur-[150px] rounded-full" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-amber-500/8 blur-[120px] rounded-full" />
      </div>
      <div className="relative z-10 max-w-2xl mx-auto px-4 pt-10 pb-32">
        <div className="flex items-center justify-between mb-10">
          <button onClick={() => navigate("/quiz")} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors font-bold text-sm px-4 py-2 bg-white/5 rounded-2xl active:scale-95">
            <ChevronLeft size={18} /> Back
          </button>
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 rounded-2xl">
            <Star size={16} className="text-amber-400" fill="currentColor" />
            <span className="text-amber-400 font-black text-sm tabular-nums">{smartCoins.toLocaleString()} SC</span>
          </div>
        </div>

        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-2xl shadow-purple-500/40">
              <Brain size={28} />
            </div>
          </div>
          <h1 className="text-4xl font-black tracking-tight uppercase">SC War Hall</h1>
          <p className="text-slate-400 font-medium mt-2 text-sm">Secret chamber. High stakes. Winner takes {mode ? (mode.players === 3 ? '2× the pot' : 'the pot') : 'Smart Coins'}.</p>
          <div className="mt-3 flex items-center justify-center gap-2 text-amber-400/70 text-[10px] font-black uppercase tracking-widest">
            <AlertCircle size={12} />
            <span>Real Smart Coins. Win big or lose your wager.</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {phase === "lobby" && (
            <motion.div key="lobby" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-8">
              {DUEL_MODES.map(m => (
                <button key={m.id} onClick={() => { setMode(m); setStake(2); setPhase("betting"); }}
                  className={`relative w-full text-left p-7 rounded-[2rem] bg-gradient-to-br ${m.color} border ${m.border} shadow-2xl ${m.glow} active:scale-[0.98] transition-all overflow-hidden group`}
                  style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)" }}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${m.color} opacity-20`} />
                  <div className="relative flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-3xl">{m.icon}</span>
                        <span className="text-xl font-black tracking-tight">{m.title}</span>
                      </div>
                      <p className="text-white/60 font-medium text-sm">{m.subtitle}</p>
                      <div className="flex items-center gap-2 mt-4">
                        <Users size={14} className="text-white/40" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">{m.players} Players</span>
                      </div>
                    </div>
                    <ArrowRight size={24} className="text-white/30 group-hover:text-white/80 transition-colors shrink-0 ml-4" />
                  </div>
                </button>
              ))}

              <div className="p-6 rounded-[2rem] bg-white/5 border border-white/10">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy size={16} className="text-amber-400" />
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-amber-400">Your Duel History</span>
                </div>
                {duelHistory.length === 0 ? (
                  <p className="text-slate-400 text-sm font-medium text-center py-4">No duels yet. Enter the arena above.</p>
                ) : (
                  <div className="space-y-2">
                    {duelHistory.map(d => (
                      <div key={d.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                        <div className="flex items-center gap-2 min-w-0">
                          {d.outcome === 'win' ? <Trophy size={14} className="text-emerald-400 shrink-0" /> : <Award size={14} className="text-red-400 shrink-0" />}
                          <span className="text-sm font-bold truncate">vs {d.opponent}</span>
                          <span className="text-[10px] text-white/40 uppercase">{d.mode === 'triple' ? 'Triple' : '1v1'}</span>
                        </div>
                        <span className={`font-black text-sm tabular-nums ${d.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {d.delta > 0 ? '+' : ''}{d.delta} SC
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {phase === "betting" && mode && (
            <motion.div key="betting" initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-8">
              <button onClick={() => setPhase("lobby")} className="text-slate-400 hover:text-white text-sm font-bold flex items-center gap-1 transition-colors">
                <ChevronLeft size={16} /> Choose Mode
              </button>
              <div className="p-6 rounded-[2rem] bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{mode.icon}</span>
                  <div>
                    <h2 className="text-xl font-black">{mode.title}</h2>
                    <p className="text-white/50 text-sm">{mode.subtitle}</p>
                  </div>
                </div>
                {mode.id === "duel" && (
                  <div className="mt-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20 p-3 text-xs text-indigo-200/90 font-medium">
                    <Zap size={12} className="inline align-[-2px] mr-1 text-indigo-300" />
                    40-question Blitz · 90-second shared clock · live lobby — matched against a real scholar, no House.
                    <span className="block mt-1 text-indigo-200/70">Or scroll down to challenge a Tutor or a live Scholar in a non-blitz 1v1.</span>
                  </div>
                )}
              </div>
              {smartCoins <= 0 ? (
                <div className="rounded-2xl p-6 bg-amber-500/10 border border-amber-500/30 text-center space-y-4">
                  <div className="text-4xl">🪙</div>
                  <div>
                    <h3 className="font-black text-amber-300 text-lg">No Smart Coins to wager</h3>
                    <p className="text-sm text-white/60 font-medium mt-1">
                      This arena is real-stakes only. Complete quizzes and daily challenges to earn Smart Coins, then come back to duel.
                    </p>
                  </div>
                  <button onClick={() => navigate("/quiz")}
                    className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 font-black uppercase tracking-widest text-xs shadow-lg shadow-emerald-500/30 active:scale-95 transition-all">
                    Earn Smart Coins
                  </button>
                </div>
              ) : (
              <div className="space-y-4">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Set Your Wager</p>
                <div className="grid grid-cols-5 gap-3">
                  {SC_STAKES.map(s => (
                    <button key={s} onClick={() => setStake(s)}
                      className={`py-4 rounded-2xl font-black text-sm transition-all active:scale-95 border-2 ${stake === s ? "bg-amber-500 border-amber-400 text-white shadow-xl shadow-amber-500/30" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                    >{s}</button>
                  ))}
                </div>
                <p className="text-center text-slate-400 text-sm font-medium">
                  Wagering <span className="text-amber-400 font-black">{stake} SC</span> — you have <span className="text-amber-400 font-black">{smartCoins} SC</span>
                </p>
                {stake > smartCoins && <p className="text-red-400 text-center text-xs font-bold animate-pulse">⚠️ Insufficient SC. Choose a lower wager.</p>}
              </div>
              )}
              {smartCoins > 0 && (
              <button disabled={stake > smartCoins} onClick={() => requestArena(() => { if (mode.id === 'duel') startQuickMatch(); else startBattle(); })}
                className="w-full py-6 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-[0.3em] text-sm shadow-2xl shadow-indigo-500/30 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-3"
              >
                <Zap size={18} fill="currentColor" /> {mode.id === 'duel' ? 'Enter the Arena · Blitz' : 'Enter the Arena'}
              </button>
              )}

              {mode.id === "duel" && smartCoins > 0 && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-indigo-300" />
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Instant tutor match</p>
                  </div>
                  <p className="text-[11px] text-slate-400 font-medium -mt-2">
                    Tutors play the exact same 40-question blitz board, on the same clock, with the same scoring and Double.
                  </p>
                  <div className="space-y-3">
                    {BOT_OPPONENTS.map(b => (
                      <button key={b.key} disabled={stake > smartCoins} onClick={() => requestArena(() => startVsBot(b.key, b.name))}
                        className={`w-full text-left p-4 rounded-2xl bg-gradient-to-br ${b.accent} border border-white/10 shadow-lg active:scale-[0.98] transition-all disabled:opacity-40 disabled:pointer-events-none`}
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

                  <div className="flex items-center justify-between gap-2 pt-2">
                    <div className="flex items-center gap-2">
                      <Users size={14} className="text-emerald-300" />
                      <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Live Scholars</p>
                    </div>
                    <button disabled={stake > smartCoins} onClick={() => requestArena(() => startQuickMatch())}
                      className="flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-300 active:scale-95 transition-all disabled:opacity-40">
                      <Zap size={12} /> Quick Match
                    </button>
                  </div>
                  {roster.length === 0 ? (
                    <p className="text-slate-500 text-xs font-medium text-center py-2">
                      {rosterLoading ? 'Looking for eligible scholars…' : 'No eligible scholars waiting right now. Pick a tutor above.'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {roster.map(p => (
                        <div key={p.userId} className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center font-black text-xs text-emerald-300">{String(p.name || 'S')[0]}</div>
                            <div className="min-w-0">
                              <span className="font-bold text-sm block truncate">{p.name || 'Scholar'}</span>
                              <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest">wagers {p.stake} SC</span>
                            </div>
                          </div>
                          <button disabled={stake > smartCoins} onClick={() => requestArena(() => challengeScholar(p))}
                            className="rounded-full bg-emerald-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white active:scale-95 transition-all disabled:opacity-40">
                            Challenge
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {confirmHighWager && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="rounded-2xl p-6 bg-red-500/10 border border-red-500/30 space-y-4"
                >
                  <div className="flex items-start gap-3">
                    <AlertCircle size={20} className="text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <h3 className="font-black text-red-300">High-stakes duel</h3>
                      <p className="text-sm text-white/60 font-medium">
                        You are about to wager <span className="text-amber-400 font-black">{pendingArenaRef.current?.stake ?? stake} SC</span>. This is real — if you lose, it comes out of your balance.
                      </p>
                      <p className="text-[11px] text-white/40 font-medium mt-1">
                        Both stakes are held in escrow before the clock opens. Quit or drop for 45s and you forfeit yours.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { pendingArenaRef.current = null; setConfirmHighWager(false); }}
                      className="py-3.5 rounded-2xl bg-white/10 font-black uppercase tracking-widest text-xs hover:bg-white/15 active:scale-95 transition-all">Cancel</button>
                    <button onClick={() => { setConfirmHighWager(false); const p = pendingArenaRef.current; pendingArenaRef.current = null; if (p?.run) p.run(); else if (mode.id === 'duel') startQuickMatch(); else startBattle(); }}
                      className="py-3.5 rounded-2xl bg-red-600 font-black uppercase tracking-widest text-xs shadow-lg shadow-red-500/30 active:scale-95 transition-all">I Understand, Fight</button>
                  </div>
                </motion.div>
              )}
            </motion.div>
          )}

          {phase === "blitz-waiting" && (
            <motion.div key="blitz-waiting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center min-h-[45vh] gap-5 text-center">
              <div className="flex items-center gap-2 text-amber-400">
                <Zap size={16} fill="currentColor" />
                <span className="text-[10px] font-black uppercase tracking-[0.25em]">Blitz Duel · 40 NMCN · 90s</span>
              </div>
              <div className="flex items-center gap-3 text-white/70">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
                <span className="text-sm font-bold animate-pulse">Finding your opponent…</span>
              </div>
              <motion.div
                key={opponent}
                initial={{ scale: 1.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="text-2xl font-black flex items-center gap-2"
              >
                <User size={20} className="text-indigo-300" /> vs {opponent}
              </motion.div>
              <div className="flex items-center gap-2 text-slate-400 text-sm font-medium">
                <span className="text-amber-400 font-black">{stake} SC</span> wager
                {lobbyOnline != null && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/50">
                    {lobbyOnline} waiting
                  </span>
                )}
              </div>
              <p className="text-slate-500 text-xs font-medium max-w-xs">
                Both scholars get the same 40 NMCN questions and one shared 90-second clock. Both stakes are already held in escrow — cancel and they come straight back.
              </p>
              <button onClick={matchIdRef.current ? cancelArena : resetToBetting}
                className="mt-2 px-8 py-4 rounded-2xl bg-white/10 hover:bg-white/15 font-black uppercase tracking-widest text-xs flex items-center gap-2 active:scale-95 transition-all">
                <ChevronLeft size={14} /> Cancel {matchIdRef.current ? '& refund both' : ''}
              </button>
            </motion.div>
          )}

          {phase === "blitz-countdown" && (
            <motion.div key="blitz-countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center min-h-[45vh] gap-6 text-center">
              <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-sm">Blitz begins in</p>
              <motion.div key={countdown} initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}
                className="text-[120px] font-black text-white leading-none" style={{ textShadow: "0 0 60px rgba(139,92,246,0.8)" }}
              >{countdown}</motion.div>
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-sm">
                <User size={16} /> Matched against {opponent}
              </div>
              <p className="text-slate-500 text-sm font-medium">Both clocks start when the countdown hits zero.</p>
            </motion.div>
          )}

          {phase === "blitz-play" && blitzMatch && (
            <motion.div key="blitz-play" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-5">
              <div className="flex justify-between items-center bg-white/5 border border-white/10 p-4 rounded-2xl">
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <Zap className="text-amber-500 animate-pulse" size={18} fill="currentColor" />
                    <span className="text-xs font-black uppercase tracking-widest text-amber-500">BLITZ DUEL</span>
                  </div>
                  <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">
                    Q {Math.min(blitzIndex + 1, blitzMatch.questionCount)}/{blitzMatch.questionCount} · {stake} SC held in escrow
                  </span>
                </div>
                <div className={`font-black tabular-nums text-2xl ${blitzTimeLeft <= 10000 ? "text-red-400 animate-pulse" : "text-white"}`}>
                  {fmtBlitzTime(blitzTimeLeft)}
                </div>
              </div>

              {oppDown && (
                <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                  <AlertCircle size={16} className="text-amber-400 shrink-0 animate-pulse" />
                  <p className="text-xs font-bold text-amber-200 leading-snug">
                    {opponent} lost connection. They have {Math.round((blitzMatch.graceSeconds ?? 45))}s to come back — if they don't, they forfeit and your stake is refunded.
                  </p>
                </div>
              )}

              {/* One scorecard shape for humans and tutors alike. */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 mb-1">You</p>
                  <p className="text-3xl font-black tabular-nums text-emerald-300">{blitzScore}</p>
                  <p className="text-[10px] text-white/50 font-bold tabular-nums mt-1">
                    {blitzAnswered} seen · {blitzRight} right · {blitzWrongs} wrong · {blitzSkipped} skip
                  </p>
                  <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest mt-0.5">
                    {doubleUsed ? 'Double spent' : 'Double available'}{blitzStreak >= 2 ? ` · 🔥 ${blitzStreak}` : ""}
                  </p>
                </div>
                <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-4 text-center min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-1 truncate">{opponent}</p>
                  <p className="text-3xl font-black tabular-nums text-indigo-300">{oppScore}</p>
                  <p className="text-[10px] text-white/50 font-bold tabular-nums mt-1">
                    {oppAnswered} seen · {oppRight} right · {oppWrongs} wrong · {oppSkipped} skip
                  </p>
                  <p className="text-[9px] text-white/30 font-bold uppercase tracking-widest mt-0.5">
                    {oppDown ? 'Disconnected' : oppStreak >= 2 ? `🔥 ${oppStreak}` : 'Racing'}
                  </p>
                </div>
              </div>

              {blitzIndex >= blitzMatch.questionCount ? (
                <div className="text-center p-8 rounded-[2rem] bg-white/5 border border-white/10 space-y-2">
                  <Trophy size={28} className="mx-auto text-amber-400" />
                  <p className="font-black text-lg">All questions answered</p>
                  <p className="text-slate-400 text-sm font-medium">The clock decides the rest — your opponent is still racing.</p>
                </div>
              ) : (
                <>
                  <div className="text-center p-6 bg-gradient-to-br from-slate-900 to-slate-950 rounded-[2rem] border border-white/10 shadow-2xl">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                      Question {Math.min(blitzIndex + 1, blitzMatch.questionCount)} of {blitzMatch.questionCount}
                    </p>
                    <h2 className="text-2xl font-black leading-snug">{blitzQuestions[blitzIndex]?.question ?? "…"}</h2>
                  </div>

                  {/* Double sits with the options, not detached above them. It is
                      consumed by the very next submit and can never carry over. */}
                  {!doubleUsed && (
                    <button onClick={() => setDoubleArmed(armed => !armed)}
                      className={`w-full py-2.5 rounded-2xl border-2 transition-all font-black text-xs flex items-center justify-center gap-2 ${doubleArmed ? "bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.3)]" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}>
                      <Zap size={14} fill={doubleArmed ? "currentColor" : "none"} />
                      {doubleArmed ? "Double armed ×2 — tap to cancel" : "Double — one answer ×2 (once per duel)"}
                    </button>
                  )}

                  <div className="grid grid-cols-1 gap-3">
                    {(blitzQuestions[blitzIndex]?.options || []).map((opt, idx) => {
                      let btnState = 'bg-white/5 border-white/10 hover:bg-white/10';
                      if (userAnswerState) {
                        const isPickedOpt = lastOptionRef.current === opt;
                        if (isPickedOpt) btnState = 'bg-amber-500/25 border-amber-500 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]';
                        else btnState = 'bg-white/5 border-white/5 text-white/30 opacity-50';
                      }
                      return (
                        <button
                          key={idx}
                          disabled={userAnswerState !== null}
                          onClick={() => blitzPick(opt)}
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
                  {txState === 'pending' && (
                    <p className="text-center text-xs text-amber-400 font-bold animate-pulse">Grading…</p>
                  )}
                  <button onClick={() => setForfeitOpen(true)}
                    className="w-full p-3 rounded-2xl bg-red-500/5 border border-red-500/20 text-red-400/70 font-bold text-[10px] uppercase tracking-widest hover:bg-red-500/10 hover:text-red-300 active:scale-95 transition-all">
                    Forfeit — lose your {stake} SC stake
                  </button>

                  {forfeitOpen && (
                    <div className="rounded-2xl p-5 bg-red-500/10 border border-red-500/30 space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
                        <p className="text-sm text-white/70 font-medium leading-snug">
                          Forfeit now? Your <span className="text-red-300 font-black">{stake} SC</span> stake is lost and {opponent} is refunded theirs. This cannot be undone.
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

          {phase === "blitz-result" && blitzResult && (
            <motion.div key="blitz-result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
              {(() => {
                const r = blitzResultForMe();
                if (!r) return null;
                if (blitzResult.status === 'abandoned') {
                  const ABANDON_COPY = {
                    forfeit: ['You Forfeited', 'You left the duel, so your stake is gone and your opponent was refunded theirs.'],
                    grace_expired: ['Opponent Forfeited', `${opponent} dropped out and did not come back inside the reconnect window. Their stake is gone and yours was refunded.`],
                    cancel: ['Battle Voided', 'The duel was cancelled before the clock opened, so both stakes were refunded in full.'],
                    no_show: ['Opponent Never Arrived', `${opponent} never confirmed the wager, so both stakes were refunded in full.`],
                    both_away: ['Battle Voided', 'Both players lost connection, so both stakes were refunded in full.'],
                    v63_pre_migration_void: ['Battle Voided', 'This duel was voided by a system upgrade. Nothing was wagered.'],
                  };
                  const [title, copy] = ABANDON_COPY[blitzResult.reason] || ABANDON_COPY.v63_pre_migration_void;
                  return (
                    <div className="p-8 rounded-[2rem] text-center bg-white/5 border border-white/10 space-y-3">
                      <AlertCircle size={40} className="mx-auto text-amber-400" />
                      <h2 className="text-2xl font-black uppercase tracking-tight text-amber-300">{title}</h2>
                      <p className="text-white/60 font-medium text-sm leading-relaxed">{copy}</p>
                      {reviewList().length > 0 && (
                        <p className="text-white/40 text-xs font-medium">{reviewList().length} questions reviewed below.</p>
                      )}
                      <div className="grid grid-cols-2 gap-3 mt-4">
                        <button onClick={resetToBetting}
                          className="py-4 rounded-2xl bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all">Back</button>
                        <button onClick={resetToBetting}
                          className="py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">Fight Again</button>
                      </div>
                    </div>
                  );
                }
                const youWon = r.youWon && !r.draw;
                const cardTone = youWon
                  ? "bg-emerald-500/10 border border-emerald-500/30 shadow-[0_0_70px_-24px_rgba(16,185,129,0.75)] ring-1 ring-emerald-400/40"
                  : r.draw
                    ? "bg-amber-500/10 border border-amber-500/30"
                    : "bg-red-500/10 border border-red-500/30";
                return (
                  <>
                    <div className={`p-8 rounded-[2rem] text-center relative overflow-hidden ${cardTone}`}>
                      <div className="text-5xl mb-4">{youWon ? "🏆" : r.draw ? "🤝" : "💀"}</div>
                      <h2 className={`text-3xl font-black uppercase tracking-tight ${youWon ? "text-emerald-400" : r.draw ? "text-amber-300" : "text-red-400"}`}>
                        {youWon ? "Victory!" : r.draw ? "Draw!" : "Eliminated"}
                      </h2>
                      {youWon && (
                        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                          <Trophy size={12} /> Winner
                        </span>
                      )}
                      <p className="text-white/50 mt-2 font-medium">
                        {youWon
                          ? "Higher points on the 40-question board."
                          : r.draw
                            ? `Level on points — both stakes returned, nothing lost.`
                            : `${r.winner || "Your opponent"} took the pot.`}
                      </p>
                      <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-lg ${r.delta > 0 ? "bg-emerald-500/15 text-emerald-400" : r.delta < 0 ? "bg-red-500/15 text-red-400" : "bg-white/10 text-white/60"}`}>
                        {r.delta !== 0 ? `${r.delta > 0 ? "+" : ""}${r.delta} SC` : "0 SC"}
                      </div>
                    </div>

                    {/* Identical scorecard shape for a human and for a tutor. */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 mb-1">You</p>
                        <p className="text-3xl font-black tabular-nums text-emerald-300">{r.you.points}</p>
                        <p className="text-[10px] text-white/50 font-bold tabular-nums mt-1">
                          {r.you.answers} seen · {r.you.correct} right · {r.you.incorrect} wrong · {r.you.skipped} skip
                        </p>
                      </div>
                      <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-4 text-center min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-1 truncate">
                          {r.winner}{r.oppIsBot ? ' · tutor' : ''}
                        </p>
                        <p className="text-3xl font-black tabular-nums text-indigo-300">{r.opp.points}</p>
                        <p className="text-[10px] text-white/50 font-bold tabular-nums mt-1">
                          {r.opp.answers} seen · {r.opp.correct} right · {r.opp.incorrect} wrong · {r.opp.skipped} skip
                        </p>
                      </div>
                    </div>

                    {reviewList().length > 0 && (
                      <div className="p-5 rounded-[2rem] bg-white/5 border border-white/10">
                        <div className="flex items-center gap-2 mb-3">
                          <Brain size={14} className="text-indigo-300" />
                          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-indigo-300">Question review</span>
                        </div>
                        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                          {reviewList().map(rv => (
                            <div key={rv.index} className={`rounded-xl p-3 text-sm ${rv.skipped ? 'bg-white/[0.03]' : rv.isCorrect ? 'bg-emerald-500/5' : 'bg-red-500/5'}`}>
                              <p className="font-bold text-white/90 leading-snug">
                                Q{rv.index + 1}. {rv.question ?? '…'}
                              </p>
                              <div className="mt-1.5 space-y-1 text-xs">
                                <p className={rv.skipped ? 'text-white/40 font-bold' : rv.isCorrect ? 'text-emerald-300 font-bold' : 'text-red-300 font-bold'}>
                                  {rv.skipped ? 'Skipped · 0 pts' : rv.isCorrect ? `Correct · ${rv.points} pt${rv.points === 1 ? '' : 's'}${rv.multiplier === 2 ? ' (doubled)' : ''}` : `Incorrect · 0 pts${rv.multiplier === 2 ? ' (doubled, still 0)' : ''}`}
                                </p>
                                {rv.selected && !rv.isCorrect && (
                                  <p className="text-white/40 font-medium">Your answer: {rv.selected}</p>
                                )}
                                {rv.correctAnswer && !rv.isCorrect && !rv.skipped && (
                                  <p className="text-emerald-200 font-bold">Correct answer: {rv.correctAnswer}</p>
                                )}
                                {rv.explanation && (
                                  <p className="text-slate-300 font-medium leading-relaxed pt-1">{rv.explanation}</p>
                                )}
                                {!rv.explanation && rv.hint && (
                                  <p className="text-slate-400 italic font-medium pt-1">Hint: {rv.hint}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {missedList().length > 0 && (
                      <div className="p-5 rounded-[2rem] bg-white/5 border border-white/10">
                        <div className="flex items-center gap-2 mb-3">
                          <AlertCircle size={14} className="text-red-400" />
                          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-red-300">Missed questions · review</span>
                        </div>
                        <div className="space-y-2">
                          {missedList().map(m => (
                            <div key={m.index} className="rounded-xl bg-white/5 p-3 text-sm">
                              <p className="font-bold text-white/90">
                                Q{m.index + 1}. {blitzQuestions[m.index]?.question ?? "…"}
                              </p>
                              <p className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">
                                {m.delta < 0 ? `−${Math.abs(m.delta)} pts` : ""}{m.multiplier === 2 ? " · doubled" : ""}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                      <button onClick={resetToBetting}
                        className="py-5 rounded-[2rem] bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all hover:bg-white/15 flex items-center justify-center gap-2"><RefreshCw size={14} /> Rematch</button>
                      <button onClick={resetToLobby}
                        className="py-5 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">New Mode</button>
                    </div>
                  </>
                );
              })()}
            </motion.div>
          )}

          {phase === "countdown" && (
            <motion.div key="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center min-h-[45vh] gap-6 text-center">
              <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-sm">Battle begins in</p>
              <motion.div key={countdown} initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}
                className="text-[120px] font-black text-white leading-none" style={{ textShadow: "0 0 60px rgba(139,92,246,0.8)" }}
              >{countdown}</motion.div>
              <div className="flex items-center gap-2 text-amber-400">
                {finding === 'human'
                  ? (<><User size={16} /><span className="text-sm font-bold">Matched against {opponent}</span></>)
                  : finding === 'bot'
                    ? (<><Shield size={16} /><span className="text-sm font-bold">Tutor match vs {opponent}</span></>)
                    : (<><Shield size={16} /><span className="text-sm font-bold">Versus {opponent}</span></>)}
              </div>
              {finding === 'house' && (
                <p className="text-slate-500 text-sm font-medium animate-pulse">Hunting for a live scholar… falling back to The House.</p>
              )}
            </motion.div>
          )}

          {phase === "question" && currentQuestion && (
            <motion.div key="question" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-6">
              <div className="flex justify-between items-center bg-white/5 border border-white/10 p-4 rounded-2xl">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <Zap className="text-amber-500 animate-pulse" size={18} fill="currentColor" />
                    <span className="text-xs font-black uppercase tracking-widest text-amber-500">SUDDEN DEATH</span>
                  </div>
                  <span className="text-[10px] text-white/40 font-bold uppercase tracking-widest mt-1">vs {opponent} · {mode?.players} players · {stake} SC</span>
                </div>
                <div className="font-black tabular-nums text-xl text-white">{questionTimeLeft}s</div>
              </div>
              <div className="text-center p-6 bg-gradient-to-br from-slate-900 to-slate-950 rounded-[2rem] border border-white/10 shadow-2xl">
                <h2 className="text-2xl font-black leading-snug">{currentQuestion.question}</h2>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {currentQuestion.options.map((opt, idx) => {
                  let btnState = 'bg-white/5 border-white/10 hover:bg-white/10';
                  if (userAnswerState) {
                    const isPickedOpt = lastOptionRef.current === opt;
                    if (isPickedOpt) btnState = 'bg-amber-500/25 border-amber-500 text-amber-300 shadow-[0_0_15px_rgba(245,158,11,0.25)]';
                    else btnState = 'bg-white/5 border-white/5 text-white/30 opacity-50';
                  }
                  return (
                    <button
                      key={idx}
                      disabled={userAnswerState !== null}
                      onClick={() => handleAnswer(opt)}
                      className={`w-full p-5 rounded-2xl border transition-all text-left font-bold ${btnState}`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {txState === 'pending' && (
                <p className="text-center text-xs text-amber-400 font-bold animate-pulse">Settling Smart Coins…</p>
              )}
            </motion.div>
          )}

          {phase === "result" && result && (
            <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
              <div className={`p-8 rounded-[2rem] text-center relative overflow-hidden ${result.youWon && !result.draw ? "bg-emerald-500/10 border border-emerald-500/30 shadow-[0_0_70px_-24px_rgba(16,185,129,0.75)] ring-1 ring-emerald-400/40" : result.draw ? "bg-amber-500/10 border border-amber-500/30" : "bg-red-500/10 border border-red-500/30"}`}>
                <div className="text-5xl mb-4">{result.youWon && !result.draw ? "🏆" : result.draw ? "🤝" : "💀"}</div>
                <h2 className={`text-3xl font-black uppercase tracking-tight ${result.youWon && !result.draw ? "text-emerald-400" : result.draw ? "text-amber-300" : "text-red-400"}`}>
                  {result.youWon && !result.draw ? "Victory!" : result.draw ? "Draw!" : "Eliminated"}
                </h2>
                {result.youWon && !result.draw && (
                  <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-emerald-400/50 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">
                    <Trophy size={12} /> Winner
                  </span>
                )}
                <p className="text-white/50 mt-2 font-medium">
                  {result.youWon && !result.draw
                    ? "You dominated the hall."
                    : result.draw
                      ? "Nobody took the pot. Your wager is safe."
                      : `${result.winner} claimed the SC.`}
                </p>
                <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-lg animate-pulse ${result.delta > 0 ? "bg-emerald-500/15 text-emerald-400" : result.delta < 0 ? "bg-red-500/15 text-red-400" : "bg-white/10 text-white/60"}`}>
                  {result.delta !== 0 ? `${result.delta > 0 ? "+" : ""}${result.delta} SC` : "0 SC"}
                </div>
                {(result.outcome === 'win' || result.outcome === 'loss') && result.settled === false && (
                  <p className="mt-3 text-xs text-amber-400/90 font-bold">
                    Settlement couldn't be recorded — your Smart Coin balance was not changed. Please try again.
                  </p>
                )}
                {Array.isArray(result.achievements) && result.achievements.length > 0 && (
                  <div className="mt-5 rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-300">
                      Win + Achievement Unlocked
                    </p>
                    <div className="mt-3 space-y-2">
                      {result.achievements.map(a => (
                        <div
                          key={a.key || a.name}
                          className="flex items-center justify-center gap-2 rounded-xl border bg-white/5 px-3 py-2"
                          style={{ borderColor: `${a.accent}59` }}
                        >
                          <span className="text-lg" aria-hidden="true">{a.icon}</span>
                          <span className="text-sm font-black text-white">{a.name}</span>
                          <span
                            className="rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest"
                            style={{ color: a.accent, borderColor: `${a.accent}66`, background: `${a.accent}14` }}
                          >
                            {a.tierLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {Array.isArray(result.breakdown) && result.breakdown.length > 0 && (
                <div className="space-y-3">
                  {result.breakdown.map((p, i) => (
                    <div key={i} className={`flex items-center justify-between p-5 rounded-2xl border transition-all ${p.result === "win" ? "bg-emerald-500/10 border-emerald-400/50 ring-1 ring-emerald-400/30 shadow-[0_0_40px_-24px_rgba(16,185,129,0.9)]" : p.result === "draw" ? "bg-amber-500/5 border-amber-400/20" : "bg-white/5 border-white/5"}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${p.result === "win" ? "bg-emerald-500 text-white" : "bg-white/10 text-white/40"}`}>{String(p.name)[0]}</div>
                        <div>
                          <span className="font-bold block">{p.name}</span>
                          {p.result === "win" && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-emerald-300">
                              <Trophy size={10} /> Winner
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-white/40 font-bold uppercase tracking-widest mb-0.5">
                          {p.result === "win" ? "Won" : p.result === "draw" ? "Stalemate" : "Lost"}
                        </p>
                        <p className={`font-black text-lg ${p.delta > 0 ? "text-emerald-400" : p.delta < 0 ? "text-red-400" : "text-white/50"}`}>
                          {p.delta > 0 ? "+" : ""}{p.delta} SC
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <button onClick={resetToBetting}
                  className="py-5 rounded-[2rem] bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all hover:bg-white/15 flex items-center justify-center gap-2"><RefreshCw size={14} /> Rematch</button>
                <button onClick={resetToLobby}
                  className="py-5 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">New Mode</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Rumble;