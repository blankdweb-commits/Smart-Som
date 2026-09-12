import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  ShieldCheck,
  MessageCircle,
  Trophy,
  Loader2,
  ArrowLeft,
  User,
  Coins,
  TrendingUp,
  Award,
  Heart,
  Send,
  Flag,
  Lock,
  Eye
} from '../components/Icons';
import { supabase } from '../utils/supabase';
import { communityApi } from '../utils/communityApi';
import { authHeaders } from '../utils/apiHeaders';
import { useAppContext } from '../context/AppContext';
import { formatDistanceToNow } from 'date-fns';
import CommunityAuthModal from '../components/CommunityAuthModal';

const GroupBadge = ({ verified }) =>
  verified ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-full text-[8px] font-black uppercase tracking-widest border border-emerald-500/30">
      <ShieldCheck size={10} /> Verified
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-500/10 text-slate-500 rounded-full text-[8px] font-black uppercase tracking-widest border border-slate-500/20">
      Pending
    </span>
  );

const ANON_STATE_META = {
  waiting: {
    label: 'Waiting round · open',
    emoji: '⏳',
    cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'
  },
  active: {
    label: 'Active · membership closed',
    emoji: '🔥',
    cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
  },
  wiped: {
    label: 'Wiped · room closed',
    emoji: '💀',
    cls: 'bg-slate-500/15 text-slate-500 dark:text-slate-400 border-slate-500/30'
  }
};

const GroupPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { session } = useAppContext();
  const currentUserId = session?.user?.id;
  const isAuthenticated = !!currentUserId && session?.user?.is_anonymous !== true;

  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('members'); // members | board | discussion
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [postContent, setPostContent] = useState('');
  const [posting, setPosting] = useState(false);

  // Anonymous group state (server-authoritative panel + actions).
  const [panel, setPanel] = useState(null);
  const [panelLoading, setPanelLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [buying, setBuying] = useState(false);
  const [anonError, setAnonError] = useState('');

  const requireAuth = () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return false;
    }
    return true;
  };

  const isAnonymousGroup = group?.type === 'anonymous';
  const myRole = panel?.my_role || null;
  const anonMember = ['member', 'admin', 'owner'].includes(myRole);
  const anonViewer = anonMember || myRole === 'spectator';
  const canPost = !isAnonymousGroup || anonMember;

  const loadGroup = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('study_groups')
        .select('*')
        .eq('id', Number(id))
        .single();
      if (data) {
        // Embedded joins against study_group_members cause PostgREST 400s;
        // count members in a separate lightweight head query instead.
        let memberCount = 0;
        const { count } = await supabase
          .from('study_group_members')
          .select('*', { count: 'exact', head: true })
          .eq('group_id', Number(id));
        memberCount = count || 0;
        setGroup({ ...data, member_count: memberCount });
      }
    } catch (err) {
      console.error('Error loading group page:', err);
    }
  }, [id]);

  const loadMembers = useCallback(async () => {
    if (!supabase || group?.type === 'anonymous') return;
    try {
      // No PostgREST embeds here: `community_profiles` is a SQL VIEW and
      // embedded joins against it (and cross-schema profiles embeds) return 400
      // ("Could not find a relationship"). Fetch the rows + display identity
      // separately and merge, preserving the shape the render expects.
      const { data } = await supabase
        .from('study_group_members')
        .select('user_id, role, joined_at, group_quiz_streak, group_quiz_last_date')
        .eq('group_id', Number(id))
        .order('joined_at', { ascending: true });
      const rows = (data || []);
      let profiles = {};
      let community = {};
      const memberIds = rows.map(r => r.user_id).filter(Boolean);
      if (memberIds.length > 0) {
        const [{ data: profRows }, { data: comRows }] = await Promise.all([
          supabase.from('profiles').select('id, streak, quiz_streak, smart_coins').in('id', memberIds),
          supabase.from('community_profiles').select('id, display_name, avatar_url, year').in('id', memberIds)
        ]);
        (profRows || []).forEach(p => { profiles[p.id] = p; });
        (comRows || []).forEach(c => { community[c.id] = c; });
      }
      const merged = rows.map(r => ({
        ...r,
        profile: profiles[r.user_id] || {},
        community: community[r.user_id] || {}
      })).sort((a, b) =>
        (a.profile?.smart_coins || 0) - (b.profile?.smart_coins || 0)
      ).reverse();
      setMembers(merged);
    } catch (err) {
      console.error('Error loading members:', err);
    }
  }, [id, group?.type]);

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    try {
      if (group?.type === 'anonymous') {
        // Anonymous rooms are gated (RLS + excluded from community_feed) and
        // render exclusively through the /groups/feed RPC path.
        if (!session?.access_token) { setPosts([]); return; }
        const data = await communityApi(session, '/groups/feed', { group_id: Number(id), limit: 50 });
        setPosts(data.posts || []);
      } else {
        const { data } = await supabase
          .from('community_feed')
          .select('*')
          .eq('group_id', Number(id))
          .order('created_at', { ascending: false })
          .limit(50);
        setPosts(data || []);
      }
    } catch (err) {
      console.error('Error loading group posts:', err);
    }
  }, [id, group?.type, session]);

  const loadPanel = useCallback(async () => {
    if (!session?.access_token) { setPanelLoading(false); return; }
    setPanelLoading(true);
    try {
      const data = await communityApi(session, '/groups/panel', { group_id: Number(id) });
      setPanel(data);
    } catch (err) {
      console.error('Error loading anonymous panel:', err);
    } finally {
      setPanelLoading(false);
    }
  }, [id, session]);

  useEffect(() => {
    Promise.all([loadGroup(), loadMembers(), loadPosts()]).finally(() => setLoading(false));
  }, [loadGroup, loadMembers, loadPosts]);

  useEffect(() => {
    if (group?.type === 'anonymous') loadPanel();
  }, [group?.type, loadPanel]);

  const handlePost = async () => {
    if (!requireAuth()) return;
    if (!postContent.trim() || !supabase || !group) return;
    setPosting(true);
    try {
      await communityApi(session, '/posts', { content: postContent.trim(), group_id: group.id });
      setPostContent('');
      await loadPosts();
    } catch (err) {
      console.error('Error posting:', err);
      if (err.status === 401) {
        setShowAuthModal(true);
      } else if (err.code === 'SPECTATOR_READ_ONLY') {
        alert('Spectators can watch and react, but cannot post in the Anonymous group.');
      } else if (err.code === 'ANONYMOUS_MEMBERS_ONLY') {
        alert('Only members can post in the Anonymous group.');
      } else {
        alert(err.message || 'Failed to post in this group.');
      }
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post) => {
    if (!requireAuth()) return;
    if (!session?.access_token) return;
    const liked = !!post.liked_by_current_user;
    // Optimistic update.
    setPosts(prev => prev.map(p => p.id === post.id
      ? { ...p, liked_by_current_user: !liked, like_count: Math.max(0, (p.like_count || 0) + (liked ? -1 : 1)) }
      : p));
    try {
      await communityApi(session, '/posts/like', { post_id: post.id, liked: !liked });
    } catch (err) {
      console.error('Like toggle failed:', err);
      // Revert.
      setPosts(prev => prev.map(p => p.id === post.id
        ? { ...p, liked_by_current_user: liked, like_count: Math.max(0, (p.like_count || 0) + (liked ? 1 : -1)) }
        : p));
    }
  };

  const handleAnonJoin = async () => {
    if (!requireAuth()) return;
    setJoining(true);
    setAnonError('');
    try {
      const data = await communityApi(session, '/groups/join', { group_id: group.id });
      await Promise.all([loadPanel(), loadPosts()]);
      setGroup(prev => prev ? { ...prev, group_state: data.group_state } : prev);
    } catch (err) {
      setAnonError(err.code === 'GROUP_ACTIVE'
        ? 'This room just activated and membership is now closed.'
        : err.message || 'Could not join right now. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  const handleAnonLeave = async () => {
    if (!requireAuth()) return;
    if (!confirm('Leave the Anonymous group? Your post history stays posted anonymously.')) return;
    setLeaving(true);
    setAnonError('');
    try {
      await communityApi(session, '/groups/leave', { group_id: group.id });
      await Promise.all([loadPanel(), loadPosts()]);
    } catch (err) {
      setAnonError(err.message || 'Could not leave right now.');
    } finally {
      setLeaving(false);
    }
  };

  const handleBuySpectator = async () => {
    if (!requireAuth()) return;
    if (!session?.access_token) return;
    setBuying(true);
    setAnonError('');
    try {
      const res = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: { ...authHeaders(session, { json: true }) },
        body: JSON.stringify({ product: 'anonymous_spectate', group_id: group.id }),
      });
      const body = await res.json();
      if (res.ok && body.authorization_url) {
        window.location.assign(body.authorization_url);
        return;
      }
      setAnonError(body.error || body.message || 'Payment could not be started.');
    } catch {
      setAnonError('Could not start payment. Check your connection and try again.');
    } finally {
      setBuying(false);
    }
  };

  const tabs = isAnonymousGroup
    ? [{ id: 'discussion', label: 'Discussion', icon: MessageCircle }]
    : [
        { id: 'members', label: 'Members', icon: Users },
        { id: 'board', label: 'Leadership Board', icon: Trophy },
        { id: 'discussion', label: 'Discussion', icon: MessageCircle }
      ];

  const boardSorted = [...members].sort((a, b) => {
    const scoreA = (a.group_quiz_streak || 0) + (a.profile?.streak || 0) + (a.profile?.smart_coins || 0);
    const scoreB = (b.group_quiz_streak || 0) + (b.profile?.streak || 0) + (b.profile?.smart_coins || 0);
    return scoreB - scoreA;
  });

  const memberName = (m) => m.community?.display_name || 'Scholarship Member';

  const anonMeta = ANON_STATE_META[group?.group_state] || ANON_STATE_META.waiting;
  const anonCount = panel?.member_count ?? group?.member_count;
  const anonTarget = panel?.minimum_members_to_activate ?? group?.minimum_members_to_activate ?? 30;
  const anonWipeFloor = panel?.minimum_members_to_remain_active ?? group?.minimum_members_to_remain_active ?? 18;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 sm:px-6 sm:py-10">
      {/* Header */}
      <button
        onClick={() => navigate('/community')}
        className="inline-flex items-center gap-2 text-sm font-black text-slate-500 dark:text-slate-400 hover:text-apex-600 transition-colors mb-5"
      >
        <ArrowLeft size={16} /> Back to Community
      </button>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-apex-600" size={32} /></div>
      ) : !group ? (
        <div className="text-center py-20 text-slate-500 font-black">Study group not found.</div>
      ) : (
        <>
          <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-[2.5rem] shadow-clinical border border-slate-100 dark:border-slate-700 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">{group.name}</h1>
                  {isAnonymousGroup ? (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest border ${anonMeta.cls}`}>
                      {anonMeta.emoji} {anonMeta.label}
                    </span>
                  ) : (
                    <GroupBadge verified={group.is_verified} />
                  )}
                </div>
                {group.description && (
                  <p className="text-slate-500 dark:text-slate-400 font-medium mt-2 max-w-xl">{group.description}</p>
                )}
                <div className="flex flex-wrap gap-2 mt-3">
                  {[group.school, group.level, group.focus].filter(Boolean).map((t, i) => (
                    <span key={i} className="px-3 py-1 bg-apex-50 dark:bg-apex-900/30 text-apex-700 dark:text-apex-300 rounded-full text-[10px] font-black uppercase tracking-widest border border-apex-100 dark:border-apex-800">
                      {t}
                    </span>
                  ))}
                  <span className="px-3 py-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full text-[10px] font-black uppercase tracking-widest">
                    <Users size={10} className="inline mr-1" /> {panelLoading ? '' : anonCount ?? members.length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Anonymous room card — join / leave / spectator gating. */}
          {isAnonymousGroup && (
            <div className="mb-6 p-6 rounded-3xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-clinical">
              {panelLoading ? (
                <div className="flex items-center justify-center py-6 gap-2 text-slate-400 text-sm font-bold">
                  <Loader2 size={16} className="animate-spin" /> Checking the room…
                </div>
              ) : group.group_state === 'wiped' ? (
                <>
                  <div className="text-3xl mb-2">💀</div>
                  <h2 className="font-black text-slate-900 dark:text-white">This room was wiped.</h2>
                  <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
                    Membership fell below {anonWipeFloor} and the Anonymous round closed. All posts have been hidden and spectator passes revoked.
                  </p>
                </>
              ) : myRole === 'spectator' ? (
                <>
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-apex-100 dark:bg-apex-900/40 text-apex-600 dark:text-apex-300 flex items-center justify-center shrink-0"><Eye size={18} /></div>
                    <div className="flex-1">
                      <h2 className="font-black text-slate-900 dark:text-white">You're watching anonymously.</h2>
                      <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
                        Spectators can read the room and react, but cannot post. {panel?.spectator_price ? `This pass cost ₦${panel.spectator_price}.` : ''}
                      </p>
                    </div>
                  </div>
                </>
              ) : anonMember ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center shrink-0"><ShieldCheck size={18} /></div>
                      <div>
                        <h2 className="font-black text-slate-900 dark:text-white">You're in the room.</h2>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
                          {group.group_state === 'waiting'
                            ? `${anonCount} of ${anonTarget} joined — the room opens to everyone (and closes to joiners) at ${anonTarget}.`
                            : 'This round is active. You can post, react and read — nobody knows who you are.'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleAnonLeave}
                      disabled={leaving}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300 font-black text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-50 transition"
                    >
                      {leaving ? <Loader2 size={14} className="animate-spin" /> : <ArrowLeft size={14} />} Leave
                    </button>
                  </div>
                </>
              ) : group.group_state === 'waiting' ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 flex items-center justify-center shrink-0">⏳</div>
                      <div>
                        <h2 className="font-black text-slate-900 dark:text-white">The room is still filling up.</h2>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
                          <span className="font-black text-amber-500">{anonCount ?? '…'} / {anonTarget}</span> joined — it opens at {anonTarget} members. Anyone joining now gets a spot.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleAnonJoin}
                      disabled={joining}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-5 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest text-center hover:bg-apex-700 disabled:opacity-50 transition shadow-lg"
                    >
                      {joining ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />} Join as Anonymous
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 flex items-center justify-center shrink-0"><Lock size={18} /></div>
                      <div>
                        <h2 className="font-black text-slate-900 dark:text-white">Membership is closed.</h2>
                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-1">
                          This room is now {anonCount} strong. Non-members can watch it anonymously for a one-time {panel?.spectator_price ? `₦${panel.spectator_price}` : ''} spectator pass.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleBuySpectator}
                      disabled={buying}
                      className="inline-flex w-full sm:w-auto items-center justify-center gap-2 px-5 py-3 rounded-xl bg-apex-600 text-white font-black text-xs uppercase tracking-widest text-center hover:bg-apex-700 disabled:opacity-50 transition shadow-lg"
                    >
                      {buying ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Watch as Spectator — ₦{panel?.spectator_price || '…'}
                    </button>
                  </div>
                </>
              )}
              {anonError && <p className="text-xs font-bold text-red-500 mt-3">{anonError}</p>}
            </div>
          )}

          {!(isAnonymousGroup && !anonViewer) ? (
            <>
              {/* Group quiz CTA — only for identity-safe study groups. */}
              {!isAnonymousGroup && (
                <div className="mb-6 p-5 bg-gradient-to-br from-apex-600 to-indigo-600 rounded-3xl text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-clinical">
                  <div>
                    <h2 className="font-black text-lg tracking-tight">Group Quiz Sprint</h2>
                    <p className="text-white/80 text-xs font-bold mt-0.5 max-w-md">
                      Answer midwifery questions to build this group's unique streak and climb the board. SC stays rare.
                    </p>
                  </div>
                  <button
                    onClick={() => navigate(`/quiz?groupId=${group.id}`)}
                    className="inline-flex items-center gap-2 px-5 py-3 bg-white text-apex-700 rounded-2xl font-black text-sm uppercase tracking-wide hover:bg-slate-100 active:scale-95 transition shrink-0"
                  >
                    <Trophy size={16} /> Take Quiz
                  </button>
                </div>
              )}

              {/* Tabs */}
              <div className="flex gap-2 mb-5 overflow-x-auto">
                {tabs.map(t => {
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`inline-flex items-center gap-2 whitespace-nowrap px-4 py-2.5 rounded-xl font-black text-sm uppercase tracking-wide transition-all ${
                        active ? 'bg-apex-600 text-white shadow-lg' : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:text-apex-600'
                      }`}
                    >
                      <t.icon size={16} /> {t.label}
                    </button>
                  );
                })}
              </div>

              <AnimatePresence mode="wait">
                <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.2 }}>
                  {/* MEMBERS */}
                  {tab === 'members' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {members.map(m => (
                        <div key={m.id || `${m.profile?.id}-${m.role}`} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700 flex items-center gap-3">
                          <div className="w-12 h-12 rounded-xl bg-apex-100 dark:bg-apex-900/40 flex items-center justify-center text-apex-600 dark:text-apex-300 font-black overflow-hidden shrink-0">
                            {m.community?.avatar_url ? (
                              <img src={m.community.avatar_url} alt="" className="w-full h-full object-cover" />
                            ) : memberName(m).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-black text-slate-900 dark:text-white truncate flex items-center gap-2">{memberName(m)}
                              {m.role === 'owner' && <span className="px-1.5 py-0.5 bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded-full text-[8px] font-black uppercase tracking-widest shrink-0">Owner</span>}
                            </p>
                            <p className="text-xs font-bold text-slate-400">{m.community?.year || 'Scholar'} · joined {m.joined_at ? formatDistanceToNow(new Date(m.joined_at), { addSuffix: true }) : 'recently'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-black text-amber-500 flex items-center justify-end gap-1"><Coins size={12} /> {m.profile?.smart_coins || 0}</p>
                            <p className="text-[10px] font-bold text-slate-400">{m.group_quiz_streak || 0} group streak</p>
                          </div>
                        </div>
                      ))}
                      {members.length === 0 && <p className="col-span-full text-center py-10 text-slate-400 font-black">No members yet.</p>}
                    </div>
                  )}

                  {/* LEADERSHIP BOARD */}
                  {tab === 'board' && (
                    <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 overflow-hidden">
                      <div className="p-5 border-b border-slate-100 dark:border-slate-700 flex items-center gap-3">
                        <Trophy className="text-amber-500" size={22} />
                        <div>
                          <h3 className="font-black text-slate-900 dark:text-white">Leadership Board</h3>
                          <p className="text-xs font-bold text-slate-400">Ranked by group quiz streak + activity streak + Smart Coins</p>
                        </div>
                      </div>
                      {boardSorted.map((m, rank) => {
                        const score = (m.group_quiz_streak || 0) + (m.profile?.streak || 0) + (m.profile?.smart_coins || 0);
                        return (
                          <div key={m.id || `${m.profile?.id}-${m.role}`} className={`flex items-center gap-4 p-4 ${rank === 0 ? 'bg-amber-50 dark:bg-amber-500/10' : ''} border-b border-slate-50 dark:border-slate-700/50 last:border-0`}>
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-sm shrink-0 ${
                              rank === 0 ? 'bg-amber-500 text-white' : rank === 1 ? 'bg-slate-400 text-white' : rank === 2 ? 'bg-orange-400 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500'
                            }`}>{rank + 1}</div>
                            <div className="w-10 h-10 rounded-xl bg-apex-100 dark:bg-apex-900/40 flex items-center justify-center text-apex-600 dark:text-apex-300 font-black overflow-hidden shrink-0">
                              {m.community?.avatar_url ? <img src={m.community.avatar_url} alt="" className="w-full h-full object-cover" /> : memberName(m).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-black text-slate-900 dark:text-white truncate flex items-center gap-2">{memberName(m)}
                                {m.role === 'owner' && <Flag size={12} className="text-amber-500 shrink-0" />}
                              </p>
                              <p className="text-[10px] font-bold text-slate-400 flex items-center gap-2">
                                <span className="inline-flex items-center gap-0.5"><TrendingUp size={10} /> {m.group_quiz_streak || 0} grp</span>
                                <span className="inline-flex items-center gap-0.5"><Award size={10} /> {m.profile?.streak || 0} day</span>
                                <span className="inline-flex items-center gap-0.5"><Coins size={10} /> {m.profile?.smart_coins || 0} SC</span>
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="font-black text-apex-600 dark:text-apex-400">{score} pts</p>
                            </div>
                          </div>
                        );
                      })}
                      {boardSorted.length === 0 && <p className="text-center py-10 text-slate-400 font-black">No members to rank yet.</p>}
                    </div>
                  )}

                  {/* DISCUSSION */}
                  {tab === 'discussion' && (
                    <div className="space-y-4">
                      {isAnonymousGroup && (
                        <div className="p-3 rounded-xl bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs font-bold flex items-center gap-2">
                          <Lock size={13} /> Anonymous room — every author is masked. Nothing here links back to a real identity.
                        </div>
                      )}
                      {canPost && (
                        <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                          <textarea
                            value={postContent}
                            onChange={e => setPostContent(e.target.value)}
                            placeholder={isAnonymousGroup ? 'Share anonymously with the room…' : 'Share a study tip or question with this group...'}
                            rows="3"
                            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none focus:border-apex-400 resize-none"
                          />
                          <div className="flex justify-end mt-3">
                            <button
                              onClick={handlePost}
                              disabled={posting || !postContent.trim()}
                              className="inline-flex items-center gap-2 px-5 py-2.5 bg-apex-600 text-white rounded-xl font-black text-sm uppercase tracking-wide hover:bg-apex-700 disabled:opacity-40 transition"
                            >
                              {posting ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Post
                            </button>
                          </div>
                        </div>
                      )}

                      {posts.map(post => (
                        <div key={post.id} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-apex-100 dark:bg-apex-900/40 flex items-center justify-center text-apex-600 dark:text-apex-300 font-black overflow-hidden shrink-0">
                              {isAnonymousGroup ? <Lock size={16} /> : post.avatar_url ? <img src={post.avatar_url} alt="" className="w-full h-full object-cover" /> : (post.display_name ? post.display_name.charAt(0).toUpperCase() : <User size={16} />)}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                <p className="font-black text-slate-900 dark:text-white text-sm">{post.display_name || 'Anonymous Scholar'}</p>
                                <span className="text-[10px] font-bold text-slate-400">{post.created_at ? formatDistanceToNow(new Date(post.created_at), { addSuffix: true }) : ''}</span>
                              </div>
                              <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mt-1 break-words">{post.content}</p>
                              <button
                                onClick={() => toggleLike(post)}
                                className={`mt-2 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide transition-colors ${post.liked_by_current_user ? 'text-rose-500' : 'text-slate-400 hover:text-rose-500'}`}
                              >
                                <Heart size={14} fill={post.liked_by_current_user ? 'currentColor' : 'none'} /> {post.like_count || 0}
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                      {posts.length === 0 && (
                        <p className="text-center py-10 text-slate-400 font-black">
                          {isAnonymousGroup && myRole === 'spectator' ? 'Spectators see an empty room — posts are ephemeral and expire.' : 'No posts yet — start the conversation.'}
                        </p>
                      )}
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </>
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-10 text-center text-slate-400 shadow-clinical">
              <Lock size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm font-bold text-slate-900 dark:text-white">You can't see this room yet.</p>
              <p className="text-xs mt-1">Join as a member or grab a spectator pass above to open the board.</p>
            </div>
          )}
        </>
      )}

      <CommunityAuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onAuthSuccess={() => {}} />
    </div>
  );
};

export default GroupPage;