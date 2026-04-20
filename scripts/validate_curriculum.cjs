const fs = require('fs');
const path = require('path');

const BASE_DIR = 'src/data/flashcards/curriculum';

function validateFile(filepath) {
  const content = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  const errors = [];

  if (!content.courses || !Array.isArray(content.courses)) {
    errors.push("Missing or invalid 'courses' array");
    return errors;
  }

  const courseTitles = new Set();
  content.courses.forEach((course, cIdx) => {
    if (!course.title) errors.push(`Course at index ${cIdx} missing title`);
    if (courseTitles.has(course.title)) errors.push(`Duplicate course title: ${course.title}`);
    courseTitles.add(course.title);

    if (!course.units || !Array.isArray(course.units)) {
      errors.push(`Course '${course.title}' missing or invalid 'units' array`);
    } else {
      const unitNumbers = new Set();
      course.units.forEach((unit, uIdx) => {
        if (!unit.unit_number) errors.push(`Unit at index ${uIdx} in course '${course.title}' missing unit_number`);
        if (unitNumbers.has(unit.unit_number)) errors.push(`Duplicate unit_number '${unit.unit_number}' in course '${course.title}'`);
        unitNumbers.add(unit.unit_number);

        if (!unit.flashcards || !Array.isArray(unit.flashcards) || unit.flashcards.length === 0) {
          // errors.push(`Unit '${unit.unit_number}' in course '${course.title}' has no flashcards`);
        } else {
          const questions = new Set();
          unit.flashcards.forEach((card, fIdx) => {
            if (!card.question) errors.push(`Flashcard at index ${fIdx} in unit '${unit.unit_number}' missing question`);
            if (questions.has(card.question)) errors.push(`Duplicate question in unit '${unit.unit_number}': ${card.question.substring(0, 30)}...`);
            questions.add(card.question);
          });
        }
      });
    }
  });

  return errors;
}

function run() {
  const files = [
    'src/data/flashcards/curriculum/general-nursing/year-1/semester-1/normalized.json',
    'src/data/flashcards/curriculum/general-nursing/year-1/semester-2/normalized.json',
    'src/data/flashcards/curriculum/general-nursing/year-2/semester-1/normalized.json',
    'src/data/flashcards/curriculum/general-nursing/year-2/semester-2/normalized.json',
    'src/data/flashcards/curriculum/general-nursing/year-3/semester-1/normalized.json',
    'src/data/flashcards/curriculum/general-nursing/year-3/semester-2/normalized.json'
  ];

  let totalErrors = 0;
  files.forEach(f => {
    const fullPath = path.join(process.cwd(), f);
    if (fs.existsSync(fullPath)) {
      const errors = validateFile(fullPath);
      if (errors.length > 0) {
        console.error(`\nValidation errors in ${f}:`);
        errors.forEach(e => console.error(`  - ${e}`));
        totalErrors += errors.length;
      } else {
        console.log(`✓ ${f} is valid.`);
      }
    }
  });

  if (totalErrors > 0) {
    console.error(`\nTotal validation errors: ${totalErrors}`);
    process.exit(1);
  } else {
    console.log("\nAll curriculum files passed validation.");
  }
}

run();
