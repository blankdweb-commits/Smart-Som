import re

with open('src/pages/ExamTimetable.jsx', 'r') as f:
    content = f.read()

# Add useMemo and useNavigate
content = content.replace("useState, useRef", "useState, useRef, useMemo")
content = content.replace("import { useAppContext", "import { useNavigate } from 'react-router-dom';\nimport { useAppContext")
content = content.replace("const ExamTimetable = () => {", "const ExamTimetable = () => {\n  const navigate = useNavigate();")

# Course Indexing Logic
indexing_logic = """
  const { flashcards: allCards } = useAppContext();
  const indexedCourses = useMemo(() => {
    const courses = {};
    allCards.forEach(c => {
      if (!c.subject) return;
      if (!courses[c.subject]) courses[c.subject] = { questions: 0, flashcards: 0, sources: new Set() };
      courses[c.subject].questions += 1;
      courses[c.subject].flashcards += 1;
      if (c.source) courses[c.subject].sources.add(c.source);
    });
    return courses;
  }, [allCards]);
"""

content = content.replace("const sortedExams = [...exams].sort((a, b) => parseISO(a.date) - parseISO(b.date));", indexing_logic + "\n  const sortedExams = [...exams].sort((a, b) => parseISO(a.date) - parseISO(b.date));")

# Insertion point for Revision Cards
revision_cards_ui = """
            <AnimatePresence mode="popLayout">

              {/* Dynamic Course Revision Cards */}
              {Object.entries(indexedCourses).map(([name, stats]) => (
                <motion.div
                  key={name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-8 bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 relative overflow-hidden group"
                >
                  <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:scale-110 transition-transform"><BookOpen size={80}/></div>
                  <div className="relative z-10">
                    <div className="flex justify-between items-start mb-6">
                       <span className="px-3 py-1 bg-medical-50 dark:bg-medical-900/30 text-medical-600 dark:text-medical-400 rounded-lg text-[10px] font-black uppercase tracking-widest border border-medical-100 dark:border-medical-800">Available Course</span>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Revision Unit</span>
                    </div>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-2 tracking-tight">{name}</h3>
                    <div className="grid grid-cols-2 gap-4 mt-8">
                       <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/5">
                          <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Questions</p>
                          <p className="font-black text-slate-900 dark:text-white">{stats.questions}</p>
                       </div>
                       <div className="p-4 bg-slate-50 dark:bg-white/5 rounded-2xl border border-slate-100 dark:border-white/5">
                          <p className="text-[10px] font-black text-slate-400 uppercase mb-1">Flashcards</p>
                          <p className="font-black text-slate-900 dark:text-white">{stats.flashcards}</p>
                       </div>
                    </div>
                    <div className="mt-8 flex flex-col gap-3">
                       <button
                         onClick={() => navigate(`/quiz?mode=subject&subject=${encodeURIComponent(name)}`)}
                         className="w-full py-4 bg-slate-900 text-white dark:bg-white dark:text-slate-900 rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-xl active:scale-95 transition-all flex items-center justify-center gap-3 hover:gap-5"
                       >Start Revision <ArrowRight size={14}/></button>
                       <button
                         onClick={() => setView('calendar')}
                         className="w-full py-3 bg-slate-50 dark:bg-white/5 text-slate-400 rounded-xl font-black uppercase tracking-widest text-[9px] hover:bg-slate-100 transition-all"
                       >View Full Timetable</button>
                    </div>
                  </div>
                </motion.div>
              ))}
"""

content = content.replace('<AnimatePresence mode="popLayout">', revision_cards_ui)

with open('src/pages/ExamTimetable.jsx', 'w') as f:
    f.write(content)
