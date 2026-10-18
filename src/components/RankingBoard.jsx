import React, { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Coins, Award, Loader2, RefreshCw, Crown } from './Icons';
import { BLOCKED_COPY } from '../data/challengeCopy';

/**
 * RankingBoard — the Global Ranking tab of the social hub.
 *
 * Extracted verbatim from pages/Leaderboard.jsx when that page became the hub
 * shell. Nothing about the ordering, the row shape or the challenge
 * eligibility changed in the move; the only structural difference is that the
 * hero and the tab bar now live in the shell, so this file starts at the
 * leaderboard body.
 *
 * SCORE DISCIPLINE, unchanged and deliberate: `playerScore` is fetched but
 * never printed. The board's job is POSITION. Showing the number next to it is
 * what turned "you are #412" into "you have 12 points", which is neither true
 * nor useful.
 */

// Every ranked scholar should be visible without clicking "Load more", so the
// first page is large enough for any realistic cohort. The RPC clamps a page
// to 500 (migration-v74) and "Load more" still handles anything beyond this.
export const PAGE_SIZE = 100;

const medal = (rank) => {
  if (rank === 1) return 'bg-amber-400 text-amber-900';
  if (rank === 2) return 'bg-slate-300 text-slate-700';
  if (rank === 3) return 'bg-orange-300 text-orange-800';
  return 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
};

