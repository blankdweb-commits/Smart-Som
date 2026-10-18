import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Trophy, Coins, Award, TrendingUp, Clock, Loader2, Swords, Eye, User, Crown } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { playerColor } from '../utils/playerIdentity';

/**
 * PlayerSheet — a tappable scholar's profile.
 *
 * WHY A SHEET AND NOT A ROUTE: it is reached from a dozen places (the global
 * leaderboard, group member lists, community posts and their replies, the
 * dashboard community widget, the arena scholars list). A modal keeps the
 * surrounding context intact, which is what a "who is this person" glance
 * actually needs.
 *
 * TWO-STAGE RENDER, and the reason it feels instant:
 *   1. Paint immediately from whatever the caller already had. The leaderboard
 *      row alone carries rank, name, year, score, the breakdown, 1v1/3v3 wins,
 *      answers and coins — so the sheet is readable before any network call
 *      finishes.
 *   2. One `player_public_profile` call then fills in what no list can carry:
 *      achievements, streaks, the full duel record and your head-to-head.
 *
 * PRIVACY (unchanged, and deliberately not a decision this component makes):
 * the server returns a pseudonym until the viewer and this account have
 * completed a duel, via the existing _person_pair_name(). `nameIsReal` tells us
 * which of the two we got, purely so we can say so honestly.
 *
 * CONTAINER FOLLOWS Marketplace's ProductSheet (light + dark, max-h-[88vh],
 * rounded top, backdrop dismiss) and ADDS the dialog ARIA + Escape handling
 * that no existing overlay in this app has.
 */

// A mid-tone set that stays legible on BOTH a white card and a slate-800 card,
// used as the initial letter. Deterministic per userId (see utils/playerIdentity)
// so the same scholar is the same colour on the leaderboard, in the sheet, and
// on a group member row.
export const PlayerTile = ({ userId, name, size = 'md', online }) => {
  const color = playerColor(userId);
  const dims = size === 'lg' ? 'w-16 h-16 text-2xl rounded-2xl'
    : size === 'sm' ? 'w-8 h-8 text-xs rounded-lg'
      : 'w-12 h-12 text-lg rounded-xl';
  return (
    <div
      className={`relative ${dims} shrink-0 flex items-center justify-center font-black`}
      style={{ backgroundColor: `${color}26`, color }}
      aria-hidden="true"
    >
      {String(name || 'S').charAt(0).toUpperCase()}
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white dark:border-slate-800" />
      )}
    </div>
  );
};

const Row = ({ label, value, icon: Icon }) => (
  <div className="flex items-center justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-700/60 last:border-0">
    <span className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-slate-400">
      {Icon && <Icon size={12} />}
      {label}
    </span>
    <span className="text-sm font-black text-slate-800 dark:text-white tabular-nums">{value}</span>
  </div>
);

const Section = ({ title, children }) => (
  <div className="mt-4">
    <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">{title}</h4>
    {children}
  </div>
);

const PlayerSheet = ({ userId, seed, onClose, onChallenge, challengeBusy, canChallenge, challengeLabel }) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const escapeRef = useRef(null);

  // `seed` is whatever the caller already knows (a leaderboard row, a roster
  // entry). It renders straight away so the sheet never opens blank.
  const seedName = seed?.displayName || seed?.name || seed?.display_name || '';
  const seedId = userId || seed?.userId || seed?.user_id || seed?.id || null;

  // Called DIRECTLY from the browser, exactly like arena_roster /
