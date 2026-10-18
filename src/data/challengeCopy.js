/**
 * Challenge refusal copy.
 *
 * Why a Challenge button is disabled. The server sends the REFUSAL REASON
 * (arena_challenge_targets returns `reason`, not a bare boolean) so a row can
 * say what is actually wrong instead of rendering a dead grey control.
 *
 * This lives in its own module rather than beside a component because both the
 * ranking rows and the hub shell need it: RankingBoard builds the per-row
 * label, and the shell builds the "could not send" message when the RPC
 * refuses. Exporting it from the component file would trip
 * react-refresh/only-export-components, and duplicating it is how the two
 * surfaces end up disagreeing about what "Busy" means.
 */
export const BLOCKED_COPY = {
  ALREADY_IN_MATCH: 'In a duel',
  INSUFFICIENT_SC: 'Low coins',
  NOT_ACTIVATED: 'Not activated',
  OPPONENT_BUSY: 'Busy',
  OPPONENT_INSUFFICIENT_SC: 'Low coins',
  OPPONENT_NOT_ACTIVATED: 'Not activated',
  INVITE_ALREADY_OPEN: 'Challenged',
  BLOCKED: 'Blocked',
};

export default BLOCKED_COPY;