const RankingBoard = ({ myId, onOpenProfile, onChallenge, challengeBusy }) => {
  const { supabase, fetchGlobalRank, userProfile, arenaChallengeTargets } = useAppContext();

  const [rows, setRows] = useState([]);
  const [myRank, setMyRank] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [refreshedAt, setRefreshedAt] = useState(null);

  // ---- challenge eligibility (merged onto the rows by userId) ----
  const [targets, setTargets] = useState({});
  const [callerBlocked, setCallerBlocked] = useState(null);

  const loadPage = useCallback(async (offset) => {
    if (!supabase) return null;
    const { data, error: rpcError } = await supabase.rpc('get_player_leaderboard', {
      p_limit: PAGE_SIZE,
      p_offset: offset,
    });
    if (rpcError) throw rpcError;
    if (!data || data.ok === false) throw new Error(data?.error || 'Leaderboard error');
    return data;
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    try {
      const page = await loadPage(0);
      setRows(page.players || []);
      setTotal(Number(page.totalPlayers) || 0);
      setRefreshedAt(new Date());
    } catch {
      setError('Could not load the leaderboard right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase, loadPage]);

  useEffect(() => { refresh(); }, [refresh]);

  // Own rank (fresh, server-side)
  useEffect(() => {
    fetchGlobalRank().then((res) => setMyRank(res && res.globalRank != null ? res : null));
  }, [fetchGlobalRank]);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await arenaChallengeTargets({ limit: PAGE_SIZE, offset: 0 });
      if (!live || !res) return;
      const map = {};
      for (const p of res.players) map[p.userId] = p;
      setTargets(map);
      setCallerBlocked(res.callerBlocked || null);
    })();
    return () => { live = false; };
  }, [arenaChallengeTargets]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadPage(rows.length);
      setRows((prev) => [...prev, ...(page.players || [])]);
    } catch {
      setError('Could not load more players.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Nobody had set identity_name before migration-v74, so without this nudge
  // every row on the board is an anonymous `Scholar-xxxxxx` handle.
  const needsIdentityName = !String(userProfile?.identityName || '').trim();

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
          {Number(total).toLocaleString()} ranked scholars
          {refreshedAt ? ` · updated ${refreshedAt.toLocaleTimeString()}` : ''}
        </p>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold rounded-2xl px-4 py-3">
          {error}
        </div>
      )}

      {myRank && (
        <div className="mb-4 rounded-2xl border border-polynurse-200 dark:border-polynurse-700 bg-polynurse-50 dark:bg-slate-800/60 px-4 py-3 text-sm font-black text-polynurse-800 dark:text-polynurse-200">
          You are <span className="text-xl text-polynurse-600 dark:text-polynurse-300">#{myRank.globalRank}</span>
        </div>
      )}

      {needsIdentityName && !loading && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-polynurse-200 dark:border-polynurse-700 bg-polynurse-50 dark:bg-slate-800/60 px-4 py-3">
          <p className="flex-1 min-w-[14rem] text-xs font-bold text-slate-600 dark:text-slate-300">
            You appear here as an anonymous handle. Pick a display name so rivals
            and friends recognise you on the board.
          </p>
          <a
            href="/settings"
            className="rounded-xl bg-polynurse-700 px-4 py-2 text-xs font-black uppercase tracking-widest text-white transition hover:bg-polynurse-800"
          >
            Set display name
          </a>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-polynurse-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-10 text-center">
          <Award className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={44} />
          <p className="text-slate-500 dark:text-slate-400 font-bold">
            No ranked scholars yet. Be the first — complete a quiz round!
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => {
              const isMe = myId && row.userId === myId;
              const b = row.scoreBreakdown || {};
              // Per-row challenge eligibility, merged from arena_challenge_targets.
              // `reason` is why the server would refuse, so a disabled button can
              // say so rather than just being grey.
              const t = targets[row.userId];
              const blocked = callerBlocked;
              const canChallenge = !isMe && !blocked && !!t?.canChallenge;
              const blockedLabel = isMe ? 'You'
                : blocked ? BLOCKED_COPY[blocked] || 'Unavailable'
                  : t?.reason ? BLOCKED_COPY[t.reason] || 'Unavailable' : 'Challenge';
              return (
                <li key={row.userId} className="flex items-stretch gap-3">
                  {/* The whole row opens the profile. role/tabIndex/keyboard
                      handling so it is not mouse-only; the Challenge button
                      stops propagation so it does not also open the sheet. */}
                  <button
                    type="button"
                    tabIndex={0}
                    aria-label={`Open ${row.displayName || 'scholar'}’s profile`}
                    onClick={() => onOpenProfile(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProfile(row); }
                    }}
                    className={`flex-1 min-w-0 flex items-center gap-3 text-left bg-white dark:bg-slate-800 rounded-2xl shadow-clinical border px-4 py-3 transition hover:border-polynurse-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-polynurse-500 ${
                      isMe
                        ? 'border-polynurse-400 ring-2 ring-polynurse-600/20 dark:border-polynurse-500'
                        : 'border-slate-100 dark:border-slate-700'
                    }`}
                  >
                    <span className={`w-9 h-9 flex items-center justify-center rounded-xl font-black text-xs shrink-0 ${medal(row.rank)}`}>
                      {row.rank}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="font-black text-slate-900 dark:text-white truncate block">
                        {row.displayName || 'Scholar'}
                        {/* Cosmetic only, and never part of the ordering. The
                            server's ORDER BY cannot reference has_crown, so
                            owning one cannot move a row up or down. */}
                        {row.hasCrown && (
                          <span className="inline-block ml-1 align-[-2px]" title="Crown cosmetic — decoration only">
                            <Crown size={13} className="text-amber-500" aria-label="Has a Crown cosmetic" />
                          </span>
                        )}
                        {isMe && <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-polynurse-600 dark:text-polynurse-300">You</span>}
                      </span>
                      {/* playerScore / totalAnswers are NULL when the user has no
                          player_stats row yet, so "no data yet" is distinguished
                          from a genuine zero. */}
                      <span className="text-[10px] font-bold text-slate-400 truncate block">
                        {row.playerScore == null && row.totalAnswers == null
                          ? 'No graded rounds yet'
                          : `${Number(row.totalAnswers || 0).toLocaleString()} answers graded`}
                        {row.year ? ` · Year ${row.year}` : ''}
                      </span>
                    </span>
                    <span className="hidden sm:flex items-center gap-1 shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <Coins size={12} className="text-amber-500" /> {Number(b.coin || 0).toLocaleString()}
                    </span>
                    <span className="hidden sm:flex items-center gap-1 shrink-0 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <Award size={12} className="text-polynurse-600" /> {Number(b.duels || 0).toLocaleString()}
                    </span>
                  </button>

                  {/* Challenge a duel. Nothing is held until they accept. */}
                  {!isMe && (
                    <button
                      type="button"
                      onClick={() => onChallenge(row)}
                      disabled={!canChallenge || challengeBusy === row.userId}
                      title={canChallenge
                        ? `Challenge ${row.displayName || 'this scholar'} to a 2 SC duel. Nothing is held until they accept.`
                        : blockedLabel}
                      className="shrink-0 self-center rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-polynurse-700 hover:bg-polynurse-800 text-white transition active:scale-95 disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                    >
                      {challengeBusy === row.userId ? 'Sending' : blockedLabel}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>

          {rows.length < total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-5 w-full flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3 font-black text-xs uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300 hover:border-polynurse-300 disabled:opacity-50 transition"
            >
              {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null}
              Load more ({Math.max(0, total - rows.length).toLocaleString()} left)
            </button>
          )}
        </>
      )}
    </>
  );
};

export default RankingBoard;
