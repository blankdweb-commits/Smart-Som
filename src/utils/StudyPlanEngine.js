// ============================================================
// Rule-based Study Plan engine (NO AI).
//
// Replaces the Gemini Study Coach with a deterministic, offline planner that
// builds "Today's Plan" from the learner's real activity: weak concepts,
// quiz accuracy, unlocked difficulty tiers, and current streaks. Always
// returns 1-4 actionable items; never blocks on a network call and never
// glitches the Dashboard.
//
// Each item: { id, title, desc, cta, target, tone, icon }
//   target   — a routable path (e.g. /weakness-drill, /quiz?practiceSubject=…)
//   tone     — tailwind-ish accent key (rose / medical / indigo / amber)
//   icon     — lucide name handled by the StudyPlanCard icon map
// ============================================================

// Difficulty tiers, lowest first, matching the unlock chain
// (Easy → Medium(50) → Hard(80) → Expert(100)). Level completions are keyed
// by tier id in user_quiz_progress.
const TIER_ORDER = ['Easy', 'Medium', 'Hard', 'Expert', 'Master', 'Extreme'];

const avgQuizAccuracy = (quizHistory = []) => {
  const rows = quizHistory.filter(r => (r.total || 0) > 0);
  if (rows.length === 0) return null;
  const correct = rows.reduce((sum, r) => sum + (r.score || 0), 0);
  const total = rows.reduce((sum, r) => sum + (r.total || 0), 0);
  return Math.round((correct / total) * 100);
};

export const generateDailyPlan = ({
  quizHistory = [],
  weakConcepts = [],
  levelCompletions = {},
  dayStreak = 0,
  quizStreak = 0
}) => {
  const plan = [];
  const acc = avgQuizAccuracy(quizHistory);

  // 1. Weakness drill — surfaced whenever real weak topics exist (accuracy < 60%).
  if (weakConcepts.length > 0) {
    plan.push({
      id: 'weakness-drill',
      title: 'Review your missed questions',
      desc: `${weakConcepts.length} weak ${weakConcepts.length === 1 ? 'concept' : 'concepts'} below 60% accuracy — revisit the exact questions you got wrong.`,
      cta: 'Open Weakness Drill',
      target: '/weakness-drill',
      tone: 'rose',
      icon: 'flame'
    });
  }

  // 2. Focused practice on the weakest subject (or a general practice quiz).
  const worst = weakConcepts.length ? weakConcepts[0] : null;
  if (worst && worst.subject && weakConcepts.some(w => String(w.subject || '').trim())) {
    plan.push({
      id: 'practice-quiz',
      title: `Practice ${worst.subject}`,
      desc: `One focused session on ${worst.name || 'your weakest area'} to lift accuracy above 60%.`,
      cta: 'Start Practice',
      target: `/quiz?practiceSubject=${encodeURIComponent(worst.subject)}`,
      tone: 'medical',
      icon: 'target'
    });
  } else {
    plan.push({
      id: 'practice-quiz',
      title: 'Practice quiz',
      desc: acc == null
        ? 'Your first session is a few taps away — warm up with a practice set.'
        : `Current accuracy ${acc}% — a short session keeps the rhythm.`,
      cta: 'Start Practice',
      target: '/quiz',
      tone: 'medical',
      icon: 'target'
    });
  }

  // 3. Next difficulty tier — show the lowest unpassed tier worth chasing.
  const current = TIER_ORDER.find(t => !levelCompletions[t]);
  plan.push({
    id: 'tier-progress',
    title: current
      ? `Chase the ${current} tier`
      : 'Push for Extreme',
    desc: current
      ? `Pass a ${current} quiz to unlock the next difficulty level.`
      : 'Every tier unlocked — go for the hardest questions we have.',
    cta: current ? `Take ${current} Quiz` : 'Go Extreme',
    target: `/quiz?difficulty=${current || 'Extreme'}`,
    tone: 'indigo',
    icon: 'trophy'
  });

  // 4. Streak / exam-prep push.
  if (dayStreak >= 3 && quizStreak >= 1) {
    plan.push({
      id: 'streak-quiz',
      title: 'Protect the streak',
      desc: `You're on a ${dayStreak}-day streak with a ${quizStreak} quiz streak — one more session extends it.`,
      cta: 'Keep It Going',
      target: '/quiz',
      tone: 'amber',
      icon: 'zap'
    });
  } else {
    plan.push({
      id: 'exam-prep',
      title: 'Review flashcards',
      desc: examPrepDesc(quizHistory, acc),
      cta: 'Open Cards',
      target: '/flashcards',
      tone: 'indigo',
      icon: 'book'
    });
  }

  return plan.slice(0, 4);
};

const examPrepDesc = (quizHistory, acc) => {
  if (acc == null) return 'Browse the card vault and start learning mode.';
  if (acc >= 70) return 'Solid accuracy — reinforce with a flashcard review session.';
  return 'Cards reinforce what quizzes reveal — a short review tightens recall.';
};