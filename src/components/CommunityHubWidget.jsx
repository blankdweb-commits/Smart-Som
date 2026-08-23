import React, { useState, useEffect, useCallback } from 'react';
import { Users, Heart, MessageCircle, Share2, MoreHorizontal, User, CheckCircle2, Loader2 } from './Icons';
import { supabase } from '../utils/supabase';
import { useAppContext } from '../context/AppContext';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';

const CommunityHubWidget = () => {
  const { session } = useAppContext();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const currentUserId = session?.user?.id;

  const fetchPosts = useCallback(async () => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('community_feed')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3);

      if (error) throw error;
      setPosts(data || []);
    } catch (error) {
      console.error('Error fetching community posts:', error);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleLike = async (postId, currentLikedStatus) => {
    if (!supabase || !currentUserId) return;

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

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-800 flex flex-col h-full transition-all">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-black flex items-center gap-2 text-slate-900 dark:text-white uppercase tracking-tight">
            <Users className="text-medical-600" size={20} /> Community Hub
          </h3>
          <p className="text-xs text-slate-500 mt-1">Connect with other nursing scholars.</p>
        </div>
        <button 
          onClick={() => navigate('/community')}
          className="text-[10px] font-black uppercase text-medical-600 hover:text-medical-700 bg-medical-50 dark:bg-medical-900/30 px-3 py-1.5 rounded-lg transition-colors"
        >
          View All
        </button>
      </div>

      <div className="flex-1 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full py-8">
            <Loader2 className="animate-spin text-medical-600 w-8 h-8" />
          </div>
        ) : posts.length > 0 ? (
          posts.map((post) => (
            <div key={post.id} className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 transition-all hover:shadow-md cursor-pointer" onClick={() => navigate('/community')}>
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-medical-100 dark:bg-medical-900/30 text-medical-600 rounded-full flex items-center justify-center font-black text-xs shrink-0 overflow-hidden">
                    {post.avatar_url ? (
                        <img src={post.avatar_url} alt={post.display_name} className="w-full h-full object-cover" />
                    ) : (
                        post.display_name ? post.display_name.charAt(0).toUpperCase() : <User size={14} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{post.display_name || 'Anonymous Scholar'}</p>
                      {post.year && (
                        <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[8px] font-black uppercase rounded">
                          YR {post.year}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                      {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" onClick={(e) => e.stopPropagation()}>
                  <MoreHorizontal size={14} />
                </button>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed mb-3 line-clamp-2">
                {post.content}
              </p>
              <div className="flex items-center gap-4 text-slate-400" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={(e) => { e.stopPropagation(); handleLike(post.id, post.liked_by_current_user); }}
                  className={`flex items-center gap-1.5 text-xs font-semibold transition-colors group ${post.liked_by_current_user ? 'text-red-500' : 'hover:text-red-500'}`}
                >
                  <Heart size={14} className={`transition-colors ${post.liked_by_current_user ? 'fill-red-500 text-red-500' : 'group-hover:fill-red-500 group-hover:text-red-500'}`} /> {post.like_count || 0}
                </button>
                <button 
                   onClick={() => navigate('/community')}
                   className="flex items-center gap-1.5 text-xs font-semibold hover:text-blue-500 transition-colors"
                >
                  <MessageCircle size={14} /> {post.reply_count || 0} Reply
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 py-8">
            <MessageCircle size={32} className="mb-2 opacity-50" />
            <p className="text-sm font-medium">No posts yet.</p>
            <p className="text-xs">Be the first to share something!</p>
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
        <button 
           onClick={() => navigate('/community')}
           className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-2"
        >
          <Share2 size={14} /> New Post
        </button>
      </div>
    </div>
  );
};

export default CommunityHubWidget;
