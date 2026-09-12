// Built-in flashcard data layer — DISABLED.
//
// The bundled SRS flashcard datasets (~15–16 MB of JSON) are intentionally NOT
// shipped to the browser any more. The CARDS tab is permanently locked to the
// admin-granted gated screen, so there is zero flashcard dataset loading: no
// bundle, no lazy chunk, no dynamic import for flashcard cards.
//
// The processing/memoisation functions below are kept purely for source
// compatibility; with an empty module map they always resolve to an empty
// array and never fetch a single JSON file.
const modules = {};

const processModule = (path, module) => {
  const parts = path.split('/');
  const fIdx = parts.indexOf('flashcards');
  const inferredCategory = parts[fIdx + 1] ? parts[fIdx + 1].charAt(0).toUpperCase() + parts[fIdx + 1].slice(1) : 'Academic';

  let inferredLevel, inferredSemester, inferredProgram;
  if (inferredCategory === 'Curriculum') {
    inferredProgram = parts[fIdx + 2];
    inferredLevel = parts[fIdx + 3] ? parts[fIdx + 3].replace('year-', 'Year ') : 'Year 1';
    inferredLevel = inferredLevel.charAt(0).toUpperCase() + inferredLevel.slice(1);
    inferredSemester = parts[fIdx + 4] ? parts[fIdx + 4].replace('sem-', 'Semester ').replace('semester-', 'Semester ') : 'Semester 1';
    inferredSemester = inferredSemester.charAt(0).toUpperCase() + inferredSemester.slice(1);
  } else {
    inferredLevel = parts[fIdx + 2] ? parts[fIdx + 2].replace('year-', 'Year ') : 'Year 1';
    inferredSemester = parts[fIdx + 3] ? parts[fIdx + 3].replace('sem-', 'Semester ') : 'Semester 1';
  }

  const finalCategory = inferredCategory === 'Nclex' ? 'NCLEX' : inferredCategory === 'Nmcn' ? 'NMCN' : inferredCategory;

  if (finalCategory === 'NCLEX' || finalCategory === 'NMCN') {
    inferredLevel = 'Professional';
    inferredSemester = 'Exam Prep';
  }

  const data = module.default;
  let cards = [];

  if (Array.isArray(data)) {
    cards = data;
  } else if (data.courses) {
    cards = data.courses.flatMap(course =>
      course.units.flatMap(unit =>
        (unit.flashcards || []).map(card => ({
          ...card,
          subject: course.title,
          unit: unit.unit_number,
          unitTitle: unit.title
        }))
      )
    );
  }

  return cards.map(card => {
    let normalizedSubject = card.subject || 'General';
    normalizedSubject = normalizedSubject
      .replace(/\s+and\s+/gi, ' & ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const finalLevel = card.level || inferredLevel;
    const normalizedLevel = (String(finalLevel) === '1' || String(finalLevel) === '100' || String(finalLevel) === '100L' || String(finalLevel) === 'year-1') ? 'Year 1' :
       (String(finalLevel) === '2' || String(finalLevel) === '200' || String(finalLevel) === '200L' || String(finalLevel) === 'year-2') ? 'Year 2' :
       (String(finalLevel) === '3' || String(finalLevel) === '300' || String(finalLevel) === '300L' || String(finalLevel) === 'year-3') ? 'Year 3' : finalLevel;

    // Detection for Richard's Bank
    const source = card.source || (path.toLowerCase().includes('richard') ? "Richard's Bank" : "Polynurse Core Bank");

    return {
      category: finalCategory,
      level: normalizedLevel,
      semester: card.semester || inferredSemester,
      program: inferredProgram,
      ...card,
      subject: normalizedSubject,
      source: source,
      important: card.isImportant || card.important || false,
      srs: card.srs || {
        interval: 0,
        reps: 0,
        efactor: 2.5,
        nextReview: new Date().toISOString()
      }
    };
  });
};

const dedupe = (cards) =>
  cards.filter((card, index, self) =>
    index === self.findIndex((t) => (
      t.question === card.question && t.answer === card.answer
    ))
  );

let builtInCardsPromise = null;

// Loads ALL bundled flashcards exactly once (memoized). Returns the full
// deduplicated array. The lazy glob means the JSON is fetched as a separate
// chunk on first authenticated need instead of blocking the initial route.
export const loadAllBuiltInFlashcards = () => {
  if (!builtInCardsPromise) {
    builtInCardsPromise = Promise.all(
      Object.entries(modules).map(async ([path, load]) => {
        const module = await load();
        return processModule(path, module);
      })
    ).then((all) => dedupe(all.flat()));
  }
  return builtInCardsPromise;
};

// Backwards-compatible sync export. DO NOT import this from the main route
// graph — it stays empty until the async loader above resolves. Use
// loadAllBuiltInFlashcards() instead.
export const allBuiltInFlashcards = [];