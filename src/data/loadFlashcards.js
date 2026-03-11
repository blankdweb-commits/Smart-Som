const modules = import.meta.glob('./flashcards/**/*.json', { eager: true });

export const allBuiltInFlashcards = Object.entries(modules).flatMap(([path, module]) => {
  // Infer category, level, and semester from path if missing
  // Path format: ./flashcards/academic/year-1/sem-1/file.json
  const parts = path.split('/');
  const fIdx = parts.indexOf('flashcards');

  const inferredCategory = parts[fIdx + 1] ? parts[fIdx + 1].charAt(0).toUpperCase() + parts[fIdx + 1].slice(1) : 'Academic';

  // Handle curriculum subfolders: curriculum/program/year/sem/file.json
  let inferredLevel, inferredSemester, inferredProgram;
  if (inferredCategory === 'Curriculum') {
    inferredProgram = parts[fIdx + 2]; // e.g. 'nd-nursing'
    inferredLevel = parts[fIdx + 3] ? parts[fIdx + 3].replace('year-', 'Year ') : 'Year 1';
    inferredSemester = parts[fIdx + 4] ? parts[fIdx + 4].replace('sem-', 'Semester ') : 'Semester 1';
  } else {
    inferredLevel = parts[fIdx + 2] ? parts[fIdx + 2].replace('year-', 'Year ') : 'Year 1';
    inferredSemester = parts[fIdx + 3] ? parts[fIdx + 3].replace('sem-', 'Semester ') : 'Semester 1';
  }

  // Specific overrides for professional tracks
  const finalCategory = inferredCategory === 'Nclex' ? 'NCLEX' : inferredCategory === 'Nmcn' ? 'NMCN' : inferredCategory;

  // Prevent Professional exams from leaking into Academic Year defaults
  if (finalCategory === 'NCLEX' || finalCategory === 'NMCN') {
    inferredLevel = 'Professional';
    inferredSemester = 'Exam Prep';
  }

  const data = module.default;
  let cards = [];

  if (Array.isArray(data)) {
    cards = data;
  } else if (data.courses) {
    // Handle nested structure: { courses: [ { units: [ { flashcards: [] } ] } ] }
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
    // Normalize subject names to prevent duplicates like "Anatomy and Physiology" vs "Anatomy & Physiology"
    let normalizedSubject = card.subject || 'General';
    normalizedSubject = normalizedSubject
      .replace(/\s+and\s+/gi, ' & ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      category: finalCategory,
      level: inferredLevel,
      semester: inferredSemester,
      program: inferredProgram,
      ...card, // Original card properties override inferred ones
      subject: normalizedSubject,
      important: card.isImportant || card.important || false,
      srs: card.srs || {
        interval: 0,
        reps: 0,
        efactor: 2.5,
        nextReview: new Date().toISOString()
      }
    };
  });
});
