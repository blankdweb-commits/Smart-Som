import { CURRICULUM_MASTER } from '../src/data/curriculumMaster.js';

function check() {
  const courses = [];
  Object.keys(CURRICULUM_MASTER).forEach(year => {
    Object.keys(CURRICULUM_MASTER[year]).forEach(semester => {
      CURRICULUM_MASTER[year][semester].forEach(course => {
        courses.push({ year, semester, ...course });

        const unitTitles = new Set();
        course.units.forEach(unit => {
          if (unitTitles.has(unit.unit)) {
            console.log(`Duplicate Unit: "${unit.unit}" in Course: "${course.course}" (${year} ${semester})`);
          }
          unitTitles.add(unit.unit);

          const topics = new Set();
          unit.topics.forEach(topic => {
            if (topics.has(topic)) {
              console.log(`Duplicate Topic: "${topic}" in Unit: "${unit.unit}" (${course.course})`);
            }
            topics.add(topic);
          });
        });
      });
    });
  });

  // Check for duplicate course names within the same semester
  const semesterCourses = {};
  courses.forEach(c => {
    const key = `${c.year}|${c.semester}|${c.course}`;
    if (semesterCourses[key]) {
      console.log(`Duplicate Course in Semester: "${c.course}" in ${c.year} ${c.semester}`);
    }
    semesterCourses[key] = true;
  });
}

check();
