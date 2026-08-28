// Nursing-specific community discussion boards.
// Keys must match the `section` column on community_posts (migration-v4b).

export const COMMUNITY_SECTIONS = {
  general: {
    label: 'General',
    emoji: '🗣️',
    description: 'Open discussions with fellow nursing students',
    accentText: 'text-slate-600 dark:text-slate-400',
    accentBg: 'bg-slate-500/10 border-slate-500/25',
    chip: 'bg-slate-500'
  },
  clinical: {
    label: 'Clinical Questions',
    emoji: '🩺',
    description: 'Real clinical scenarios, assessments and patient-care dilemmas',
    accentText: 'text-sky-500',
    accentBg: 'bg-sky-500/10 border-sky-500/25',
    chip: 'bg-sky-500'
  },
  exams: {
    label: 'Exam Discussions',
    emoji: '📝',
    description: 'NMCN & school exam tips, past questions and study strategy',
    accentText: 'text-indigo-500',
    accentBg: 'bg-indigo-500/10 border-indigo-500/25',
    chip: 'bg-indigo-500'
  },
  'clinical-experience': {
    label: 'Clinical Experience',
    emoji: '🏥',
    description: 'Clinical postings, ward rounds and hands-on nursing stories',
    accentText: 'text-cyan-500',
    accentBg: 'bg-cyan-500/10 border-cyan-500/25',
    chip: 'bg-cyan-500'
  },
  pharmacology: {
    label: 'Pharmacology',
    emoji: '💊',
    description: 'Drugs, dosages, calculations and adverse effects',
    accentText: 'text-rose-500',
    accentBg: 'bg-rose-500/10 border-rose-500/25',
    chip: 'bg-rose-500'
  },
  'adult-health': {
    label: 'Adult Health',
    emoji: '❤️',
    description: 'Adult and medical-surgical nursing care',
    accentText: 'text-red-500',
    accentBg: 'bg-red-500/10 border-red-500/25',
    chip: 'bg-red-500'
  },
  'maternal-child': {
    label: 'Maternal & Child Health',
    emoji: '👶',
    description: 'Midwifery, paediatrics and reproductive health',
    accentText: 'text-pink-500',
    accentBg: 'bg-pink-500/10 border-pink-500/25',
    chip: 'bg-pink-500'
  },
  'mental-health': {
    label: 'Mental Health',
    emoji: '🧠',
    description: 'Psychiatric nursing, therapy and mental wellness',
    accentText: 'text-violet-500',
    accentBg: 'bg-violet-500/10 border-violet-500/25',
    chip: 'bg-violet-500'
  },
  school: {
    label: 'School Communities',
    emoji: '🎓',
    description: 'Connect with students from your own school',
    accentText: 'text-amber-500',
    accentBg: 'bg-amber-500/10 border-amber-500/25',
    chip: 'bg-amber-500'
  }
};

export const SECTION_ORDER = [
  'general',
  'clinical',
  'exams',
  'clinical-experience',
  'pharmacology',
  'adult-health',
  'maternal-child',
  'mental-health',
  'school'
];

export const getSection = (key) => COMMUNITY_SECTIONS[key] || COMMUNITY_SECTIONS.general;