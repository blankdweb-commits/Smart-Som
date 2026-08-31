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
