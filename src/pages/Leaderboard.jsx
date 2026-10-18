import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { usePlayerSheet } from '../hooks/usePlayerSheet';
import { ArrowLeft, Swords, Trophy, Users, Sparkles, Crown } from '../components/Icons';
import BrandLogo from '../components/BrandLogo';
import RankingBoard, { PAGE_SIZE as RANKING_PAGE_SIZE } from '../components/RankingBoard';
import SocialPanel from '../components/SocialPanel';
import ActivityPanel from '../components/ActivityPanel';
import CosmeticsPanel from '../components/CosmeticsPanel';
import { BLOCKED_COPY } from '../data/challengeCopy';

/**
 * Leaderboard — the social hub.
 *
 * This used to be a bare ranking table. It is now the single surface for
 * "who else is on here": the ranking you had, plus the people you chose to
 * know, plus what they have done, plus what you have bought.
 *
 * THE TAB IS IN THE URL (`?tab=`), not in local state, for one concrete
 * reason: /rivals has to keep working. It is a long-standing route in the
 * sidebar and in players' muscle memory, and pages/Rivals.jsx now redirects
 * here. A redirect can only land on a tab if the tab is addressable.
 *
 * `sendChallenge` lives HERE, not in a panel, because three panels can raise a
 * challenge (the board, a friend card, a rival card) and they must all obey
 * the same rule: one in flight at a time, and the same refusal copy. Two
 * independent implementations is how you get two different bugs.
 */
const TABS = [
  { key: 'ranking', label: 'Ranking', icon: Trophy },
  { key: 'friends', label: 'Friends', icon: Users },
  { key: 'rivals', label: 'Rivals', icon: Swords },
  { key: 'activity', label: 'Activity', icon: Sparkles },
  { key: 'cosmetics', label: 'Cosmetics', icon: Crown },
];

const HERO = {
  ranking: {
    title: 'Global Leaderboard',
    sub: 'Position by coins, duels and performance · tap anyone to see their profile',
  },
  friends: {
    title: 'Friends',
    sub: 'People you have chosen to know · challenge anyone straight from here',
  },
  rivals: {
    title: 'Rivals',
    sub: 'The ones you mean to beat · a challenge moves no coins until it is accepted',
  },
  activity: {
    title: 'Activity',
    sub: 'What your scholars have unlocked, newest first',
  },
  cosmetics: {
    title: 'Cosmetics',
    sub: 'Earned with Smart Coins · profile decoration only, never a gameplay edge',
  },
};