// get_player_leaderboard / cast_service_rating / friend_list all are. That
// matters for two reasons: no new /api/* route (this project sits exactly on
// the 12-function Vercel Hobby cap), and the session's own JWT is what makes
// auth.uid() resolve inside the SECURITY DEFINER function — so the server
// still decides what this viewer is allowed to see.
  const load = useCallback(async () => {
    if (!supabase || !seedId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('player_public_profile', { p_user: seedId });
      if (!error && data?.ok) setDetail(data);
    } catch {
      /* the seed already painted a useful sheet; a failure here is not fatal */
    } finally {
      setLoading(false);
    }
  }, [seedId]);

  useEffect(() => { load(); }, [load]);

  // Escape closes, Tab is trapped inside the panel. No existing overlay in this
  // app does either, and a modal you cannot keyboard-dismiss is a trap.
  useEffect(() => {
    if (!panelRef.current) return undefined;
    escapeRef.current = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const focusables = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', escapeRef.current);
    panelRef.current.focus();
    return () => document.removeEventListener('keydown', escapeRef.current);
  }, [onClose]);

  const d = detail;
  const name = d?.name || seedName || 'Scholar';
  const rank = d?.rank ?? seed?.rank ?? null;
  const total = d?.totalPlayers ?? null;
  const score = d?.competitiveScore ?? seed?.competitiveScore ?? null;
  const breakdown = d?.scoreBreakdown || seed?.scoreBreakdown || null;
  const duels = d?.duels || {};
  const oneWins = duels.oneVsOneWins ?? seed?.oneVOneWins ?? 0;
  const threeWins = duels.threeVsThreeWins ?? seed?.threeVThreeWins ?? 0;
  const answers = d?.answers || {};
  const coins = d?.smartCoins ?? seed?.smartCoins ?? null;

  const h2h = d?.headToHead;
  const showH2h = h2h && Number(h2h.played) > 0;

  const joined = useMemo(() => {
    if (!d?.joinedAt) return null;
    const dt = new Date(d.joinedAt);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  }, [d?.joinedAt]);

  return (
    <div className="fixed inset-0 z-[70]" role="presentation">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${name}'s profile`}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[88vh] sm:max-w-md max-h-[88vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-[2rem] sm:rounded-[2rem] p-6 pb-8 shadow-2xl outline-none"
      >
        <button
          onClick={onClose}
          aria-label="Close profile"
          className="absolute right-4 top-4 w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white flex items-center justify-center transition"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-4 pr-10">
          <PlayerTile userId={seedId} name={name} size="lg" />
          <div className="min-w-0">
            {/* Cosmetic only. `hasCrown` comes from the server profile object,
                never from client state, and nothing in the sheet's maths reads
                it - it cannot influence rank, duels or any stat shown below. */}
            <h3 className="font-black text-lg text-slate-900 dark:text-white truncate flex items-center gap-1.5">
              <span className="truncate">{name}</span>
              {(d?.hasCrown || seed?.hasCrown) && (
                <span title="Crown cosmetic — decoration only" className="shrink-0">
                  <Crown size={16} className="text-amber-500" aria-label="Has a Crown cosmetic" />
                </span>
              )}
            </h3>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">
              {d?.isSelf ? 'That is you' : rank != null ? `Rank #${rank}${total ? ` of ${total}` : ''}` : 'Scholar'}
              {d?.year ? ` · Year ${d.year}` : seed?.year ? ` · Year ${seed.year}` : ''}
            </p>
            {/* Honest about WHY the name looks like a handle. */}
            {d && !d.isSelf && d.nameIsReal === false && (
              <p className="text-[10px] font-medium text-slate-400 mt-1">
                Showing a Scholar handle. Real names appear after a completed duel.
              </p>
            )}
            {joined && (
              <p className="text-[10px] font-medium text-slate-400 mt-0.5">Joined {joined}</p>
            )}
          </div>
        </div>

        {onChallenge && (
          <button
            onClick={() => onChallenge(d || seed)}
            disabled={challengeBusy || canChallenge === false}
            className="mt-4 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-apex-600 hover:bg-apex-700 disabled:opacity-50 text-white text-[11px] font-black uppercase tracking-widest transition"
          >
            {challengeBusy ? <Loader2 size={14} className="animate-spin" /> : <Swords size={14} />}
            {challengeLabel || 'Challenge to a duel'}
          </button>
        )}

        {loading && !d && (
          <div className="mt-4 flex items-center justify-center py-6">
            <Loader2 size={20} className="animate-spin text-slate-400" />
          </div>
        )}

        <Section title="Standing">
          <Row label="Rank" icon={Trophy} value={rank != null ? `#${rank}${total ? ` / ${total}` : ''}` : '—'} />
          <Row label="Power score" icon={Coins} value={score != null ? Number(score).toLocaleString() : '—'} />
          <Row label="Smart Coins" icon={Coins} value={coins != null ? Number(coins).toLocaleString() : '—'} />
        </Section>

        {breakdown && (
          <Section title="Where the score comes from">
            <Row label="Coins" value={Number(breakdown.coin || 0).toLocaleString()} />
            <Row label="Duels" value={Number(breakdown.duels || 0).toLocaleString()} />
            <Row label="Performance" value={Number(breakdown.perf || 0).toLocaleString()} />
          </Section>
        )}

        <Section title="Duel record">
          <Row label="1v1 wins" icon={Swords} value={Number(oneWins || 0).toLocaleString()} />
          <Row label="3v3 wins" icon={Swords} value={Number(threeWins || 0).toLocaleString()} />
          {d && Number(answers.total || 0) > 0 && (
            <Row
              label="Answers"
              icon={Eye}
              value={`${Number(answers.correct || 0).toLocaleString()} correct / ${Number(answers.total || 0).toLocaleString()}`}
            />
          )}
        </Section>

        {d && (Number(d.streak || 0) > 0 || Number(d.maxQuizStreak || 0) > 0) && (
          <Section title="Streaks">
            <Row label="Day streak" icon={TrendingUp} value={Number(d.streak || 0)} />
            <Row label="Best quiz streak" icon={Award} value={Number(d.maxQuizStreak || 0)} />
          </Section>
        )}

        {showH2h && (
          <Section title="Head to head vs you">
            <Row label="Played" icon={Swords} value={Number(h2h.played)} />
            <Row label="You won" value={Number(h2h.wins)} />
            <Row label="They won" value={Number(h2h.losses)} />
            {Number(h2h.draws) > 0 && <Row label="Drawn" value={Number(h2h.draws)} />}
          </Section>
        )}

        {d && (
          <Section title={`Achievements (${Number(d.achievementCount || 0)})`}>
            {(d.achievements || []).length === 0 ? (
              <p className="text-[11px] font-medium text-slate-400 py-2">Nothing unlocked yet.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5 pt-1">
                {(d.achievements || []).map((a) => (
                  <li
                    key={a.key}
                    title={a.description}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-1 text-[10px] font-black text-slate-700 dark:text-slate-200"
                  >
                    <span aria-hidden="true">{a.emoji}</span>
                    {a.name}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {!d && !loading && (
          <p className="mt-4 flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
            <Clock size={12} /> Details unavailable right now.
          </p>
        )}

        {!d?.isSelf && (
          <p className="mt-5 flex items-start gap-1.5 text-[10px] font-medium text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-3">
            <User size={12} className="mt-px shrink-0" />
            We show a display name, never your email, and your real name stays private until you have
            completed a duel together.
          </p>
        )}
      </div>
    </div>
  );
};

export default PlayerSheet;