import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { supabase } from "../utils/supabase";
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Zap, Star, ChevronLeft, ArrowRight, Users, AlertCircle, RefreshCw, Trophy, Award, Shield, User } from "../components/Icons";

const DUEL_MODES = [
  { id: "duel", title: "1v1 Duel", subtitle: "Two scholars enter. One emerges richer.", players: 2, color: "from-indigo-600 to-purple-700", glow: "shadow-indigo-500/40", border: "border-indigo-500/30", icon: "⚔️" },
  { id: "triple", title: "Triple Threat", subtitle: "Three-way war. Winner takes all.", players: 3, color: "from-amber-500 to-orange-600", glow: "shadow-amber-500/40", border: "border-amber-500/30", icon: "🔱" },
];
const SC_STAKES = [1, 2, 5, 10, 20];
const QUESTION_SECONDS = 20;
const WAIT_FOR_HUMAN_MS = 3000;

const XpHall = () => {
  const navigate = useNavigate();
  const { flashcards, smartCoins, earnSC, spendSC } = useAppContext();
  const [phase, setPhase] = useState("lobby");
  const [mode, setMode] = useState(null);
  const [stake, setStake] = useState(2);
  const [countdown, setCountdown] = useState(3);
  const [result, setResult] = useState(null);
  const [duelHistory, setDuelHistory] = useState([]);
  const [finding, setFinding] = useState(null); // 'house' | 'human' | null
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(QUESTION_SECONDS);
  const [userAnswerState, setUserAnswerState] = useState(null);
  const [opponent, setOpponent] = useState("The House");
  const [opponentId, setOpponentId] = useState(null);
  const [txState, setTxState] = useState(null); // null | 'pending' | 'done'
  const ownWaitingKeyRef = useRef(null); // id of my duel_waiting row (to clean up)

  const fetchHistory = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from('duels')
        .select('id, opponent, mode, stake, outcome, delta, created_at')
        .order('created_at', { ascending: false })
        .limit(20);
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

  const startBattle = useCallback(async () => {
    if (!mode) return;
    setCountdown(3);
    setFinding('house');
    // Declare intent to the realtime queue, then immediately look for a human.
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('duel_waiting')
          .upsert({ user_id: (await supabase.auth.getUser()).data.user?.id, mode: mode.id, stake }, { onConflict: 'user_id' })
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
        .neq('user_id', me)
        .order('created_at', { ascending: true })
        .limit(1);
      if (data && data[0]) opponent = data[0];
    } catch { /* ignore */ }
    if (opponent) {
      // Fetch opponent display name
      let name = "Rival Scholar";
      try {
        const { data: prof } = await supabase.from('profiles').select('full_name').eq('id', opponent.user_id).single();
        if (prof && prof.full_name) name = prof.full_name;
      } catch { /* ignore */ }
      await clearWaiting();
      setOpponent(name);
      setOpponentId(opponent.user_id);
      setFinding('human');
      startCountdownPhase();
      return;
    }
    // No waiting human — play The House after a short grace window so a challenger can jump in.
    setTimeout(() => {
      if (ownWaitingKeyRef.current) {
        // still alone
        setOpponent("The House");
        setOpponentId(null);
        startCountdownPhase();
      }
    }, WAIT_FOR_HUMAN_MS);
  }, [mode, stake]);

  const finishVsHouse = () => {
    setOpponent("The House");
    setOpponentId(null);
    startCountdownPhase();
  };

  const startCountdownPhase = () => {
    setPhase("countdown");
    setCountdown(3);
  };

  // Pre-game Countdown -> move to question
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      setCurrentQuestion(pickQuestion());
      setPhase("question");
      setQuestionTimeLeft(QUESTION_SECONDS);
      setUserAnswerState(null);
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown]);

  const shuffle = (arr) => [...arr].sort(() => 0.5 - Math.random());

  const pickQuestion = useCallback(() => {
    let hardCards = flashcards?.filter(c => {
      const d = String(c.difficulty || '').toLowerCase();
      return d === 'hard' || d === 'difficult' || d === 'expert' || d === 'extreme';
    }) || [];
    if (hardCards.length === 0) hardCards = flashcards || [];
    const randomCard = hardCards[Math.floor(Math.random() * hardCards.length)];
    if (!randomCard) return null;
    let options = [];
    const correct = randomCard.correctAnswer || randomCard.answer;
    if (Array.isArray(randomCard.options) && randomCard.options.length >= 2) {
      options = shuffle(randomCard.options);
    } else {
      const distractors = (flashcards || [])
        .filter(c => c.id !== randomCard.id && (c.answer || c.correctAnswer) !== correct)
        .slice(0, 3)
        .map(c => c.answer || c.correctAnswer);
      options = shuffle([correct, ...distractors]);
    }
    return { ...randomCard, question: randomCard.question, correctAnswer: correct, generatedOptions: options };
  }, [flashcards]);

  // Question Timer
  useEffect(() => {
    if (phase !== "question" || userAnswerState !== null) return;
    if (questionTimeLeft <= 0) {
      handleAnswer(null); // timeout = incorrect
      return;
    }
    const t = setTimeout(() => setQuestionTimeLeft(c => c - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, questionTimeLeft, userAnswerState]);

  const buildBreakdown = (won, players) => {
    const rows = [{ name: "You", score: won ? 10 : 0 }];
    for (let i = 1; i < players; i++) {
      rows.push({ name: opponent, score: won ? 0 : 9 });
    }
    const winnerName = won ? "You" : opponent;
    return rows.map(e => ({
      ...e,
      result: e.name === winnerName ? 'won' : 'lost',
      delta: e.name === winnerName ? stake * (players - 1) : -stake,
    }));
  };

  const handleAnswer = useCallback((option) => {
    if (userAnswerState !== null) return;
    const correct = option !== null && option === currentQuestion?.correctAnswer;
    setUserAnswerState(correct ? 'correct' : 'wrong');
    setTxState('pending');
    const players = mode?.players || 2;
    const won = correct;
    const outcome = won ? 'win' : 'loss';
    const delta = won ? stake * (players - 1) : -stake;

    setTimeout(async () => {
      try {
        if (won) {
          await earnSC(stake * players, 'duel_win');
        } else {
          await spendSC(stake, 'duel_loss');
        }
        if (supabase && opponentId) {
          await supabase.from('duels').insert({
            user_id: (await supabase.auth.getUser()).data.user?.id,
            opponent, opponent_id: opponentId, mode: mode.id, stake, outcome, delta,
          }).then(() => {});
        }
      } catch { /* ignore */ }
      setTxState('done');
      setResult({
        winner: won ? "You" : opponent,
        outcome,
        delta,
        players,
        breakdown: buildBreakdown(won, players),
      });
      setPhase("result");
      fetchHistory();
      clearWaiting();
    }, 900);
  }, [userAnswerState, currentQuestion, mode, stake, opponent, opponentId, earnSC, spendSC, fetchHistory]);

  const resetToLobby = () => {
    setPhase("lobby");
    setResult(null);
    setCountdown(3);
    setMode(null);
    setCurrentQuestion(null);
    setOpponent("The House");
    setOpponentId(null);
    setTxState(null);
    setFinding(null);
    clearWaiting();
  };

  const resetToBetting = () => {
    setPhase("betting");
    setResult(null);
    setCountdown(3);
    setCurrentQuestion(null);
    setTxState(null);
    setFinding(null);
    clearWaiting();
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
              </div>
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
              <button disabled={stake > smartCoins} onClick={() => startBattle()}
                className="w-full py-6 rounded-[2rem] bg-gradient-to-r from-indigo-600 to-purple-600 font-black uppercase tracking-[0.3em] text-sm shadow-2xl shadow-indigo-500/30 active:scale-95 transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center justify-center gap-3"
              >
                <Zap size={18} fill="currentColor" /> Enter the Arena
              </button>
            </motion.div>
          )}

          {phase === "countdown" && (
            <motion.div key="countdown" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center min-h-[40vh] gap-6 text-center">
              <p className="text-slate-400 font-black uppercase tracking-[0.3em] text-sm">Battle begins in</p>
              <motion.div key={countdown} initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 }}
                className="text-[120px] font-black text-white leading-none" style={{ textShadow: "0 0 60px rgba(139,92,246,0.8)" }}
              >{countdown}</motion.div>
              <div className="flex items-center gap-2 text-amber-400">
                {finding === 'human'
                  ? (<><User size={16} /><span className="text-sm font-bold">Matched against {opponent}</span></>)
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
                   {currentQuestion.generatedOptions.map((opt, idx) => {
                      let btnState = 'bg-white/5 border-white/10 hover:bg-white/10';
                      if (userAnswerState) {
                         const isCorrectOpt = opt === currentQuestion.correctAnswer;
                         if (isCorrectOpt) btnState = 'bg-emerald-500/20 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
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
              <div className={`p-8 rounded-[2rem] text-center ${result.winner === "You" ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-red-500/10 border border-red-500/30"}`}>
                <div className="text-5xl mb-4">{result.winner === "You" ? "🏆" : "💀"}</div>
                <h2 className={`text-3xl font-black uppercase tracking-tight ${result.winner === "You" ? "text-emerald-400" : "text-red-400"}`}>
                  {result.winner === "You" ? "Victory!" : "Eliminated"}
                </h2>
                <p className="text-white/50 mt-2 font-medium">{result.winner === "You" ? "You dominated the hall." : `${result.winner} claimed the SC.`}</p>
                <div className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-2xl font-black text-lg ${result.delta >= 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"}`}>
                  {result.delta >= 0 ? '+' : ''}{result.delta} SC
                </div>
              </div>
              <div className="space-y-3">
                {result.breakdown.map((p, i) => (
                  <div key={i} className={`flex items-center justify-between p-5 rounded-2xl border ${p.result === "won" ? "bg-emerald-500/10 border-emerald-500/20" : "bg-white/5 border-white/5"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${p.result === "won" ? "bg-emerald-500 text-white" : "bg-white/10 text-white/40"}`}>{p.name[0]}</div>
                      <span className="font-bold">{p.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-white/40 font-bold uppercase tracking-widest mb-0.5">Score: {p.score}/10</p>
                      <p className={`font-black text-lg ${p.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>{p.delta > 0 ? "+" : ""}{p.delta} SC</p>
                    </div>
                  </div>
                ))}
              </div>
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