const Leaderboard = () => {
  const navigate = useNavigate();
  const { session, arenaInvite, arenaChallengeTargets } = useAppContext();
  const [params, setParams] = useSearchParams();

  const myId = session?.user?.id || null;
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'ranking';

  const [challengeBusy, setChallengeBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  // ---- challenge eligibility + the stake the arena is actually running ----
  //
  // These live in the SHELL, not in RankingBoard, for one reason: the stake.
  //
  // `arena_challenge_targets` is the single source of truth for "who can be
  // challenged" AND "what it costs". It used to be fetched inside
  // RankingBoard, which threw away the top-level `stake` and kept only the
  // per-player map - so the shell had to hardcode 2 while the server was
  // advertising min(stakes) = 1 (fixed by migration-v93, which reads
  // stake_fixed). Two numbers, one of them wrong, and the affordability check
  // on the server used the wrong one.
  //
  // One fetch, one stake, and the number the row promises is the number that
  // gets escrowed.
  const [targets, setTargets] = useState({});
  const [callerBlocked, setCallerBlocked] = useState(null);
  const [stake, setStake] = useState(2);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await arenaChallengeTargets({ limit: RANKING_PAGE_SIZE, offset: 0 });
      if (!live || !res) return;
      const map = {};
      for (const p of res.players) map[p.userId] = p;
      setTargets(map);
      setCallerBlocked(res.callerBlocked || null);
      setStake(Number(res.stake) || 2);
    })();
    return () => { live = false; };
  }, [arenaChallengeTargets]);

  const profile = usePlayerSheet({
    onChallenge: (t) => t?.userId && sendChallenge(t),
    challengeBusy,
  });

  const setTab = useCallback((key) => {
    if (key === 'ranking') setParams({}, { replace: true });
    else setParams({ tab: key }, { replace: true });
  }, [setParams]);

  // Sending a challenge moves NO coins - escrow only happens server-side inside
  // arena_invite_respond when the other person accepts. We send the invite and
  // send the user to the Arena, where the incoming-invite popup lives.
  //
  // The `?challenge=` handoff is how a friend card and the ranking row agree on
  // a destination: the Arena preselects that scholar instead of dumping the user
  // on a list they then have to find the person on again.
  const sendChallenge = useCallback(async (target) => {
    const userId = target?.userId ?? target?.user_id ?? null;
    if (!userId || challengeBusy) return;
    setChallengeBusy(userId);
    setNotice(null);
    const res = await arenaInvite({ userId, stake });
    setChallengeBusy(null);
    if (res?.ok) {
      setNotice(`Challenge sent to ${target.displayName || target.name || 'that scholar'}. It is held only if they accept.`);
      navigate(`/rumble?challenge=${userId}`);
      return;
    }
    setNotice(BLOCKED_COPY[res?.error]
      ? `Cannot challenge right now — ${BLOCKED_COPY[res.error].toLowerCase()}.`
      : 'That challenge could not be sent right now.');
  }, [arenaInvite, challengeBusy, navigate, stake]);

  const hero = HERO[tab];

  const panel = useMemo(() => {
    switch (tab) {
      case 'friends':
        return <SocialPanel relType="friend" stake={stake} onOpenProfile={profile.open} onChallenge={sendChallenge} challengeBusy={challengeBusy} />;
      case 'rivals':
        return <SocialPanel relType="rival" stake={stake} onOpenProfile={profile.open} onChallenge={sendChallenge} challengeBusy={challengeBusy} />;
      case 'activity':
        return <ActivityPanel onOpenProfile={profile.open} />;
      case 'cosmetics':
        return <CosmeticsPanel />;
      default:
        return (
          <RankingBoard
            myId={myId}
            targets={targets}
            callerBlocked={callerBlocked}
            stake={stake}
            onOpenProfile={profile.open}
            onChallenge={sendChallenge}
            challengeBusy={challengeBusy}
          />
        );
    }
  }, [tab, profile, sendChallenge, challengeBusy, myId, targets, callerBlocked, stake]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-polynurse-700 dark:hover:text-polynurse-300 font-bold text-sm transition"
        >
          <ArrowLeft size={18} /> Back
        </button>
      </div>

      <div className="bg-polynurse-700 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mb-4">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Trophy size={120} />
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tight relative z-10">{hero.title}</h1>
        <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
          {hero.sub}
        </p>
      </div>

      {/* The tab bar scrolls horizontally on a 360px screen rather than wrapping
          into two rows, which would push the panel content down on every tab
          change. */}
      <div
        role="tablist"
        aria-label="Social hub sections"
        className="flex gap-1.5 overflow-x-auto pb-2 mb-4 -mx-1 px-1 snap-x"
      >
        {/* ESLint 9.39's no-unused-vars does not count `<Icon />` as a use of
            the destructured name, so it reports `Icon` unused at the
            destructuring site. Same suppression the framer imports use. */}
        {/* eslint-disable-next-line no-unused-vars */}
        {TABS.map(({ key, label, icon: Icon }) => {
          const active = key === tab;
          return (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => setTab(key)}
              className={`shrink-0 snap-start inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition ${
                active
                  ? 'bg-polynurse-700 text-white'
                  : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          );
        })}
      </div>

      {notice && (
        <div role="status" className="mb-4 flex items-center gap-2 bg-polynurse-50 dark:bg-slate-800/60 text-polynurse-800 dark:text-polynurse-200 text-sm font-bold rounded-2xl px-4 py-3">
          <Swords size={15} className="shrink-0" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="underline shrink-0">Dismiss</button>
        </div>
      )}

      <div role="tabpanel">{panel}</div>

      <div className="mt-8 flex justify-center">
        <BrandLogo variant="mark" size="md" />
      </div>

      {/* The profile sheet, mounted once for every tab. */}
      {profile.sheet}
    </div>
  );
};

export default Leaderboard;
