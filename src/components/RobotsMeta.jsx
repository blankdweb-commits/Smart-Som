import { useEffect } from 'react';

// Sets <meta name="robots" content="noindex"> for protected/private routes so
// search engines never index authenticated surfaces such as the dashboard,
// quiz player, flashcards, payments, or admin areas.
export default function RobotsMeta() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="robots"]');
    if (meta) meta.setAttribute('content', 'noindex, nofollow');
    return () => {
      const next = document.querySelector('meta[name="robots"]');
      if (next) next.setAttribute('content', 'index, follow');
    };
  }, []);
  return null;
}
