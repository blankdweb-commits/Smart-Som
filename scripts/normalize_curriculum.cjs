const fs = require('fs');
const path = require('path');

const CURRICULUM_MASTER = {
  "Year 1": {
    "Semester 1": [
      { "course": "Anatomy and Physiology I" },
      { "course": "Foundation of Nursing I" },
      { "course": "Introduction Of Nursing Informatics" },
      { "course": "The Use of English Language" },
      { "course": "Applied Physics" },
      { "course": "Applied Chemistry" },
      { "course": "Microbiology" },
      { "course": "Social and Behavioural Science" }
    ],
    "Semester 2": [
      { "course": "Primary Health Care I" },
      { "course": "Pharmacology I" },
      { "course": "Anatomy and Physiology II" },
      { "course": "Foundation of nursing II" },
      { "course": "Medico/Surgical Nursing I" },
      { "course": "Nursing Ethics and Jurisprudence" }
    ]
  },
  "Year 2": {
    "Semester 1": [
      { "course": "Anatomy and Physiology III" },
      { "course": "Foundation of Nursing II" },
      { "course": "Medical/Surgical Nursing II" },
      { "course": "Primary Health Care II" },
      { "course": "Pharmacology II" },
      { "course": "Reproductive Health I" },
      { "course": "Research and statistics I" }
    ],
    "Semester 2": [
      { "course": "Foundation of Nursing IV" },
      { "course": "Medical Surgical Nursing III" },
      { "course": "Pharmacology III" },
      { "course": "Research methodology II" },
      { "course": "Community Health Nursing I" },
      { "course": "Reproductive Health II" },
      { "course": "Nutrition and Dietetics" },
      { "course": "Introduction to professional Writing and seminar in Nursing" },
      { "course": "Politics and Governance in Nursing" }
    ]
  },
  "Year 3": {
    "Semester 1": [
      { "course": "Medical surgical Nursing IV" },
      { "course": "Reproductive health III" },
      { "course": "Community health nursing II" },
      { "course": "Mental health Nursing" },
      { "course": "Emergency and Disaster Nursing" },
      { "course": "Quality improvement in Healthcare and patient safety" }
    ],
    "Semester 2": [
      { "course": "Medical Surgical Nursing V" },
      { "course": "Home health care nursing" },
      { "course": "Reproductive health V" },
      { "course": "Principle of Management and teaching" },
      { "course": "Health economics" },
      { "course": "Entrepreneurship in Nursing" }
    ]
  }
};

const BASE_DIR = 'src/data/flashcards/curriculum/general-nursing';

function normalizeSubject(name) {
  if (!name) return 'General';
  return name.replace(/\s+and\s+/gi, ' & ').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function process() {
  const allCards = [];
  const years = ['year-1', 'year-2', 'year-3'];

  years.forEach(y => {
    const sems = ['sem-1', 'sem-2'];
    sems.forEach(s => {
      const dir = path.join(BASE_DIR, y, s);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
        files.forEach(f => {
          const content = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          let cards = [];
          if (Array.isArray(content)) cards = content;
          else if (content.courses) {
            cards = content.courses.flatMap(c =>
              c.units.flatMap(u =>
                (u.flashcards || []).map(card => ({
                  ...card,
                  subject: normalizeSubject(c.title),
                  unit: u.unit_number
                }))
              )
            );
          }
          allCards.push(...cards.map(c => ({
            ...c,
            subject: normalizeSubject(c.subject),
            level: y.replace('year-', 'Year '),
            semester: s.replace('sem-', 'Semester ')
          })));
        });
      }
    });
  });

  // Deduplicate
  const uniqueCards = [];
  const seen = new Set();
  allCards.forEach(c => {
    const key = `${c.question}|${c.answer}`.toLowerCase();
    if (!seen.has(key)) {
      uniqueCards.push(c);
      seen.add(key);
    }
  });

  // Re-map to master
  Object.keys(CURRICULUM_MASTER).forEach(year => {
    Object.keys(CURRICULUM_MASTER[year]).forEach(semester => {
      const courses = CURRICULUM_MASTER[year][semester];
      const semesterData = {
        metadata: { program: "General Nursing", level: year, semester: semester, version: "3.1" },
        courses: courses.map(c => {
          const normalizedMasterSubject = normalizeSubject(c.course);
          // Find all cards belonging to this course
          const courseCards = uniqueCards.filter(card =>
            normalizeSubject(card.subject) === normalizedMasterSubject &&
            card.level === year &&
            card.semester === semester
          );

          // Group by unit
          const unitsMap = {};
          courseCards.forEach(card => {
            const unitName = card.unit || "General";
            if (!unitsMap[unitName]) unitsMap[unitName] = [];
            unitsMap[unitName].push({
              question: card.question,
              answer: card.answer,
              difficulty: card.difficulty || "intermediate",
              important: card.important || false
            });
          });

          return {
            title: c.course,
            units: Object.keys(unitsMap).map(u => ({
              unit_number: u,
              flashcards: unitsMap[u]
            }))
          };
        })
      };

      const outDir = path.join(BASE_DIR, year.toLowerCase().replace(' ', '-'), semester.toLowerCase().replace(' ', '-'));
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'normalized.json'), JSON.stringify(semesterData, null, 2));
    });
  });

  console.log(`Processed ${uniqueCards.length} unique cards.`);
}

process();
