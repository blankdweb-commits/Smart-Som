const modules = import.meta.glob('./flashcards/**/*.json', { eager: true });

export const allBuiltInFlashcards = Object.entries(modules).flatMap(([path, module]) => {
  // Infer category, level, and semester from path if missing
  // Path format: ./flashcards/academic/year-1/sem-1/file.json
  const parts = path.split('/');

  const inferredCategory = parts[2] ? parts[2].charAt(0).toUpperCase() + parts[2].slice(1) : 'Academic';
  let inferredLevel = parts[3] ? parts[3].replace('year-', 'Year ') : 'Year 1';
  let inferredSemester = parts[4] ? parts[4].replace('sem-', 'Semester ') : 'Semester 1';

  // Specific overrides for professional tracks
  const finalCategory = inferredCategory === 'Nclex' ? 'NCLEX' : inferredCategory === 'Nmcn' ? 'NMCN' : inferredCategory;

  return module.default.map(card => ({
    category: finalCategory,
    level: inferredLevel,
    semester: inferredSemester,
    ...card, // Original card properties override inferred ones
    important: card.isImportant || card.important || false,
    srs: card.srs || {
      interval: 0,
      reps: 0,
      efactor: 2.5,
      nextReview: new Date().toISOString()
    }
  }));
});
