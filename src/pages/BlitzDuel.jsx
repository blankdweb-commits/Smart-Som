// Blitz Duel with Flow State (v101).
//
// A server-authoritative 1v1 blitz: 90-second shared clock, 2 SC stake, 4 SC
// gross payout, a Scholar bot opponent. Every rule — the clock, the question
// sequence, grading, the bot, Flow accounting, the stake and the payout — lives
// in the service_role-only blitz_duel_* RPCs. This page is a VIEW: it never
// computes a score or a balance, and the answer key never leaves the server.
//
// Immersive full-screen route (like /rumble) — no sidebar or bottom nav.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { audioManager } from '../utils/audio';
import {
  createBlitzDuel,
  fetchBlitzDuelState,
  answerBlitzDuel,
  skipBlitzDuel,
  setBlitzDuelFlow,
  settleBlitzDuel,
  rematchBlitzDuel,
} from '../utils/blitzDuelApi';
import {
  ArrowLeft, Zap, Volume2, VolumeX, Swords, Trophy, Clock,
  RefreshCw, Sparkles, Target, X,
} from '../components/Icons';

const MATCH_KEY = 'blitz_duel_match_id';
const PACE_KEY = 'blitz_duel_pace';
const MIN_PACE = 3;
const MAX_PACE = 12;
const DEFAULT_PACE = 6;

const clampPace = (n) => {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_PACE;
  return Math.min(MAX_PACE, Math.max(MIN_PACE, v));
};

const readPace = () => {
  try {
    return clampPace(localStorage.getItem(PACE_KEY) ?? DEFAULT_PACE);
  } catch {
    return DEFAULT_PACE;
  }
};

const readMatchId = () => {
  try {
    return localStorage.getItem(MATCH_KEY) || null;
  } catch {
    return null;
  }
};

const writeMatchId = (id) => {
  try {
    if (id) localStorage.setItem(MATCH_KEY, id);
    else localStorage.removeItem(MATCH_KEY);
  } catch {
    /* storage unavailable — the match is simply not resumable */
  }
};

