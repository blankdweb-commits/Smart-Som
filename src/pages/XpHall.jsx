import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from "framer-motion";
import { Brain, Zap, Star, ChevronLeft, ArrowRight, Users, AlertCircle } from "../components/Icons";

const DUEL_MODES = [
  { id: "duel", title: "1v1 Duel", subtitle: "Two scholars enter. One emerges richer.", players: 2, color: "from-indigo-600 to-purple-700", glow: "shadow-indigo-500/40", border: "border-indigo-500/30", icon: "⚔️" },
  { id: "triple", title: "Triple Threat", subtitle: "Three-way war. Winner takes all.", players: 3, color: "from-amber-500 to-orange-600", glow: "shadow-amber-500/40", border: "border-amber-500/30", icon: "🔱" },
];
const XP_STAKES = [50, 100, 200, 500, 1000];
const allNames = ["You", "Scholar Amaka", "Scholar Tunde"];

const XpHall = () => {
  const navigate = useNavigate();
  const { studyStats } = useAppContext();
  const [phase, setPhase] = useState("lobby");
  const [mode, setMode] = useState(null);
  const [stake, setStake] = useState(100);
  const [countdown, setCountdown] = useState(3);
  const [result, setResult] = useState(null);
  const [playerXP, setPlayerXP] = useState((studyStats?.quizStreak || 0) * 10 + 240);
  
  // Question State
  const { flashcards } = useAppContext();
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [questionTimeLeft, setQuestionTimeLeft] = useState(20);
  const [userAnswerState, setUserAnswerState] = useState(null); // 'correct' or 'wrong'

  const startBattle = useCallback(() => { setPhase("countdown"); setCountdown(3); }, []);

  // Pre-game Countdown
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdown <= 0) {
      // Transition to question phase instead of random result
      let hardCards = flashcards?.filter(c => c.difficulty?.toLowerCase() === 'hard' || c.difficulty?.toLowerCase() === 'difficult') || [];
      if (hardCards.length === 0) hardCards = flashcards || []; // Fallback to all
      
      const randomCard = hardCards[Math.floor(Math.random() * hardCards.length)];
      if (randomCard) {
         let options = [];
         if (Array.isArray(randomCard.options) && randomCard.options.length >= 2) {
             options = [...randomCard.options].sort(() => 0.5 - Math.random());
         } else {
             const distractors = flashcards
                .filter(c => c.id !== randomCard.id && c.answer !== randomCard.answer)
                .sort(() => 0.5 - Math.random())
                .slice(0, 3)
                .map(c => c.answer);
             options = [randomCard.correctAnswer || randomCard.answer, ...distractors].sort(() => 0.5 - Math.random());
         }
         setCurrentQuestion({ ...randomCard, generatedOptions: options });
      }
      
      setPhase("question");
      setQuestionTimeLeft(20);
      setUserAnswerState(null);
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdown, flashcards]);

  // Question Timer
  useEffect(() => {
     if (phase !== "question" || userAnswerState !== null) return;
     if (questionTimeLeft <= 0) {
        handleAnswer(null); // Time out = wrong
        return;
     }
     const t = setTimeout(() => setQuestionTimeLeft(c => c - 1), 1000);
     return () => clearTimeout(t);
  }, [phase, questionTimeLeft, userAnswerState]);

  const handleAnswer = (option) => {
     if (userAnswerState !== null) return;
     const correct = option === (currentQuestion?.correctAnswer || currentQuestion?.answer);
     setUserAnswerState(correct ? 'correct' : 'wrong');
     
     // Evaluate results after a short delay
     setTimeout(() => {
        const num = mode.players;
        const winnerIdx = correct ? 0 : Math.floor(Math.random() * (num - 1)) + 1; // If wrong, random opponent wins
        const names = allNames.slice(0, num);
        
        const breakdown = names.map((name, i) => ({
          name, wager: stake, result: i === winnerIdx ? "won" : "lost",
          delta: i === winnerIdx ? stake * (num - 1) : -stake,
          score: i === 0 ? (correct ? 10 : Math.floor(Math.random() * 4)) : (i === winnerIdx ? 9 : Math.floor(Math.random() * 6)),
        }));
        
        setResult({ winner: names[winnerIdx], breakdown });
        if (winnerIdx === 0) setPlayerXP(prev => prev + stake * (num - 1));
        else setPlayerXP(prev => prev - stake);
        setPhase("result");
     }, 1500);
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
            <span className="text-amber-400 font-black text-sm tabular-nums">{playerXP.toLocaleString()} XP</span>
          </div>
        </div>

        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center shadow-2xl shadow-purple-500/40">
              <Brain size={28} />
            </div>
          </div>
          <h1 className="text-4xl font-black tracking-tight uppercase">XP War Hall</h1>
          <p className="text-slate-400 font-medium mt-2 text-sm">Secret chamber. High stakes. Winner takes XP.</p>
          <div className="mt-3 flex items-center justify-center gap-2 text-amber-400/70 text-[10px] font-black uppercase tracking-widest">
            <AlertCircle size={12} />
            <span>Unofficial. Scholarly bragging rights only.</span>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {phase === "lobby" && (
            <motion.div key="lobby" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
              {DUEL_MODES.map(m => (
                <button key={m.id} onClick={() => { setMode(m); setPhase("betting"); }}
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
                  {XP_STAKES.map(s => (
                    <button key={s} onClick={() => setStake(s)}
                      className={`py-4 rounded-2xl font-black text-sm transition-all active:scale-95 border-2 ${stake === s ? "bg-amber-500 border-amber-400 text-white shadow-xl shadow-amber-500/30" : "bg-white/5 border-white/10 text-white/50 hover:border-white/30"}`}
                    >{s}</button>
                  ))}
                </div>
                <p className="text-center text-slate-400 text-sm font-medium">
                  Wagering <span className="text-amber-400 font-black">{stake} XP</span> — you have <span className="text-amber-400 font-black">{playerXP} XP</span>
                </p>
                {stake > playerXP && <p className="text-red-400 text-center text-xs font-bold animate-pulse">⚠️ Insufficient XP. Choose a lower wager.</p>}
              </div>
              <button disabled={stake > playerXP} onClick={startBattle}
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
              <p className="text-slate-500 text-sm font-medium">Opponents are joining the arena…</p>
            </motion.div>
          )}

          {phase === "question" && currentQuestion && (
             <motion.div key="question" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="space-y-6">
                <div className="flex justify-between items-center bg-white/5 border border-white/10 p-4 rounded-2xl">
                   <div className="flex items-center gap-2">
                      <Zap className="text-amber-500 animate-pulse" size={18} fill="currentColor" />
                      <span className="text-xs font-black uppercase tracking-widest text-amber-500">SUDDEN DEATH</span>
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
                         const isCorrectOpt = opt === (currentQuestion.correctAnswer || currentQuestion.answer);
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
             </motion.div>
          )}

          {phase === "result" && result && (
            <motion.div key="result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-6">
              <div className={`p-8 rounded-[2rem] text-center ${result.winner === "You" ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-red-500/10 border border-red-500/30"}`}>
                <div className="text-5xl mb-4">{result.winner === "You" ? "🏆" : "💀"}</div>
                <h2 className={`text-3xl font-black uppercase tracking-tight ${result.winner === "You" ? "text-emerald-400" : "text-red-400"}`}>
                  {result.winner === "You" ? "Victory!" : "Eliminated"}
                </h2>
                <p className="text-white/50 mt-2 font-medium">{result.winner === "You" ? "You dominated the hall." : `${result.winner} claimed the XP.`}</p>
              </div>
              <div className="space-y-3">
                {result.breakdown.map(p => (
                  <div key={p.name} className={`flex items-center justify-between p-5 rounded-2xl border ${p.result === "won" ? "bg-emerald-500/10 border-emerald-500/20" : "bg-white/5 border-white/5"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm ${p.result === "won" ? "bg-emerald-500 text-white" : "bg-white/10 text-white/40"}`}>{p.name[0]}</div>
                      <span className="font-bold">{p.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-white/40 font-bold uppercase tracking-widest mb-0.5">Score: {p.score}/10</p>
                      <p className={`font-black text-lg ${p.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>{p.delta > 0 ? "+" : ""}{p.delta} XP</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <button onClick={() => { setPhase("betting"); setResult(null); setCountdown(3); }}
                  className="py-5 rounded-[2rem] bg-white/10 font-black uppercase tracking-widest text-xs active:scale-95 transition-all hover:bg-white/15">Rematch</button>
                <button onClick={() => { setPhase("lobby"); setResult(null); setCountdown(3); setMode(null); }}
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
