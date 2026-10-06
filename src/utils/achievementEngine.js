// Deterministic achievement evaluation — no server calls, no AI.
//
// Mirrors the 10 achievements seeded in scripts/migration-v10-upgrade.sql
// (achievements catalog + user_achievements owner-RLS table). Given a snapshot
// of the learner's real data, returns the set of achievement KEYS that are
// currently earned. The AppContext layer persists newly-earned keys to
// user_achievements (joining by key -> id) and fires celebration toasts.

export const ACHIEVEMENT_CATALOG = [
  { key: 'first-quiz', name: 'First Quiz', description: 'Complete your first quiz.', emoji: '🎯', tone: 'bg-apex-600' },
  { key: 'questions-50', name: '50 Questions', description: 'Answer 50 questions total.', emoji: '📚', tone: 'bg-emerald-500' },
  { key: 'questions-100', name: '100 Questions', description: 'Answer 100 questions total.', emoji: '⚡', tone: 'bg-amber-500' },
  { key: 'questions-500', name: '500 Questions', description: 'Answer 500 questions total.', emoji: '🔥', tone: 'bg-rose-500' },
  { key: 'streak-7', name: '7-Day Streak', description: 'Maintain a 7-day study streak.', emoji: '🔥', tone: 'bg-orange-500' },
  { key: 'streak-30', name: '30-Day Streak', description: 'Maintain a 30-day study streak.', emoji: '🌟', tone: 'bg-purple-500' },
  { key: 'medication-master', name: 'Medication Master', description: 'Reach the Medication Master identity (Tier 3).', emoji: '💊', tone: 'bg-rose-400' },
  { key: 'clinical-strategist', name: 'Clinical Strategist', description: 'Reach the Clinical Strategist identity (Tier 5).', emoji: '🧠', tone: 'bg-indigo-500' },
  { key: 'daily-goal', name: 'Daily Goal', description: 'Complete today\'s daily goal.', emoji: '✅', tone: 'bg-slate-600' }
];

// Total questions answered across all recorded quizzes.
const totalQuestions = (quizHistory = []) =>
  quizHistory.reduce((sum, r) => sum + (r.total || 0), 0);

// Evaluate every catalog achievement against a live data snapshot. Returns an
// array of earned keys (empty set for a brand-new learner).
export const evaluateAchievements = (snapshot = {}) => {
  const { quizHistory = [], studyStats = {}, identity = null, dailyGoalDone = false } = snapshot;
  const earned = new Set();

  const qCount = quizHistory.length;
  const totalQ = totalQuestions(quizHistory);
  const dayStreak = studyStats.streak || 0;
  const identityTier = identity?.tier ?? 0;

  if (qCount >= 1) earned.add('first-quiz');
  if (totalQ >= 50) earned.add('questions-50');
  if (totalQ >= 100) earned.add('questions-100');
  if (totalQ >= 500) earned.add('questions-500');
  if (dayStreak >= 7) earned.add('streak-7');
  if (dayStreak >= 30) earned.add('streak-30');
  if (identityTier >= 3) earned.add('medication-master');
  if (identityTier >= 5) earned.add('clinical-strategist');
  if (dailyGoalDone) earned.add('daily-goal');

  return [...earned];
};