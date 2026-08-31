import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { authHeaders } from '../utils/apiHeaders';
import { Sparkles, ChevronRight, CheckCircle2, XCircle, Trophy, Loader2 } from './Icons';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

import useluData from '../data/flashcards/nmcn/uselu-posting-tests.json';
import respirationData from '../data/flashcards/nmcn/Respiration-richard.json';
import fluidData from '../data/flashcards/nmcn/fluid-electrolytes.json';
import rawNclex from '../data/flashcards/nclex/nclex-rn-ngn.json';
import {
  pharmacologyData,
  musculoskeletalData,
  neurologicalData,
  nursing200Data,
  midwiferyData
} from '../data/richardBank';

// Combined id -> card lookup across every question pool (mirrors Quiz.jsx),
// used to turn the server-issued question_ids into renderable questions.
const BUILD_LOOKUP = () => {
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
  const addCard = (map, c) => {
    if (!c) return;
    if (c.id != null) map.set(String(c.id), c);
    if (c.key != null) map.set(String(c.key), c);
  };
  const map = new Map();
  (respirationData || []).forEach((c, i) => addCard(map, normalizeAlpha(c, 'resp', i)));
  (fluidData || []).forEach((c, i) => addCard(map, normalizeAlpha(c, 'fluid', i)));
  pharmacologyData.forEach((c) => addCard(map, c));
  musculoskeletalData.forEach((c) => addCard(map, c));
  neurologicalData.forEach((c) => addCard(map, c));
  nursing200Data.forEach((c) => addCard(map, c));
  midwiferyData.forEach((c) => addCard(map, c));
  (useluData || []).forEach((c, i) => addCard(map, normalizeAlpha(c, 'uselu', i)));
  (Array.isArray(rawNclex) ? rawNclex : []).forEach((c, i) => addCard(map, normalizeAlpha(c, 'nclex', i)));
  return map;
};
const CHALLENGE_LOOKUP = BUILD_LOOKUP();

const CHALLENGE_SIZE = 5;

const DailyChallengeWidget = () => {
  const { flashcards, userProfile, session } = useAppContext();
  const [challengeStarted, setChallengeStarted] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [dailyQuestions, setDailyQuestions] = useState([]);
  const [selectedOption, setSelectedOption] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [challengeScore, setChallengeScore] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [gotQuestionIds, setGotQuestionIds] = useState(false);

  // Load today's challenge from the serverless API (authHeaders = Bearer +
  // X-Session-Id). Falls back to client-side generation when unavailable.
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (flashcards.length === 0 || dailyQuestions.length > 0) return;
      setLoading(true);
      let resolved = [];
      if (session?.access_token) {
        try {
          const res = await fetch('/api/daily-challenge', { headers: authHeaders(session) });
          const body = await res.json();
          const ids = Array.isArray(body?.question_ids) ? body.question_ids : [];
          if (ids.length > 0) {
            for (const id of ids) {
              const card = CHALLENGE_LOOKUP.get(String(id));
              if (card) resolved.push(card);
            }
          }
        } catch (err) {
          console.warn('Daily challenge fetch skipped:', err.message);
        }
      }
      if (!active) return;

      if (resolved.length > 0) {
        // Build MCQ options for any card without them (bank cards may be
        // flashcard-shaped with a single answer).
        const withOpts = resolved.slice(0, CHALLENGE_SIZE).map(card => {
          const target = card.correctAnswer;
          const distractors = flashcards
            .filter(c => (c.answer || c.correctAnswer) !== target)
            .sort(() => 0.5 - Math.random())
            .slice(0, 3)
            .map(c => c.answer || c.correctAnswer);
          const options = Array.isArray(card.options) && card.options.length >= 2
            ? card.options
            : [target, ...distractors].sort(() => 0.5 - Math.random());
          return { ...card, options, correctAnswer: target, question: card.question };
        });
        setDailyQuestions(withOpts);
        setGotQuestionIds(true);
      } else {
        // Fallback: personalized client-side selection from the flashcard pool.
        const userLevel = userProfile.level || 'Year 1';
        const levelAppropriate = flashcards.filter(c => c.level === userLevel);
        const pool = levelAppropriate.length >= 5 ? levelAppropriate : flashcards;
        const shuffled = [...pool].sort(() => 0.5 - Math.random());
        const selected = shuffled.slice(0, CHALLENGE_SIZE).map(card => {
          const target = card.answer || card.correctAnswer;
          const distractors = flashcards
            .filter(c => (c.answer || c.correctAnswer) !== target)
            .sort(() => 0.5 - Math.random())
            .slice(0, 3)
            .map(c => c.answer || c.correctAnswer);
          const options = [target, ...distractors].sort(() => 0.5 - Math.random());
          return { ...card, options, correctAnswer: target };
        });
        setDailyQuestions(selected);
      }
      setLoading(false);
    };
    load();
    return () => { active = false; };
  }, [flashcards, userProfile, session, dailyQuestions.length]);

  // Report completion to the server for persistence/stats.
  const reportComplete = useMemo(() => async (score, total, ids) => {
    if (!session?.access_token) return;
    try {
      await fetch('/api/daily-challenge/complete', {
        method: 'POST',
        headers: authHeaders(session, { json: true }),
        body: JSON.stringify({ score, total, question_ids: ids })
      });
    } catch (err) {
      console.warn('Daily challenge complete skipped:', err.message);
    }
  }, [session]);

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

  if (dailyQuestions.length === 0) return null;

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
          {[...Array(CHALLENGE_SIZE)].map((_, i) => (
            <div key={i} className={`w-3 h-3 rounded-full ${i < challengeScore ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          ))}
        </div>
      </div>
    );
  }

  if (!challengeStarted) {
    return (
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
              ? `${dailyQuestions.length} questions from your recent misses — targeted review.`
              : `5 randomized concepts tailored for ${userProfile.level || 'Year 1'}.`}
          </p>
          <button
            onClick={() => setChallengeStarted(true)}
            className="px-6 py-3 bg-slate-900 dark:bg-white dark:text-slate-900 text-white rounded-xl font-black uppercase tracking-widest text-[10px] flex items-center gap-2 hover:gap-4 transition-all"
          >
            Start Challenge <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  const currentQ = dailyQuestions[currentIdx];

  return (
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
  );
};

export default DailyChallengeWidget;
