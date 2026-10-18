import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import TutorialTip from '../components/TutorialTip';
import AdSenseSlot from '../components/ads/AdSenseSlot';
import {
  Star, BarChart2, Trophy, Loader2, CheckCircle, Users, Clock, Flag,
  AlertCircle, Shield, RefreshCw, ChevronRight,
} from 'lucide-react';

// ============================================================================
// POLYNURSE VOTING — Phase 3
//
// Two surfaces that are deliberately kept apart, in storage and in the UI:
//
//   "Services"     -> service_ratings / service_rating_stats, via
//                     cast_service_rating(). "How was PolyNurse?"
//   "Campaigns"    -> voting_campaigns + voting_candidates + campaign_votes,
//                     via cast_campaign_vote(). Individual candidates, a real
//                     start/end window, standings.
//
// A service rating is stored in one table and a candidate vote in another, are
// written by different RPCs, and can never be counted as each other.
//
// INTEGRITY: this file never computes an authoritative number. Totals come
// from the server (campaign_totals / get_campaign_results), the vote itself
// goes through cast_campaign_vote, and the UI only ever shows "confirmed" once
// that RPC has returned. There is no client-side vote counter anywhere.
//
// LIVE UPDATES: a filtered postgres_changes subscription on campaign_totals
// (an aggregate table with no voter identity) plus a bounded 20s fallback poll
// and a reconcile on reconnect, so the page degrades rather than freezes.
//
// WHAT WAS REMOVED: the old "request a poll" flow. It inserted a `type`
// column into voting_polls that has never existed in any migration, so every
// submission failed with 42703. That feature is not part of this platform and
// is not being resurrected.
// ============================================================================

const SERVICE_CATEGORIES = [
  { key: 'quiz', label: 'Learning & Quiz', blurb: 'Question banks, rounds and your score.' },
  { key: 'marketplace', label: 'Marketplace', blurb: 'Browsing listings and buying.' },
  { key: 'arena', label: '1v1 Arena', blurb: 'Matchmaking, matches and results.' },
  { key: 'community', label: 'Community', blurb: 'Feeds, groups and the anonymous room.' },
  { key: 'overall', label: 'Overall service', blurb: 'PolyNurse as a whole.' },
];

const RATING_OPTIONS = {
  quiz: [
    { key: 'fast', label: 'Fast' }, { key: 'clear', label: 'Clear' },
    { key: 'helpful', label: 'Helpful' }, { key: 'reliable', label: 'Reliable' },
  ],
  marketplace: [
    { key: 'clear', label: 'Easy to browse' }, { key: 'reliable', label: 'Checkout works' },
    { key: 'needs_work', label: 'Needs work' },
  ],
  arena: [
    { key: 'fair', label: 'Fair' }, { key: 'fast', label: 'Quick matchmaking' },
    { key: 'confusing', label: 'Confusing' }, { key: 'slow', label: 'Too slow' },
  ],
  community: [
    { key: 'helpful', label: 'Helpful' }, { key: 'safe', label: 'Feels safe' },
    { key: 'confusing', label: 'Confusing' }, { key: 'slow', label: 'Slow' },
  ],
  overall: [
    { key: 'would_recommend', label: "I'd recommend it" }, { key: 'helpful', label: 'Useful' },
    { key: 'needs_work', label: 'Needs work' },
  ],
};

// Mirrors the option allowlist enforced server-side in cast_service_rating.
const VALID_OPTION_KEYS = new Set([
  'fast', 'clear', 'helpful', 'reliable', 'fair', 'safe',
  'would_recommend', 'needs_work', 'confusing', 'slow',
]);

// Categories that may only ever be answered ONCE per account. All five are
// write-once: an account that can edit its score of a service can keep editing
// it until it likes the number it landed on, which makes the average meaningless.
// Enforced server-side (cast_service_rating raises ALREADY_RATED on any second
// differing submission; an identical replay is accepted as a no-op) - this set
// only drives the disabled UI.
const ONE_TIME_CATEGORIES = new Set(SERVICE_CATEGORIES.map((c) => c.key));