const fmtClock = (ms) => {
  const total = Math.max(0, Math.ceil((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

const errorCopy = (code) => {
  switch (code) {
    case 'INSUFFICIENT_FUNDS': return 'You need 2 Smart Coins to enter a Blitz Duel.';
    case 'RATE_LIMITED': return 'You are playing too fast — wait a breath and try again.';
    case 'MATCH_NOT_FOUND': return 'That match no longer exists.';
    case 'NETWORK': return 'Network problem — check your connection.';
    case 'AUTH_EXPIRED':
    case 'AUTH_NOT_READY': return 'Your session expired. Please sign in again.';
    case 'INSUFFICIENT_QUESTIONS': return 'The question bank is too small to start a match.';
    default: return 'Something went wrong. Please try again.';
  }
};

// ---------------------------------------------------------------
// Plan the whole 90s from the server payload. The server is the only clock.
// ---------------------------------------------------------------
export default function BlitzDuel() {
  const navigate = useNavigate();
  const {
    session, smartCoins, refreshSmartCoins, soundEnabled, toggleSound,
  } = useAppContext();

  const [pace, setPaceState] = useState(readPace);
  const [match, setMatch] = useState(null);
  const [settlement, setSettlement] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [flash, setFlash] = useState(null);
  const [booting, setBooting] = useState(true);
  const [, setTick] = useState(0);

  const offsetRef = useRef(0);          // server_now − client now
  const shownAtRef = useRef(Date.now()); // when the CURRENT question first appeared
  const shownIndexRef = useRef(-1);
  const paceSkipForRef = useRef(-1);    // index already auto-skipped by the ring
  const settlingRef = useRef(false);
  const inFlightRef = useRef(false);

  const phase = !match ? 'setup' : (match.status === 'completed' ? 'results' : 'active');
  const current = match?.question || null;

  // ---- clock -------------------------------------------------------------
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, []);

  const now = Date.now() + offsetRef.current;
  const remainingMs = match?.ends_at ? Math.max(0, Date.parse(match.ends_at) - now) : 0;

  const paceMs = pace * 1000;
  const paceElapsed = match?.index === shownIndexRef.current ? Date.now() - shownAtRef.current : 0;
  const paceRemaining = Math.max(0, paceMs - paceElapsed);

  // Reset the pace ring whenever the server advances the question index.
  useEffect(() => {
    if (match?.status === 'active' && match.index !== shownIndexRef.current) {
      shownIndexRef.current = match.index;
      shownAtRef.current = Date.now();
      paceSkipForRef.current = -1;
    }
  }, [match?.index, match?.status]);

  // ---- ingest a payload --------------------------------------------------
  const ingest = useCallback((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.match) {
      setMatch(payload.match);
      if (payload.match.server_now) {
        offsetRef.current = Date.parse(payload.match.server_now) - Date.now();
      }
      if (payload.match.status === 'completed' && payload.match.settlement) {
        setSettlement(payload.match.settlement);
      }
    }
    if (payload.settlement) setSettlement(payload.settlement);
  }, []);

  // ---- resume on mount ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readMatchId();
      if (!stored || !session?.access_token) { setBooting(false); return; }
      try {
        const data = await fetchBlitzDuelState(session, stored);
        if (cancelled) return;
        ingest(data);
      } catch (err) {
        if (cancelled) return;
        if (err?.code === 'MATCH_NOT_FOUND') {
          writeMatchId(null);
        } else if (err?.code !== 'AUTH_NOT_READY') {
          setError(errorCopy(err?.code));
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session, ingest]);

  // ---- actions -----------------------------------------------------------
  const guard = useCallback(async (fn) => {
    if (inFlightRef.current) return null;
    inFlightRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const data = await fn();
      ingest(data);
      return data;
    } catch (err) {
      // MATCH_ENDED arrives as a 409 carrying the settlement + final board.
      if (err?.data && (err.code === 'MATCH_ENDED' || err.code === 'MATCH_CLOSED')) ingest(err.data);
      else setError(errorCopy(err?.code));
      return null;
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }, [ingest]);

  const start = useCallback(async () => {
    audioManager.playIntro();
    const data = await guard(() => createBlitzDuel(session, pace));
    if (data?.match?.id) {
      writeMatchId(data.match.id);
      refreshSmartCoins();
    }
  }, [guard, session, pace, refreshSmartCoins]);

  const answer = useCallback((letter) => {
    if (!match || match.status !== 'active' || !current || inFlightRef.current) return;
    if (Date.now() + offsetRef.current >= Date.parse(match.ends_at)) return;
    const index = match.index;
    guard(() => answerBlitzDuel(session, {
      matchId: match.id,
      questionIndex: index,
      selected: letter,
      clientRequestId: crypto.randomUUID(),
    })).then((data) => {
      const a = data?.action;
      if (!a) return;
      setFlash({ index: a.index, correct: a.correct });
      if (a.correct) audioManager.playCorrect(); else audioManager.playWrong();
      setTimeout(() => setFlash(null), 900);
    });
  }, [match, current, guard, session]);

  const skip = useCallback((auto = false) => {
    if (!match || match.status !== 'active' || current === null || inFlightRef.current) return;
    if (!auto && Date.now() + offsetRef.current >= Date.parse(match.ends_at)) return;
    const index = match.index;
    guard(() => skipBlitzDuel(session, {
      matchId: match.id,
      questionIndex: index,
      clientRequestId: crypto.randomUUID(),
    })).then((data) => {
      if (data) { setFlash({ index, correct: null }); setTimeout(() => setFlash(null), 600); }
    });
  }, [match, current, guard, session]);

  const toggleFlow = useCallback(() => {
    if (!match || match.status !== 'active' || inFlightRef.current) return;
    const next = !match.mine?.flow_active;
    guard(() => setBlitzDuelFlow(session, {
      matchId: match.id, active: next, clientRequestId: crypto.randomUUID(),
    }));
  }, [match, guard, session]);

  const settle = useCallback(async () => {
    if (!match || settlingRef.current) return;
    settlingRef.current = true;
    const data = await guard(() => settleBlitzDuel(session, match.id));
    if (data?.settlement) {
      setSettlement(data.settlement);
      audioManager.playExit();
      refreshSmartCoins();
    }
    settlingRef.current = false;
  }, [match, guard, session, refreshSmartCoins]);

  const rematch = useCallback(async () => {
    setSettlement(null);
    setMatch(null);
    const data = await guard(() => rematchBlitzDuel(session, pace));
    if (data?.match?.id) {
      writeMatchId(data.match.id);
      refreshSmartCoins();
    }
  }, [guard, session, pace, refreshSmartCoins]);

  const leave = useCallback(() => {
    // A finished match stays settled; a live match stays active on the server
    // and can be resumed later, so its id is kept.
    if (match?.status === 'completed') writeMatchId(null);
    navigate('/dashboard');
  }, [navigate, match?.status]);

  // ---- auto-skip when the pace ring expires (counts as a skip) -----------
  useEffect(() => {
    if (phase !== 'active' || !current || busy) return;
    if (remainingMs <= 0) return;
    if (paceRemaining > 0) return;
    if (paceSkipForRef.current === match.index) return;
    paceSkipForRef.current = match.index;
    skip(true);
  }, [phase, current, busy, paceRemaining, remainingMs, match?.index, skip]);

  // ---- settle when the whistle blows -------------------------------------
  useEffect(() => {
    if (phase !== 'active' || busy) return;
    if (remainingMs > 0) return;
    settle();
  }, [phase, busy, remainingMs, settle]);

  const setPace = useCallback((v) => {
    const next = clampPace(v);
    setPaceState(next);
    try { localStorage.setItem(PACE_KEY, String(next)); } catch { /* ignore */ }
  }, []);

  const mine = match?.mine || { score: 0, correct: 0, wrong: 0, skips: 0, flow_active: false, flow_on_ms: 0 };
  const bot = match?.bot || { score: 0, flow_active: false };
  const inFlow = !!mine.flow_active;
  const botFlow = !!bot.flow_active;

  return (
    <div className="blitz-shell min-h-screen text-white">
      <style>{BLITZ_CSS}</style>

      <header className="blitz-header">
        <button type="button" className="blitz-icon-btn" onClick={leave} aria-label="Leave Blitz Duel">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="blitz-title">
          <Swords className="w-5 h-5 text-amber-400" />
          <span>Blitz Duel</span>
          <span className="blitz-flow-tag">Flow State</span>
        </div>
        <button
          type="button"
          className="blitz-icon-btn"
          onClick={toggleSound}
          aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
        >
          {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
        </button>
      </header>

      {error && (
        <div className="blitz-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
        </div>
      )}

      {booting ? (
        <div className="blitz-center"><div className="blitz-spinner" /></div>
      ) : phase === 'setup' ? (
        <SetupView
          pace={pace} setPace={setPace} balance={smartCoins}
          busy={busy} onStart={start}
        />
      ) : phase === 'active' ? (
        <ActiveView
          match={match} mine={mine} bot={bot} current={current}
          remainingMs={remainingMs} paceRemaining={paceRemaining} paceMs={paceMs}
          flash={flash} busy={busy} inFlow={inFlow} botFlow={botFlow}
          onAnswer={answer} onSkip={() => skip(false)} onToggleFlow={toggleFlow}
        />
      ) : (
        <ResultsView
          settlement={settlement} mine={mine} bot={bot}
          busy={busy} onRematch={rematch} onExit={leave}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------
function SetupView({ pace, setPace, balance, busy, onStart }) {
  return (
    <div className="blitz-center">
      <div className="blitz-card blitz-setup">
        <div className="blitz-vs-row">
          <div className="blitz-side">
            <div className="blitz-avatar blitz-avatar-you">You</div>
            <span className="blitz-side-label">Scholar</span>
          </div>
          <div className="blitz-vs-badge">VS</div>
          <div className="blitz-side">
            <div className="blitz-avatar blitz-avatar-bot"><Sparkles className="w-7 h-7" /></div>
            <span className="blitz-side-label">Scholar Bot</span>
          </div>
        </div>

        <ul className="blitz-rules">
          <li><Clock className="w-4 h-4" /> A shared 90-second clock — the match ends at the whistle.</li>
          <li><Zap className="w-4 h-4" /> Each question has a {pace}-second window; miss it and it counts as a skip.</li>
          <li><Target className="w-4 h-4" /> Correct +1, wrong 0, skip 0. No answer key is shown.</li>
          <li><Swords className="w-4 h-4" /> Stake 2 SC. Win returns 4 SC gross (net +2). Draw refunds 2 SC.</li>
        </ul>

        <div className="blitz-pace">
          <label htmlFor="blitz-pace-range">
            Answer window <strong>{pace}s</strong>
          </label>
          <input
            id="blitz-pace-range"
            type="range"
            min={MIN_PACE}
            max={MAX_PACE}
            step={1}
            value={pace}
            onChange={(e) => setPace(e.target.value)}
          />
          <div className="blitz-pace-scale"><span>{MIN_PACE}s</span><span>{MAX_PACE}s</span></div>
        </div>

        <div className="blitz-balance">Balance: <strong>{balance} SC</strong></div>

        <button type="button" className="blitz-primary" onClick={onStart} disabled={busy}>
          {busy ? 'Entering…' : 'Enter the Duel · 2 SC'}
        </button>
        <p className="blitz-fine">The +4 SC payout is applied server-side only after the match settles.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------
// Active duel
// ---------------------------------------------------------------
function ActiveView({
  match, mine, bot, current, remainingMs, paceRemaining, paceMs,
  flash, busy, inFlow, botFlow, onAnswer, onSkip, onToggleFlow,
}) {
  const lowTime = remainingMs <= 10000;
  const boardCleared = !current;
  const ringPct = paceMs > 0 ? Math.max(0, Math.min(1, paceRemaining / paceMs)) : 0;
  const R = 52;
  const C = 2 * Math.PI * R;
  const dash = C * ringPct;

  return (
    <div className={`blitz-center blitz-active ${inFlow ? 'is-flow' : ''}`}>
      <div className={`blitz-clock ${lowTime ? 'is-low' : ''}`}>
        <Clock className="w-4 h-4" />
        <span>{fmtClock(remainingMs)}</span>
      </div>

      <div className="blitz-board-head">
        <div className="blitz-qmeta">
          Q {Math.min(match.index + 1, match.question_count)} / {match.question_count}
          {current?.subject ? <span className="blitz-qmeta-sub"> · {current.subject}</span> : null}
        </div>
      </div>

      <div className="blitz-question">
        {boardCleared ? (
          <div className="blitz-cleared">
            <Trophy className="w-8 h-8 text-amber-400" />
            <p>Board cleared — holding for the whistle.</p>
          </div>
        ) : (
          <>
            <div className="blitz-ring-wrap">
              <svg className="blitz-ring" width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
                <circle cx="60" cy="60" r={R} className="blitz-ring-track" />
                <circle
                  cx="60" cy="60" r={R}
                  className="blitz-ring-fill"
                  strokeDasharray={`${dash} ${C}`}
                  strokeDashoffset="0"
                />
              </svg>
              <span className="blitz-ring-num">{Math.ceil(paceRemaining / 1000)}</span>
            </div>
            <h2 className="blitz-stem">{current.text}</h2>
            <div className="blitz-options">
              {['A', 'B', 'C', 'D'].map((letter) => {
                const opt = current.options?.[letter];
                if (!opt) return null;
                const isFlashing = flash && flash.index === match.index;
                const cls = isFlashing && flash.correct === true
                  ? 'is-correct'
                  : (isFlashing && flash.correct === false ? 'is-wrong' : '');
                return (
                  <button
                    key={letter}
                    type="button"
                    className={`blitz-option ${cls}`}
                    onClick={() => onAnswer(letter)}
                    disabled={busy}
                  >
                    <span className="blitz-option-key">{letter}</span>
                    <span className="blitz-option-text">{opt}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="blitz-skip" onClick={onSkip} disabled={busy}>
              Skip question
            </button>
          </>
        )}
      </div>

      {!inFlow && (
        <div className="blitz-scorecard" aria-label="Scoreboard">
          <ScoreSide label="You" value={mine.score} active={false} tone="you" />
          <ScoreSide label="Scholar Bot" value={bot.score} active={botFlow} tone="bot" />
        </div>
      )}

      <button type="button" className={`blitz-flow-btn ${inFlow ? 'is-on' : ''}`} onClick={onToggleFlow} disabled={busy}>
        <Zap className="w-5 h-5" />
        {inFlow ? 'Flow State ON — tap to release' : 'Enter Flow State'}
      </button>
    </div>
  );
}

function ScoreSide({ label, value, active, tone }) {
  return (
    <div className={`blitz-score ${active ? 'is-active' : ''} blitz-score-${tone}`}>
      <span className="blitz-score-label">{label}</span>
      <span className="blitz-score-value">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------
// Results
// ---------------------------------------------------------------
function ResultsView({ settlement, mine, bot, busy, onRematch, onExit }) {
  const s = settlement || {};
  const outcome = s.outcome || (mine.score > bot.score ? 'win' : mine.score < bot.score ? 'loss' : 'draw');
  const heading = outcome === 'win' ? 'Victory' : outcome === 'loss' ? 'Defeat' : 'Draw';
  const glyph = outcome === 'win' ? '🏆' : outcome === 'loss' ? '💀' : '🤝';
  const delta = Number.isFinite(s.delta) ? s.delta : 0;
  const flowOn = s.flow_on_ms ?? mine.flow_on_ms ?? 0;
  const flowOff = s.flow_off_ms ?? 0;
  const totalFlow = flowOn + flowOff;

  return (
    <div className="blitz-center">
      <div className={`blitz-card blitz-result is-${outcome}`}>
        <div className="blitz-result-glyph">{glyph}</div>
        <h2 className="blitz-result-title">{heading}</h2>

        {outcome === 'win' && (
          <div className="blitz-payout-badge">+{delta || 4} SC</div>
        )}
        {outcome === 'draw' && <div className="blitz-payout-badge is-draw">Refunded {delta || 2} SC</div>}

        <div className="blitz-result-scores">
          <div><span>You</span><strong>{s.score ?? mine.score}</strong></div>
          <div><span>Bot</span><strong>{s.bot_score ?? bot.score}</strong></div>
        </div>

        <div className="blitz-stat-grid">
          <Stat label="Correct" value={s.correct ?? mine.correct} />
          <Stat label="Wrong" value={s.wrong ?? mine.wrong} />
          <Stat label="Skips" value={s.skips ?? mine.skips} />
          <Stat label="Balance" value={s.balance_after ?? '—'} />
        </div>

        <div className="blitz-flow-stats">
          <div className="blitz-flow-stats-head"><Zap className="w-4 h-4" /> Flow State</div>
          <div className="blitz-flow-bar">
            <div
              className="blitz-flow-bar-on"
              style={{ width: totalFlow > 0 ? `${Math.round((flowOn / totalFlow) * 100)}%` : '0%' }}
            />
          </div>
          <div className="blitz-flow-stats-line">
            <span>ON {fmtClock(flowOn)}</span>
            <span>OFF {fmtClock(flowOff)}</span>
          </div>
        </div>

        <div className="blitz-result-actions">
          <button type="button" className="blitz-primary" onClick={onRematch} disabled={busy}>
            <RefreshCw className="w-4 h-4" /> Rematch · 2 SC
          </button>
          <button type="button" className="blitz-ghost" onClick={onExit} disabled={busy}>Back to Dashboard</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="blitz-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// ---------------------------------------------------------------
// Page-scoped styles (navy #060818 · orange #F59E0B · dark-red Flow aura).
// ---------------------------------------------------------------
const BLITZ_CSS = `
.blitz-shell {
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(245,158,11,0.10), transparent 60%),
    #060818;
  padding-bottom: 3rem;
}
.blitz-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0.85rem 1rem; border-bottom: 1px solid rgba(148,163,184,0.12);
  position: sticky; top: 0; z-index: 20; backdrop-filter: blur(8px);
  background: rgba(6,8,24,0.82);
}
.blitz-title { display: flex; align-items: center; gap: 0.5rem; font-weight: 700; letter-spacing: 0.02em; }
.blitz-flow-tag {
  font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.14em;
  color: #fca5a5; border: 1px solid rgba(220,38,38,0.55); border-radius: 999px;
  padding: 0.12rem 0.5rem; background: rgba(220,38,38,0.12);
}
.blitz-icon-btn {
  width: 2.35rem; height: 2.35rem; display: grid; place-items: center;
  border-radius: 0.7rem; border: 1px solid rgba(148,163,184,0.2);
  background: rgba(15,23,42,0.6); color: #e2e8f0; cursor: pointer;
}
.blitz-icon-btn:hover { border-color: rgba(245,158,11,0.6); color: #fbbf24; }
.blitz-error {
  margin: 0.75rem auto; max-width: 40rem; display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem; padding: 0.65rem 0.9rem; border-radius: 0.6rem;
  background: rgba(220,38,38,0.14); border: 1px solid rgba(220,38,38,0.5); color: #fecaca;
}
.blitz-error button { background: none; border: none; color: inherit; cursor: pointer; display: grid; place-items: center; }
.blitz-center {
  min-height: calc(100vh - 60px); display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 0.85rem; padding: 1rem;
}
.blitz-spinner {
  width: 2.5rem; height: 2.5rem; border-radius: 999px;
  border: 3px solid rgba(245,158,11,0.3); border-top-color: #f59e0b;
  animation: blitz-spin 0.9s linear infinite;
}
@keyframes blitz-spin { to { transform: rotate(360deg); } }
.blitz-card {
  width: 100%; max-width: 30rem; background: rgba(15,23,42,0.72);
  border: 1px solid rgba(148,163,184,0.16); border-radius: 1.1rem;
  padding: 1.35rem; box-shadow: 0 24px 60px -30px rgba(0,0,0,0.9);
}
.blitz-vs-row { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-bottom: 1.1rem; }
.blitz-side { display: flex; flex-direction: column; align-items: center; gap: 0.4rem; }
.blitz-side-label { font-size: 0.72rem; color: #94a3b8; }
.blitz-avatar {
  width: 3.6rem; height: 3.6rem; border-radius: 1rem; display: grid; place-items: center;
  font-weight: 700; border: 1px solid rgba(148,163,184,0.25);
}
.blitz-avatar-you { background: rgba(245,158,11,0.16); color: #fbbf24; font-size: 0.8rem; }
.blitz-avatar-bot { background: rgba(99,102,241,0.18); color: #a5b4fc; }
.blitz-vs-badge { font-weight: 800; font-size: 1.2rem; color: #64748b; }
.blitz-rules { list-style: none; margin: 0 0 1.1rem; padding: 0; display: grid; gap: 0.5rem; }
.blitz-rules li { display: flex; gap: 0.55rem; align-items: flex-start; font-size: 0.82rem; color: #cbd5e1; }
.blitz-rules li svg { color: #f59e0b; flex-shrink: 0; margin-top: 0.1rem; }
.blitz-pace { margin-bottom: 0.9rem; }
.blitz-pace label { display: block; font-size: 0.78rem; color: #94a3b8; margin-bottom: 0.4rem; }
.blitz-pace input[type=range] { width: 100%; accent-color: #f59e0b; }
.blitz-pace-scale { display: flex; justify-content: space-between; font-size: 0.66rem; color: #64748b; }
.blitz-balance { font-size: 0.8rem; color: #94a3b8; margin-bottom: 0.9rem; }
.blitz-balance strong { color: #fbbf24; }
.blitz-primary {
  width: 100%; display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding: 0.8rem 1rem; border-radius: 0.8rem; border: none; cursor: pointer;
  background: linear-gradient(180deg, #fbbf24, #f59e0b); color: #1c1204; font-weight: 800;
}
.blitz-primary:disabled { opacity: 0.55; cursor: not-allowed; }
.blitz-ghost {
  width: 100%; padding: 0.7rem 1rem; border-radius: 0.8rem; cursor: pointer;
  background: transparent; border: 1px solid rgba(148,163,184,0.3); color: #cbd5e1; font-weight: 600;
}
.blitz-fine { margin: 0.7rem 0 0; font-size: 0.68rem; color: #64748b; text-align: center; }

.blitz-clock {
  display: inline-flex; align-items: center; gap: 0.45rem; font-variant-numeric: tabular-nums;
  font-weight: 800; font-size: 1.35rem; padding: 0.3rem 0.9rem; border-radius: 999px;
  border: 1px solid rgba(148,163,184,0.25); background: rgba(15,23,42,0.7); color: #e2e8f0;
}
.blitz-clock.is-low { color: #fca5a5; border-color: rgba(220,38,38,0.6); animation: blitz-pulse 1s ease-in-out infinite; }
@keyframes blitz-pulse { 50% { box-shadow: 0 0 0 6px rgba(220,38,38,0.16); } }
.blitz-board-head { width: 100%; max-width: 34rem; display: flex; justify-content: center; }
.blitz-qmeta { font-size: 0.75rem; letter-spacing: 0.05em; color: #94a3b8; text-transform: uppercase; }
.blitz-qmeta-sub { color: #64748b; }
.blitz-question {
  width: 100%; max-width: 34rem; background: rgba(15,23,42,0.72);
  border: 1px solid rgba(148,163,184,0.16); border-radius: 1.1rem; padding: 1.15rem;
  display: flex; flex-direction: column; align-items: center; gap: 0.9rem;
}
.blitz-ring-wrap { position: relative; width: 120px; height: 120px; }
.blitz-ring { transform: rotate(-90deg); }
.blitz-ring-track { fill: none; stroke: rgba(148,163,184,0.18); stroke-width: 8; }
.blitz-ring-fill { fill: none; stroke: #f59e0b; stroke-width: 8; stroke-linecap: round; transition: stroke-dasharray 0.1s linear; }
.blitz-ring-num {
  position: absolute; inset: 0; display: grid; place-items: center;
  font-size: 1.5rem; font-weight: 800; font-variant-numeric: tabular-nums; color: #fbbf24;
}
.blitz-stem { font-size: 1.02rem; line-height: 1.45; text-align: center; margin: 0; color: #f1f5f9; }
.blitz-options { width: 100%; display: grid; gap: 0.55rem; }
.blitz-option {
  display: flex; align-items: center; gap: 0.65rem; width: 100%; text-align: left;
  padding: 0.7rem 0.8rem; border-radius: 0.8rem; cursor: pointer;
  border: 1px solid rgba(148,163,184,0.2); background: rgba(2,6,23,0.6); color: #e2e8f0;
}
.blitz-option:hover:not(:disabled) { border-color: rgba(245,158,11,0.55); }
.blitz-option:disabled { cursor: default; }
.blitz-option.is-correct { border-color: #22c55e; background: rgba(34,197,94,0.16); }
.blitz-option.is-wrong { border-color: #ef4444; background: rgba(239,68,68,0.16); }
.blitz-option-key {
  width: 1.7rem; height: 1.7rem; flex-shrink: 0; display: grid; place-items: center;
  border-radius: 0.5rem; background: rgba(148,163,184,0.16); font-weight: 700; font-size: 0.8rem;
}
.blitz-option-text { font-size: 0.86rem; line-height: 1.35; }
.blitz-skip {
  background: none; border: none; color: #94a3b8; font-size: 0.78rem;
  text-decoration: underline; text-underline-offset: 3px; cursor: pointer;
}
.blitz-cleared { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; color: #cbd5e1; padding: 1rem 0; }
.blitz-scorecard { display: flex; gap: 0.75rem; width: 100%; max-width: 34rem; }
.blitz-score {
  flex: 1; border-radius: 0.9rem; padding: 0.6rem 0.8rem;
  border: 1px solid rgba(148,163,184,0.18); background: rgba(15,23,42,0.7);
  display: flex; align-items: center; justify-content: space-between;
}
.blitz-score-you { border-color: rgba(245,158,11,0.4); }
.blitz-score-bot.is-active { border-color: rgba(99,102,241,0.7); box-shadow: 0 0 0 3px rgba(99,102,241,0.18); }
.blitz-score-label { font-size: 0.72rem; color: #94a3b8; }
.blitz-score-value { font-size: 1.3rem; font-weight: 800; color: #f1f5f9; }
.blitz-flow-btn {
  display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.7rem 1.1rem;
  border-radius: 999px; cursor: pointer; font-weight: 700;
  border: 1px solid rgba(220,38,38,0.4); background: rgba(220,38,38,0.12); color: #fca5a5;
  transition: box-shadow 0.35s ease, background 0.35s ease, border-color 0.35s ease;
}
.blitz-flow-btn.is-on {
  background: rgba(220,38,38,0.26); border-color: rgba(220,38,38,0.9); color: #fecaca;
  box-shadow: 0 0 0 8px rgba(220,38,38,0.14), 0 0 42px 6px rgba(220,38,38,0.45);
}
.blitz-active.is-flow .blitz-question {
  border-color: rgba(220,38,38,0.6);
  box-shadow: 0 0 44px -6px rgba(220,38,38,0.6);
}
.blitz-result { text-align: center; }
.blitz-result-glyph { font-size: 3rem; line-height: 1; }
.blitz-result-title { margin: 0.3rem 0 0.5rem; font-size: 1.5rem; font-weight: 800; }
.blitz-result.is-win .blitz-result-title { color: #fbbf24; }
.blitz-result.is-loss .blitz-result-title { color: #fca5a5; }
.blitz-result.is-draw .blitz-result-title { color: #93c5fd; }
.blitz-payout-badge {
  display: inline-block; margin-bottom: 0.9rem; padding: 0.3rem 0.85rem; border-radius: 999px;
  background: rgba(34,197,94,0.18); border: 1px solid rgba(34,197,94,0.6); color: #86efac; font-weight: 800;
}
.blitz-payout-badge.is-draw { background: rgba(59,130,246,0.16); border-color: rgba(59,130,246,0.55); color: #bfdbfe; }
.blitz-result-scores { display: flex; justify-content: center; gap: 1.6rem; margin-bottom: 0.9rem; }
.blitz-result-scores div { display: flex; flex-direction: column; }
.blitz-result-scores span { font-size: 0.72rem; color: #94a3b8; }
.blitz-result-scores strong { font-size: 1.4rem; }
.blitz-stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem; margin-bottom: 0.9rem; }
.blitz-stat { border-radius: 0.7rem; padding: 0.5rem 0.3rem; background: rgba(2,6,23,0.55); border: 1px solid rgba(148,163,184,0.14); display: flex; flex-direction: column; gap: 0.15rem; }
.blitz-stat span { font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; }
.blitz-stat strong { font-size: 1rem; }
.blitz-flow-stats { margin-bottom: 1rem; }
.blitz-flow-stats-head { display: flex; align-items: center; justify-content: center; gap: 0.4rem; font-size: 0.76rem; color: #fca5a5; margin-bottom: 0.4rem; }
.blitz-flow-bar { height: 0.5rem; border-radius: 999px; background: rgba(148,163,184,0.16); overflow: hidden; }
.blitz-flow-bar-on { height: 100%; background: linear-gradient(90deg, #ef4444, #f59e0b); }
.blitz-flow-stats-line { display: flex; justify-content: space-between; font-size: 0.68rem; color: #94a3b8; margin-top: 0.3rem; }
.blitz-result-actions { display: grid; gap: 0.55rem; }
@media (prefers-reduced-motion: reduce) {
  .blitz-clock.is-low { animation: none; }
  .blitz-ring-fill { transition: none; }
  .blitz-flow-btn { transition: none; }
}
`;
