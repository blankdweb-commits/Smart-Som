import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { supabase } from "../utils/supabase";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Zap, Star, ChevronLeft, ArrowRight, Users, AlertCircle, RefreshCw, Trophy, Award, Shield, User, SkipForward } from "../components/Icons";
import { useMatchRealtime } from "../hooks/useMatchRealtime";

const DUEL_MODES = [
  { id: "duel", title: "1v1 Duel", subtitle: "Live lobby · 40 NMCN questions · 90 seconds", players: 2, color: "from-indigo-600 to-purple-700", glow: "shadow-indigo-500/40", border: "border-indigo-500/30", icon: "⚔️" },
  { id: "triple", title: "Triple Threat", subtitle: "Three-way war. Winner takes all.", players: 3, color: "from-amber-500 to-orange-600", glow: "shadow-amber-500/40", border: "border-amber-500/30", icon: "🔱" },
];
const SC_STAKES = [1, 2, 5, 10, 20];
const QUESTION_SECONDS = 20;
const WAIT_FOR_HUMAN_MS = 3000;
// ---- Tutor bots (non-blitz 1v1, migration v60) ----
// The server grades the tutor from its skill profile at settlement, so these
// keys are the ONLY thing the client sends (never a score/answer). Blitz stays
// human-only; bots are a non-blitz sudden-death opponent.
const BOT_OPPONENTS = [
  { key: 'house', name: 'The House', tier: 'Rookie', accent: 'from-slate-600 to-slate-800', icon: '🏛️', blurb: 'The classic. Plays fair — a warm-up duel.' },
  { key: 'zainab', name: 'Nurse Zainab', tier: 'Intermediate', accent: 'from-emerald-600 to-teal-700', icon: '🩺', blurb: 'Steady hands, sharp recall. A real drill.' },
  { key: 'apollo', name: 'Prof. Apollo', tier: 'Expert', accent: 'from-rose-600 to-red-700', icon: '🎓', blurb: 'Relentless. Only the sharp survive.' },
];
const ROSTER_POLL_MS = 4000;
// ---- Blitz (1v1 Duel Lobby, migration v58) ----
const BLITZ_DURATION_MS = 90 * 1000; // 90s shared wall-clock
const BLITZ_QUESTION_COUNT = 40;
const BLITZ_POLL_MS = 1600;
const ACTIVE_BLITZ_KEY = "apex_active_blitz";

