import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import { authHeaders } from '../utils/apiHeaders';
import { safeGet, safeSet } from '../utils/safeStorage';
import { Sparkles, ChevronRight, CheckCircle2, XCircle, Trophy, Loader2, Clock } from './Icons';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

// The question banks (~15.6 MB) are intentionally NOT imported at module load —
// this widget renders on the Dashboard, and static imports would drag the whole
// flashcard-data chunk into the initial authenticated load. Instead the lookup
// is built lazily through a single memoized dynamic import the first time a
// challenge actually needs question content (i.e. when the user starts it).
const normalizeAlpha = (q, prefix, i) => ({
  id: String(q.id !== undefined ? q.id : q.question_id !== undefined ? q.question_id : i),
  key: prefix ? `${prefix}-${q.id !== undefined ? q.id : q.question_id}` : undefined,
  question: q.question,
  options: Array.isArray(q.options) ? [...q.options] : [],
  correctAnswer: q.correctAnswer || q.correct_answer_text || q.correct_answer || undefined,
  rationale: q.rationale || q.clinical_application || undefined,
  subject: q.subject,
  category: q.category,
  difficulty: q.difficulty
});
const addLookupCard = (map, c, prefix, i) => {
  if (!c) return;
  const card = prefix ? normalizeAlpha(c, prefix, i) : c;
  if (card.id != null) map.set(String(card.id), card);
  if (card.key != null) map.set(String(card.key), card);
};

let challengeLookupPromise = null;
const getChallengeLookup = () => {
  if (!challengeLookupPromise) {
    challengeLookupPromise = (async () => {
      const [useluData, respirationData, fluidData, rawNclex, richardBank] = await Promise.all([
        import('../data/flashcards/nmcn/uselu-posting-tests.json').then(m => m.default || m),
        import('../data/flashcards/nmcn/Respiration-richard.json').then(m => m.default || m),
        import('../data/flashcards/nmcn/fluid-electrolytes.json').then(m => m.default || m),
        import('../data/flashcards/nclex/nclex-rn-ngn.json').then(m => m.default || m),
        import('../data/richardBank'),
      ]);
      const { pharmacologyData, musculoskeletalData, neurologicalData, nursing200Data, midwiferyData } = richardBank;
      const map = new Map();
      (respirationData || []).forEach((c, i) => addLookupCard(map, c, 'resp', i));
      (fluidData || []).forEach((c, i) => addLookupCard(map, c, 'fluid', i));
      [pharmacologyData, musculoskeletalData, neurologicalData, nursing200Data, midwiferyData].forEach((arr) => (arr || []).forEach(c => addLookupCard(map, c)));
      (useluData || []).forEach((c, i) => addLookupCard(map, c, 'uselu', i));
      (Array.isArray(rawNclex) ? rawNclex : []).forEach((c, i) => addLookupCard(map, c, 'nclex', i));
      return map;
    })();
  }
  return challengeLookupPromise;
};

const CHALLENGE_SIZE = 5;

const fmtClock = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const doneMarker = () => `apex:dailyChallengeDone:${todayKey()}`;

