import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import {
  Brain,
  Timer,
  Award,
  Zap,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Target,
  Clock,
  Trophy,
  HelpCircle,
  Shield,
  Star,
  RefreshCw,
  LayoutDashboard,
  ChevronRight,
  TrendingUp,
  Settings as SettingsIcon,
  ChevronLeft,
  Users,
  AlertCircle,
  Sparkles
} from '../components/Icons';
import useluData from '../data/flashcards/nmcn/uselu-posting-tests.json';
import { motion, AnimatePresence } from 'framer-motion';

const MILESTONES = [
  { q: 5, label: 'Clinical Novice', reward: 'Bronze Badge' },
  { q: 10, label: 'Nurse Intern', reward: 'Silver Badge' },
  { q: 15, label: 'Medical Scholar', reward: 'Gold Badge' },
  { q: 20, label: 'Diagnostic Specialist', reward: 'Platinum Badge' },
  { q: 25, label: 'Apex Practitioner', reward: 'Diamond Badge' },
  { q: 30, label: 'Clinical Legend', reward: 'Legendary Status' }
];

// ----- Sound System (unchanged) -----
const SOUND_POOL = {
  start: [
    'https://www.myinstants.com/media/sounds/show-me-what-you-got.mp3',
    'https://www.myinstants.com/media/sounds/are-you-ready-kids.mp3'
  ],
  correct: [
    'https://www.myinstants.com/media/sounds/im-ready.mp3',
    'https://www.myinstants.com/media/sounds/f-is-for-friends.mp3',
    'https://www.myinstants.com/media/sounds/krusty-krab-pizza.mp3',
    'https://www.myinstants.com/media/sounds/is-mayonnaise-an-instrument.mp3',
    'https://www.myinstants.com/media/sounds/its-a-giraffe.mp3',
    'https://www.myinstants.com/media/sounds/giggity.mp3',
    'https://www.myinstants.com/media/sounds/freaking-sweet.mp3',
    'https://www.myinstants.com/media/sounds/oh-my-god.mp3',
    'https://www.myinstants.com/media/sounds/awesome.mp3',
    'https://www.myinstants.com/media/sounds/think-mark.mp3',
    'https://www.myinstants.com/media/sounds/i-can-do-whatever-i-want.mp3',
    'https://www.myinstants.com/media/sounds/you-dont-seem-to-understand.mp3',
    'https://www.myinstants.com/media/sounds/i-am-the-strongest.mp3'
  ],
  wrong: [
    'https://www.myinstants.com/media/sounds/im-ugly-and-im-proud.mp3',
    'https://www.myinstants.com/media/sounds/ravioli-ravioli-give-me-the-formuoli.mp3',
    'https://www.myinstants.com/media/sounds/squidward.mp3',
    'https://www.myinstants.com/media/sounds/patrick.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-thats-not-a-joke.mp3',
    'https://www.myinstants.com/media/sounds/wheres-my-money.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-youre-a-moron.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-what-the-deuce.mp3',
    'https://www.myinstants.com/media/sounds/family-guy-bird-is-the-word.mp3',
    'https://www.myinstants.com/media/sounds/im-so-sorry-mark.mp3',
    'https://www.myinstants.com/media/sounds/you-pathetic-excuse.mp3',
    'https://www.myinstants.com/media/sounds/why-did-you-make-me-do-this.mp3'
  ],
  timeout: [
    'https://www.myinstants.com/media/sounds/family-guy-time-out.mp3',
    'https://www.myinstants.com/media/sounds/the-krusty-krab-is-closed.mp3'
  ]
};

const audioCache = {};

const playQuizSound = (type) => {
  try {
    const pool = SOUND_POOL[type] || [];
    if (pool.length === 0) return;

    const url = pool[Math.floor(Math.random() * pool.length)];

    if (!audioCache[url]) {
      audioCache[url] = Array.from({ length: 3 }).map(() => {
        const audio = new Audio(url);
        audio.preload = 'auto';
        return audio;
      });
    }

    const audioPool = audioCache[url];
    let audioToPlay = audioPool.find(a => a.paused || a.ended);
    if (!audioToPlay) {
      audioToPlay = audioPool[0];
    }

    audioToPlay.currentTime = 0;
    audioToPlay.volume = 1.0;
    const playPromise = audioToPlay.play();

    if (playPromise !== undefined) {
      playPromise.catch(err => console.warn('Audio playback blocked:', err));
    }
  } catch (e) {
    console.warn('Sound system error:', e);
  }
};

const enterFullscreen = async () => {
  try {
    const docEl = document.documentElement;
    const requestFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
    if (requestFs && !document.fullscreenElement && !document.webkitFullscreenElement) {
      await requestFs.call(docEl);
    }
  } catch (err) {
    console.warn("Fullscreen request failed", err);
  }
};

const exitFullscreen = async () => {
  try {
    const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (exitFs && (document.fullscreenElement || document.webkitFullscreenElement)) {
      await exitFs.call(document);
    }
  } catch (err) {
    console.warn("Exit fullscreen failed", err);
  }
};

