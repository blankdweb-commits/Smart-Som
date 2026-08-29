// Question metadata helpers for the Question Intelligence System.
// Hardcoded banks remain the source of truth; these pure helpers normalize a
// card into a stable identity ("question id") and a "niche" used for the
// same-niche-different-angle selection strategy.

// Stable per-card identity. The bundled banks already carry stable ids
// (e.g. "pharm-123", "midw-42", "n200-9"); the legacy/imported cards fall back
// to the question text. This must match the `question_id` written to
// question_attempts so no-repetition keeps working.
export const questionId = (card) => {
  if (!card) return '';
  if (typeof card.id !== 'undefined' && card.id !== null && String(card.id).trim() !== '') {
    return String(card.id);
  }
  return (card.question || '').trim();
};

// A "niche" is the narrowest stable grouping a question belongs to. The
// Richard banks carry only subject/source/category, so we fall back to a
// deterministic subject+source niche; cards with an explicit `topic` use it.
export const niche = (card) => {
  if (!card) return 'general';
  const t = String(card.topic || '').trim();
  if (t) return t;
  const subject = String(card.subject || '').trim() || 'general';
  const source = String(card.source || '').trim();
  return source ? `${subject}::${source}` : subject;
};

// Whether two questions belong to the same niche (for re-asking a different
// angle of a concept the learner already saw).
export const isSameNiche = (a, b) => niche(a) === niche(b);

// Normalizes a card difficulty to the app's tier scale for reward math.
// Returns 'Easy' | 'Medium' | 'Hard' | 'Expert'.
export const tierOf = (card) => {
  const d = String(card && card.difficulty ? card.difficulty : '').toLowerCase();
  if (/easy/i.test(d)) return 'Easy';
  if (/expert/i.test(d)) return 'Expert';
  if (/hard|difficult/i.test(d)) return 'Hard';
  return 'Medium';
};

// Flat SC payout per correct answer: hard/expert tiers pay more, everything
// else pays the base amount. Kept in one place so the economy is easy to tune.
export const SC_PER_CORRECT = { base: 0.1, hard: 0.5 };
export const perCorrectSC = (card) => {
  const tier = tierOf(card);
  return tier === 'Hard' || tier === 'Expert' ? SC_PER_CORRECT.hard : SC_PER_CORRECT.base;
};