const DailyChallengeWidget = () => {
  const { userProfile, session, markDailyChallengeDone, isPremium, consumeCourseQuota, callApexApi } = useAppContext();
  const navigate = useNavigate();
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [dailyQuestions, setDailyQuestions] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [challengeScore, setChallengeScore] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gotQuestionIds, setGotQuestionIds] = useState(false);
  // Per-course round gate (v13): the Daily Challenge charges its own round
  // (`daily-challenge` key). Blocked starts render a centered notification.
  const [cooldown, setCooldown] = useState(null); // { seconds, expiresAt }
  const [tickNow, setTickNow] = useState(Date.now());
  // FAIL-CLOSED: shown when the server could not confirm availability (network
  // hiccup, API 5xx) so the CTA never silently reads as startable.
  const [startBlockedMsg, setStartBlockedMsg] = useState(null);

  useEffect(() => {
    if (!cooldown) return undefined;
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // Question ids the server issued for today's challenge. Content is NOT
  // materialized until the user actually starts the round (see bindQuestions),
  // because doing so loads the ~15.6 MB question bank over the network.
  const pendingCountRef = useRef(0);
  const pendingIdsRef = useRef([]);

  // Materializes the challenge questions. Called only from startChallenge so
  // the bank chunks load on demand (never during the Dashboard's initial load).
  const bindQuestions = async () => {
    const lookup = await getChallengeLookup();
    const ids = pendingIdsRef.current || [];
    const resolved = [];
    for (const id of ids) {
      const card = lookup.get(String(id));
      if (card) resolved.push(card);
    }
    if (resolved.length > 0) {
      // Build MCQ options for any card without them (bank cards may be
      // flashcard-shaped with a single answer).
      const pool = [...lookup.values()];
      return resolved.slice(0, CHALLENGE_SIZE).map(card => {
        const target = card.correctAnswer || card.answer;
        const distractors = pool
          .filter(c => (c.answer || c.correctAnswer) !== target)
          .sort(() => 0.5 - Math.random())
          .slice(0, 3)
          .map(c => c.answer || c.correctAnswer);
        const options = Array.isArray(card.options) && card.options.length >= 2
          ? card.options
          : [target, ...distractors].sort(() => 0.5 - Math.random());
        return { ...card, options, correctAnswer: target, question: card.question };
      });
    }
    // Fallback: personalized client-side selection from the bank.
    const userLevel = userProfile.level || 'Year 1';
    const allCards = [...lookup.values()];
    const levelAppropriate = allCards.filter(c => c.level === userLevel);
    const pool = levelAppropriate.length >= CHALLENGE_SIZE ? levelAppropriate : allCards;
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, CHALLENGE_SIZE).map(card => {
      const target = card.answer || card.correctAnswer;
      const distractors = allCards
        .filter(c => (c.answer || c.correctAnswer) !== target)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(c => c.answer || c.correctAnswer);
      const options = [target, ...distractors].sort(() => 0.5 - Math.random());
      return { ...card, options, correctAnswer: target };
    });
  };

  // Server-authoritative start: reserve the daily-challenge round FIRST, then
  // unlock the questions. A blocked round shows the centered cooldown notice.
  const startChallenge = async () => {
    setStartBlockedMsg(null);
    if (!isPremium && session?.access_token) {
      const res = await consumeCourseQuota('daily-challenge', CHALLENGE_SIZE, session);
      if (!res) {
        // Network/API/Supabase failure: FAIL CLOSED — nothing charged, but the
        // CTA must not pretend the round is ready.
        setStartBlockedMsg("We couldn't verify availability right now. Please try again.");
        return;
      }
      // Gate on `allowed === false` ONLY. A successful free consume returns
      // `is_ready:false` (the normal post-round state), so a `is_ready` gate
      // would lock the FIRST ever round — this mirrors the Quiz.jsx fix.
      if (res.allowed === false) {
        const seconds = Number(res.cooldown_remaining_seconds) || 0;
        setCooldown({
          seconds,
          expiresAt: res.window_expires_at || new Date(Date.now() + seconds * 1000).toISOString()
        });
        return;
      }
    }
    // Reserve the round succeeded — now load the question content on demand.
    try {
      setLoading(true);
      const questions = await bindQuestions();
      setDailyQuestions(questions);
      setChallengeStarted(true);
    } catch (err) {
      console.warn('Challenge setup failed:', err?.message || err);
      setStartBlockedMsg("We couldn't prepare today's challenge. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Light server call only: checks today's completion state and captures the
  // issued question ids. Content resolution (and with it the question banks)
  // is deferred to startChallenge — this never blocks or slows the Dashboard.
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (dailyQuestions.length > 0) return;
      // Already wrapped up today (server row completed or local marker) —
      // surface the completed state instead of re-running the same set.
      if (safeGet(doneMarker())) {
        setIsCompleted(true);
        return;
      }
      setLoading(true);
      let servedCompleted = false;
      let servedScore = 0;
      let servedTotal = CHALLENGE_SIZE;
      if (session?.access_token) {
        try {
          const res = await callApexApi('/api/daily-challenge', { headers: authHeaders(session) });
          const body = res?.data;
          if (body?.completed) {
            servedCompleted = true;
            servedScore = body.score || 0;
            servedTotal = body.total || CHALLENGE_SIZE;
          }
          const ids = Array.isArray(body?.question_ids) ? body.question_ids : [];
          pendingIdsRef.current = ids;
          pendingCountRef.current = ids.length;
          if (ids.length > 0) setGotQuestionIds(true);
        } catch (err) {
          console.warn('Daily challenge fetch skipped:', err.message);
        }
      }
      if (!active) return;

      if (servedCompleted) {
        // Persist so future mounts today stay in the done state.
        safeSet(doneMarker(), '1');
        markDailyChallengeDone?.();
        setChallengeScore(servedScore);
        setDailyQuestions(Array(Math.max(1, servedTotal)));
        setIsCompleted(true);
      }
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, [session, markDailyChallengeDone, callApexApi, dailyQuestions.length]);

  // Report completion to the server for persistence/stats.
  const reportComplete = useMemo(() => async (score, total, ids) => {
    safeSet(doneMarker(), '1');
    markDailyChallengeDone?.();
    if (!session?.access_token) return;
    try {
      await callApexApi('/api/daily-challenge/complete', {
        method: 'POST',
        headers: authHeaders(session, { json: true }),
        body: JSON.stringify({ score, total, question_ids: ids })
      });
    } catch (err) {
      console.warn('Daily challenge complete skipped:', err.message);
    }
  }, [session, markDailyChallengeDone, callApexApi]);

  const handleAnswer = (option) => {
    if (selectedOption || dailyQuestions.length === 0) return;
    const correct = option === dailyQuestions[currentIdx].correctAnswer;
    setSelectedOption(option);
    setIsCorrect(correct);
    const newScore = correct ? challengeScore + 1 : challengeScore;
    if (correct) setChallengeScore(newScore);

    setTimeout(() => {
      if (currentIdx < dailyQuestions.length - 1) {
        setCurrentIdx(prev => prev + 1);
        setSelectedOption(null);
        setIsCorrect(null);
      } else {
        setIsCompleted(true);
        reportComplete(newScore, dailyQuestions.length, dailyQuestions.map(q => String(q.key || q.id)));
      }
    }, 1500);
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 flex items-center justify-center min-h-[180px]">
        <div className="flex items-center gap-2 text-slate-400 text-sm font-semibold">
          <Loader2 className="w-5 h-5 animate-spin" /> Preparing today's challenge…
        </div>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 text-center animate-in zoom-in duration-500">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Trophy size={32} />
        </div>
        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">Challenge Complete!</h3>
        <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mb-6">
          You mastered {challengeScore}/{dailyQuestions.length} concepts today.
        </p>
        <div className="flex items-center justify-center gap-2">
          {[...Array(dailyQuestions.length)].map((_, i) => (
            <div key={i} className={`w-3 h-3 rounded-full ${i < challengeScore ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          ))}
        </div>
      </div>
    );
  }

  if (dailyQuestions.length === 0) return null;

  const renderOverlay = cooldown && (
    <DailyCooldownOverlay
      expiresAt={cooldown.expiresAt}
      now={tickNow}
      onDismiss={() => { setCooldown(null); navigate('/quiz'); }}
      onStart={() => { setCooldown(null); startChallenge(); }}
      onPremium={() => navigate('/activate')}
    />
  );

  if (!challengeStarted) {
    return (
      <>
        {renderOverlay}
        <div className="bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-110 transition-transform">
            <Sparkles size={80} className="text-apex-600" />
          </div>
          <div className="relative z-10">
            <h4 className="text-[10px] font-black text-apex-600 uppercase tracking-[0.2em] mb-4">
              {gotQuestionIds ? 'Daily Remediation' : 'Daily Precision'}
            </h4>
            <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">Today's Clinical Challenge</h3>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mb-8 max-w-[240px]">
              {gotQuestionIds
                ? `${Math.max(1, pendingCountRef.current)} questions from your recent misses — targeted review.`
                : `5 randomized concepts tailored for ${userProfile.level || 'Year 1'}.`}
            </p>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={startChallenge}
                className="px-6 py-3 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center gap-2 hover:gap-4 transition-all"
              >
                Start Challenge <ChevronRight size={14} />
              </button>
              {!isPremium && (
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Free: 1 round every 30 minutes</span>
              )}
            </div>
            {startBlockedMsg && (
              <div className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-xs font-semibold px-3 py-2.5">
                {startBlockedMsg}
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  const currentQ = dailyQuestions[currentIdx];

  return (
    <>
      {renderOverlay}
      <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 min-h-[350px] flex flex-col animate-in fade-in duration-500">
       <div className="flex justify-between items-center mb-6">
          <div className="flex gap-1">
             {dailyQuestions.map((_, i) => (
               <div key={i} className={`h-1.5 rounded-full transition-all ${i === currentIdx ? 'w-8 bg-apex-600' : i < currentIdx ? 'w-4 bg-emerald-500' : 'w-4 bg-slate-100 dark:bg-slate-700'}`} />
             ))}
          </div>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentIdx + 1}/{dailyQuestions.length}</span>
       </div>

       <div className="flex-1 space-y-6">
          <h4 className="text-lg font-bold text-slate-800 dark:text-white leading-tight tracking-tight">
            {currentQ.question}
          </h4>

          <div className="grid gap-2">
             {currentQ.options.map((opt, i) => {
                let style = "border-slate-100 dark:border-slate-700 hover:border-apex-600";
                if (selectedOption === opt) {
                  style = opt === currentQ.correctAnswer ? "bg-emerald-50 border-emerald-500 text-emerald-700" : "bg-red-50 border-red-500 text-red-700";
                } else if (selectedOption && opt === currentQ.correctAnswer) {
                  style = "bg-emerald-50 border-emerald-500 text-emerald-700";
                }

                return (
                  <button
                    key={i}
                    onClick={() => handleAnswer(opt)}
                    disabled={!!selectedOption}
                    className={`w-full text-left p-4 rounded-2xl border-2 transition-all font-bold text-xs tracking-tight ${style}`}
                  >
                    {opt}
                  </button>
                );
             })}
          </div>
       </div>

       <AnimatePresence>
         {selectedOption && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-4 flex items-center gap-2 font-black uppercase tracking-widest text-[9px] ${isCorrect ? 'text-emerald-600' : 'text-red-600'}`}
            >
               {isCorrect ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
               {isCorrect ? 'Masterfully Answered' : 'Incorrect Logic'}
            </motion.div>
         )}
       </AnimatePresence>
      </div>
    </>
  );
};

// Centered cooldown notification (fixed overlay, in the middle of the app).
const DailyCooldownOverlay = ({ expiresAt, now, onDismiss, onStart, onPremium }) => {
  const remaining = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  const ready = remaining <= 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-900/60 dark:bg-slate-950/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-700 p-6 text-center animate-in zoom-in duration-200">
        <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 ${ready ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-amber-100 dark:bg-amber-900/40'}`}>
          <Clock className={`w-8 h-8 ${ready ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`} />
        </div>
        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">
          {ready ? 'Next round is ready' : 'Daily Challenge on cooldown'}
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium mb-5">
          {ready ? (
            <>A fresh Daily Challenge round is available now.</>
          ) : (
            <>Each round reserves a <span className="font-semibold">30-minute cooldown</span> (free plan). Next round in{' '}
              <span className="font-black text-amber-600 dark:text-amber-400 tabular-nums">{fmtClock(remaining)}</span>.</>
          )}
        </p>
        <div className="grid gap-2">
          {ready && (
            <button onClick={onStart} className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl font-black uppercase tracking-widest text-[10px]">
              Start now
            </button>
          )}
          <button onClick={onDismiss} className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-black uppercase tracking-widest text-[10px]">
            🔄 Try another course
          </button>
          <button onClick={onPremium} className="w-full py-2.5 text-teal-600 dark:text-teal-400 font-black uppercase tracking-widest text-[10px] hover:underline">
            ⭐ Go Premium — unlimited rounds
          </button>
        </div>
      </div>
    </div>
  );
};

export default DailyChallengeWidget;
