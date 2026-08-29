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
  Flag
} from '../components/Icons';
import { supabase } from '../utils/supabase';
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
  const [likedPostIds, setLikedPostIds] = useState([]);

  const requireAuth = () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return false;
    }
    return true;
  };

  const loadGroup = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('study_groups')
        .select('*, members:study_group_members(count)')
        .eq('id', Number(id))
        .single();
      if (data) {
        setGroup({ ...data, member_count: data.members?.[0]?.count ?? 0 });
      }
    } catch (err) {
      console.error('Error loading group page:', err);
    }
  }, [id]);

  const loadMembers = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from('study_group_members')
        .select(`
          role, joined_at, group_quiz_streak, group_quiz_last_date,
          profile:profiles(id, streak, quiz_streak, smart_coins),
          community:community_profiles(id, display_name, avatar_url, year)
        `)
        .eq('group_id', Number(id))
        .order('joined_at', { ascending: true });
      const rows = (data || []).sort((a, b) =>
        (a.profile?.smart_coins || 0) - (b.profile?.smart_coins || 0)
      ).reverse();
      setMembers(rows);
    } catch (err) {
      console.error('Error loading members:', err);
    }
  }, [id]);

  const loadPosts = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data } = await supabase
        .from('community_feed')
        .select('*')
        .eq('group_id', Number(id))
        .order('created_at', { ascending: false })
        .limit(50);
      setPosts(data || []);
    } catch (err) {
      console.error('Error loading group posts:', err);
    }
  }, [id]);

  const loadMyLikes = useCallback(async () => {
    if (!supabase || !currentUserId) return;
    const { data } = await supabase
      .from('community_post_likes')
      .select('post_id')
      .eq('user_id', currentUserId);
    setLikedPostIds((data || []).map(l => l.post_id));
  }, [currentUserId]);

  useEffect(() => {
    Promise.all([loadGroup(), loadMembers(), loadPosts(), loadMyLikes()]).finally(() => setLoading(false));
  }, [loadGroup, loadMembers, loadPosts, loadMyLikes]);

  const handlePost = async () => {
    if (!requireAuth()) return;
    if (!postContent.trim() || !supabase || !group) return;
    setPosting(true);
    try {
      const { error } = await supabase
        .from('community_posts')
        .insert({
          author_id: currentUserId,
          content: postContent.trim(),
          section: 'general',
          group_id: group.id
        });
      if (error) throw error;
      setPostContent('');
      await loadPosts();
    } catch (err) {
      console.error('Error posting:', err);
      if (err.message?.includes('row-level security') || err.code === '42501') {
        setShowAuthModal(true);
      } else {
        alert('Failed to post in this group.');
      }
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post) => {
    if (!requireAuth()) return;
    if (!supabase) return;
    const already = likedPostIds.includes(post.id);
    try {
      if (already) {
        await supabase.from('community_post_likes').delete().match({ post_id: post.id, user_id: currentUserId });
        setLikedPostIds(prev => prev.filter(x => x !== post.id));
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, like_count: Math.max(0, (p.like_count || 0) - 1) } : p));
      } else {
        await supabase.from('community_post_likes').insert({ post_id: post.id, user_id: currentUserId });
        setLikedPostIds(prev => [...prev, post.id]);
        setPosts(prev => prev.map(p => p.id === post.id ? { ...p, like_count: (p.like_count || 0) + 1 } : p));
      }
    } catch (err) {
      console.error('Like toggle failed:', err);
    }
  };

  const tabs = [
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
                  <GroupBadge verified={group.is_verified} />
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
                    <Users size={10} className="inline mr-1" /> {group.member_count || members.length}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Group quiz CTA — launches the Midwifery 200-Level bank and stamps
              results with this group so the per-group streak can advance. */}
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
                  <div className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <textarea
                      value={postContent}
                      onChange={e => setPostContent(e.target.value)}
                      placeholder="Share a study tip or question with this group..."
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

                  {posts.map(post => (
                    <div key={post.id} className="bg-white dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-xl bg-apex-100 dark:bg-apex-900/40 flex items-center justify-center text-apex-600 dark:text-apex-300 font-black overflow-hidden shrink-0">
                          {post.avatar_url ? <img src={post.avatar_url} alt="" className="w-full h-full object-cover" /> : (post.display_name ? post.display_name.charAt(0).toUpperCase() : <User size={16} />)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="font-black text-slate-900 dark:text-white text-sm">{post.display_name || 'Anonymous Scholar'}</p>
                            <span className="text-[10px] font-bold text-slate-400">{post.created_at ? formatDistanceToNow(new Date(post.created_at), { addSuffix: true }) : ''}</span>
                          </div>
                          <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mt-1 break-words">{post.content}</p>
                          <button
                            onClick={() => toggleLike(post)}
                            className={`mt-2 inline-flex items-center gap-1.5 text-xs font-black uppercase tracking-wide transition-colors ${likedPostIds.includes(post.id) ? 'text-rose-500' : 'text-slate-400 hover:text-rose-500'}`}
                          >
                            <Heart size={14} fill={likedPostIds.includes(post.id) ? 'currentColor' : 'none'} /> {post.like_count || 0}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {posts.length === 0 && <p className="text-center py-10 text-slate-400 font-black">No posts yet — start the conversation.</p>}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      <CommunityAuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onAuthSuccess={() => {}} />
    </div>
  );
};

export default GroupPage;