const CAMPAIGN_STATUS = {
  upcoming: { label: 'Upcoming', cls: 'bg-slate-500/15 text-slate-300', icon: Clock },
  active: { label: 'Voting open', cls: 'bg-emerald-500/15 text-emerald-300', icon: CheckCircle },
  ended: { label: 'Ended', cls: 'bg-slate-700/60 text-slate-400', icon: Flag },
};

const fmtCountdown = (iso) => {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'closed';
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hrs = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days}d ${hrs}h left`;
  if (hrs > 0) return `${hrs}h ${mins % 60}m left`;
  if (mins > 0) return `${mins}m left`;
  return 'under a minute';
};

// A short, honest banner for a refusal. Codes come from the RPC.
const VOTE_ERRORS = {
  AUTH_REQUIRED: 'Please sign in to vote.',
  CAMPAIGN_NOT_FOUND: 'That campaign no longer exists.',
  CAMPAIGN_ENDED: 'Voting on this campaign has closed.',
  CAMPAIGN_NOT_STARTED: 'Voting on this campaign has not opened yet.',
  INVALID_CANDIDATE: 'That candidate is not part of this campaign.',
  INVALID_CATEGORY: 'That category is not recognised.',
  INVALID_RATING: 'Please choose a rating between 1 and 5.',
  // 'overall' is a one-time verdict on PolyNurse as a whole; the other four
  // categories stay re-openable. The server enforces this (cast_service_rating
  // raises ALREADY_RATED), this is only the message for it.
  ALREADY_RATED:
    'You have already reviewed this service. Each service can only be reviewed once per account, so your original rating still stands.',
};
const voteErrorText = (err, fallback) =>
  VOTE_ERRORS[err?.message] || err?.message || fallback;

const Voting = () => {
  const { session, userProfile } = useAppContext();
  // ?tab=campaigns / ?tab=services deep-links straight to a tab. Without it
  // the seeded sample campaign sat one invisible tap behind the default
  // 'services' tab, so a first-time visitor never saw the Campaigns screen the
  // tutorial describes.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState(requestedTab === 'campaigns' ? 'campaigns' : 'services');

  // ---------------- Service feedback ----------------
  const [stats, setStats] = useState({});
  const [myRatings, setMyRatings] = useState({});
  const [myRatingsError, setMyRatingsError] = useState('');
  const [draft, setDraft] = useState({});
  const [ratingBusy, setRatingBusy] = useState('');
  const [ratingNote, setRatingNote] = useState(null);

  // ---------------- Campaigns ----------------
  const [campaigns, setCampaigns] = useState([]);
  const [openCampaign, setOpenCampaign] = useState(null);
  const [results, setResults] = useState(null);
  const [myVote, setMyVote] = useState(null);
  const [voteBusy, setVoteBusy] = useState(false);
  const [votePending, setVotePending] = useState(null);
  const [liveState, setLiveState] = useState('connecting'); // connecting|live|polling|offline
  const [campaignError, setCampaignError] = useState('');
  const [campaignsLoading, setCampaignsLoading] = useState(true);

  // The vote RPC is idempotent on this id, so a double-tap or a retried request
  // is safe. It is generated per campaign, not per click.
  const requestIds = useRef({});

  // loadStats / loadMyRatings used to swallow their errors entirely, which meant a
  // MISSING TABLE was indistinguishable from "nobody has rated anything" and the
  // page rendered the confident, false "No ratings recorded yet. Be the first."
  // over a broken query. These carry the failure to the UI instead.
  const [statsError, setStatsError] = useState('');
  const loadStats = useCallback(async () => {
    if (!supabase) {
      setStatsError('Ratings are unavailable right now.');
      return;
    }
    const { data, error } = await supabase
      .from('service_rating_stats')
      .select('*')
      .order('category');
    if (error) {
      setStatsError('We could not load the ratings.');
      setStats({});
      return;
    }
    const map = {};
    for (const row of data || []) map[row.category] = row;
    setStats(map);
    setStatsError('');
  }, []);

  const loadMyRatings = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error } = await supabase
      .from('service_ratings')
      .select('category, rating, options, comment')
      .eq('user_id', session.user.id);
    if (error) {
      // Failing soft here would let the user submit a rating the server has
      // already recorded, and the UI would then show it as unrecorded.
      setMyRatingsError('We could not check whether you have already rated these services.');
      setMyRatings({});
      return;
    }
    const map = {};
    for (const row of data || []) map[row.category] = row;
    setMyRatings(map);
    setMyRatingsError('');
  }, [session]);

  const loadCampaigns = useCallback(async () => {
    if (!supabase) return;
    setCampaignsLoading(true);
    const { data, error } = await supabase
      .from('voting_campaigns')
      .select('*, voting_candidates(id, name, image_url, statement, sort_order)')
      .order('starts_at', { ascending: false });
    if (error) {
      setCampaignError('Could not load campaigns.');
      setCampaigns([]);
    } else {
      setCampaigns(data || []);
      setCampaignError('');
    }
    setCampaignsLoading(false);
  }, []);

  useEffect(() => {
    loadStats();
    loadMyRatings();
    loadCampaigns();
  }, [loadStats, loadMyRatings, loadCampaigns]);

  // ---- live results for the open campaign -------------------------------
  const refreshResults = useCallback(async (campaignId) => {
    if (!supabase || !campaignId || !session) return;
    const [{ data: res, error: resErr }, { data: mine }] = await Promise.all([
      supabase.rpc('get_campaign_results', { p_campaign: campaignId }),
      supabase.rpc('my_campaign_vote', { p_campaign: campaignId }),
    ]);
    if (resErr) {
      // Previously `return` with no state change, so the pill sat on
      // "Connecting" forever and looked like a slow network rather than a
      // failed query.
      setLiveState('error');
      return;
    }
    setLiveState('live');
    if (res) setResults(res);
    if (mine) setMyVote(mine.candidate_id ?? null);
  }, [session]);

  useEffect(() => {
    if (!openCampaign) return;
    refreshResults(openCampaign.id);
  }, [openCampaign, refreshResults]);

  // Realtime: subscribe to the AGGREGATE only. campaign_totals has no voter
  // identity, so a live update can never leak who voted for whom.
  useEffect(() => {
    if (!supabase || !openCampaign) return undefined;
    const channel = supabase
      .channel(`campaign_totals_${openCampaign.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'campaign_totals',
          filter: `campaign_id=eq.${openCampaign.id}`,
        },
        () => refreshResults(openCampaign.id),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setLiveState('live');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setLiveState('polling');
        }
      });

    // Bounded fallback + reconcile. If realtime is unavailable the page still
    // updates, just less often — and reconnecting immediately re-syncs.
    const poll = setInterval(() => refreshResults(openCampaign.id), 20000);
    const onFocus = () => refreshResults(openCampaign.id);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      supabase.removeChannel(channel);
    };
  }, [openCampaign, refreshResults]);

  // ---- actions ----------------------------------------------------------
  // ---------------- Admin: fraudulent-vote correction ----------------
  const [auditRows, setAuditRows] = useState([]);
  const [voteRows, setVoteRows] = useState([]);
  const [voiding, setVoiding] = useState(null);

  const isAdmin = !!userProfile?.isAdmin;

  // Admins (only) may see the raw votes for the open campaign, plus the audit
  // trail of every correction already made to it.
  const loadAdminRows = useCallback(async (campaignId) => {
    if (!supabase || !campaignId || !isAdmin) return;
    const [votes, audit] = await Promise.all([
      supabase
        .from('campaign_votes')
        .select('id, candidate_id, user_id, voted_at')
        .eq('campaign_id', campaignId)
        .order('voted_at', { ascending: false })
        .limit(50),
      supabase
        .from('campaign_vote_audit')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);
    if (!votes.error) setVoteRows(votes.data || []);
    if (!audit.error) setAuditRows(audit.data || []);
  }, [isAdmin]);

  useEffect(() => {
    if (openCampaign && isAdmin) loadAdminRows(openCampaign.id);
    else { setVoteRows([]); setAuditRows([]); }
  }, [openCampaign, isAdmin, loadAdminRows]);

  const voidVote = async (voteId) => {
    if (voiding) return;
    setVoiding(voteId);
    setCampaignError('');
    try {
      const { error } = await supabase.rpc('void_campaign_vote', {
        p_vote: voteId,
        p_reason: 'Removed by an administrator',
      });
      if (error) throw error;
      loadAdminRows(openCampaign.id);
      refreshResults(openCampaign.id);
    } catch (err) {
      setCampaignError(voteErrorText(err, 'Could not void that vote.'));
    } finally {
      setVoiding(null);
    }
  };

  const submitRating = async (categoryKey) => {
    const d = draft[categoryKey] || {};
    if (!d.rating) {
      setRatingNote({ ok: false, msg: 'Choose a star rating first.' });
      return;
    }
    setRatingBusy(categoryKey);
    setRatingNote(null);
    try {
      const options = (d.options || []).filter((k) => VALID_OPTION_KEYS.has(k));
      const { error, data } = await supabase.rpc('cast_service_rating', {
        p_category: categoryKey,
        p_rating: d.rating,
        p_options: options,
        p_comment: (d.comment || '').slice(0, 500),
      });
      if (error) throw error;
      setMyRatings((prev) => ({
        ...prev,
        [categoryKey]: { category: categoryKey, rating: d.rating, options, comment: d.comment || '' },
      }));
      setDraft((prev) => ({ ...prev, [categoryKey]: { ...prev[categoryKey], rating: d.rating } }));
      loadStats();
      // The server distinguishes a genuine first submission from an identical
      // replay (a double-tapped Save, or a retry after a dropped connection),
      // so do not thank the user for something that changed nothing.
      setRatingNote({
        ok: true,
        msg: data?.replay
          ? `Your ${categoryKey} rating was already recorded, so nothing changed.`
          : `Thanks — your ${categoryKey} rating is recorded. It cannot be changed afterwards.`,
      });
    } catch (err) {
      // Never claim success without the server confirming.
      setRatingNote({ ok: false, msg: voteErrorText(err, 'Could not save your rating. Please try again.') });
    } finally {
      setRatingBusy('');
    }
  };

  const submitVote = async (campaign, candidateId) => {
    if (voteBusy) return;
    setVoteBusy(true);
    setVotePending(candidateId);
    setCampaignError('');
    if (!requestIds.current[campaign.id]) {
      requestIds.current[campaign.id] = (crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    }
    try {
      const { error } = await supabase.rpc('cast_campaign_vote', {
        p_campaign: campaign.id,
        p_candidate: candidateId,
        p_request: requestIds.current[campaign.id],
      });
      if (error) throw error;
      // Confirmed by the server — now, and only now, is the vote "done".
      requestIds.current[campaign.id] = null;
      setVotePending(null);
      refreshResults(campaign.id);
    } catch (err) {
      setVotePending(null);
      setCampaignError(voteErrorText(err, 'Your vote could not be recorded.'));
    } finally {
      setVoteBusy(false);
    }
  };

  const openCampaignResults = (c) => {
    setOpenCampaign(c);
    setResults(null);
    setMyVote(null);
    setCampaignError('');
  };

  // ---- derived ----------------------------------------------------------
  const totalRatings = useMemo(
    () => SERVICE_CATEGORIES.reduce((sum, c) => sum + (Number(stats[c.key]?.rating_count) || 0), 0),
    [stats],
  );

  const standings = useMemo(() => {
    if (!results?.results_visible) return [];
    const rows = [...(results.candidates || [])];
    // Honest ranking: equal votes share a position, and we never invent a winner
    // by breaking a tie behind the scenes.
    let lastVotes = null;
    let lastRank = 0;
    return rows.map((row, i) => {
      const votes = Number(row.votes) || 0;
      const tied = lastVotes !== null && votes === lastVotes;
      const rank = tied ? lastRank : i + 1;
      lastVotes = votes;
      lastRank = rank;
      return { ...row, votes, rank, tied: tied || (lastVotes !== null && row.tied) };
    });
  }, [results]);

  const maxVotes = useMemo(
    () => standings.reduce((m, r) => Math.max(m, r.votes), 0),
    [standings],
  );
  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28">
      <TutorialTip tutorialKey="voting">
        New here? The short tour explains how service feedback and campaigns differ.
      </TutorialTip>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <BarChart2 className="text-teal-600" /> Voting
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Rate PolyNurse, or vote in a campaign
          </p>
        </div>
      </div>

      {/* Two clearly separate experiences. */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-5"
        role="tablist" aria-label="Voting sections">
        {[
          { key: 'services', label: 'Service feedback' },
          { key: 'campaigns', label: 'Campaigns' },
        ].map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`min-h-[44px] px-3 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition ${
              tab === t.key
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ================= SERVICES ================= */}
      {tab === 'services' && (
        <section aria-label="PolyNurse service feedback" className="space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
            Each rating measures one specific service. They are never combined into a single
            overall number, and they are never counted as a campaign vote.
          </p>

          {ratingNote && (
            <p
              role="status"
              className={`rounded-xl px-3.5 py-2.5 text-xs font-bold ${
                ratingNote.ok
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'bg-red-500/10 text-red-600 dark:text-red-400'
              }`}
            >
              {ratingNote.msg}
            </p>
          )}

          {SERVICE_CATEGORIES.map((cat) => {
            const stat = stats[cat.key];
            const mine = myRatings[cat.key];
            const d = draft[cat.key] || {};
            const count = Number(stat?.rating_count) || 0;
            const dist = [stat?.r1, stat?.r2, stat?.r3, stat?.r4, stat?.r5].map((n) => Number(n) || 0);
            // A one-time category is locked the moment it has been saved, so the
            // UI offers no way to try again — the server would refuse it anyway.
            const lockedOnce = ONE_TIME_CATEGORIES.has(cat.key) && !!mine;

            return (
              <div
                key={cat.key}
                className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-clinical"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-black text-slate-800 dark:text-slate-100 text-sm">{cat.label}</h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{cat.blurb}</p>
                  </div>
                  {count > 0 ? (
                    <div className="shrink-0 text-right">
                      <p className="text-lg font-black text-slate-800 dark:text-white leading-none tabular-nums">
                        {Number(stat.avg_rating).toFixed(1)}
                      </p>
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">
                        {count} {count === 1 ? 'rating' : 'ratings'}
                      </p>
                    </div>
                  ) : null}
                </div>

                {/* Real distribution — only rendered when there is real data. */}
                {count > 0 && (
                  <div className="mt-3 space-y-1" aria-hidden="true">
                    {dist.map((n, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-3 text-[9px] font-black text-slate-400">{i + 1}★</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-400"
                            style={{ width: `${count ? (n / count) * 100 : 0}%` }}
                          />
                        </div>
                        <span className="w-6 text-right text-[9px] font-bold text-slate-400 tabular-nums">{n}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Star input. Buttons, not a custom widget, so it is keyboard
                    and screen-reader accessible for free. */}
                <div className="mt-3 flex items-center gap-1" role="group" aria-label={`Rate ${cat.label}`}>
                  {[1, 2, 3, 4, 5].map((n) => {
                    const active = Number(d.rating || mine?.rating) >= n;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, [cat.key]: { ...p[cat.key], rating: n } }))}
                        aria-label={`${n} star${n > 1 ? 's' : ''}`}
                        aria-pressed={Number(d.rating || mine?.rating) === n}
                        disabled={lockedOnce}
                        className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition active:scale-95 disabled:pointer-events-none disabled:opacity-60"
                      >
                        <Star
                          size={26}
                          className={active ? 'text-amber-400 fill-amber-400' : 'text-slate-300 dark:text-slate-600'}
                        />
                      </button>
                    );
                  })}
                  {mine && !d.rating && !lockedOnce && (
                    <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-emerald-500">
                      saved
                    </span>
                  )}
                  {lockedOnce && (
                    <span className="ml-1 inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-teal-600 dark:text-teal-400">
                      <CheckCircle size={11} /> one-time verdict — recorded
                    </span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(RATING_OPTIONS[cat.key] || []).map((o) => {
                    const sel = (d.options || mine?.options || []).includes(o.key);
                    return (
                      <button
                        key={o.key}
                        type="button"
                        onClick={() => setDraft((p) => {
                          const cur = p[cat.key]?.options ?? mine?.options ?? [];
                          const next = cur.includes(o.key) ? cur.filter((k) => k !== o.key) : [...cur, o.key];
                          return { ...p, [cat.key]: { ...p[cat.key], options: next } };
                        })}
                        aria-pressed={sel}
                        disabled={lockedOnce}
                        className={`min-h-[36px] px-3 py-1.5 rounded-full text-[11px] font-bold border transition disabled:pointer-events-none disabled:opacity-60 ${
                          sel
                            ? 'bg-teal-600 text-white border-teal-600'
                            : 'bg-slate-50 dark:bg-slate-900/50 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="text"
                    value={d.comment ?? mine?.comment ?? ''}
                    onChange={(e) => setDraft((p) => ({ ...p, [cat.key]: { ...p[cat.key], comment: e.target.value } }))}
                    placeholder="Add a comment (optional)"
                    aria-label={`Comment about ${cat.label}`}
                    maxLength={500}
                    readOnly={lockedOnce}
                    className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 readOnly:opacity-60"
                  />
                  <button
                    onClick={() => submitRating(cat.key)}
                    disabled={ratingBusy === cat.key || lockedOnce}
                    className="min-h-[44px] shrink-0 px-4 rounded-xl bg-teal-600 text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {ratingBusy === cat.key && <Loader2 size={13} className="animate-spin" />}
                    {lockedOnce ? 'Recorded' : 'Save'}
                  </button>
                </div>
              </div>
            );
          })}

          {statsError ? (
            // An honest failure. The old copy here claimed nobody had rated
            // anything, which is a different and false statement when the query
            // itself failed.
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-xs text-red-400 font-bold">{statsError}</p>
              <button
                onClick={() => { loadStats(); loadMyRatings(); }}
                className="min-h-[44px] px-4 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[11px] font-black uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                Try again
              </button>
            </div>
          ) : totalRatings === 0 ? (
            <p className="text-center text-xs text-slate-400 py-6">
              No ratings recorded yet. Be the first.
            </p>
          ) : null}
          {myRatingsError && (
            <p className="text-center text-[11px] font-bold text-amber-500 py-3">{myRatingsError}</p>
          )}
        </section>
      )}

      {/* ================= CAMPAIGNS ================= */}
      {tab === 'campaigns' && (
        <section aria-label="Individual campaigns" className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Vote for an individual candidate in a live campaign.
            </p>
            <span
              className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${
                liveState === 'live' ? 'bg-emerald-500/15 text-emerald-400'
                  : liveState === 'offline' || liveState === 'error' ? 'bg-red-500/15 text-red-400'
                    : 'bg-slate-500/15 text-slate-400'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" aria-hidden="true" />
              {liveState === 'live'
                ? 'Live'
                : liveState === 'offline'
                  ? 'Offline'
                  : liveState === 'error'
                    ? 'Not updating'
                    : 'Connecting'}
            </span>
          </div>

          {campaignsLoading && (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-teal-600" size={22} /></div>
          )}

          {campaignError && !campaignsLoading && (
            <p role="alert" className="rounded-xl px-3.5 py-2.5 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-2">
              <AlertCircle size={14} /> {campaignError}
              <button onClick={loadCampaigns} className="ml-auto underline">Retry</button>
            </p>
          )}

          {!campaignsLoading && !campaignError && campaigns.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
              <Trophy size={26} className="mx-auto mb-2.5 text-slate-300 dark:text-slate-600" />
              <p className="text-sm font-bold text-slate-600 dark:text-slate-300">No campaigns right now</p>
              <p className="text-xs text-slate-400 mt-1">
                When a campaign is configured it will appear here with its rules and closing time.
              </p>
            </div>
          )}

          {campaigns.map((c) => {
            const meta = CAMPAIGN_STATUS[c.status] || CAMPAIGN_STATUS.upcoming;
            const StatusIcon = meta.icon;
            return (
              <button
                key={c.id}
                onClick={() => openCampaignResults(c)}
                className="w-full text-left rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 shadow-clinical hover:border-teal-500/50 active:scale-[0.995] transition"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-black text-slate-800 dark:text-slate-100 text-sm leading-snug">{c.title}</h3>
                  <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${meta.cls}`}>
                    <StatusIcon size={10} /> {meta.label}
                  </span>
                </div>
                {c.description && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 leading-snug">{c.description}</p>
                )}
                <p className="mt-2 text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <Users size={11} /> {(c.voting_candidates || []).length} candidate{(c.voting_candidates || []).length === 1 ? '' : 's'}
                  <ChevronRight size={12} className="ml-auto" />
                </p>
                {c.status === 'active' && (
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-emerald-500">
                    {fmtCountdown(c.ends_at)}
                  </p>
                )}
              </button>
            );
          })}
        </section>
      )}

      {/* Campaign detail */}
      {openCampaign && (
        <CampaignSheet
          campaign={openCampaign}
          standings={standings}
          maxVotes={maxVotes}
          results={results}
          myVote={myVote}
          voteBusy={voteBusy}
          votePending={votePending}
          error={campaignError}
          onVote={(cid) => submitVote(openCampaign, cid)}
          onClose={() => setOpenCampaign(null)}
          isAdmin={isAdmin}
          voteRows={voteRows}
          auditRows={auditRows}
          voiding={voiding}
          onVoid={voidVote}
        />
      )}

      <AdSenseSlot placement="voting-content" />
    </div>
  );
};

// The campaign detail sheet: rules first, then standings, then the vote.
const CampaignSheet = ({
  campaign, standings, maxVotes, results, myVote, voteBusy, votePending, error, onVote, onClose,
  isAdmin, voteRows, auditRows, voiding, onVoid,
}) => {
  const canVote = campaign.status === 'active' && new Date(campaign.starts_at) <= new Date();
  const visible = !!results?.results_visible;
  const totalVotes = standings.reduce((s, r) => s + r.votes, 0);
  const leaders = standings.filter((r) => r.rank === 1);

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-label={campaign.title}>
      <div className="w-full sm:max-w-md bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl max-h-[88dvh] overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-black text-slate-900 dark:text-white leading-snug">{campaign.title}</h2>
          <button onClick={onClose} aria-label="Close"
            className="min-h-[44px] min-w-[44px] -mr-2 -mt-2 flex items-center justify-center text-slate-400 text-xl">
            &times;
          </button>
        </div>

        {campaign.description && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{campaign.description}</p>
        )}

        <div className="mt-4 space-y-2 text-[11px]">
          <p className="flex items-start gap-2 text-slate-500 dark:text-slate-400">
            <Clock size={13} className="mt-0.5 shrink-0" />
            <span>
              {new Date(campaign.starts_at).toLocaleDateString()} — {new Date(campaign.ends_at).toLocaleDateString()}
              {campaign.status === 'active' && <span className="ml-1 font-black text-emerald-500">· {fmtCountdown(campaign.ends_at)}</span>}
            </span>
          </p>
          {campaign.eligibility_note && (
            <p className="flex items-start gap-2 text-slate-500 dark:text-slate-400">
              <Shield size={13} className="mt-0.5 shrink-0" />
              <span><strong className="text-slate-700 dark:text-slate-200">Who can vote:</strong> {campaign.eligibility_note}</span>
            </p>
          )}
          {campaign.rules_note && (
            <p className="flex items-start gap-2 text-slate-500 dark:text-slate-400">
              <BarChart2 size={13} className="mt-0.5 shrink-0" />
              <span><strong className="text-slate-700 dark:text-slate-200">Rules:</strong> {campaign.rules_note}</span>
            </p>
          )}
          <p className="flex items-start gap-2 text-slate-500 dark:text-slate-400">
            <Users size={13} className="mt-0.5 shrink-0" />
            <span>
              {campaign.votes_per_user} {campaign.votes_per_user === 1 ? 'vote' : 'votes'} per account, per campaign.
            </span>
          </p>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-xl px-3 py-2 bg-red-500/10 text-red-600 dark:text-red-400 text-xs font-bold flex items-center gap-2">
            <AlertCircle size={13} /> {error}
          </p>
        )}

        {/* Standings */}
        <div className="mt-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">Standings</h3>
            {visible && <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 tabular-nums">{totalVotes} vote{totalVotes === 1 ? '' : 's'}</span>}
          </div>

          {!visible && (
            <p className="rounded-xl bg-slate-100 dark:bg-slate-800 px-3.5 py-3 text-xs text-slate-500 dark:text-slate-400">
              Results for this campaign are not published until voting closes.
            </p>
          )}

          {visible && leaders.length > 1 && (
            <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
              {leaders.length} candidates are level on {leaders[0].votes} vote{leaders[0].votes === 1 ? '' : 's'}.
              A lead this small is not a win — it can still change until voting closes.
            </p>
          )}

          <ul className="space-y-2">
            {standings.map((c) => (
              <li key={c.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                <div className="flex items-center gap-2.5">
                  <span className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-black ${
                    c.rank === 1 ? 'bg-amber-400 text-amber-900' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}>
                    {c.rank}
                  </span>
                  {c.image_url ? (
                    <img src={c.image_url} alt="" loading="lazy"
                      className="shrink-0 w-9 h-9 rounded-lg object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-slate-800 dark:text-slate-100 truncate">{c.name}</p>
                  </div>
                  <span className="shrink-0 text-sm font-black text-slate-800 dark:text-white tabular-nums">{c.votes}</span>
                </div>

                {/* Live progress bar. Width is stable, so a realtime update
                    never nudges the layout. */}
                <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-teal-500 transition-[width] duration-500 motion-reduce:transition-none"
                    style={{ width: `${maxVotes ? (c.votes / maxVotes) * 100 : 0}%` }}
                  />
                </div>

                {c.statement && (
                  <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{c.statement}</p>
                )}

                {canVote && !myVote && (
                  <button
                    onClick={() => onVote(c.id)}
                    disabled={voteBusy}
                    className="mt-2.5 w-full min-h-[44px] rounded-xl bg-teal-600 text-white text-[11px] font-black uppercase tracking-widest disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {votePending === c.id && <Loader2 size={13} className="animate-spin" />}
                    {votePending === c.id ? 'Recording…' : `Vote for ${c.name}`}
                  </button>
                )}
                {myVote === c.id && (
                  <p className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-emerald-500">
                    <CheckCircle size={13} /> Your vote is counted
                  </p>
                )}
                {myVote && myVote !== c.id && (
                  <p className="mt-2.5 text-center text-[11px] text-slate-400">
                    You have already voted in this campaign.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-5 flex items-start gap-2 text-[10px] text-slate-400 leading-relaxed">
          <RefreshCw size={11} className="mt-0.5 shrink-0" />
          Totals are confirmed by the server. Votes must be your genuine choice — duplicate
          accounts to vote more than once are not supported.
        </p>

        {/* Admin: correct a fraudulent vote. Every action here writes an
            audit row, so a total never changes silently. */}
        {isAdmin && (
          <div className="mt-5 border-t border-slate-200 dark:border-slate-800 pt-4">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Admin · vote records
            </h3>

            {voteRows.length === 0 ? (
              <p className="mt-2 text-[11px] text-slate-400">No votes recorded for this campaign.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {voteRows.map((v) => {
                  const cand = standings.find((s) => s.id === v.candidate_id);
                  return (
                    <li key={v.id} className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-slate-800 px-2.5 py-2">
                      <span className="min-w-0 flex-1 text-[11px] text-slate-600 dark:text-slate-300 truncate">
                        vote #{v.id} → {cand?.name || `candidate ${v.candidate_id}`}
                        <span className="text-slate-400"> · {new Date(v.voted_at).toLocaleString()}</span>
                      </span>
                      <button
                        onClick={() => onVoid(v.id)}
                        disabled={voiding === v.id}
                        className="shrink-0 min-h-[32px] px-2.5 rounded-lg border border-red-300 dark:border-red-900 text-red-600 dark:text-red-400 text-[9px] font-black uppercase tracking-widest disabled:opacity-50"
                      >
                        {voiding === v.id ? '…' : 'Void'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {auditRows.length > 0 && (
              <>
                <h4 className="mt-4 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Audit trail
                </h4>
                <ul className="mt-1.5 space-y-1">
                  {auditRows.map((a) => (
                    <li key={a.id} className="text-[10px] text-slate-400">
                      {new Date(a.created_at).toLocaleString()} — {a.action} vote #{a.vote_id}
                      {a.reason ? ` · ${a.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Voting;