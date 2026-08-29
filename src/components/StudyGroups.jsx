import React, { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Lock,
  ShieldCheck,
  Check,
  X,
  Loader2,
  Send,
  Heart,
  MessageCircle,
  Trash2,
  ArrowLeft,
  Plus,
  User,
  BookOpen,
  Sparkles
} from './Icons';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAppContext } from '../context/AppContext';
import { formatDistanceToNow } from 'date-fns';
import CommunityAuthModal from './CommunityAuthModal';

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

const StudyGroups = () => {
  const { session, userProfile } = useAppContext();
  const navigate = useNavigate();
  const isAdmin = userProfile.isAdmin;
  const currentUserId = session?.user?.id;
  const isAuthenticated = !!currentUserId && session?.user?.is_anonymous !== true;

  const [groups, setGroups] = useState([]);
  const [memberships, setMemberships] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState(null);
  const [joinedIds, setJoinedIds] = useState([]);

  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [form, setForm] = useState({ name: '', description: '', school: '', level: '', focus: '' });

  const [showAuthModal, setShowAuthModal] = useState(false);

  const [groupPosts, setGroupPosts] = useState([]);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [groupPostContent, setGroupPostContent] = useState('');
  const [posting, setPosting] = useState(false);

  const [comments, setComments] = useState([]);
  const [openCommentsId, setOpenCommentsId] = useState(null);
  const [commentText, setCommentText] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  const requireAuth = () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return false;
    }
    return true;
  };

  const loadGroups = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    try {
      const { data } = await supabase
        .from('study_groups')
        .select('*, members:study_group_members(count)')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      const rows = (data || []).map(g => ({
        ...g,
        member_count: g.members?.[0]?.count ?? 0
      }));
      setGroups(rows);
      setActiveGroup(prev => {
        if (!prev) return prev;
        const updated = rows.find(r => r.id === prev.id);
        return updated ? { ...prev, ...updated } : prev;
      });
    } catch (err) {
      console.error('Error loading study groups:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMemberships = useCallback(async () => {
    if (!supabase || !currentUserId) return;
    const { data } = await supabase
      .from('study_group_members')
      .select('group_id, role')
      .eq('user_id', currentUserId);
    const map = {};
    (data || []).forEach(m => { map[m.group_id] = m.role; });
    setMemberships(map);
    setJoinedIds(Object.keys(map).map(Number));
  }, [currentUserId]);

  useEffect(() => {
    loadGroups();
    loadMemberships();
  }, [loadGroups, loadMemberships]);

  const handleCreate = async () => {
    if (!requireAuth()) return;
    if (!form.name.trim()) {
      setCreateError('Give your study group a name.');
      return;
    }
    if (!supabase) return;
    setCreating(true);
    setCreateError('');
    try {
      const { data: group, error: gErr } = await supabase
        .from('study_groups')
        .insert({
          name: form.name.trim(),
          description: form.description.trim(),
          school: form.school.trim(),
          level: form.level.trim(),
          focus: form.focus.trim(),
          creator_id: currentUserId
        })
        .select('*')
        .single();
      if (gErr) throw gErr;

      const { error: mErr } = await supabase
        .from('study_group_members')
        .insert({ group_id: group.id, user_id: currentUserId, role: 'owner' });
      if (mErr) throw mErr;

      setForm({ name: '', description: '', school: '', level: '', focus: '' });
      setShowCreate(false);
      await Promise.all([loadGroups(), loadMemberships()]);
      setActiveGroup(group);
    } catch (err) {
      console.error('Error creating group:', err);
      if (err.message?.includes('row-level security') || err.code === '42501') {
        setShowAuthModal(true);
        setCreateError('You must be signed in to create a group.');
      } else {
        setCreateError('Could not create the group. Please try again.');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleJoinLeave = async (group) => {
    if (!requireAuth()) return;
    if (!supabase) return;
    const isMember = joinedIds.includes(group.id);
    try {
      if (isMember) {
        if (memberships[group.id] === 'owner') return;
        await supabase.from('study_group_members').delete().match({ group_id: group.id, user_id: currentUserId });
      } else {
        await supabase.from('study_group_members').insert({ group_id: group.id, user_id: currentUserId, role: 'member' });
      }
      await Promise.all([loadGroups(), loadMemberships()]);
    } catch (err) {
      console.error('Error updating membership:', err);
    }
  };

  const toggleVerify = async (group) => {
    if (!isAdmin || !supabase) return;
    await supabase.from('study_groups').update({ is_verified: !group.is_verified }).eq('id', group.id);
    loadGroups();
  };

  const handleDeleteGroup = async (group) => {
    if (!requireAuth()) return;
    if (!confirm(`Delete "${group.name}"? This removes all memberships and moves its posts to the general feed.`)) return;
    if (!supabase) return;
    try {
      await supabase.from('study_groups').delete().eq('id', group.id);
      if (activeGroup?.id === group.id) setActiveGroup(null);
      await loadGroups();
    } catch (err) {
      console.error('Error deleting group:', err);
      alert('Failed to delete group.');
    }
  };

  const loadGroupPosts = async (gid) => {
    if (!supabase) return;
    setLoadingPosts(true);
    try {
      const { data } = await supabase
        .from('community_feed')
        .select('*')
        .eq('group_id', gid)
        .order('created_at', { ascending: false })
        .limit(50);
      setGroupPosts(data || []);
    } catch (err) {
      console.error('Error loading group posts:', err);
    } finally {
      setLoadingPosts(false);
    }
  };

  const openGroup = async (group) => {
    setActiveGroup(group);
    await loadGroupPosts(group.id);
  };

  const handleGroupPost = async () => {
    if (!requireAuth()) return;
    if (!groupPostContent.trim() || !supabase || !activeGroup) return;
    setPosting(true);
    try {
      const { error } = await supabase
        .from('community_posts')
        .insert({
          author_id: currentUserId,
          content: groupPostContent.trim(),
          section: 'general',
          group_id: activeGroup.id
        });
      if (error) throw error;
      setGroupPostContent('');
      await loadGroupPosts(activeGroup.id);
    } catch (err) {
      console.error('Error posting to group:', err);
      if (err.message?.includes('row-level security') || err.code === '42501') {
        setShowAuthModal(true);
      } else {
        alert('Failed to post in this group.');
      }
    } finally {
      setPosting(false);
    }
  };

  const handleGroupLike = async (post) => {
    if (!requireAuth()) return;
    if (!supabase) return;
    const liked = post.liked_by_current_user;
    const optimistic = groupPosts.map(p => p.id === post.id
      ? { ...p, liked_by_current_user: !liked, like_count: Math.max(0, (p.like_count || 0) + (liked ? -1 : 1)) }
      : p);
    setGroupPosts(optimistic);
    try {
      if (!liked) {
        await supabase.from('community_post_likes').insert({ post_id: post.id, user_id: currentUserId });
      } else {
        await supabase.from('community_post_likes').delete().match({ post_id: post.id, user_id: currentUserId });
      }
    } catch (err) {
      console.error('Error toggling like:', err);
    }
  };

  const toggleComments = async (post) => {
    if (!requireAuth()) return;
    if (openCommentsId === post.id) {
      setOpenCommentsId(null);
      setComments([]);
      return;
    }
    setOpenCommentsId(post.id);
    const { data } = await supabase
      .from('community_comments')
      .select('id, author_id, content, created_at')
      .eq('post_id', post.id)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true });
    setComments(data || []);
  };

  const handleComment = async (postId) => {
    if (!commentText.trim() || !supabase) return;
    setPostingComment(true);
    try {
      const { data } = await supabase
        .from('community_comments')
        .insert({ post_id: postId, author_id: currentUserId, content: commentText.trim() })
        .select('id, author_id, content, created_at')
        .single();
      if (data) {
        setComments(prev => [...prev, data]);
        setGroupPosts(prev => prev.map(p => p.id === postId ? { ...p, reply_count: (p.reply_count || 0) + 1 } : p));
        setCommentText('');
      }
    } catch (err) {
      console.error('Error commenting:', err);
    } finally {
      setPostingComment(false);
    }
  };

  // ---------- RENDER ----------

  if (activeGroup) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => setActiveGroup(null)}
          className="flex items-center gap-2 text-sm font-black text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
        >
          <ArrowLeft size={16} /> Back to Study Groups
        </button>

        <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-7 shadow-clinical">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">{activeGroup.name}</h2>
                <GroupBadge verified={activeGroup.is_verified} />
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 font-medium max-w-xl">{activeGroup.description || 'No description yet.'}</p>
              <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
                {activeGroup.school && <span className="px-2 py-1 bg-slate-100 dark:bg-slate-900 rounded-lg">🏫 {activeGroup.school}</span>}
                {activeGroup.level && <span className="px-2 py-1 bg-slate-100 dark:bg-slate-900 rounded-lg">🎓 {activeGroup.level}</span>}
                {activeGroup.focus && <span className="px-2 py-1 bg-apex-600/10 text-apex-600 dark:text-apex-400 rounded-lg">🎯 {activeGroup.focus}</span>}
              </div>
              <p className="text-xs text-slate-400 font-bold flex items-center gap-1">
                <Users size={12} /> {activeGroup.member_count} member{activeGroup.member_count === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {memberships[activeGroup.id] !== 'owner' && (
                <button
                  onClick={() => handleJoinLeave(activeGroup)}
                  className={`px-4 py-2.5 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 flex items-center gap-2 ${
                    joinedIds.includes(activeGroup.id)
                      ? 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                      : 'bg-apex-600 text-white shadow-lg'
                  }`}
                >
                  {joinedIds.includes(activeGroup.id) ? <><X size={12} /> Leave</> : <><Check size={12} /> Join</>}
                </button>
              )}
              {isAdmin && (
                <button
                  onClick={() => toggleVerify(activeGroup)}
                  className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white font-black uppercase tracking-widest text-[10px] transition-all active:scale-95"
                >
                  <ShieldCheck size={12} /> {activeGroup.is_verified ? 'Unverify' : 'Verify'}
                </button>
              )}
              {(isAdmin || memberships[activeGroup.id] === 'owner') && (
                <button
                  onClick={() => handleDeleteGroup(activeGroup)}
                  className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-black uppercase tracking-widest text-[10px] transition-all active:scale-95 flex items-center gap-1.5"
                >
                  <Trash2 size={12} /> Delete
                </button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Group composer */}
        <motion.div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 shadow-clinical">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
              {session?.user?.user_metadata?.avatar_url ? (
                <img src={session.user.user_metadata.avatar_url} alt="You" className="w-full h-full object-cover" />
              ) : (
                <User size={16} />
              )}
            </div>
            <textarea
              value={groupPostContent}
              onChange={(e) => setGroupPostContent(e.target.value)}
              placeholder={`Post to ${activeGroup.name}...`}
              maxLength={1000}
              className="flex-1 bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white placeholder-slate-400 resize-none outline-none text-sm font-medium leading-relaxed min-h-[54px] rounded-2xl p-3 border border-slate-100 dark:border-slate-800"
              rows={2}
            />
          </div>
          <div className="flex justify-end mt-3">
            <button
              onClick={handleGroupPost}
              disabled={!groupPostContent.trim() || posting}
              className="px-5 py-2 bg-emerald-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
            >
              {posting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {posting ? 'Posting...' : 'Post'}
            </button>
          </div>
        </motion.div>

        {/* Group feed */}
        <div className="space-y-4">
          {loadingPosts ? (
            <div className="flex justify-center py-12"><Loader2 size={24} className="animate-spin text-emerald-500" /></div>
          ) : groupPosts.length > 0 ? (
            groupPosts.map(post => (
              <div key={post.id} className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 shadow-clinical">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 rounded-full flex items-center justify-center font-black text-sm shrink-0 overflow-hidden">
                    {post.avatar_url ? <img src={post.avatar_url} alt={post.display_name} className="w-full h-full object-cover" /> : (post.display_name ? post.display_name.charAt(0).toUpperCase() : <User size={16} />)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 dark:text-white">{post.display_name || 'Anonymous Scholar'}</p>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}</p>
                  </div>
                  {post.author_id === currentUserId && (
                    <button
                      onClick={async () => {
                        if (!confirm('Delete this post?')) return;
                        await supabase.from('community_posts').update({ is_deleted: true }).eq('id', post.id);
                        setGroupPosts(prev => prev.filter(p => p.id !== post.id));
                      }}
                      className="ml-auto text-slate-400 hover:text-red-500 transition-colors"
                      aria-label="Delete post"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed whitespace-pre-wrap break-words">{post.content}</p>
                <div className="flex items-center gap-5 text-slate-400 mt-4">
                  <button
                    onClick={() => handleGroupLike(post)}
                    className={`flex items-center gap-1.5 text-xs font-semibold transition-colors ${post.liked_by_current_user ? 'text-red-500' : 'hover:text-red-500'}`}
                  >
                    <Heart size={15} className={post.liked_by_current_user ? 'fill-red-500 text-red-500' : ''} /> {post.like_count || 0}
                  </button>
                  <button
                    onClick={() => toggleComments(post)}
                    className={`flex items-center gap-1.5 text-xs font-semibold ${openCommentsId === post.id ? 'text-emerald-500' : 'hover:text-emerald-500'} transition-colors`}
                  >
                    <MessageCircle size={15} /> {post.reply_count || 0}
                  </button>
                  {post.author_id === currentUserId && (
                    <button
                      onClick={async () => {
                        await supabase.from('community_posts').update({ is_deleted: true }).eq('id', post.id);
                        setGroupPosts(prev => prev.filter(p => p.id !== post.id));
                      }}
                      className="ml-auto flex items-center gap-1.5 text-xs font-semibold hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>

                {openCommentsId === post.id && (
                  <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 space-y-3">
                    {comments.length > 0 && (
                      <div className="space-y-2">
                        {comments.map(c => (
                          <div key={c.id} className="flex gap-2.5">
                            <div className="w-7 h-7 bg-slate-100 dark:bg-slate-900 text-slate-500 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 overflow-hidden">
                              <User size={11} />
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-900/50 rounded-xl rounded-tl-none px-3 py-2">
                              <p className="text-[10px] text-slate-500 font-black">{c.author_id === currentUserId ? 'You' : 'Member'}</p>
                              <p className="text-sm text-slate-700 dark:text-slate-300 font-medium">{c.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <input
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleComment(post.id); }}
                        placeholder="Reply..."
                        className="flex-1 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white text-sm px-4 py-2 rounded-full outline-none border border-transparent focus:border-emerald-300"
                      />
                      <button
                        onClick={() => handleComment(post.id)}
                        disabled={!commentText.trim() || postingComment}
                        className="w-9 h-9 flex items-center justify-center bg-emerald-600 text-white rounded-full hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                      >
                        {postingComment ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-10 text-center text-slate-400">
              <MessageCircle size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-bold text-slate-900 dark:text-white">No posts in this group yet.</p>
              <p className="text-xs mt-1">Kick off the discussion with a study tip.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + create */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 text-emerald-600 mb-1">
            <Sparkles size={22} />
            <span className="text-[10px] font-black uppercase tracking-[0.3em]">Peer Support</span>
          </div>
          <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Verified Study Groups</h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-sm mt-1">Study with classmates. Verified groups are checked by the school.</p>
        </div>
        <button
          onClick={() => requireAuth() && setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-3 bg-apex-600 text-white rounded-2xl font-black uppercase tracking-widest text-[10px] shadow-lg hover:bg-apex-700 transition-all active:scale-95"
        >
          <Plus size={14} /> Create Group
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={28} className="animate-spin text-emerald-500" /></div>
      ) : groups.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {groups.map((group, i) => {
            const isOwner = memberships[group.id] === 'owner';
            const isMember = joinedIds.includes(group.id);
            const section = getGroupVisual();
            return (
              <motion.div
                key={group.id}
                initial={{ y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: i * 0.04 }}
                className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 shadow-clinical flex flex-col transition-all hover:-translate-y-1"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className={`w-12 h-12 rounded-2xl ${section.bg} flex items-center justify-center text-xl shrink-0`}>{section.emoji}</div>
                  <GroupBadge verified={group.is_verified} />
                </div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight leading-snug">{group.name}</h3>
                {group.focus && (
                  <p className="text-[10px] font-black uppercase tracking-widest text-apex-600 dark:text-apex-400 mt-1">{group.focus}</p>
                )}
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed mt-2 line-clamp-2 flex-1">{group.description}</p>
                <div className="flex flex-wrap gap-2 mt-4 text-[9px] font-black uppercase tracking-widest text-slate-400">
                  {group.school && <span className="px-2 py-1 bg-slate-100 dark:bg-slate-900 rounded-lg">🏫 {group.school}</span>}
                  {group.level && <span className="px-2 py-1 bg-slate-100 dark:bg-slate-900 rounded-lg">🎓 {group.level}</span>}
                  <span className="px-2 py-1 bg-slate-100 dark:bg-slate-900 rounded-lg flex items-center gap-1"><Users size={10} /> {group.member_count}</span>
                </div>

                <div className="flex items-center gap-2 mt-5 pt-5 border-t border-slate-100 dark:border-slate-700">
                  <button
                    onClick={() => openGroup(group)}
                    className="flex-1 px-4 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-black uppercase tracking-widest text-[9px] hover:opacity-90 transition-all active:scale-95"
                  >
                    Open
                  </button>
                  <button
                    onClick={() => navigate(`/study-groups/${group.id}`)}
                    className="px-4 py-2.5 bg-apex-600 text-white rounded-xl font-black uppercase tracking-widest text-[9px] flex items-center gap-1.5 hover:bg-apex-700 transition-all active:scale-95"
                  >
                    <Users size={12} /> Group Page
                  </button>
                  {isOwner ? (
                    <button
                      onClick={() => handleDeleteGroup(group)}
                      className="px-4 py-2.5 bg-red-600 text-white rounded-xl font-black uppercase tracking-widest text-[9px]"
                    >
                      <Trash2 size={12} />
                    </button>
                  ) : (
                    <button
                      onClick={() => handleJoinLeave(group)}
                      className={`px-4 py-2.5 rounded-xl font-black uppercase tracking-widest text-[9px] transition-all active:scale-95 flex items-center gap-1.5 ${isMember ? 'bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-300' : 'bg-apex-600 text-white'}`}
                    >
                      {isMember ? <><X size={11} /> Leave</> : <><Check size={11} /> Join</>}
                    </button>
                  )}
                </div>

                {isAdmin && group.creator_id === currentUserId && (
                  <button
                    onClick={() => toggleVerify(group)}
                    className="mt-2 w-full px-4 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-black uppercase tracking-widest text-[9px] flex items-center justify-center gap-1.5 hover:bg-emerald-500/20 transition-colors"
                  >
                    <ShieldCheck size={12} /> {group.is_verified ? 'Unverify Group' : 'Verify Group'}
                  </button>
                )}
              </motion.div>
            );
          })}
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-12 text-center text-slate-400 shadow-clinical">
          <BookOpen size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-bold text-slate-900 dark:text-white mb-2">No study groups yet.</p>
          <p className="text-sm font-medium max-w-sm mx-auto">Start one — teammates are a tap away.</p>
        </div>
      )}

      {/* Create modal */}
      <AnimatePresence>
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-800 rounded-[2rem] p-7 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">Create Study Group</h3>
                <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X size={20} /></button>
              </div>

              <div className="space-y-4">
                {[
                  { key: 'name', label: 'Group Name', placeholder: 'Year 2 Nursing — Warri Study Group', required: true },
                  { key: 'description', label: 'Description', placeholder: 'What will this group work on together?' },
                  { key: 'school', label: 'School', placeholder: 'e.g. UNIBEN School of Nursing' },
                  { key: 'level', label: 'Level / Year', placeholder: 'e.g. Year 2' },
                  { key: 'focus', label: 'Focus Area', placeholder: '2026 Council Exam Preparation', required: true }
                ].map(field => (
                  <div key={field.key}>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{field.label}</label>
                    <input
                      value={form[field.key]}
                      onChange={(e) => setForm(f => ({ ...f, [field.key]: e.target.value }))}
                      placeholder={field.placeholder}
                      className="w-full bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white text-sm px-4 py-3 rounded-xl outline-none border border-slate-200 dark:border-slate-700 focus:border-apex-400 transition-colors"
                    />
                  </div>
                ))}
              </div>

              {createError && <p className="text-red-500 text-xs mt-3">{createError}</p>}

              <div className="flex gap-3 mt-6">
                <button onClick={() => setShowCreate(false)} className="flex-1 py-3 rounded-xl font-bold text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating || !form.name.trim() || !form.focus.trim()}
                  className="flex-1 py-3 rounded-xl font-bold text-sm bg-apex-600 text-white hover:bg-apex-700 disabled:opacity-50 transition-colors flex justify-center items-center gap-2"
                >
                  {creating && <Loader2 size={16} className="animate-spin" />}
                  Create
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <CommunityAuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </div>
  );
};

// Deterministic visual per group (picks from a stable palette by id).
const GROUP_VISUALS = [
  { emoji: '📚', bg: 'bg-amber-500/15' },
  { emoji: '🩺', bg: 'bg-sky-500/15' },
  { emoji: '📝', bg: 'bg-indigo-500/15' },
  { emoji: '💊', bg: 'bg-rose-500/15' },
  { emoji: '❤️', bg: 'bg-red-500/15' },
  { emoji: '🧠', bg: 'bg-violet-500/15' },
  { emoji: '🎓', bg: 'bg-emerald-500/15' },
  { emoji: '🏥', bg: 'bg-cyan-500/15' }
];
const getGroupVisual = (() => {
  let counter = 0;
  return () => GROUP_VISUALS[counter++ % GROUP_VISUALS.length];
})();

export default StudyGroups;