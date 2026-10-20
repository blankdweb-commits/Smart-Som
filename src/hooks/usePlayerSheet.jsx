import { useCallback, useState } from 'react';
import PlayerSheet from '../components/PlayerSheet';
import { supabase } from '../utils/supabase';

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
 *
 * PROFILE VIEWS ARE RECORDED HERE, not in the callers. Every surface that can
 * open a sheet goes through this hook, so recording here is the one place
 * that catches all of them — a ranking row, a friend card, a rival card, an
 * activity entry. Putting the call in each caller would have meant five
 * chances to forget one, and a half-wired feature is exactly how
 * `friend_list()` ended up dead.
 *
 * The server enforces everything that matters: it refuses a view of yourself,
 * it refuses to record anything while the profile owner has views switched
 * off, and it never names a visitor who has not opted in to being identified.
 * The client's only job is to ask.
 */
export function usePlayerSheet(options = {}) {
  const [target, setTarget] = useState(null);

  const open = useCallback((row, extra) => {
    if (!row) return;
    const userId = row.userId ?? row.user_id ?? row.author_id ?? row.id ?? null;
    if (!userId) return;
    setTarget({ userId, seed: row, ...(extra || {}) });

    // Best effort: a failure here must never stop the sheet from opening, so
    // the promise is deliberately not awaited and not awaited-then-checked.
    //
    // IMPORTANT: supabase-js's PostgrestFilterBuilder is a LAZY thenable. It
    // has `.then` but NO `.catch`/`.finally` until something calls `.then`,
    // and the network request is only dispatched when the thenable is
    // subscribed to. The old guard `typeof p.catch === 'function'` was always
    // FALSE here, so `.catch` was never attached and the RPC was built but
    // NEVER SENT - every profile view was silently dropped. Subscribing with
    // `.then(onFulfilled, onRejected)` both fires the request and swallows the
    // failure, which is exactly the "best effort" contract this hook wants.
    try {
      const p = supabase?.rpc('profile_view_record', { p_profile: userId });
      if (p && typeof p.then === 'function') p.then(() => {}, () => {});
    } catch {
      /* the sheet still opens; the view is simply not counted */
    }
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