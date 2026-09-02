import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users,
  Info,
  Sparkles,
  Clock,
  MessageSquare,
  Heart,
  MessageCircle,
  Share2,
  MoreHorizontal,
   User,
   Send,
   Flag,
   Trash2,
   Edit2,
   X,
   Loader2,
   CheckCircle2,
  Lock,
  ImageIcon
} from '../components/Icons';
  // eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { supabase, uploadFile, getPublicUrl } from '../utils/supabase';
import { useAppContext } from '../context/AppContext';
import { formatDistanceToNow } from 'date-fns';
import { useParams, useNavigate, Link } from 'react-router-dom';
import CommunityAuthModal from '../components/CommunityAuthModal';
import AdBanner from '../components/AdBanner';
import { COMMUNITY_SECTIONS, getSection, SECTION_ORDER } from '../data/communitySections';

const POSTS_PER_PAGE = 15;

const Community = () => {
  const { session } = useAppContext();
  const { section } = useParams();
  const navigate = useNavigate();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  // Section is URL-driven now: /community (=> 'all') or /community/:section.
  const activeSection = section || 'all';
  const [newPostSection, setNewPostSection] = useState('general');

  const [newPostContent, setNewPostContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  // Image attachment states
  const [selectedImage, setSelectedImage] = useState(null);   // File object
  const [imagePreview, setImagePreview] = useState(null);     // object URL for preview
  const imageInputRef = useRef(null);
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

  const handleSelectImage = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('Image is too large. Maximum size is 5 MB.');
      return;
    }
    setError('');
    setSelectedImage(file);
    setImagePreview(URL.createObjectURL(file));
    // Allow re-selecting the same file later
    e.target.value = '';
  };

  const clearSelectedImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setSelectedImage(null);
    setImagePreview(null);
  };

  // Comment section states
  const [activeCommentPostId, setActiveCommentPostId] = useState(null);
  const [comments, setComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [newCommentContent, setNewCommentContent] = useState('');
  const [postingComment, setPostingComment] = useState(false);

  // Comment edit/delete states
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editCommentContent, setEditCommentContent] = useState('');
  const [commentMenuId, setCommentMenuId] = useState(null);

  // Ref mirror for use inside the once-registered realtime subscription
  const activeCommentPostIdRef = useRef(null);
  useEffect(() => {
    activeCommentPostIdRef.current = activeCommentPostId;
  }, [activeCommentPostId]);

  const activeSectionRef = useRef('all');
  useEffect(() => {
    activeSectionRef.current = activeSection;
  }, [activeSection]);

  // Menu states
  const [activeMenuPostId, setActiveMenuPostId] = useState(null);

  // Edit state
  const [editingPostId, setEditingPostId] = useState(null);
  const [editContent, setEditContent] = useState('');

  // Report State
  const [reportPostId, setReportPostId] = useState(null);
  const [reportReason, setReportReason] = useState('');
  const [reporting, setReporting] = useState(false);

  // Auth modal state
  const [showAuthModal, setShowAuthModal] = useState(false);

  const currentUserId = session?.user?.id;
  const isAnonymous = session?.user?.is_anonymous === true;
  const isAuthenticated = !!currentUserId && !isAnonymous;

  // ============================
  // AUTH GUARD
  // ============================
  const requireAuth = () => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return false;
    }
    return true;
  };

  // Also verify auth at Supabase level before writes
  const verifyAuthBeforeWrite = async () => {
    if (!supabase) return false;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || user.is_anonymous) {
        setShowAuthModal(true);
        return false;
      }
      return true;
    } catch {
      setShowAuthModal(true);
      return false;
    }
  };

  // ============================
  // FETCH POSTS (public read)
  // ============================
  const fetchPosts = useCallback(async (pageIndex = 0, append = false) => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      if (pageIndex === 0) setLoading(true);
      else setLoadingMore(true);

      const from = pageIndex * POSTS_PER_PAGE;
      const to = from + POSTS_PER_PAGE - 1;

      let query = supabase
        .from('community_feed')
        .select('*')
        .is('group_id', null) // group-scoped posts live in the Study Groups feed
        .order('created_at', { ascending: false })
        .range(from, to);

      if (activeSection !== 'all') {
        query = query.eq('section', activeSection);
      }

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;

      if (data) {
        if (append) {
          setPosts(prev => [...prev, ...data]);
        } else {
          setPosts(data);
        }
        setHasMore(data.length === POSTS_PER_PAGE);
      }
    } catch (err) {
      console.error('Error fetching community posts:', err);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [activeSection]);

  const switchSection = (key) => {
    if (key !== 'all') setNewPostSection(key);
    navigate(key === 'all' ? '/community' : `/community/${key}`);
  };

  useEffect(() => {
    fetchPosts(0, false);
    setPage(0);
  }, [fetchPosts]);

  // Realtime Subscriptions
  useEffect(() => {
    if (!supabase) return;

    const channel = supabase.channel('community_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_posts' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          fetchSinglePost(payload.new.id).then(newPost => {
            if (!newPost) return;
            if (newPost.group_id) return; // group feed only
            if (activeSectionRef.current !== 'all' && (newPost.section || 'general') !== activeSectionRef.current) return;
            setPosts(prev => {
              if (prev.some(p => p.id === newPost.id)) return prev;
              return [newPost, ...prev];
            });
          });
        } else if (payload.eventType === 'UPDATE') {
          if (payload.new.is_deleted || payload.new.is_hidden) {
            setPosts(prev => prev.filter(p => p.id !== payload.new.id));
          } else {
            setPosts(prev => prev.map(p => p.id === payload.new.id ? { ...p, content: payload.new.content } : p));
          }
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_post_likes' }, () => {
         // Optionally refresh specific post counts or just rely on local state to avoid jumpiness
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'community_comments' }, (payload) => {
         if (payload.eventType === 'INSERT' && payload.new.post_id) {
            setPosts(prev => prev.map(p => p.id === payload.new.post_id ? { ...p, reply_count: Number(p.reply_count) + 1 } : p));
            // Live-append the new comment if its drawer is currently open
            if (payload.new.post_id === activeCommentPostIdRef.current && !payload.new.is_deleted) {
               fetchSingleComment(payload.new.id).then(formatted => {
                  if (formatted) {
                     setComments(prev => prev.some(c => c.id === formatted.id) ? prev : [...prev, formatted]);
                  }
               });
            }
         } else if (payload.eventType === 'DELETE' && payload.old.post_id) {
            setPosts(prev => prev.map(p => p.id === payload.old.post_id ? { ...p, reply_count: Math.max(0, Number(p.reply_count) - 1) } : p));
         } else if (payload.eventType === 'UPDATE' && payload.new) {
            // Soft-deleted comments disappear live from open drawers
            if (payload.new.is_deleted) {
               setComments(prev => prev.filter(c => c.id !== payload.new.id));
            } else if (activeCommentPostIdRef.current === payload.new.post_id) {
               setComments(prev => prev.map(c => c.id === payload.new.id ? { ...c, content: payload.new.content } : c));
            }
         }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchSinglePost = async (id) => {
    const { data } = await supabase.from('community_feed').select('*').eq('id', id).single();
    return data;
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchPosts(nextPage, true);
    }
  };

  // ============================
  // GUARDED ACTIONS
  // ============================
  const handleLike = async (postId, currentLikedStatus) => {
    if (!requireAuth()) return;
    if (!supabase) return;

    const verified = await verifyAuthBeforeWrite();
    if (!verified) return;

    const newLikedStatus = !currentLikedStatus;
    
    // Optimistic UI update
    setPosts(posts.map(p => {
      if (p.id === postId) {
        return { 
          ...p, 
          liked_by_current_user: newLikedStatus, 
          like_count: newLikedStatus ? Number(p.like_count) + 1 : Math.max(0, Number(p.like_count) - 1) 
        };
      }
      return p;
    }));

    try {
      if (newLikedStatus) {
        await supabase.from('community_post_likes').insert({ post_id: postId, user_id: currentUserId });
      } else {
        await supabase.from('community_post_likes').delete().match({ post_id: postId, user_id: currentUserId });
      }
    } catch (err) {
      console.error('Error toggling like:', err);
      // Revert optimistic update
      setPosts(posts.map(p => {
        if (p.id === postId) {
          return { 
            ...p, 
            liked_by_current_user: currentLikedStatus, 
            like_count: currentLikedStatus ? Number(p.like_count) + 1 : Math.max(0, Number(p.like_count) - 1) 
          };
        }
        return p;
      }));
    }
  };

  const handleNewPost = async () => {
    if (!requireAuth()) return;
    if ((!newPostContent.trim() && !selectedImage) || !supabase) return;

    const verified = await verifyAuthBeforeWrite();
    if (!verified) return;

    try {
      setPosting(true);
      setError('');

      // Upload image first (if attached), then insert the post with its URL.
      let imageUrl = null;
      if (selectedImage) {
        const ext = (selectedImage.name.split('.').pop() || 'jpg').toLowerCase();
        const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg';
        const imagePath = `${currentUserId}/${Date.now()}-post.${safeExt}`;
        await uploadFile('uploads', imagePath, selectedImage);
        imageUrl = getPublicUrl('uploads', imagePath);
      }

      const { error: insertError } = await supabase
        .from('community_posts')
        .insert({
           author_id: currentUserId,
           content: newPostContent.trim() || '',
           section: newPostSection,
           ...(imageUrl ? { image_url: imageUrl } : {})
        });

      if (insertError) throw insertError;

      setNewPostContent('');
      clearSelectedImage();
    } catch (err) {
      console.error('Error creating post:', err);
      if (err.message?.includes('row-level security') || err.code === '42501') {
        setShowAuthModal(true);
        setError('You must be signed in to post.');
      } else if (/bucket|storage/i.test(err.message || '')) {
        setError('Could not upload the image. Please try again.');
      } else {
        setError('Unable to publish your post. Please try again.');
      }
    } finally {
      setPosting(false);
    }
  };

  const handleDeletePost = async (postId) => {
    if (!requireAuth()) return;
    if (!confirm('Are you sure you want to delete this post?')) return;

    const verified = await verifyAuthBeforeWrite();
    if (!verified) return;

    try {
      const { error } = await supabase
        .from('community_posts')
        .update({ is_deleted: true })
        .eq('id', postId)
        .eq('author_id', currentUserId); // Extra safety
      
      if (error) throw error;
      setPosts(posts.filter(p => p.id !== postId));
      setActiveMenuPostId(null);
    } catch (err) {
      console.error('Error deleting post', err);
      alert('Failed to delete post.');
    }
  };

  const handleEditPost = async () => {
    if (!requireAuth()) return;
    if (!editContent.trim()) return;

    const verified = await verifyAuthBeforeWrite();
    if (!verified) return;

    try {
       const { error } = await supabase
         .from('community_posts')
         .update({ content: editContent.trim() })
         .eq('id', editingPostId)
         .eq('author_id', currentUserId);

       if (error) throw error;
       
       setPosts(posts.map(p => p.id === editingPostId ? { ...p, content: editContent.trim() } : p));
       setEditingPostId(null);
       setEditContent('');
       setActiveMenuPostId(null);
    } catch (err) {
       console.error('Error editing post', err);
       alert('Failed to edit post.');
    }
  };

  const startEdit = (post) => {
    if (!requireAuth()) return;
    setEditingPostId(post.id);
    setEditContent(post.content);
    setActiveMenuPostId(null);
  };

  const submitReport = async () => {
    if (!requireAuth()) return;
    if (!reportReason) return;

    const verified = await verifyAuthBeforeWrite();
    if (!verified) return;

    try {
      setReporting(true);
      const { error } = await supabase
        .from('community_reports')
        .insert({ reporter_id: currentUserId, post_id: reportPostId, reason: reportReason });
      
      if (error) throw error;
      alert('Post reported successfully. Thank you.');
      setReportPostId(null);
      setReportReason('');
    } catch (err) {
      console.error('Error reporting', err);
      alert('Failed to submit report.');
    } finally {
      setReporting(false);
    }
  };

  const handleShare = async (post) => {
    if (!requireAuth()) return;

    const url = `${window.location.origin}/community?post=${post.id}`;
    
    // Optimistically update share count locally
    setPosts(posts.map(p => p.id === post.id ? { ...p, share_count: Number(p.share_count) + 1 } : p));

    try {
      // Record share in DB
      if (currentUserId) {
         await supabase.from('community_post_shares').insert({ post_id: post.id, user_id: currentUserId });
      }

      if (navigator.share) {
        await navigator.share({
          title: `Post by ${post.display_name}`,
          text: post.content.substring(0, 50) + '...',
          url: url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        alert('Link copied to clipboard!');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Error sharing:', err);
      }
    }
  };

  // Batch-fetches author profiles. community_profiles is a SQL VIEW, so
  // PostgREST embedded joins (profiles:community_profiles!author_id) cannot
  // resolve against it — profile data must be queried separately.
  const fetchProfiles = async (authorIds) => {
    if (!authorIds || authorIds.length === 0 || !supabase) return {};
    try {
      const { data } = await supabase
        .from('community_profiles')
        .select('id, display_name, avatar_url, year')
        .in('id', authorIds);
      const map = {};
      (data || []).forEach(p => { map[p.id] = p; });
      return map;
    } catch {
      return {};
    }
  };

  const fetchComments = async (postId) => {
    setLoadingComments(true);
    try {
       const { data, error } = await supabase
         .from('community_comments')
         .select('id, content, created_at, author_id, is_deleted')
         .eq('post_id', postId)
         .eq('is_deleted', false)
         .order('created_at', { ascending: true });

       if (error) throw error;

       const authorIds = [...new Set((data || []).map(c => c.author_id).filter(Boolean))];
       const profileMap = await fetchProfiles(authorIds);

       const formattedComments = (data || []).map(c => ({
         ...c,
         display_name: profileMap[c.author_id]?.display_name,
         avatar_url: profileMap[c.author_id]?.avatar_url,
         year: profileMap[c.author_id]?.year
       }));

       setComments(formattedComments);
    } catch (err) {
       console.error("Error fetching comments", err);
    } finally {
       setLoadingComments(false);
    }
  };

  // Fetches a single comment (with profile data) — used by the realtime handler.
  const fetchSingleComment = async (id) => {
    try {
      const { data } = await supabase
        .from('community_comments')
        .select('id, content, created_at, author_id, is_deleted')
        .eq('id', id)
        .maybeSingle();
      if (!data || data.is_deleted) return null;
      const profileMap = await fetchProfiles([data.author_id]);
      return {
        ...data,
        display_name: profileMap[data.author_id]?.display_name,
        avatar_url: profileMap[data.author_id]?.avatar_url,
        year: profileMap[data.author_id]?.year
      };
    } catch {
      return null;
    }
  };

  const toggleComments = (postId) => {
     if (activeCommentPostId === postId) {
        setActiveCommentPostId(null);
        setComments([]);
     } else {
        setActiveCommentPostId(postId);
        fetchComments(postId);
     }
  };

  const handleNewComment = async (postId) => {
     if (!requireAuth()) return;
     if (!newCommentContent.trim()) return;

     const verified = await verifyAuthBeforeWrite();
     if (!verified) return;

     try {
       setPostingComment(true);
       // Plain insert — no embedded select. community_profiles is a VIEW so
       // PostgREST embedded joins fail against it; profile data is fetched
       // separately below.
       const { data, error } = await supabase
         .from('community_comments')
         .insert({
           post_id: postId,
           author_id: currentUserId,
           content: newCommentContent.trim()
         })
         .select('id, content, created_at, author_id')
         .single();

       if (error) throw error;

       const profileMap = data.author_id ? await fetchProfiles([data.author_id]) : {};
       const newComment = {
         ...data,
         display_name: profileMap[data.author_id]?.display_name || 'You',
         avatar_url: profileMap[data.author_id]?.avatar_url,
         year: profileMap[data.author_id]?.year
       };

       setComments(prev => prev.some(c => c.id === newComment.id) ? prev : [...prev, newComment]);
       setNewCommentContent('');

       // Optimistically update comment count
       setPosts(posts.map(p => p.id === postId ? { ...p, reply_count: Number(p.reply_count) + 1 } : p));
     } catch (err) {
       console.error("Error posting comment", err);
       if (err.message?.includes('row-level security') || err.code === '42501') {
         setShowAuthModal(true);
       } else {
         alert("Failed to post reply.");
       }
     } finally {
       setPostingComment(false);
     }
  };

  const startEditComment = (comment) => {
    setEditingCommentId(comment.id);
    setEditCommentContent(comment.content);
    setCommentMenuId(null);
  };

  const handleEditComment = async () => {
    if (!requireAuth()) return;
    if (!editCommentContent.trim() || !editingCommentId) return;

    const verified = await verifyAuthBeforeWrite();
    if (!verified) return;

    try {
      const { error } = await supabase
        .from('community_comments')
        .update({ content: editCommentContent.trim() })
        .eq('id', editingCommentId)
        .eq('author_id', currentUserId);

      if (error) throw error;

      setComments(prev => prev.map(c => c.id === editingCommentId ? { ...c, content: editCommentContent.trim() } : c));
      setEditingCommentId(null);
      setEditCommentContent('');
      setCommentMenuId(null);
    } catch (err) {
      console.error('Error editing comment:', err);
      alert('Failed to edit reply.');
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!requireAuth()) return;
    if (!confirm('Delete this reply?')) return;

    const verified = await verifyAuthBeforeWrite();
    if (!verified) return;

    try {
      const { error } = await supabase
        .from('community_comments')
        .update({ is_deleted: true })
        .eq('id', commentId)
        .eq('author_id', currentUserId);

      if (error) throw error;

      setComments(prev => prev.filter(c => c.id !== commentId));
      if (activeCommentPostId) {
        setPosts(posts.map(p => p.id === activeCommentPostId
          ? { ...p, reply_count: Math.max(0, Number(p.reply_count) - 1) }
          : p));
      }
      setCommentMenuId(null);
    } catch (err) {
      console.error('Error deleting comment:', err);
      alert('Failed to delete reply.');
    }
  };

  const handleComposerFocus = () => {
    if (!requireAuth()) return;
  };

  const handleMenuAction = (action, post) => {
    if (!requireAuth()) return;
    if (action === 'edit') startEdit(post);
    else if (action === 'delete') handleDeletePost(post.id);
    else if (action === 'report') {
      setReportPostId(post.id);
      setActiveMenuPostId(null);
    }
  };


  return (
    <>
      <div className="max-w-5xl mx-auto space-y-10 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <header>
          <div className="flex items-center gap-3 text-medical-600 mb-2">
             <Users size={32} />
             <span className="text-[10px] font-black uppercase tracking-[0.3em]">Student Network</span>
          </div>
          <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Community Hub</h1>
          <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Connect with nursing students across Nigeria.</p>
        </header>

        {/* Section Tabs */}
        <div className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-clinical p-2">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-none py-1">
            <button
              onClick={() => switchSection('all')}
              className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                activeSection === 'all'
                  ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow'
                  : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900'
              }`}
            >
              <Sparkles size={13} /> All & General
            </button>
            {SECTION_ORDER.map(key => {
              const s = COMMUNITY_SECTIONS[key];
              const active = activeSection === key;
              return (
                <button
                  key={key}
                  onClick={() => switchSection(key)}
                  className={`shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                    active ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900'
                  }`}
                >
                  <span>{s.emoji}</span> {s.label}
                </button>
              );
            })}
            <Link
              to="/study-groups"
              className="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
            >
              <Users size={13} /> Study Groups
            </Link>
          </div>
        </div>

        <>
        {/* New Post Composer */}
        <motion.div
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 shadow-clinical relative overflow-hidden"
        >
          {/* Auth overlay for unauthenticated users */}
          {!isAuthenticated && (
            <div
              className="absolute inset-0 z-10 bg-white/80 dark:bg-slate-800/80 backdrop-blur-[2px] flex flex-col items-center justify-center cursor-pointer rounded-[2rem]"
              onClick={() => setShowAuthModal(true)}
            >
              <div className="w-12 h-12 bg-medical-100 dark:bg-medical-900/30 text-medical-600 rounded-full flex items-center justify-center mb-3">
                <Lock size={24} />
              </div>
              <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">Join the Community</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Sign in or create an account to share your thoughts</p>
            </div>
          )}

          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-medical-100 dark:bg-medical-900/30 text-medical-600 rounded-full flex items-center justify-center font-black text-sm shrink-0 overflow-hidden">
               {session?.user?.user_metadata?.avatar_url ? (
                 <img src={session.user.user_metadata.avatar_url} alt="User avatar" className="w-full h-full object-cover" />
               ) : (
                 <User size={18} />
               )}
            </div>
            <div className="flex-1">
              <textarea
                value={newPostContent}
                onChange={(e) => setNewPostContent(e.target.value)}
                onFocus={handleComposerFocus}
                placeholder="Share a study tip, ask a question, or encourage your peers..."
                className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 resize-none outline-none text-sm font-medium leading-relaxed min-h-[60px]"
                rows={2}
                maxLength={1000}
              />
              {error && <p className="text-red-500 text-xs mt-2">{error}</p>}

              {/* Image preview */}
              {imagePreview && (
                <div className="relative mt-3 inline-block">
                  <img
                    src={imagePreview}
                    alt="Attachment preview"
                    className="max-h-48 rounded-2xl border border-slate-200 dark:border-slate-700 object-cover"
                  />
                  <button
                    onClick={clearSelectedImage}
                    disabled={posting}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-slate-900 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
                    aria-label="Remove image"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {/* Section picker */}
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 mr-1">Post in:</span>
                {['general', ...SECTION_ORDER.filter(k => k !== 'general')].map(key => {
                  const s = COMMUNITY_SECTIONS[key];
                  const activePick = newPostSection === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setNewPostSection(key)}
                      className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all active:scale-95 ${
                        activePick
                          ? `text-white ${s.chip} border-transparent shadow`
                          : 'text-slate-500 border-slate-200 dark:border-slate-700 hover:border-medical-400'
                      }`}
                    >
                      <span>{s.emoji}</span> {s.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleSelectImage}
                    className="hidden"
                  />
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    disabled={posting || !!selectedImage}
                    className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-medical-600 transition-colors disabled:opacity-40"
                    aria-label="Attach an image"
                  >
                    <ImageIcon size={16} /> Photo
                  </button>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest hidden sm:block">
                    {newPostContent.length > 0 ? `${newPostContent.length}/1000 chars` : selectedImage ? 'Image ready' : "What's on your mind?"}
                  </p>
                </div>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest sm:hidden">
                  {newPostContent.length > 0 ? `${newPostContent.length}/1000` : ''}
                </p>
                <button
                  onClick={handleNewPost}
                  disabled={(!newPostContent.trim() && !selectedImage) || posting}
                  className="px-5 py-2 bg-medical-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-medical-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                >
                  {posting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  {posting ? 'Posting...' : 'Post'}
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        <AdBanner slot={import.meta.env.VITE_ADSENSE_SLOT_COMMUNITY || ''} />

        {/* Posts Feed */}
        <div className="space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-medical-600 border-t-transparent"></div>
              <p className="text-sm font-medium text-slate-500">Loading community feed...</p>
            </div>
          ) : posts.length > 0 ? (
            <>
              <AnimatePresence>
                {posts.map((post) => (
                  <motion.div
                    key={post.id}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 shadow-clinical transition-shadow relative"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-medical-100 dark:bg-medical-900/30 text-medical-600 rounded-full flex items-center justify-center font-black text-sm shrink-0 overflow-hidden cursor-pointer">
                          {post.avatar_url ? (
                             <img src={post.avatar_url} alt={post.display_name} className="w-full h-full object-cover" />
                          ) : (
                             post.display_name ? post.display_name.charAt(0).toUpperCase() : <User size={16} />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-slate-900 dark:text-white cursor-pointer hover:underline">{post.display_name || 'Anonymous Scholar'}</p>
                            {post.year && (
                              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[8px] font-black uppercase rounded-md">
                                YEAR {post.year}
                              </span>
                            )}
                            {post.section && post.section !== 'general' && (
                              (() => {
                                const sec = getSection(post.section);
                                return (
                                  <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-wider ${sec.accentBg} ${sec.accentText}`}>
                                    {sec.emoji} {sec.label}
                                  </span>
                                );
                              })()
                            )}
                          </div>
                          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                            {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                      
                      {/* Three-Dot Menu */}
                      <div className="relative">
                        <button 
                           onClick={() => {
                             if (!requireAuth()) return;
                             setActiveMenuPostId(activeMenuPostId === post.id ? null : post.id);
                           }}
                           className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                           aria-label="More options"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        
                        {activeMenuPostId === post.id && (
                          <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 overflow-hidden z-20">
                            {post.author_id === currentUserId ? (
                               <>
                                 <button 
                                   onClick={() => handleMenuAction('edit', post)}
                                   className="w-full text-left px-4 py-2 text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                                 >
                                   <Edit2 size={14} /> Edit post
                                 </button>
                                 <button 
                                   onClick={() => handleMenuAction('delete', post)}
                                   className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                                 >
                                   <Trash2 size={14} /> Delete post
                                 </button>
                               </>
                            ) : (
                               <button 
                                 onClick={() => handleMenuAction('report', post)}
                                 className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                               >
                                 <Flag size={14} /> Report post
                               </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {editingPostId === post.id ? (
                       <div className="pl-[52px] pr-2 mb-4">
                          <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-900/50 text-slate-900 dark:text-white p-3 rounded-xl border border-slate-200 dark:border-slate-700 resize-none outline-none text-sm font-medium leading-relaxed"
                            rows={3}
                          />
                          <div className="flex gap-2 mt-2 justify-end">
                             <button 
                               onClick={() => setEditingPostId(null)}
                               className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                             >
                               Cancel
                             </button>
                             <button 
                               onClick={handleEditPost}
                               className="px-3 py-1.5 text-xs font-bold text-white bg-medical-600 hover:bg-medical-700 rounded-lg"
                             >
                               Save
                             </button>
                          </div>
                       </div>
                     ) : (
                       <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed mb-4 pl-[52px] pr-2 whitespace-pre-wrap break-words">
                         {post.content}
                       </p>
                     )}

                     {/* Post image */}
                     {!editingPostId && post.image_url && (
                       <div className="pl-[52px] pr-2 mb-4">
                         <img
                           src={post.image_url}
                           alt="Post attachment"
                           loading="lazy"
                           className="w-full max-h-96 object-cover rounded-2xl border border-slate-200 dark:border-slate-700"
                         />
                       </div>
                     )}

                    <div className="flex items-center gap-5 text-slate-400 pl-[52px]">
                      <button
                        onClick={() => handleLike(post.id, post.liked_by_current_user)}
                        className={`flex items-center gap-1.5 text-xs font-semibold transition-colors group ${post.liked_by_current_user ? 'text-red-500' : 'hover:text-red-500'}`}
                        aria-label={post.liked_by_current_user ? "Unlike post" : "Like post"}
                      >
                        <Heart size={15} className={`transition-colors ${post.liked_by_current_user ? 'fill-red-500 text-red-500' : 'group-hover:fill-red-500 group-hover:text-red-500'}`} /> {post.like_count || 0}
                      </button>
                      <button 
                         onClick={() => toggleComments(post.id)}
                         className={`flex items-center gap-1.5 text-xs font-semibold hover:text-blue-500 transition-colors ${activeCommentPostId === post.id ? 'text-blue-500' : ''}`}
                         aria-label="Reply to post"
                      >
                        <MessageCircle size={15} className={activeCommentPostId === post.id ? 'fill-blue-500/20' : ''} /> {post.reply_count || 0} {Number(post.reply_count) === 1 ? 'Reply' : 'Replies'}
                      </button>
                      <button 
                         onClick={() => handleShare(post)}
                         className="flex items-center gap-1.5 text-xs font-semibold hover:text-medical-500 transition-colors"
                         aria-label="Share post"
                      >
                        <Share2 size={15} /> {post.share_count > 0 ? post.share_count : ''} Share
                      </button>
                    </div>

                    {/* Comment Section (Inline Drawer) */}
                    <AnimatePresence>
                       {activeCommentPostId === post.id && (
                          <motion.div 
                             initial={{ height: 0, opacity: 0 }}
                             animate={{ height: 'auto', opacity: 1 }}
                             exit={{ height: 0, opacity: 0 }}
                             className="overflow-hidden"
                          >
                             <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700 pl-[52px]">
                                {loadingComments ? (
                                   <div className="flex justify-center py-4">
                                      <Loader2 size={20} className="animate-spin text-slate-400" />
                                   </div>
                                ) : (
                                   <div className="space-y-4 mb-4">
                                       {comments.length > 0 ? comments.map(comment => (
                                          <div key={comment.id} className="flex gap-3">
                                             <div className="w-8 h-8 bg-medical-50 dark:bg-slate-800 text-medical-600 rounded-full flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden">
                                                {comment.avatar_url ? (
                                                   <img src={comment.avatar_url} alt={comment.display_name} className="w-full h-full object-cover" />
                                                ) : (
                                                   comment.display_name ? comment.display_name.charAt(0).toUpperCase() : <User size={12} />
                                                )}
                                             </div>
                                             <div className="flex-1 min-w-0">
                                                {editingCommentId === comment.id ? (
                                                   <div className="bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl rounded-tl-none border border-medical-200 dark:border-medical-800">
                                                      <textarea
                                                         value={editCommentContent}
                                                         onChange={(e) => setEditCommentContent(e.target.value)}
                                                         className="w-full bg-transparent text-slate-900 dark:text-white resize-none outline-none text-sm font-medium leading-relaxed"
                                                         rows={2}
                                                         maxLength={1000}
                                                      />
                                                      <div className="flex justify-end gap-2 mt-2">
                                                         <button
                                                            onClick={() => { setEditingCommentId(null); setEditCommentContent(''); }}
                                                            className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
                                                         >
                                                            Cancel
                                                         </button>
                                                         <button
                                                            onClick={handleEditComment}
                                                            disabled={!editCommentContent.trim()}
                                                            className="px-3 py-1.5 text-xs font-bold text-white bg-medical-600 hover:bg-medical-700 rounded-lg disabled:opacity-50"
                                                         >
                                                            Save
                                                         </button>
                                                      </div>
                                                   </div>
                                                ) : (
                                                   <div className="relative bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl rounded-tl-none group/comment">
                                                      <div className="flex items-center gap-2 mb-1 pr-6">
                                                         <p className="text-xs font-bold text-slate-900 dark:text-white">{comment.display_name || 'Anonymous'}</p>
                                                         <p className="text-[9px] text-slate-400">{formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}</p>
                                                      </div>
                                                      <p className="text-sm text-slate-700 dark:text-slate-300 font-medium whitespace-pre-wrap break-words">{comment.content}</p>

                                                      {/* Author-only menu */}
                                                      {comment.author_id === currentUserId && (
                                                         <div className="absolute top-2 right-2">
                                                            <button
                                                               onClick={() => setCommentMenuId(commentMenuId === comment.id ? null : comment.id)}
                                                               className="p-1 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 transition-colors"
                                                               aria-label="Reply options"
                                                            >
                                                               <MoreHorizontal size={14} />
                                                            </button>
                                                            {commentMenuId === comment.id && (
                                                               <div className="absolute right-0 mt-1 w-32 bg-white dark:bg-slate-800 rounded-xl shadow-lg border border-slate-100 dark:border-slate-700 overflow-hidden z-20">
                                                                  <button
                                                                     onClick={() => startEditComment(comment)}
                                                                     className="w-full text-left px-3 py-2 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2"
                                                                  >
                                                                     <Edit2 size={12} /> Edit
                                                                  </button>
                                                                  <button
                                                                     onClick={() => handleDeleteComment(comment.id)}
                                                                     className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-2"
                                                                  >
                                                                     <Trash2 size={12} /> Delete
                                                                  </button>
                                                               </div>
                                                            )}
                                                         </div>
                                                      )}
                                                   </div>
                                                )}
                                             </div>
                                          </div>
                                       )) : (
                                         <p className="text-xs text-slate-400 text-center py-2">No replies yet. Be the first!</p>
                                      )}
                                   </div>
                                )}
                                
                                {/* Comment input — show auth prompt if not authenticated */}
                                {isAuthenticated ? (
                                  <div className="flex gap-3">
                                     <div className="w-8 h-8 bg-medical-100 text-medical-600 rounded-full flex items-center justify-center font-bold text-xs shrink-0 overflow-hidden">
                                         {session?.user?.user_metadata?.avatar_url ? (
                                           <img src={session.user.user_metadata.avatar_url} alt="User avatar" className="w-full h-full object-cover" />
                                         ) : (
                                           <User size={12} />
                                         )}
                                     </div>
                                     <div className="flex-1 flex gap-2">
                                        <input
                                           type="text"
                                           value={newCommentContent}
                                           onChange={(e) => setNewCommentContent(e.target.value)}
                                           placeholder="Write a reply..."
                                           className="flex-1 bg-slate-100 dark:bg-slate-900 text-slate-900 dark:text-white text-sm px-4 py-2 rounded-full outline-none border border-transparent focus:border-medical-300 dark:focus:border-medical-700 transition-colors"
                                           onKeyDown={(e) => {
                                              if (e.key === 'Enter' && !e.shiftKey) {
                                                 e.preventDefault();
                                                 handleNewComment(post.id);
                                              }
                                           }}
                                        />
                                        <button
                                           onClick={() => handleNewComment(post.id)}
                                           disabled={!newCommentContent.trim() || postingComment}
                                           className="w-9 h-9 flex items-center justify-center bg-medical-600 text-white rounded-full hover:bg-medical-700 disabled:opacity-50 shrink-0 transition-colors"
                                        >
                                           {postingComment ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                                        </button>
                                     </div>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setShowAuthModal(true)}
                                    className="w-full py-3 bg-slate-100 dark:bg-slate-900/50 rounded-xl text-sm font-bold text-medical-600 hover:bg-medical-50 dark:hover:bg-medical-900/20 transition-colors flex items-center justify-center gap-2"
                                  >
                                    <Lock size={14} /> Sign in to reply
                                  </button>
                                )}
                             </div>
                          </motion.div>
                       )}
                    </AnimatePresence>
                  </motion.div>
                ))}
              </AnimatePresence>
              
              {hasMore && (
                 <div className="flex justify-center pt-4">
                    <button 
                       onClick={handleLoadMore}
                       disabled={loadingMore}
                       className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                       {loadingMore && <Loader2 size={14} className="animate-spin" />}
                       {loadingMore ? 'Loading...' : 'Load More'}
                    </button>
                 </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 shadow-clinical">
              <MessageCircle size={48} className="mb-4 opacity-30" />
              <p className="text-lg font-bold text-slate-900 dark:text-white mb-2">No posts yet.</p>
              <p className="text-sm font-medium text-center max-w-sm">Be the first to share a study tip, ask a question, or encourage your fellow nursing students.</p>
            </div>
          )}
        </div>
        </>

        {/* Info Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
           <div className="bg-medical-600 rounded-[2.5rem] p-10 text-white space-y-6 shadow-xl relative overflow-hidden group">
              <div className="absolute -bottom-10 -right-10 opacity-10 group-hover:scale-110 transition-transform duration-700">
                 <Users size={200} />
              </div>
              <h3 className="text-2xl font-black relative z-10">Collaborative Learning</h3>
              <p className="text-medical-50 leading-relaxed font-medium relative z-10">
                Research shows that explaining concepts to others increases your own retention by up to 90%. Our community hub is designed to facilitate this "Protege Effect".
              </p>
           </div>

           <div className="bg-white dark:bg-slate-800 rounded-[2.5rem] p-10 border border-slate-100 dark:border-slate-700 space-y-6 shadow-clinical group">
              <h3 className="text-2xl font-black text-slate-900 dark:text-white">Professional Integrity</h3>
              <p className="text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                Every post will be reviewed by clinical mentors to ensure medical accuracy and adherence to NMCN professional standards.
              </p>
              <div className="pt-6 border-t border-slate-100 dark:border-slate-700 flex justify-between items-end">
                 <div>
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Moderation</span>
                    <p className="font-black text-medical-600 uppercase tracking-tighter">AI + Mentor Review Active</p>
                 </div>
                 <CheckCircle2 size={24} className="text-medical-500" />
              </div>
           </div>
        </div>

        {/* Report Modal */}
        <AnimatePresence>
           {reportPostId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
                 <motion.div 
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-white dark:bg-slate-800 rounded-[2rem] p-6 max-w-sm w-full shadow-2xl"
                 >
                    <div className="flex justify-between items-center mb-4">
                       <h3 className="text-lg font-bold text-slate-900 dark:text-white">Report Post</h3>
                       <button onClick={() => setReportPostId(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                          <X size={20} />
                       </button>
                    </div>
                    <div className="space-y-3 mb-6">
                       {['Spam', 'Harassment', 'Inappropriate content', 'Misinformation', 'Other'].map(reason => (
                          <label key={reason} className="flex items-center gap-3 cursor-pointer">
                             <input 
                                type="radio" 
                                name="reportReason" 
                                value={reason}
                                checked={reportReason === reason}
                                onChange={(e) => setReportReason(e.target.value)}
                                className="w-4 h-4 text-medical-600 focus:ring-medical-500 border-slate-300"
                             />
                             <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{reason}</span>
                          </label>
                       ))}
                    </div>
                    <div className="flex gap-3">
                       <button 
                          onClick={() => setReportPostId(null)}
                          className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600 transition-colors"
                       >
                          Cancel
                       </button>
                       <button 
                          onClick={submitReport}
                          disabled={!reportReason || reporting}
                          className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors flex justify-center items-center gap-2"
                       >
                          {reporting ? <Loader2 size={16} className="animate-spin" /> : null}
                          Submit Report
                       </button>
                    </div>
                 </motion.div>
              </div>
           )}
        </AnimatePresence>
      </div>

      {/* Community Auth Modal */}
      <CommunityAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuthSuccess={() => {
          setShowAuthModal(false);
          // Re-fetch posts to get user-specific data (like status)
          fetchPosts(0, false);
        }}
      />
    </>
  );
};

export default Community;
