import React, { useState, useEffect } from 'react';
import { Users, Heart, MessageCircle, Share2, MoreHorizontal, User, CheckCircle2 } from './Icons';
import { supabase } from '../utils/supabase';
import { useAppContext } from '../context/AppContext';
import { formatDistanceToNow } from 'date-fns';

const CommunityHubWidget = () => {
  const { session } = useAppContext();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPosts();
  }, [session]);

  const fetchPosts = async () => {
    if (!supabase) {
      setPosts([
        { id: '1', content: "Just aced my clinicals in Med-Surg today! Keep grinding everyone!", likes: 12, created_at: new Date().toISOString(), profiles: { full_name: "Sarah Jenkins", level: "Year 4" } },
        { id: '2', content: "Does anyone have a good mnemonic for the cranial nerves?", likes: 8, created_at: new Date(Date.now() - 3600000).toISOString(), profiles: { full_name: "Michael Chen", level: "Year 2" } },
      ]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('community_posts')
        .select(`
          id,
          content,
          likes,
          created_at,
          profiles(full_name, level)
        `)
        .order('created_at', { ascending: false })
        .limit(3);

      if (error) throw error;
      setPosts(data || []);
    } catch (error) {
      console.error('Error fetching community posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (postId) => {
    if (!supabase) return;

    setPosts(posts.map(p => p.id === postId ? { ...p, likes: p.likes + 1 } : p));

    try {
      const post = posts.find(p => p.id === postId);
      await supabase
        .from('community_posts')
        .update({ likes: post.likes + 1 })
        .eq('id', postId);
    } catch (error) {
      console.error('Error liking post:', error);
      setPosts(posts.map(p => p.id === postId ? { ...p, likes: p.likes - 1 } : p));
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 p-6 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-800 flex flex-col h-full">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h3 className="text-lg font-black flex items-center gap-2 text-slate-900 dark:text-white uppercase tracking-tight">
            <Users className="text-apex-600" size={20} /> Community Hub
          </h3>
          <p className="text-xs text-slate-500 mt-1">Connect with other nursing scholars.</p>
        </div>
        <button className="text-[10px] font-black uppercase text-apex-600 hover:text-apex-700 bg-apex-50 px-3 py-1.5 rounded-lg transition-colors">
          View All
        </button>
      </div>

      <div className="flex-1 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-apex-600"></div>
          </div>
        ) : posts.length > 0 ? (
          posts.map((post) => (
            <div key={post.id} className="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-slate-100 dark:border-slate-800 transition-all hover:shadow-md">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-apex-100 text-apex-600 rounded-full flex items-center justify-center font-black text-xs shrink-0">
                    {post.profiles?.full_name ? post.profiles.full_name.charAt(0) : <User size={14} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-xs font-bold text-slate-900 dark:text-white">{post.profiles?.full_name || 'Anonymous Scholar'}</p>
                      {post.profiles?.level && (
                        <span className="px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[8px] font-black uppercase rounded">
                          {post.profiles.level}
                        </span>
                      )}
                    </div>
                    <p className="text-[9px] font-semibold text-slate-400 uppercase tracking-wider">
                      {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>
                <button className="text-slate-400 hover:text-slate-600">
                  <MoreHorizontal size={14} />
                </button>
              </div>
              <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed mb-3">
                {post.content}
              </p>
              <div className="flex items-center gap-4 text-slate-400">
                <button
                  onClick={() => handleLike(post.id)}
                  className="flex items-center gap-1.5 text-xs font-semibold hover:text-red-500 transition-colors group"
                >
                  <Heart size={14} className="group-hover:fill-red-500 group-hover:text-red-500 transition-colors" /> {post.likes || 0}
                </button>
                <button className="flex items-center gap-1.5 text-xs font-semibold hover:text-blue-500 transition-colors">
                  <MessageCircle size={14} /> Reply
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
        <button className="w-full py-3 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors flex items-center justify-center gap-2">
          <Share2 size={14} /> New Post
        </button>
      </div>
    </div>
  );
};

export default CommunityHubWidget;
