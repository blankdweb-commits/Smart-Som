// Community feed sections.
// Community reset (migration-v29) merged all 8 boards into a single "general"
// feed; every post carries section = 'general'. Keys still map to the
// `section` column on community_posts so old rows resolve to General.
//
// Keep COMMUNITY_SECTIONS / SECTION_ORDER / getSection as stable exports:
// the Community page and other UI import them.

export const COMMUNITY_SECTIONS = {
  general: {
    label: 'General',
    emoji: '🗣️',
    description: 'Open discussions with fellow nursing students',
    accentText: 'text-slate-600 dark:text-slate-400',
    accentBg: 'bg-slate-500/10 border-slate-500/25',
    chip: 'bg-slate-500'
  }
};

export const SECTION_ORDER = ['general'];

export const getSection = (key) => COMMUNITY_SECTIONS[key] || COMMUNITY_SECTIONS.general;