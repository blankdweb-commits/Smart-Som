const modules = import.meta.glob('./flashcards/**/*.json', { eager: true });

export const allBuiltInFlashcards = Object.values(modules).flatMap(module => {
  // Each module.default is the array of flashcards in that JSON
  return module.default.map(card => ({
    ...card,
    important: card.isImportant || card.important || false,
    srs: card.srs || {
      interval: 0,
      reps: 0,
      efactor: 2.5,
      nextReview: new Date().toISOString()
    }
  }));
});
