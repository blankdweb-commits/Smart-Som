// 12-tier identity progression ladder for Apex Scholars.
// Every new user starts at Tier 0 (Auxibaby 👶) and earns higher identities
// through real learning milestones (questions answered, quizzes, accuracy,
// speed challenges, and Smart Coins earned).
//
// The engine (identityEngine.js) picks the highest tier whose thresholds are
// all met. Thresholds are intentionally achievable — identities reward steady,
// genuine study, not byte-counting grind.

export const IDENTITIES = [
  {
    tier: 0,
    name: 'Auxibaby',
    emoji: '👶',
    tagline: 'Every scholar starts small.',
    color: 'from-slate-400 to-slate-500',
    required: { totalAttempts: 0, quizStreak: 0, cardsStudied: 0, accuracy: 0, scEarned: 0, speedRuns: 0 }
  },
  {
    tier: 1,
    name: 'The Curious Learner',
    emoji: '📚',
    tagline: 'First step onto the ladder — questions answered.',
    color: 'from-sky-400 to-sky-600',
    required: { totalAttempts: 25 }
  },
  {
    tier: 2,
    name: 'The Steady Hammer',
    emoji: '🔨',
    tagline: '25 questions with solid focus — consistency in motion.',
    color: 'from-amber-400 to-amber-600',
    required: { totalAttempts: 75, accuracy: 40 }
  },
  {
    tier: 3,
    name: 'The Medication Master',
    emoji: '💊',
    tagline: 'Fluent in pharmacology essentials.',
    color: 'from-rose-400 to-rose-600',
    required: { totalAttempts: 150, accuracy: 50 }
  },
  {
    tier: 4,
    name: 'The Systems Thinker',
    emoji: '🧩',
    tagline: 'Sees how body systems connect.',
    color: 'from-teal-400 to-teal-600',
    required: { totalAttempts: 250, accuracy: 55 }
  },
  {
    tier: 5,
    name: 'The Clinical Strategist',
    emoji: '🧠',
    tagline: 'Thinking like a clinician, not just a student.',
    color: 'from-indigo-400 to-indigo-600',
    required: { totalAttempts: 400, accuracy: 60, quizStreak: 3 }
  },
  {
    tier: 6,
    name: 'The Fearless Competitor',
    emoji: '⚔️',
    tagline: 'Sharpened in the XP Hall arena.',
    color: 'from-orange-400 to-orange-600',
    required: { totalAttempts: 550, accuracy: 62, speedRuns: 3 }
  },
  {
    tier: 7,
    name: 'The Evidence Interpreter',
    emoji: '🔬',
    tagline: 'Comfortable reading the nursing evidence base.',
    color: 'from-violet-400 to-violet-600',
    required: { totalAttempts: 750, accuracy: 65, quizStreak: 5 }
  },
  {
    tier: 8,
    name: 'The Mentor-in-Training',
    emoji: '🦉',
    tagline: 'Teaching others by example.',
    color: 'from-fuchsia-400 to-fuchsia-600',
    required: { totalAttempts: 1000, accuracy: 68, scEarned: 200 }
  },
  {
    tier: 9,
    name: 'The Exam Conqueror',
    emoji: '🏆',
    tagline: 'Built to pass, built to lead.',
    color: 'from-yellow-400 to-yellow-600',
    required: { totalAttempts: 1400, accuracy: 72, quizStreak: 7 }
  },
  {
    tier: 10,
    name: 'The Clinical Commander',
    emoji: '🛡️',
    tagline: 'A calm, authoritative presence at the bedside.',
    color: 'from-red-400 to-red-600',
    required: { totalAttempts: 2000, accuracy: 75, scEarned: 500 }
  },
  {
    tier: 11,
    name: 'The Apex Scholar',
    emoji: '👑',
    tagline: 'The highest echelon — mastery personified.',
    color: 'from-apex-400 to-apex-600',
    required: { totalAttempts: 3000, accuracy: 80, quizStreak: 10, scEarned: 1000 }
  }
];
