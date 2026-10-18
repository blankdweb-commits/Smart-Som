// Returns a timezone-aware time-of-day greeting using the user's actual
// browser timezone (via Intl). Falls back to the server/browser default if
// resolvedOptions is unavailable.
export function getGreeting(hour) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  let h = hour;
  if (h == null) {
    try {
      h = new Date().getHours();
    } catch {
      h = 12;
    }
  }
  let period;
  if (h >= 5 && h < 12) period = 'Good morning';
  else if (h >= 12 && h < 17) period = 'Good afternoon';
  else if (h >= 17 && h < 21) period = 'Good evening';
  else period = 'Good night';
  return { text: period, tz, hour: h };
}

export function greetingForName(name, fallback = 'Scholar') {
  const { text } = getGreeting();
  const clean = (name || '').trim().split(/\s+/)[0] || fallback;
  return `${text}, ${clean}`;
}

/**
 * greetingForDisplayName — the greeting for a signed-in scholar.
 *
 * WHY THIS EXISTS. The Dashboard used to greet with `userProfile.fullName`,
 * the LEGAL name, while every other surface in the app shows the IDENTITY
 * name (`identity_name`): the Global Ranking, community posts and comments,
 * the Friends and Rivals cards, the profile sheet. Set "Nurse Ada" in
 * Settings and the whole app said "Nurse Ada" - except the big heading on
 * your own dashboard, which said your registration name. That is the
 * desynchronisation this fixes.
 *
 * WHY IT IS NOT JUST A SWAP. `greetingForName` deliberately truncates to the
 * FIRST WORD, which is right for a legal name ("Ada Lovelace" -> "Ada") and
 * wrong for a display name ("Nurse Ada" -> "Nurse", "Scholar-466fb2" -> the
 * whole handle). So the identity name is used WHOLE, and the first-word
 * truncation is kept only for the legal-name fallback.
 *
 * Order of preference:
 *   1. the identity name, in full  - the name the rest of the app shows
 *   2. the legal name, first word  - today's behaviour, for people who have
 *                                     never set an identity name
 *   3. the fallback                - "Scholar"
 */
export function greetingForDisplayName(identityName, fullName, fallback = 'Scholar') {
  const { text } = getGreeting();
  const identity = (identityName || '').trim();
  if (identity) return `${text}, ${identity}`;
  const legal = (fullName || '').trim().split(/\s+/)[0] || fallback;
  return `${text}, ${legal}`;
}
