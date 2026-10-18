/**
 * A deterministic colour per scholar, so the same person looks the same on the
 * leaderboard, in their profile sheet and on a group member row.
 *
 * FNV-1a over the userId rather than the arithmetic step `(n * 47) % 360` the
 * anonymous room originally used, which had an exact period of 360 — two
 * aliases could be byte-identical by construction, and neighbours sat only 16
 * degrees apart.
 */

// Mid-tones chosen to stay legible on BOTH a white card and a slate-800 card,
// because the same tile is rendered in light and dark mode.
export const TILE_COLORS = [
  '#0284c7', '#0d9488', '#b45309', '#be123c', '#6d28d9',
  '#0f766e', '#c2410c', '#a21caf', '#4d7c0f', '#0369a1',
  '#4338ca', '#9d174d',
];

export const playerHue = (userId) => {
  const s = String(userId || '');
  if (!s) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

export const playerColor = (userId) =>
  TILE_COLORS[playerHue(userId) % TILE_COLORS.length];

export default playerColor;