// ----- Main Quiz Component -----
const Quiz = () => {
  const { flashcards, studyStats, updateQuizStats, darkMode } = useAppContext();
  const navigate = useNavigate();
  const [secretTaps, setSecretTaps] = useState(0);
  const [quizMode, setQuizMode] = useState(null);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizQuestions, setQuizQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [showResults, setShowResults] = useState(false);

  const [selectedOption, setSelectedOption] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [showHint, setShowHint] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [isCorrect, setIsCorrect] = useState(null);
  const [timeLeft, setTimeLeft] = useState(30);
  const [eliminatedOptions, setEliminatedOptions] = useState([]);
  const [lifelinesUsed, setLifelinesUsed] = useState({ hint: false, fiftyFifty: false, askClass: false });
  const [classPoll, setClassPoll] = useState(null);
  const [consecutiveCorrect, setConsecutiveCorrect] = useState(0);
  const [showQuestionPopup, setShowQuestionPopup] = useState(false);
  const [showLifelineRestore, setShowLifelineRestore] = useState(false);

  const [maxTime, setMaxTime] = useState(20);
  const [isFinalAnswer, setIsFinalAnswer] = useState(false);
  const [highestMilestone, setHighestMilestone] = useState("None");
  const [safetyNetScore, setSafetyNetScore] = useState(0);

  const [questionLimit, setQuestionLimit] = useState(10);
  const [customQuestionCount, setCustomQuestionCount] = useState('');
  const [useTimer, setUseTimer] = useState(true);
  const [customTimePerQuestion, setCustomTimePerQuestion] = useState('30');

  const [showQuitModal, setShowQuitModal] = useState(false);

  useEffect(() => {
    return () => {
      exitFullscreen();
    };
  }, []);

  const subjects = useMemo(() => {
    const s = new Map();
    if (flashcards) {
      flashcards.forEach(c => {
        const name = c.subject || 'General';
        s.set(name, (s.get(name) || 0) + 1);
      });
    }
    return Array.from(s.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [flashcards]);

  const currentMilestone = useMemo(() => {
    const milestone = [...MILESTONES].reverse().find(m => score >= m.q);
    return milestone ? milestone.label : "Clinical Novice";
  }, [score]);

  const handleTimeOut = useCallback(() => {
    if (showRationale || showResults) return;
    if (quizMode === 'speed') {
      updateQuizStats({ quizStreak: 0 });
      playQuizSound('timeout');
      setShowResults(true);
    } else {
      setIsCorrect(false);
      setShowRationale(true);
      setIsFinalAnswer(false);
    }
  }, [quizMode, showRationale, showResults, updateQuizStats]);

  useEffect(() => {
    let interval;
    const activeTimer = useTimer && quizStarted && !showResults && !showRationale && !isFinalAnswer && timeLeft > 0;

    if (activeTimer) {
      interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) { handleTimeOut(); return 0; }
          return prev - 1;
        });
      }, 1000);
    }

    return () => clearInterval(interval);
  }, [timeLeft, quizStarted, showResults, showRationale, isFinalAnswer, useTimer, handleTimeOut]);

  const initQuiz = (mode, subject = null) => {
    let pool = [];
    if (mode === 'uselu') {
      pool = useluData;
      if (subject) {
        pool = pool.filter(c => c.subject === subject);
      }
    } else {
      if (!flashcards || flashcards.length === 0) return;
      pool = flashcards.filter(c =>
        (c.source || '').toLowerCase().includes("richard") ||
        (c.category || '').toLowerCase() === 'nmcn'
      );
      if (subject) {
        pool = pool.filter(c => c.subject === subject);
      }
    }
    if (pool.length === 0) return;

    const seen = new Set();
    const uniquePool = pool.filter(c => seen.has(c.question) ? false : seen.add(c.question));

    let limit = 10;
    const customVal = parseInt(customQuestionCount, 10);
    if (!isNaN(customVal)) {
      limit = Math.max(5, Math.min(300, customVal));
    } else {
      limit = Math.max(5, Math.min(300, questionLimit || 10));
    }

    const shuffled = uniquePool.sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, Math.min(limit, uniquePool.length));

    const questions = selected.map(card => {
      if (Array.isArray(card.options) && card.options.length >= 2 && card.correctAnswer) {
        return {
          ...card,
          options: [...card.options].sort(() => 0.5 - Math.random()),
        };
      }
      const targetAnswer = card.answer || card.correctAnswer;
      const distractors = flashcards
        .filter(c => c.id !== card.id && (c.answer || c.correctAnswer) !== targetAnswer)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3)
        .map(c => c.answer || c.correctAnswer);
      const options = [targetAnswer, ...distractors].sort(() => 0.5 - Math.random());
      return { ...card, options, correctAnswer: targetAnswer };
    });

    setQuizQuestions(questions);
    setQuizMode(mode);
    setQuizStarted(true);
    setCurrentQuestionIndex(0);
    setScore(0);
    setShowResults(false);
    setSelectedOption(null);
    setShowHint(false);
    setShowRationale(false);
    setIsCorrect(null);
    setEliminatedOptions([]);
    setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });
    setClassPoll(null);
    setIsFinalAnswer(false);
    setHighestMilestone("None");
    setSafetyNetScore(0);
    setShowQuitModal(false);
    setShowQuestionPopup(false);
    setShowLifelineRestore(false);

    if (useTimer) {
      const customTime = parseInt(customTimePerQuestion, 10);
      const time = (!isNaN(customTime)) ? Math.max(10, Math.min(60, customTime)) : 30;
      setTimeLeft(time);
      setMaxTime(time);
    } else {
      setTimeLeft(999);
      setMaxTime(999);
    }

    if (mode === 'speed') {
      playQuizSound('start');
      setTimeout(() => {
        enterFullscreen();
      }, 100);
    } else {
      exitFullscreen();
    }
  };

  const handleOptionClick = (option) => {
    if (showRationale || showResults) return;
    if (eliminatedOptions.includes(option)) return;
    if (selectedOption === option) {
      confirmAnswer(option);
    } else {
      setSelectedOption(option);
      setIsFinalAnswer(true);
    }
  };

  const confirmAnswer = (opt = selectedOption) => {
    if (!opt) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const correct = opt === currentQ.correctAnswer;
    setIsCorrect(correct);
    setIsFinalAnswer(false);
    if (correct) {
      playQuizSound('correct');
      const newScore = score + 1;
      setScore(newScore);

      const newConsecutive = consecutiveCorrect + 1;
      if (newConsecutive === 7) {
        setLifelinesUsed({ hint: false, fiftyFifty: false, askClass: false });
        setConsecutiveCorrect(0);
        setShowLifelineRestore(true);
      } else {
        setConsecutiveCorrect(newConsecutive);
      }

      updateQuizStats({ quizStreak: (studyStats.quizStreak || 0) + 1 });
    } else {
      playQuizSound('wrong');
      setConsecutiveCorrect(0);
      setShowRationale(true);
      updateQuizStats({ quizStreak: 0 });
    }
    setShowRationale(true);
  };

  const nextQuestion = () => {
    if (!isCorrect && quizMode === 'speed') {
      setShowResults(true);
      return;
    }
    if (currentQuestionIndex < quizQuestions.length - 1) {
      const nextIdx = currentQuestionIndex + 1;
      setCurrentQuestionIndex(nextIdx);
      setSelectedOption(null);
      setShowHint(false);
      setShowRationale(false);
      setIsCorrect(null);
      setEliminatedOptions([]);
      setClassPoll(null);
      setIsFinalAnswer(false);
      setShowLifelineRestore(false);

      if (useTimer) {
        const customTime = parseInt(customTimePerQuestion, 10);
        const time = (!isNaN(customTime)) ? Math.max(10, Math.min(60, customTime)) : 30;
        setTimeLeft(time);
        setMaxTime(time);
      }
    } else {
      setShowResults(true);
    }
  };

  const useFiftyFifty = () => {
    if (lifelinesUsed.fiftyFifty || showRationale || showResults) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const wrongs = currentQ.options.filter(o => o !== currentQ.correctAnswer);
    const toEliminate = wrongs.sort(() => 0.5 - Math.random()).slice(0, 2);
    setEliminatedOptions(toEliminate);
    setLifelinesUsed(prev => ({ ...prev, fiftyFifty: true }));
  };

  const useAskClass = () => {
    if (lifelinesUsed.askClass || showRationale || showResults) return;
    const currentQ = quizQuestions[currentQuestionIndex];
    const poll = currentQ.options.map(o => ({
      option: o,
      value: o === currentQ.correctAnswer ? Math.floor(Math.random() * 30) + 50 : Math.floor(Math.random() * 20)
    }));
    setClassPoll(poll);
    setLifelinesUsed(prev => ({ ...prev, askClass: true }));
  };

  // --- Render start ---
  if (!quizStarted) {
    return (
      <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-700 max-w-6xl mx-auto pb-20 px-4">
        {/* ... (unchanged mode selection UI) ... */}
        <header className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const next = secretTaps + 1;
                setSecretTaps(next);
                if (next >= 5) { navigate('/xp-hall'); setSecretTaps(0); }
              }}
              className="p-2 text-slate-200 dark:text-slate-700 hover:text-medical-500 dark:hover:text-medical-400 transition-colors rounded-xl active:scale-90"
            >
              <Brain size={22} />
            </button>
            <div>
              <h1 className="text-3xl sm:text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase">Quiz Modes</h1>
              <p className="text-slate-500 dark:text-slate-400 font-medium mt-1 uppercase tracking-[0.2em] text-[9px] sm:text-[10px]">Select your training intensity</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 bg-white dark:bg-slate-800 p-3 sm:p-4 rounded-2xl sm:rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700 w-full sm:w-auto justify-between sm:justify-start">
            <div className="text-center px-2 sm:px-4 border-r border-slate-100 dark:border-slate-700 flex-1 sm:flex-none">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Global Rank</p>
              <p className="text-lg sm:text-xl font-black text-indigo-600">#42</p>
            </div>
            <div className="text-center px-2 sm:px-4 flex-1 sm:flex-none">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">XP Earned</p>
              <p className="text-lg sm:text-xl font-black text-emerald-500">1,240</p>
            </div>
          </div>
        </header>

        <section className="bg-white dark:bg-slate-800 p-4 sm:p-6 rounded-2xl sm:rounded-3xl shadow-clinical border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <SettingsIcon size={18} />
            </div>
            <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Session Parameters</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Questions (5 to 300)</label>
              <div className="grid grid-cols-3 gap-2">
                {[5, 10, 20, 50, 100, 300].map(val => (
                  <button
                    key={val}
                    onClick={() => {
                      setQuestionLimit(val);
                      setCustomQuestionCount('');
                    }}
                    className={`py-2 rounded-xl font-black text-xs transition-all ${questionLimit === val && customQuestionCount === ''
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                  >
                    {val}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="5"
                max="300"
                value={customQuestionCount}
                onChange={(e) => {
                  setCustomQuestionCount(e.target.value);
                  const num = parseInt(e.target.value, 10);
                  if (!isNaN(num)) {
                    setQuestionLimit(num);
                  }
                }}
                placeholder="Custom amount"
                className="w-full py-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Timer (10s to 60s)</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  onClick={() => setUseTimer(true)}
                  className={`py-2 rounded-xl font-black text-xs transition-all ${useTimer ? 'bg-emerald-500 text-white shadow-md' : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  ON
                </button>
                <button
                  onClick={() => setUseTimer(false)}
                  className={`py-2 rounded-xl font-black text-xs transition-all ${!useTimer ? 'bg-red-500 text-white shadow-md' : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  OFF
                </button>
              </div>
              {useTimer && (
                <>
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {[10, 20, 30, 60].map(val => (
                      <button
                        key={val}
                        onClick={() => {
                          setCustomTimePerQuestion(val.toString());
                        }}
                        className={`py-2 rounded-xl font-black text-xs transition-all ${customTimePerQuestion === val.toString()
                          ? 'bg-emerald-500 text-white shadow-md'
                          : 'bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                      >
                        {val}s
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min="10"
                    max="60"
                    value={customTimePerQuestion}
                    onChange={(e) => {
                      setCustomTimePerQuestion(e.target.value);
                    }}
                    placeholder="Custom secs (10-60)"
                    className="w-full py-2.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent transition-all"
                  />
                </>
              )}
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <ModeCard
            title="Clinical Challenge"
            desc="Simulated exam environment with critical rationales."
            icon={<Shield size={28} className="sm:w-8 sm:h-8" />}
            duration="Variable"
            timer={useTimer ? `${customTimePerQuestion || 30}s/Q` : "Relaxed"}
            color="medical"
            onClick={() => initQuiz('clinical', null)}
          />
          <ModeCard
            title="Quick Quiz"
            desc="Rapid questions for instant knowledge verification."
            icon={<Zap size={28} className="sm:w-8 sm:h-8" />}
            duration="Fast"
            timer="Instant"
            color="amber"
            onClick={() => {
              setQuestionLimit(10);
              initQuiz('quick', null);
            }}
          />
          <ModeCard
            title="Uselu Test Questions"
            desc="Focused practice with the Uselu Posting test question bank."
            icon={<Target size={28} className="sm:w-8 sm:h-8" />}
            duration="Focused"
            timer={useTimer ? `${customTimePerQuestion || 30}s/Q` : "Adaptive"}
            color="indigo"
            onClick={() => initQuiz('uselu', null)}
          />
          <ModeCard
            title="Speed Challenge"
            desc="The ultimate test. Custom limits applied."
            icon={<Timer size={28} className="sm:w-8 sm:h-8" />}
            duration="Infinite"
            timer={useTimer ? `${customTimePerQuestion || 30}s/Q` : "Relaxed"}
            color="emerald"
            onClick={() => initQuiz('speed', null)}
          />
        </div>
      </div>
    );
  }

  const currentQ = quizQuestions[currentQuestionIndex];

  if (showResults) {
    const finalScore = quizMode === 'speed' ? Math.max(score, safetyNetScore) : score;
    return (
      <div className="flex items-center justify-center min-h-[70vh] p-4">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`p-6 sm:p-10 rounded-3xl sm:rounded-[3.5rem] shadow-clinical border text-center max-w-2xl w-full ${quizMode === 'speed' ? 'bg-slate-950 border-slate-800' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}
        >
          <div className="w-16 h-16 sm:w-24 sm:h-24 bg-medical-50 text-medical-600 rounded-2xl sm:rounded-[2.5rem] flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-lg">
            <Trophy size={32} className="sm:w-12 sm:h-12" />
          </div>
          <h2 className={`text-2xl sm:text-4xl font-black mb-2 tracking-tight uppercase ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>Session Complete</h2>
          <p className="text-slate-400 dark:text-slate-400 font-bold uppercase tracking-widest text-[9px] sm:text-[10px] mb-6 sm:mb-10">Performance Analytics Generated</p>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-8 sm:mb-10">
            <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border ${quizMode === 'speed' ? 'bg-white/5 border-white/10' : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
              <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Final Score</p>
              <p className={`text-2xl sm:text-3xl font-black ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>{finalScore} <span className="text-xs sm:text-sm text-slate-400">/ {quizQuestions.length}</span></p>
            </div>
            <div className={`p-4 sm:p-6 rounded-2xl sm:rounded-3xl border ${quizMode === 'speed' ? 'bg-white/5 border-white/10' : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
              <p className="text-[9px] sm:text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Rank Achieved</p>
              <p className="text-base sm:text-xl font-black text-medical-400">{currentMilestone}</p>
            </div>
          </div>

          {quizMode === 'speed' && score > safetyNetScore && (
            <p className="text-xs text-red-400 font-black uppercase mb-8 tracking-widest animate-pulse">Failed at Q{score}. Safety net applied at Q{safetyNetScore}.</p>
          )}

          <div className="flex flex-col sm:flex-row gap-4">
            <button onClick={() => { setQuizStarted(false); exitFullscreen(); }} className={`flex-1 py-4 sm:py-5 rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-widest text-xs hover:opacity-90 transition-all ${quizMode === 'speed' ? 'bg-white/10 text-white border border-white/20' : 'bg-slate-100 dark:bg-white/10 text-slate-900 dark:text-white'}`}>
              Mode Selection
            </button>
            <button onClick={() => initQuiz(quizMode, null)} className="flex-1 py-4 sm:py-5 bg-medical-600 text-white rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-widest text-xs shadow-xl shadow-medical-500/20 active:scale-95 transition-all">
              Try Again
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  // --- Speed Challenge Full‑Screen Render ---
  return (
    <div className={`min-h-screen flex flex-col ${quizMode === 'speed' ? 'bg-slate-950 text-white fixed inset-0 z-[9999] h-[100dvh] w-[100vw] overflow-y-auto m-0 p-0' : ''} transition-colors duration-500 pb-32 sm:pb-48 overflow-x-hidden relative`}>
      {quizMode === 'speed' && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-24 -left-24 w-96 h-96 bg-medical-500/10 blur-[120px] rounded-full" />
          <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-amber-500/5 blur-[120px] rounded-full" />
        </div>
      )}

      {/* Centered container with max width */}
      <div className={`max-w-4xl w-full mx-auto ${quizMode === 'speed' ? 'pt-3 px-3 sm:pt-10 sm:px-6' : 'pt-6 sm:pt-10 px-4 sm:px-6'} relative z-10 flex-1 flex flex-col`}>
        {/* Header - visible, high contrast */}
        <div className="flex justify-between items-center mb-3 sm:mb-6">
          <button
            onClick={() => setShowQuitModal(true)}
            className={`p-2 sm:p-3 rounded-xl sm:rounded-2xl transition-all ${quizMode === 'speed' ? 'hover:bg-white/10' : 'hover:bg-slate-100 dark:hover:bg-white/5'}`}
          >
            <XCircle size={24} className={`sm:w-8 sm:h-8 ${quizMode === 'speed' ? 'text-slate-300' : 'text-slate-400'}`} />
          </button>
          <div className="flex flex-col items-center">
            <p className={`text-[10px] sm:text-xs font-black uppercase tracking-[0.3em] ${quizMode === 'speed' ? 'text-slate-300' : 'text-slate-400'}`}>{quizMode} MODE</p>
            <h3 className="text-base sm:text-xl font-black tracking-tighter uppercase">{currentMilestone}</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 sm:px-4 py-2 backdrop-blur-md rounded-xl sm:rounded-2xl border ${quizMode === 'speed' ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/5'}`}>
              <Zap className="text-amber-400" size={16} fill="currentColor" />
              <span className="text-base font-black tabular-nums text-white">{score}</span>
            </div>
          </div>
        </div>

        {/* Timer bars - high contrast */}
        <div className={`w-full h-1.5 sm:h-2 rounded-full overflow-hidden mb-2 ${quizMode === 'speed' ? 'bg-white/20' : 'bg-slate-100 dark:bg-white/5'}`}>
          <motion.div
            initial={false}
            animate={{ width: `${(timeLeft / maxTime) * 100}%`, backgroundColor: timeLeft <= 5 ? '#ef4444' : '#10b981' }}
            className="h-full transition-colors duration-500"
          />
        </div>

        <div className={`w-full h-2 sm:h-3 rounded-full overflow-hidden p-0.5 border ${quizMode === 'speed' ? 'bg-white/20 border-white/30' : 'bg-slate-100 dark:bg-white/5 border-slate-50 dark:border-white/5'}`}>
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${((currentQuestionIndex + 1) / quizQuestions.length) * 100}%` }}
            className="h-full bg-medical-500 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.5)]"
          />
        </div>

        <div className="flex justify-between mt-2 sm:mt-4">
          <div className="flex items-center gap-2">
            <Star className="text-amber-400" size={14} fill="currentColor" />
            <span className="text-xs font-black tabular-nums text-white">{score * 10} XP</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className={timeLeft <= 5 ? 'text-red-400 animate-pulse' : 'text-slate-300'} size={14} />
            <span className={`text-xs font-black tabular-nums ${timeLeft <= 5 ? 'text-red-400' : 'text-white'}`}>{timeLeft}s</span>
          </div>
        </div>

        {/* Lifelines - high contrast */}
        <div className="max-w-4xl mx-auto px-3 sm:px-6 mt-4 sm:mt-8 relative z-30">
          <div className={`backdrop-blur-xl p-2 sm:p-4 rounded-2xl sm:rounded-3xl shadow-sm border grid grid-cols-3 gap-2 sm:gap-4 ${quizMode === 'speed' ? 'bg-slate-900/80 border-white/20' : 'bg-white/80 dark:bg-slate-900/80 border-slate-100 dark:border-white/5'}`}>
            <LifelineButton
              icon={<Target size={18} className="sm:w-6 sm:h-6" />} label="50/50"
              used={lifelinesUsed.fiftyFifty}
              onClick={useFiftyFifty}
              dark={quizMode === 'speed'}
            />
            <LifelineButton
              icon={<HelpCircle size={18} className="sm:w-6 sm:h-6" />} label="Hint"
              used={lifelinesUsed.hint}
              onClick={() => {
                setShowHint(true);
                setLifelinesUsed(prev => ({ ...prev, hint: true }));
              }}
              dark={quizMode === 'speed'}
            />
            <LifelineButton
              icon={<Users size={18} className="sm:w-6 sm:h-6" />} label="Poll"
              used={lifelinesUsed.askClass}
              onClick={useAskClass}
              dark={quizMode === 'speed'}
            />
          </div>
        </div>

        {/* Question and Options - centered */}
        <div className="max-w-4xl w-full mx-auto mt-4 sm:mt-8 px-3 sm:px-6 relative z-10 flex-1 flex flex-col justify-center">
          <motion.div
            key={currentQuestionIndex}
            initial={{ x: 20, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            className="space-y-6 sm:space-y-12"
          >
            <div className="text-center space-y-3 sm:space-y-6">
              <div className="flex flex-col items-center gap-2">
                <span className="px-3 sm:px-4 py-1 bg-medical-500/20 text-medical-400 rounded-full text-[9px] font-black uppercase tracking-widest border border-medical-500/30">
                  {currentQ?.subject}
                </span>
                <p className="text-[9px] sm:text-[10px] font-bold text-slate-300 uppercase tracking-widest">Question {currentQuestionIndex + 1}</p>
              </div>
              <h2 className={`text-xl sm:text-3xl md:text-4xl font-black leading-tight tracking-tight px-2 sm:px-4 drop-shadow-sm ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                {currentQ?.question}
              </h2>
              <div className="flex justify-center">
                <div className="px-3 sm:px-4 py-1.5 bg-indigo-500/20 text-indigo-300 rounded-lg text-[9px] font-black uppercase tracking-[0.2em] shadow-[0_0_10px_rgba(99,102,241,0.3)] border border-indigo-500/30">
                  SOURCE: {currentQ?.source || "UNKNOWN SOURCE"}
                </div>
              </div>
            </div>

            <div className={`grid ${quizMode === 'speed' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'} gap-3 sm:gap-4`}>
              {currentQ?.options?.map((option, idx) => {
                const isLearningHighlight = false;
                return (
                  <OptionButton
                    key={idx}
                    index={idx}
                    label={option}
                    isSpeed={quizMode === 'speed'}
                    isLearningHighlight={isLearningHighlight}
                    state={
                      selectedOption === option
                        ? (isCorrect === null ? 'selected' : (isCorrect ? 'correct' : 'wrong'))
                        : (isCorrect !== null && option === currentQ.correctAnswer ? 'correct' : (eliminatedOptions.includes(option) ? 'eliminated' : 'default'))
                    }
                    pollValue={classPoll?.find(p => p.option === option)?.value}
                    onClick={() => handleOptionClick(option)}
                    disabled={showRationale || eliminatedOptions.includes(option)}
                    dark={quizMode === 'speed'}
                  />
                )
              })}
            </div>
          </motion.div>
        </div>
      </div>

      {/* Final Answer button - centered and visible */}
      <AnimatePresence>
        {isFinalAnswer && !showRationale && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-20 sm:bottom-32 left-1/2 -translate-x-1/2 w-[95%] sm:max-w-md px-4 sm:px-6 z-40"
          >
            <button
              onClick={() => confirmAnswer()}
              className="w-full py-4 sm:py-6 bg-amber-500 text-black rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-[0.2em] sm:tracking-[0.3em] text-xs sm:text-sm shadow-2xl shadow-amber-500/40 animate-bounce"
            >
              FINAL ANSWER?
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mastery Ladder (desktop) - unchanged */}
      {quizMode === 'speed' && (
        <div className="fixed left-6 top-1/2 -translate-y-1/2 hidden xl:block space-y-4">
          <div className="bg-slate-900/80 backdrop-blur-md p-6 rounded-[2.5rem] border border-white/20 w-48 shadow-2xl">
            <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-6">Mastery Ladder</h4>
            <div className="space-y-4">
              {[...MILESTONES].reverse().map(m => (
                <div key={m.q} className={`flex items-center gap-3 ${score >= m.q ? 'text-medical-400' : 'text-slate-500'}`}>
                  <div className={`w-2 h-2 rounded-full ${score >= m.q ? 'bg-medical-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-slate-700'}`} />
                  <span className="text-[10px] font-black uppercase tracking-tighter">{m.label}</span>
                  {score >= m.q && <CheckCircle2 size={10} />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quit Modal */}
      <AnimatePresence>
        {showQuitModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className={`relative p-6 sm:p-10 rounded-3xl sm:rounded-[3rem] shadow-2xl border text-center max-w-sm ${quizMode === 'speed' ? 'bg-slate-900 border-white/20' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}
            >
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-amber-500/20 text-amber-400 rounded-2xl sm:rounded-[2rem] flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-inner">
                <AlertCircle size={32} className="sm:w-10 sm:h-10" />
              </div>
              <h4 className={`text-xl sm:text-2xl font-black mb-3 ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>Abandon Challenge?</h4>
              <p className="text-slate-300 font-medium italic text-base sm:text-lg leading-relaxed mb-8 sm:mb-10">
                "Every skipped challenge is a missed opportunity to strengthen your clinical judgment."
              </p>
              <div className="space-y-3 sm:space-y-4">
                <button onClick={() => setShowQuitModal(false)} className="w-full py-4 sm:py-5 bg-medical-600 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg shadow-medical-500/20 active:scale-95 transition-all">
                  Stay and Master
                </button>
                <button onClick={() => { setQuizStarted(false); exitFullscreen(); }} className="w-full py-3 sm:py-4 text-slate-400 hover:text-red-400 font-black uppercase tracking-widest text-[9px] transition-colors">
                  Quit for now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Rationale Overlay - unchanged */}
      <AnimatePresence>
        {showRationale && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              className={`relative w-full max-w-2xl rounded-t-3xl sm:rounded-[3rem] p-4 sm:p-10 shadow-2xl border ${quizMode === 'speed' ? 'bg-slate-900 border-white/20' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-white/10'}`}
            >
              <div className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-[2rem] flex items-center justify-center mb-6 sm:mb-8 mx-auto sm:mx-0 ${isCorrect ? 'bg-emerald-500/20 text-emerald-400 shadow-lg shadow-emerald-500/20' : 'bg-red-500/20 text-red-400 shadow-lg shadow-red-500/20'}`}>
                {isCorrect ? <CheckCircle2 size={32} className="sm:w-10 sm:h-10" /> : <XCircle size={32} className="sm:w-10 sm:h-10" />}
              </div>
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                <div>
                  <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-1">
                    {isCorrect ? 'Logic Validated' : 'Conceptual Misalignment'}
                  </p>
                  <h4 className={`text-2xl sm:text-3xl font-black tracking-tight leading-none ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                    {isCorrect ? 'Mastery Confirmed' : 'Learning Opportunity'}
                  </h4>
                </div>
                {showLifelineRestore && isCorrect && (
                  <div className="px-3 sm:px-4 py-2 bg-amber-500/20 text-amber-400 rounded-xl text-[9px] sm:text-[10px] font-black uppercase tracking-widest animate-bounce flex items-center gap-2 border border-amber-500/30">
                    <Zap size={12} /> Lifeline Restored!
                  </div>
                )}
              </div>
              {!isCorrect && (
                <div className="mb-4">
                  <p className="text-[9px] sm:text-[10px] font-black uppercase text-medical-400 mb-1 tracking-widest">Correct Answer</p>
                  <p className="text-sm font-bold text-slate-200 leading-snug">{currentQ?.correctAnswer}</p>
                </div>
              )}
              <div className="max-h-40 overflow-y-auto custom-scrollbar mb-6 sm:mb-8">
                <p className="text-slate-300 font-medium text-base sm:text-lg leading-relaxed italic">
                  {currentQ?.rationale || "Nurses must apply critical thinking and clinical protocols to ensure patient safety and prioritize airway, breathing, and circulation."}
                </p>
              </div>

              <div className="p-4 sm:p-6 bg-white/5 rounded-xl sm:rounded-2xl mb-8 sm:mb-10 border border-white/10 flex gap-3 sm:gap-4 items-start">
                <div className="p-2 bg-medical-500/20 text-medical-400 rounded-lg shrink-0">
                  <Target size={16} />
                </div>
                <div>
                  <p className="text-[9px] sm:text-[10px] font-black uppercase text-medical-400 mb-1 tracking-widest">Clinical Mentor Note</p>
                  <p className="text-sm font-bold text-slate-200 leading-snug italic">"{currentQ?.hint || 'Focus on the physiological foundation and the primary action that ensures long-term stability.'}"</p>
                </div>
              </div>
              <button onClick={nextQuestion} className="w-full py-4 sm:py-6 bg-white text-slate-900 rounded-2xl sm:rounded-[2rem] font-black uppercase tracking-[0.3em] text-xs shadow-2xl active:scale-95 transition-all flex items-center justify-center gap-3 sm:gap-4 hover:gap-6">{currentQuestionIndex < quizQuestions.length - 1 ? 'Next Challenge' : 'Complete Quiz'} <ArrowRight size={18} className="sm:w-5 sm:h-5" /></button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Question Review Popup - unchanged */}
      <AnimatePresence>
        {showQuestionPopup && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur-sm"
              onClick={() => setShowQuestionPopup(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className={`fixed bottom-0 left-0 right-0 z-[70] max-h-[80vh] overflow-y-auto rounded-t-3xl sm:rounded-t-[3rem] p-4 sm:p-6 shadow-2xl border ${quizMode === 'speed' ? 'bg-slate-900 border-white/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-white/10'}`}
            >
              <div className="flex justify-between items-center mb-4 sm:mb-6">
                <h3 className={`text-lg sm:text-xl font-black ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                  Question Review
                </h3>
                <button
                  onClick={() => setShowQuestionPopup(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors"
                >
                  <XCircle size={20} className="sm:w-6 sm:h-6 text-slate-400" />
                </button>
              </div>

              {currentQ && (
                <div className="space-y-4 sm:space-y-6">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Question {currentQuestionIndex + 1}</p>
                    <p className={`text-sm sm:text-base font-semibold mt-1 ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>
                      {currentQ.question}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">Source: {currentQ.source || 'Unknown'}</p>
                  </div>

                  <div className="space-y-2">
                    {currentQ.options.map((opt, idx) => {
                      const isCorrectOpt = opt === currentQ.correctAnswer;
                      const isSelected = opt === selectedOption;
                      let bgColor = 'bg-transparent';
                      let borderColor = 'border-white/20';
                      let textColor = quizMode === 'speed' ? 'text-slate-200' : 'text-slate-700 dark:text-slate-300';
                      if (isCorrectOpt) {
                        bgColor = 'bg-emerald-500/20';
                        borderColor = 'border-emerald-400';
                        textColor = 'text-emerald-300';
                      } else if (isSelected && !isCorrectOpt) {
                        bgColor = 'bg-red-500/20';
                        borderColor = 'border-red-400';
                        textColor = 'text-red-300';
                      }
                      return (
                        <div
                          key={idx}
                          className={`flex items-center gap-3 p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 ${bgColor} ${borderColor} ${textColor} transition-colors`}
                        >
                          <span className="font-mono text-sm font-bold w-6">{String.fromCharCode(65 + idx)}.</span>
                          <span className="flex-1 text-sm">{opt}</span>
                          {isCorrectOpt && <CheckCircle2 size={16} className="sm:w-5 sm:h-5 text-emerald-400 shrink-0" />}
                          {isSelected && !isCorrectOpt && <XCircle size={16} className="sm:w-5 sm:h-5 text-red-400 shrink-0" />}
                        </div>
                      );
                    })}
                  </div>

                  {selectedOption && (
                    <div className="mt-4 p-4 bg-white/5 rounded-xl sm:rounded-2xl border border-white/10">
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Your Answer</p>
                      <p className={`font-semibold text-sm ${selectedOption === currentQ.correctAnswer ? 'text-emerald-400' : 'text-red-400'}`}>
                        {selectedOption} {selectedOption === currentQ.correctAnswer ? '✅ Correct' : '❌ Incorrect'}
                      </p>
                      {selectedOption !== currentQ.correctAnswer && (
                        <p className="text-xs text-slate-400 mt-1">Correct: {currentQ.correctAnswer}</p>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => setShowQuestionPopup(false)}
                    className="w-full py-4 bg-medical-600 text-white rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-xs shadow-lg active:scale-95 transition-all"
                  >
                    Back to Quiz
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Floating arrow - remains unchanged */}
      {!showQuestionPopup && quizStarted && !showResults && showRationale && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          onClick={() => setShowQuestionPopup(true)}
          className="fixed bottom-4 sm:bottom-6 right-4 sm:right-6 z-50 p-3 sm:p-4 bg-medical-600 text-white rounded-full shadow-2xl shadow-medical-500/30 hover:scale-110 active:scale-95 transition-all border border-white/20"
          aria-label="Open question review"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            className="sm:w-6 sm:h-6 rotate-180"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="18 15 12 9 6 15" />
          </svg>
        </motion.button>
      )}

      {/* Hint Overlay - unchanged */}
      <AnimatePresence>
        {showHint && !showRationale && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm" onClick={() => setShowHint(false)} />
            <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className={`relative w-full max-w-md p-6 sm:p-10 rounded-3xl sm:rounded-[3rem] shadow-2xl border text-center ${quizMode === 'speed' ? 'bg-slate-900 border-white/20' : 'bg-white dark:bg-slate-800 border-slate-100 dark:border-slate-700'}`}>
              <div className="w-16 h-16 sm:w-20 sm:h-20 bg-medical-500/20 text-medical-400 rounded-2xl sm:rounded-[2rem] flex items-center justify-center mx-auto mb-6 sm:mb-8 shadow-inner"><Target size={32} className="sm:w-10 sm:h-10" /></div>
              <h4 className={`text-xl sm:text-2xl font-black mb-3 ${quizMode === 'speed' ? 'text-white' : 'text-slate-900 dark:text-white'}`}>Mentor Strategy</h4>
              <p className="text-slate-300 font-medium italic text-base sm:text-lg leading-relaxed mb-8 sm:mb-10">
                "{currentQ?.hint || 'Prioritize patient safety and focus on the intervention that addresses the root cause of the clinical presentation.'}"
              </p>
              <button onClick={() => setShowHint(false)} className="w-full py-4 sm:py-5 bg-white/10 text-white border border-white/20 rounded-xl sm:rounded-2xl font-black uppercase tracking-widest text-[10px] hover:bg-white/20 transition-all">
                Return to Question
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// --- ModeCard, LifelineButton, OptionButton (unchanged) ---
// (They remain exactly as in the original code, no changes needed)
const ModeCard = ({ title, desc, icon, duration, timer, color, onClick }) => {
  const colors = {
    medical: 'hover:border-medical-500 group-hover:text-medical-500 bg-medical-500/10 text-medical-600',
    amber: 'hover:border-amber-500 group-hover:text-amber-500 bg-amber-500/10 text-amber-600',
    indigo: 'hover:border-indigo-500 group-hover:text-indigo-500 bg-indigo-500/10 text-indigo-600',
    emerald: 'hover:border-emerald-500 group-hover:text-emerald-500 bg-emerald-500/10 text-emerald-600'
  };
  return (
    <button onClick={onClick} className={`p-4 sm:p-6 bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl border-2 border-slate-100 dark:border-slate-700 transition-all text-left group active:scale-95 flex flex-col justify-between min-h-[160px] sm:min-h-[200px] shadow-sm hover:shadow-xl ${colors[color].split(' ')[0]}`}>
      <div>
        <div className={`w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl flex items-center justify-center mb-3 sm:mb-6 transition-all group-hover:scale-110 shadow-inner ${colors[color].split(' ').pop()} ${colors[color].split(' ')[1]}`}>{icon}</div>
        <h3 className="text-base sm:text-xl font-black text-slate-900 dark:text-white mb-1 sm:mb-2 tracking-tight group-hover:translate-x-1 transition-transform">{title}</h3>
        <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm font-medium leading-relaxed line-clamp-2">{desc}</p>
      </div>
      <div className="flex gap-3 sm:gap-4 mt-3 sm:mt-6">
        <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-wider"><Clock size={12} /> {duration}</div>
        <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-black uppercase text-slate-400 tracking-wider"><Timer size={12} /> {timer}</div>
      </div>
    </button>
  );
};

const LifelineButton = ({ icon, label, used, onClick, dark }) => (
  <button disabled={used} onClick={onClick} className={`flex flex-col items-center justify-center p-3 sm:p-4 rounded-xl sm:rounded-2xl border-2 transition-all active:scale-90 shadow-sm ${used
    ? (dark ? 'bg-white/5 border-white/10 text-white/30' : 'bg-slate-50 border-slate-100 text-slate-300')
    : (dark ? 'bg-white/10 border-white/30 text-amber-400 hover:border-amber-400 hover:bg-white/20' : 'bg-white border-slate-100 text-medical-600 hover:border-medical-500 hover:bg-medical-50')
    }`}>
    {React.cloneElement(icon, { size: 24, className: 'w-6 h-6 sm:w-8 sm:h-8' })}
    <span className="text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] mt-2 sm:mt-3">{label}</span>
  </button>
);

const OptionButton = ({ label, index, state, pollValue, onClick, disabled, dark, isSpeed, isLearningHighlight }) => {
  const letters = ['A', 'B', 'C', 'D'];

  let baseStyles = dark
    ? 'bg-transparent border-white/10 text-slate-300 hover:bg-white/5 hover:border-white/20 hover:text-white'
    : 'bg-white border-slate-100 text-slate-700 hover:border-medical-500 hover:shadow-md';

  if (state === 'selected') baseStyles = dark
    ? 'bg-amber-500/10 border-amber-500/50 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
    : 'bg-medical-50 border-medical-500 text-medical-700 shadow-md';

  if (state === 'correct') baseStyles = 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.2)]';
  if (state === 'wrong') baseStyles = 'bg-red-500/10 border-red-500/50 text-red-400 shadow-[0_0_15px_rgba(239,68,68,0.2)]';
  if (state === 'eliminated') baseStyles = 'opacity-30 grayscale pointer-events-none scale-95';

  if (isLearningHighlight && state === 'default') {
    baseStyles = dark
      ? 'bg-indigo-900/10 border-indigo-500/30 text-indigo-200 shadow-[0_0_15px_rgba(99,102,241,0.2)] hover:bg-indigo-900/30'
      : 'bg-indigo-50/50 border-indigo-300 text-indigo-900 shadow-[0_0_15px_rgba(99,102,241,0.3)] hover:bg-indigo-50 hover:border-indigo-400';
  }

  return (
    <button disabled={disabled} onClick={onClick} className={`w-full relative flex items-center p-4 sm:p-5 rounded-2xl sm:rounded-3xl border-2 transition-all duration-300 overflow-hidden ${baseStyles} active:scale-95 min-h-[70px] sm:min-h-[80px]`}>
      {isLearningHighlight && state === 'default' && (
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 via-purple-500/5 to-pink-500/5 animate-pulse pointer-events-none" />
      )}
      <div className={`flex items-center w-full relative z-10 ${isSpeed ? 'flex-col gap-3 justify-center text-center' : 'gap-4 sm:gap-5'}`}>
        <span className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center font-black text-sm sm:text-base border-2 shrink-0 ${state === 'selected' ? 'bg-amber-500/20 border-amber-500/50 text-amber-400'
            : (isLearningHighlight && state === 'default' ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
              : (dark ? 'bg-transparent border-white/10 text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-500'))
          }`}>{letters[index]}</span>
        <span className={`flex-1 font-bold leading-snug ${isSpeed ? 'text-center text-base sm:text-lg px-2' : 'text-left text-base sm:text-lg pr-2'}`}>{label}</span>

        {isLearningHighlight && state === 'default' && (
          <div className={`px-2 py-1 sm:px-3 sm:py-1.5 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-[0.2em] shadow-lg flex items-center gap-1 sm:gap-1.5 transform hover:scale-105 transition-transform ${isSpeed ? 'mt-2' : ''}`}>
            <Sparkles size={12} className="sm:w-3.5 sm:h-3.5" /> Answer
          </div>
        )}

        {pollValue !== undefined && <div className={`shrink-0 ${isSpeed ? 'mt-2 flex flex-col items-center w-full max-w-[100px]' : 'text-right'}`}><p className={`text-base sm:text-xl font-black tabular-nums text-white ${isSpeed ? 'text-center' : ''}`}>{pollValue}%</p><div className={`w-10 sm:w-14 h-1 sm:h-1.5 bg-white/20 rounded-full overflow-hidden mt-1 ${isSpeed ? 'mx-auto' : ''}`}><div className="h-full bg-medical-400" style={{ width: `${pollValue}%` }} /></div></div>}
      </div>
      {state === 'correct' && <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} className={`absolute p-4 sm:p-6 text-emerald-400/20 pointer-events-none ${isSpeed ? 'inset-0 flex items-center justify-center opacity-50' : 'right-0 top-0'}`}><CheckCircle2 size={isSpeed ? 120 : 60} className={isSpeed ? "w-32 h-32" : "sm:w-20 sm:h-20"} /></motion.div>}
    </button>
  );
};

export default React.memo(Quiz);