const XpHall = () => {
  const navigate = useNavigate();
  const { smartCoins, createCompetitiveMatch, getCompetitiveMatch, submitCompetitiveAnswer, completeCompetitiveMatch, createBlitzMatch, startCompetitiveMatch, syncAchievements, fetchDuelRoster } = useAppContext();
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
  const [blitzIndex, setBlitzIndex] = useState(0);
  const [blitzScore, setBlitzScore] = useState(0);
  const [blitzWrongs, setBlitzWrongs] = useState(0);
  const [blitzAnswered, setBlitzAnswered] = useState(0);
  const [blitzStreak, setBlitzStreak] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [oppWrongs, setOppWrongs] = useState(0);
  const [oppAnswered, setOppAnswered] = useState(0);
  const [oppStreak, setOppStreak] = useState(0);
  const [blitzAnswers, setBlitzAnswers] = useState([]); // my results per answered index {index, correct, multiplier, delta}
  const [doubleArmed, setDoubleArmed] = useState(false);
  const [doubleUsed, setDoubleUsed] = useState(false);
  const [blitzTimeLeft, setBlitzTimeLeft] = useState(BLITZ_DURATION_MS);
  const [blitzResult, setBlitzResult] = useState(null);
  const [lobbyOnline, setLobbyOnline] = useState(null); // scholars currently waiting
  const settleDoneRef = useRef(false);
  const blitzOppIdRef = useRef(null);

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

  const displayNameOf = useCallback(async (userId) => {
    let name = "Rival Scholar";
    try {
      const { data: prof } = await supabase.from('community_profiles').select('display_name').eq('id', userId).single();
      if (prof && prof.display_name) name = prof.display_name;
    } catch { /* ignore */ }
    return name;
  }, []);

  // ============================================================
  // BLITZ — the shared 90s/40-Q lobby duel (1v1 only)
  // ============================================================

  const startBlitz = useCallback(async () => {
    if (!mode || !meId) return;
    if (stake > smartCoins) return;
    // Join the format-aware waiting queue.
    try {
      const { data, error } = await supabase
        .from('duel_waiting')
        .upsert({ user_id: meId, mode: mode.id, stake, format: 'blitz' }, { onConflict: 'user_id' })
        .select('id');
      if (!error && data && data[0]) ownWaitingKeyRef.current = data[0].id;
    } catch { /* ignore */ }
    setLobbyOnline(null);
    setOpponent("Rival Scholar");
    setPhase("blitz-waiting");
  }, [mode, stake, meId, smartCoins]);

  const matchedBy = useCallback(async (byId) => {
    const byName = await displayNameOf(byId);
    setOpponent(byName);
    blitzOppIdRef.current = byId;
    await clearWaiting();
    let created = null;
    try {
      created = await createBlitzMatch({ stake, opponentId: byId });
    } catch { /* ignore */ }
    if (!created || !created.ok || !created.questions?.length) {
      // Could not confirm the shared match — go back to the queue.
      setPhase("blitz-waiting");
      return;
    }
    blitzMatchRefCurrent(created);
    setPhase("blitz-countdown");
    setCountdown(3);
  }, [stake, displayNameOf, createBlitzMatch]);

  const matchedOpponent = useCallback(async (foundRow) => {
    const name = await displayNameOf(foundRow.user_id);
    setOpponent(name);
    blitzOppIdRef.current = foundRow.user_id;
    await clearWaiting();
    // Broadcast to the lobby so the found scholar jumps into the battle too.
    try { sendLobby({ type: 'matched', byId: meId }); } catch { /* ignore */ }
    let created = null;
    try {
      created = await createBlitzMatch({ stake, opponentId: foundRow.user_id });
    } catch { /* ignore */ }
    if (!created || !created.ok || !created.questions?.length) {
      setPhase("blitz-waiting");
      return;
    }
    blitzMatchRefCurrent(created);
    setPhase("blitz-countdown");
    setCountdown(3);
  }, [stake, meId, displayNameOf, createBlitzMatch]);

  const blitzMatchRefCurrent = (created) => {
    matchIdRef.current = created.matchId;
    setBlitzMatch({ matchId: created.matchId, questions: created.questions, questionCount: created.questionCount || created.questions.length, startsAt: null, endsAt: null });
    setBlitzQuestions(created.questions);
    setBlitzIndex(0);
    setBlitzScore(0);
    setBlitzWrongs(0);
    setBlitzAnswered(0);
    setBlitzStreak(0);
    setOppScore(0);
    setOppWrongs(0);
    setOppAnswered(0);
    setOppStreak(0);
    setBlitzAnswers([]);
    setDoubleArmed(false);
    setDoubleUsed(false);
    setBlitzResult(null);
    setBlitzTimeLeft(BLITZ_DURATION_MS);
    settleDoneRef.current = false;
  };

  const [blitzQuestions, setBlitzQuestions] = useState([]);

  // Lobby channel: presence gives the queue transparency count + 'matched'
  // broadcasts let the two matched scholars both enter the same battle.
  const { sendState: sendLobby, online: lobbyOnlineMembers } = useMatchRealtime({
    topic: 'match-lobby:duel:blitz',
    enabled: !!meId && (phase === 'blitz-waiting' || phase === 'blitz-countdown'),
    sessionId: meId,
    track: { waiting: true, stake },
    onEvent: (type, payload) => {
      if (type === 'matched' && payload && payload.byId && payload.byId !== meId) {
        matchedBy(payload.byId);
      }
    },
    onReconcile: () => {},
  });
  useEffect(() => { setLobbyOnline(lobbyOnlineMembers); }, [lobbyOnlineMembers]);

  // Match channel: mirror my score/verdict to my opponent (notification only).
  const { sendState: sendMatch } = useMatchRealtime({
    topic: blitzMatch ? `match:${blitzMatch.matchId}` : null,
    enabled: !!blitzMatch && !!meId && (phase === 'blitz-countdown' || phase === 'blitz-play'),
    sessionId: meId,
    track: { inMatch: true },
    onEvent: (type, payload) => {
      if (!payload || !payload.id || payload.id === meId) return;
      if (type === 'answer') {
        setOppScore((typeof payload.score === 'number') ? payload.score : 0);
        setOppWrongs((typeof payload.wrongs === 'number') ? payload.wrongs : 0);
        setOppAnswered((typeof payload.answered === 'number') ? payload.answered : 0);
        if (typeof payload.delta === 'number' && payload.delta > 0) setOppStreak((s) => s + 1);
        if (typeof payload.delta === 'number' && payload.delta < 0) setOppStreak(0);
      } else if (type === 'end') {
        if (phaseRef.current === 'blitz-play') settleBlitz();
      }
    },
    onReconcile: () => {},
  });

  // Waiting-loop: keep me findable, look for a waiting human on the SAME
  // mode + stake + format, and re-queue after each missed scan.
  useEffect(() => {
    if (phase !== "blitz-waiting" || !meId) return;
    let stopped = false;
    const scan = async () => {
      // Re-assert my queue row each scan (fresh created_at stamp).
      try {
        const { data, error } = await supabase
          .from('duel_waiting')
          .upsert({ user_id: meId, mode: 'duel', stake, format: 'blitz' }, { onConflict: 'user_id' })
          .select('id');
        if (!error && data && data[0]) ownWaitingKeyRef.current = data[0].id;
      } catch { /* ignore */ }
      if (stopped) return;
      let human = null;
      try {
        const { data } = await supabase
          .from('duel_waiting')
          .select('user_id, created_at, id')
          .eq('mode', 'duel')
          .eq('stake', stake)
          .eq('format', 'blitz')
          .neq('user_id', meId)
          .order('created_at', { ascending: true })
          .limit(1);
        if (data && data[0]) human = data[0];
      } catch { /* ignore */ }
      if (!stopped && human) matchedOpponent(human);
    };
    scan();
    const iv = setInterval(scan, BLITZ_POLL_MS);
    return () => { stopped = true; clearInterval(iv); clearWaiting(); };
  }, [phase, stake, meId, matchedOpponent]);

  // Blitz pre-battle countdown -> open the 90s window.
  useEffect(() => {
    if (phase !== "blitz-countdown") return;
    if (countdown <= 0) {
      startTheBlitz();
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, countdown]);

  const startTheBlitz = useCallback(async () => {
    if (!blitzMatch) return;
    let res = null;
    try {
      res = await startCompetitiveMatch(blitzMatch.matchId);
    } catch { /* ignore */ }
    if (!res || !res.ok) {
      // Opponent may have already started it — refetch authoritative state.
      try {
        const fetched = await getCompetitiveMatch(blitzMatch.matchId);
        if (fetched && fetched.ok && fetched.startsAt) {
          res = { ok: true, replay: true, startsAt: fetched.startsAt, endsAt: fetched.endsAt };
        }
      } catch { /* ignore */ }
    }
    if (!res || !res.ok || !res.startsAt || !res.endsAt) {
      setPhase("blitz-waiting");
      return;
    }
    const ends = Date.parse(res.endsAt);
    setBlitzMatch((m) => ({ ...m, startsAt: res.startsAt, endsAt: res.endsAt }));
    setBlitzTimeLeft(Math.max(0, ends - Date.now()));
    setPhase("blitz-play");
    try {
      sessionStorage.setItem(ACTIVE_BLITZ_KEY, JSON.stringify({
        matchId: blitzMatch.matchId,
        stakes: stake,
        opponent: opponent,
        opponentId: blitzOppIdRef.current,
      }));
    } catch { /* ignore */ }
  }, [blitzMatch, stake, opponent, startCompetitiveMatch, getCompetitiveMatch]);

  // 90s shared wall-clock ticking.
  useEffect(() => {
    if (phase !== "blitz-play" || !blitzMatch || !blitzMatch.endsAt) return;
    const ends = Date.parse(blitzMatch.endsAt);
    const tick = () => {
      const remain = Math.max(0, ends - Date.now());
      setBlitzTimeLeft(remain);
      if (remain <= 0) settleBlitz();
    };
    tick();
    const iv = setInterval(tick, 250);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, blitzMatch]);

  const settleBlitz = useCallback(async () => {
    if (settleDoneRef.current) return;
    if (!blitzMatch) return;
    settleDoneRef.current = true;
    try {
      const res = await completeCompetitiveMatch(blitzMatch.matchId);
      if (res && res.ok) {
        setBlitzResult(res);
        setPhase("blitz-result");
        try { sessionStorage.removeItem(ACTIVE_BLITZ_KEY); } catch { /* ignore */ }
        try { sendMatch({ type: 'end', id: meId }); } catch { /* ignore */ }
        fetchHistory();
        clearWaiting();
      } else if (res && res.error === 'BLITZ_NOT_ENDED' && res.remainingMs != null) {
        setBlitzTimeLeft(Number(res.remainingMs) || 0);
        settleDoneRef.current = false;
      } else {
        // Failed to settle (server could not agree) — let the screen hold.
        settleDoneRef.current = false;
      }
    } catch (err) {
      console.warn('Blitz settle failed:', err?.message);
      settleDoneRef.current = false;
    }
  }, [blitzMatch, meId, completeCompetitiveMatch, fetchHistory, sendMatch]);

  // Reconnect resume: if I left mid-blitz, re-join the SAME battle (never
  // reset). A running match re-syncs my mirror from my stored answers; a
  // settled match fetches its verdict.
  useEffect(() => {
    let live = true;
    const resume = async () => {
      let saved = null;
      try { saved = JSON.parse(sessionStorage.getItem(ACTIVE_BLITZ_KEY) || 'null'); } catch { /* ignore */ }
      if (!saved || !saved.matchId || !meId) return;
      try {
        const data = await getCompetitiveMatch(saved.matchId);
        if (!live || !data || !data.ok) return;
        if (data.status === 'active' && data.format === 'blitz' && data.startsAt) {
          const ends = Date.parse(data.endsAt);
          if (ends > Date.now() && !phaseRef.current.includes('blitz')) {
            matchIdRef.current = data.matchId;
            blitzOppIdRef.current = saved.opponentId || blitzOppIdRef.current;
            setOpponent(saved.opponent || "Rival Scholar");
            // Rebuild my running mirror from MY OWN stored answers (resume).
            let score = 0, wrongs = 0, answered = 0;
            const mine = Array.isArray(data.myAnswers) ? data.myAnswers : [];
            for (const a of mine) {
              if (a.selected == null) continue;
              const mult = a.multiplier === 2 ? 2 : 1;
              score += a.isCorrect ? mult : -mult;
              if (!a.isCorrect) wrongs += 1;
              answered += 1;
            }
            const idxSet = new Set(mine.map(a => a.index));
            let nextIndex = 0;
            while (idxSet.has(nextIndex)) nextIndex += 1;
            setBlitzQuestions(data.questions || []);
            setBlitzScore(score);
            setBlitzWrongs(wrongs);
            setBlitzAnswered(answered);
            setBlitzIndex(nextIndex);
            setBlitzMatch({ matchId: data.matchId, questions: data.questions || [], questionCount: data.questionCount || (data.questions || []).length, startsAt: data.startsAt, endsAt: data.endsAt });
            setBlitzTimeLeft(Math.max(0, ends - Date.now()));
            setPhase("blitz-play");
          } else if ((data.status === 'completed' || data.status === 'abandoned') && !phaseRef.current.includes('blitz')) {
            // A settled battle I never witnessed — fetch the verdict.
            const res = await completeCompetitiveMatch(data.matchId);
            if (live && res && res.ok) {
              setBlitzResult(res);
              setPhase("blitz-result");
              try { sessionStorage.removeItem(ACTIVE_BLITZ_KEY); } catch { /* ignore */ }
              fetchHistory();
            }
          }
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
    const isSkip = option === null;
    setUserAnswerState(isSkip ? 'timeout' : 'answered');
    lastOptionRef.current = option ?? null;
    setTxState('pending');
    let correct = false;
    let multiplier = 1;
    let replay = false;
    let dblApplied = false;
    try {
      const res = await submitCompetitiveAnswer({
        matchId: blitzMatch.matchId,
        questionIndex: blitzIndex,
        selected: option,
        double: doubleArmed,
      });
      if (res) {
        correct = !!res.isCorrect;
        multiplier = res.multiplier === 2 ? 2 : 1;
        replay = !!res.replay;
        dblApplied = doubleArmed && multiplier === 2;
      }
    } catch (err) {
      console.warn('Blitz answer submit failed:', err?.message);
      setUserAnswerState(null);
      setTxState(null);
      return;
    }
    const delta = isSkip ? 0 : (correct ? multiplier : -multiplier);
    const newScore = blitzScore + delta;
    const newWrongs = (!isSkip && !correct) ? blitzWrongs + 1 : blitzWrongs;
    const newAnswered = isSkip ? blitzAnswered : blitzAnswered + 1;
    setBlitzScore(newScore);
    setBlitzWrongs(newWrongs);
    setBlitzAnswered(newAnswered);
    if (!isSkip) {
      if (correct) setBlitzStreak((s) => s + 1);
      else setBlitzStreak(0);
    }
    if (dblApplied) { setDoubleUsed(true); setDoubleArmed(false); }
    setBlitzAnswers((prev) => [...prev, { index: blitzIndex, correct: (isSkip ? null : correct), multiplier, delta }]);
    setTxState('done');
    try {
      sendMatch({ type: 'answer', id: meId, delta, score: newScore, wrongs: newWrongs, answered: newAnswered });
    } catch { /* ignore */ }
    // Show the graded outcome briefly, then advance to the next question.
    setTimeout(() => {
      setUserAnswerState(null);
      setTxState(null);
      setBlitzIndex((i) => i + 1);
    }, replay ? 150 : 450);
  }, [blitzMatch, blitzIndex, blitzScore, blitzWrongs, blitzAnswered, doubleArmed, meId, userAnswerState, blitzTimeLeft, submitCompetitiveAnswer, sendMatch]);

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
    await startCountdownPhaseWithBatch("The House", null, mode?.id === 'duel' ? 'house' : null);
  };

  // Play a specific TUTOR BOT (non-blitz 1v1). The server grades the tutor from
  // its skill profile at settlement — the client only sends the bot key.
  const startVsBot = useCallback(async (botKey, botName) => {
    if (!meId || stake > smartCoins) return;
    await clearWaiting();
    setOpponent(botName);
    setFinding('bot');
    blitzOppIdRef.current = null;
    await startCountdownPhaseWithBatch(botName, null, botKey);
  }, [meId, stake, smartCoins]);

  // Challenge a specific live scholar from the eligible roster.
  const challengeScholar = useCallback(async (scholar) => {
    if (!meId || !scholar?.userId || stake > smartCoins) return;
    await clearWaiting();
    const name = scholar.name || 'Rival Scholar';
    setOpponent(name);
    setFinding('human');
    blitzOppIdRef.current = null;
    await startCountdownPhaseWithBatch(name, scholar.userId, null);
  }, [meId, stake, smartCoins]);

  // Classic non-blitz 1v1 matchmaking (sudden-death, human-first, tutor fallback).
  const startDuelSearch = useCallback(async () => {
    if (!meId || stake > smartCoins) return;
    await startBattle();
  }, [meId, stake, smartCoins, startBattle]);

  // Route every real-stakes entry (blitz / battle / tutor / scholar) through the
  // same high-wager confirmation. >=10 SC defers the action behind the modal.
  const requestArena = useCallback((action) => {
    if (stake >= 10) {
      pendingArenaRef.current = action;
      setConfirmHighWager(true);
      return;
    }
    action();
  }, [stake]);

  // Create the battle with the SERVER (migration v38): the server picks the NMCN
  // question sequence — no client question picking, no client-declared winner —
  // and returns the SAME match for both matched humans (DB-side dedupe). When
  // `bot` is set (v60) the server also grades the tutor at settlement.
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
        players = await fetchDuelRoster({ mode: 'duel', stake, format: 'sudden_death' });
      } catch { /* ignore */ }
      if (!stopped) {
        setRoster(Array.isArray(players) ? players : []);
        setRosterLoading(false);
      }
    };
    load();
    const iv = setInterval(load, ROSTER_POLL_MS);
    return () => { stopped = true; clearInterval(iv); };
  }, [phase, mode, stake, meId, smartCoins, fetchDuelRoster]);

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
    clearWaiting();
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
    blitzOppIdRef.current = null;
    setUserAnswerState(null);
    clearWaiting();
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
    blitzOppIdRef.current = null;
    setUserAnswerState(null);
    clearWaiting();
  };

  const fmtBlitzTime = (ms) => {
    const s = Math.ceil((ms || 0) / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, "0")}`;
  };

  const blitzResultForMe = () => {
    if (!blitzResult) return null;
    const bd = Array.isArray(blitzResult.breakdown) ? blitzResult.breakdown : [];
    const me = bd.find((p) => p.playerId === meId);
    const opp = bd.find((p) => p.playerId !== meId) || bd[0];
    return {
      youWon: !!blitzResult.youWon,
      draw: !!blitzResult.draw,
      winner: blitzResult.winner,
      youScore: me ? Number(me.score) || 0 : (blitzResult.scores && blitzResult.scores[meId] != null ? Number(blitzResult.scores[meId]) : blitzScore),
      oppScore: opp ? Number(opp.score) || 0 : (blitzResult.scores && blitzResult.scores[blitzOppIdRef.current] != null ? Number(blitzResult.scores[blitzOppIdRef.current]) : oppScore),
      youWrongs: me ? Number(me.wrongs) || 0 : blitzWrongs,
      oppWrongs: opp ? Number(opp.wrongs) || 0 : oppWrongs,
      youAnswered: me ? Number(me.answered) || 0 : blitzAnswered,
      oppAnswered: opp ? Number(opp.answered) || 0 : oppAnswered,
      delta: blitzResult.delta,
      settled: !!blitzResult.settled,
      outcomeIndex: me ? me.index : null,
    };
  };

  const missedList = () => {
    const missed = blitzAnswers.filter((a) => a.delta < 0 && a.index != null);
    return missed;
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
              <button disabled={stake > smartCoins} onClick={() => requestArena(() => { if (mode.id === 'duel') startBlitz(); else startBattle(); })}
                className="w-full py-6 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-[0.3em] text-sm shadow-2xl shadow-indigo-500/30 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-3"
              >
                <Zap size={18} fill="currentColor" /> {mode.id === 'duel' ? 'Enter the Arena · Blitz' : 'Enter the Arena'}
              </button>
              )}

              {mode.id === "duel" && smartCoins > 0 && (
                <div className="space-y-4 pt-2">
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-indigo-300" />
                    <p className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">Challenge a Tutor — non-blitz 1v1</p>
                  </div>
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
                    <button disabled={stake > smartCoins} onClick={() => requestArena(() => startDuelSearch())}
                      className="flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-300 active:scale-95 transition-all disabled:opacity-40">
                      <Zap size={12} /> Find any scholar
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
                        You are about to wager <span className="text-amber-400 font-black">{stake} SC</span>. This is real — if you lose, it comes out of your balance.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { pendingArenaRef.current = null; setConfirmHighWager(false); }}
                      className="py-3.5 rounded-2xl bg-white/10 font-black uppercase tracking-widest text-xs hover:bg-white/15 active:scale-95 transition-all">Cancel</button>
                    <button onClick={() => { setConfirmHighWager(false); const a = pendingArenaRef.current; pendingArenaRef.current = null; if (a) a(); else if (mode.id === 'duel') startBlitz(); else startBattle(); }}
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
                Both scholars get the same 40 NMCN questions. The 90-second clock starts together. Winner takes the pot.
              </p>
              <button onClick={resetToBetting}
                className="mt-2 px-8 py-4 rounded-2xl bg-white/10 hover:bg-white/15 font-black uppercase tracking-widest text-xs flex items-center gap-2 active:scale-95 transition-all">
                <ChevronLeft size={14} /> Cancel
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
                    Q {Math.min(blitzIndex + 1, blitzMatch.questionCount)}/{blitzMatch.questionCount} · {stake} SC
                  </span>
                </div>
                <div className={`font-black tabular-nums text-2xl ${blitzTimeLeft <= 10000 ? "text-red-400 animate-pulse" : "text-white"}`}>
                  {fmtBlitzTime(blitzTimeLeft)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
                  <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 mb-1">You</p>
                  <p className="text-3xl font-black tabular-nums text-emerald-300">{blitzScore}</p>
                  <p className="text-[10px] text-white/40 font-bold tabular-nums mt-1">{blitzAnswered} answered · {blitzWrongs} wrong{blitzStreak >= 2 ? ` · 🔥 ${blitzStreak}` : ""}</p>
                </div>
                <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-4 text-center min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-1 truncate">{opponent}</p>
                  <p className="text-3xl font-black tabular-nums text-indigo-300">{oppScore}</p>
                  <p className="text-[10px] text-white/40 font-bold tabular-nums mt-1">{oppAnswered} answered · {oppWrongs} wrong{oppStreak >= 2 ? ` · 🔥 ${oppStreak}` : ""}</p>
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

                  {!doubleUsed && (
                    <button onClick={() => setDoubleArmed(armed => !armed)}
                      className={`w-full p-4 rounded-2xl border-2 transition-all font-black text-sm flex items-center justify-center gap-2 ${doubleArmed ? "bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_20px_rgba(245,158,11,0.3)]" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}>
                      <Zap size={16} fill={doubleArmed ? "currentColor" : "none"} />
                      {doubleArmed ? "Double armed — your next answer counts ×2 (tap to disarm)" : "??? Double — one answer ×2 (once per duel)"}
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
                  return (
                    <div className="p-8 rounded-[2rem] text-center bg-white/5 border border-white/10 space-y-3">
                      <AlertCircle size={40} className="mx-auto text-amber-400" />
                      <h2 className="text-2xl font-black uppercase tracking-tight text-amber-300">Battle Voided</h2>
                      <p className="text-white/60 font-medium text-sm">The duel never began, so nothing was wagered. Better luck next time.</p>
                      <button onClick={resetToBetting}
                        className="mt-3 w-full py-5 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-widest text-xs shadow-xl shadow-indigo-500/20 active:scale-95 transition-all">Fight Again</button>
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
                          ? "You dominated the 40-question board."
                          : r.draw
                            ? "Even Stevenses — nobody took the pot. Your wager is safe."
                            : `${r.winner || "Your opponent"} claimed the SC.`}
                      </p>
                      <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-lg ${r.delta > 0 ? "bg-emerald-500/15 text-emerald-400" : r.delta < 0 ? "bg-red-500/15 text-red-400" : "bg-white/10 text-white/60"}`}>
                        {r.delta !== 0 ? `${r.delta > 0 ? "+" : ""}${r.delta} SC` : "0 SC"}
                      </div>
                      {r.settled === false && (
                        <p className="mt-3 text-xs text-amber-400/90 font-bold">
                          Settlement couldn't be recorded — your Smart Coin balance was not changed.
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-500/20 p-4 text-center">
                        <p className="text-[10px] font-black uppercase tracking-widest text-emerald-300 mb-1">You</p>
                        <p className="text-3xl font-black tabular-nums text-emerald-300">{r.youScore}</p>
                        <p className="text-[10px] text-white/40 font-bold tabular-nums mt-1">{r.youAnswered} answered · {r.youWrongs} wrong</p>
                      </div>
                      <div className="rounded-2xl bg-indigo-500/10 border border-indigo-500/20 p-4 text-center min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-300 mb-1 truncate">{opponent}</p>
                        <p className="text-3xl font-black tabular-nums text-indigo-300">{r.oppScore}</p>
                        <p className="text-[10px] text-white/40 font-bold tabular-nums mt-1">{r.oppAnswered} answered · {r.oppWrongs} wrong</p>
                      </div>
                    </div>

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

export default XpHall;