import { useCallback, useState } from 'react';
import PlayerSheet from '../components/PlayerSheet';

/**
 * usePlayerSheet — owns the "which scholar am I looking at" state so every
 * surface that wants a profile tap-through costs three lines instead of
 * duplicating open/close state across half a dozen pages.
 *
 *   const profile = usePlayerSheet({ onChallenge: challenge, canChallenge });
 *   <button onClick={() => profile.open(row)}>{row.displayName}</button>
 *   {profile.sheet}
 *
 * `row` can be anything that identifies a user — a leaderboard row
 * ({userId}), a community post ({author_id}), a group member
 * ({user_id}), a rivals card ({userId}). All the aliases are handled so no
 * caller has to reshape its data first. The row is passed through as `seed` so
 * the sheet paints instantly from data the page already had.
 */
export function usePlayerSheet(options = {}) {
  const [target, setTarget] = useState(null);

  const open = useCallback((row, extra) => {
    if (!row) return;
    const userId = row.userId ?? row.user_id ?? row.author_id ?? row.id ?? null;
    if (!userId) return;
    setTarget({ userId, seed: row, ...(extra || {}) });
  }, []);

  const close = useCallback(() => setTarget(null), []);

  const sheet = target ? (
    <PlayerSheet
      userId={target.userId}
      seed={target.seed}
      onClose={close}
      onChallenge={options.onChallenge}
      challengeBusy={options.challengeBusy}
      canChallenge={options.canChallenge}
      challengeLabel={options.challengeLabel}
    />
  ) : null;

  return { open, close, sheet, isOpen: !!target };
}

export default usePlayerSheet;