import React, { useState, useEffect } from 'react';
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
  Send
} from '../components/Icons';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '../utils/supabase';
import { useAppContext } from '../context/AppContext';
import { formatDistanceToNow } from 'date-fns';

const Community = () => {
  const { session } = useAppContext();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newPostContent, setNewPostContent] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    fetchPosts();
  }, [session]);

  const fetchPosts = async () => {
    if (!supabase) {
      setPosts([
        { id: '1', content: "Just aced my clinicals in Med-Surg today! Keep grinding everyone! 💪", likes: 12, created_at: new Date().toISOString(), profiles: { full_name: "Sarah Jenkins", level: "Year 4" } },
        { id: '2', content: "Does anyone have a good mnemonic for the cranial nerves? I keep mixing up the sensory vs motor ones.", likes: 8, created_at: new Date(Date.now() - 3600000).toISOString(), profiles: { full_name: "Michael Chen", level: "Year 2" } },
        { id: '3', content: "Pro tip: Use the ADPIE framework for every care plan question on the NMCN exam. Assessment → Diagnosis → Planning → Implementation → Evaluation. Works every time! 🎯", likes: 24, created_at: new Date(Date.now() - 7200000).toISOString(), profiles: { full_name: "Amara Okafor", level: "Year 3" } },
        { id: '4', content: "Who else is preparing for the pharmacology midterm next week? Let's form a study group!", likes: 15, created_at: new Date(Date.now() - 14400000).toISOString(), profiles: { full_name: "David Eze", level: "Year 2" } },
        { id: '5', content: "Remember: Maslow's Hierarchy is your best friend for prioritization questions. Physiological needs always come first! 📚", likes: 31, created_at: new Date(Date.now() - 28800000).toISOString(), profiles: { full_name: "Grace Adeyemi", level: "Year 4" } },
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
        .limit(20);

      if (error) throw error;
      setPosts(data || []);
    } catch (error) {
      console.error('Error fetching community posts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (postId) => {
    setPosts(posts.map(p => p.id === postId ? { ...p, likes: p.likes + 1 } : p));

    if (!supabase) return;

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

  const handleNewPost = async () => {
    if (!newPostContent.trim()) return;

    if (!supabase || !session) {
      // Offline / demo mode: add to local state
      const newPost = {
        id: `local_${Date.now()}`,
        content: newPostContent.trim(),
        likes: 0,
        created_at: new Date().toISOString(),
        profiles: { full_name: 'You', level: '' }
      };
      setPosts([newPost, ...posts]);
      setNewPostContent('');
      return;
    }

    try {
      setPosting(true);
      const { data, error } = await supabase
        .from('community_posts')
        .insert({ user_id: session.user.id, content: newPostContent.trim() })
        .select(`id, content, likes, created_at, profiles(full_name, level)`)
        .single();

      if (error) throw error;
      setPosts([data, ...posts]);
      setNewPostContent('');
    } catch (error) {
      console.error('Error creating post:', error);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-10 pb-32 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <header>
        <div className="flex items-center gap-3 text-medical-600 mb-2">
           <Users size={32} />
           <span className="text-[10px] font-black uppercase tracking-[0.3em]">Student Network</span>
        </div>
        <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight">Community Hub</h1>
        <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Connect with 10,000+ nursing students across Nigeria.</p>
      </header>

      {/* New Post Composer */}
      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 shadow-clinical"
      >
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-medical-100 dark:bg-medical-900/30 text-medical-600 rounded-full flex items-center justify-center font-black text-sm shrink-0">
            <User size={18} />
          </div>
          <div className="flex-1">
            <textarea
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              placeholder="Share a study tip, ask a question, or encourage your peers..."
              className="w-full bg-transparent text-slate-900 dark:text-white placeholder-slate-400 resize-none outline-none text-sm font-medium leading-relaxed min-h-[60px]"
              rows={2}
            />
            <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                {newPostContent.length > 0 ? `${newPostContent.length} characters` : 'What\'s on your mind?'}
              </p>
              <button
                onClick={handleNewPost}
                disabled={!newPostContent.trim() || posting}
                className="px-5 py-2 bg-medical-600 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-medical-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
              >
                <Send size={12} /> {posting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Posts Feed */}
      <div className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-medical-600"></div>
          </div>
        ) : posts.length > 0 ? (
          <AnimatePresence>
            {posts.map((post, idx) => (
              <motion.div
                key={post.id}
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
                className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 shadow-clinical hover:shadow-lg transition-shadow"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-medical-100 dark:bg-medical-900/30 text-medical-600 rounded-full flex items-center justify-center font-black text-sm shrink-0">
                      {post.profiles?.full_name ? post.profiles.full_name.charAt(0) : <User size={16} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-900 dark:text-white">{post.profiles?.full_name || 'Anonymous Scholar'}</p>
                        {post.profiles?.level && (
                          <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[8px] font-black uppercase rounded-md">
                            {post.profiles.level}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mt-0.5">
                        {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors p-1">
                    <MoreHorizontal size={16} />
                  </button>
                </div>

                <p className="text-sm text-slate-700 dark:text-slate-300 font-medium leading-relaxed mb-4 pl-[52px]">
                  {post.content}
                </p>

                <div className="flex items-center gap-5 text-slate-400 pl-[52px]">
                  <button
                    onClick={() => handleLike(post.id)}
                    className="flex items-center gap-1.5 text-xs font-semibold hover:text-red-500 transition-colors group"
                  >
                    <Heart size={15} className="group-hover:fill-red-500 group-hover:text-red-500 transition-colors" /> {post.likes || 0}
                  </button>
                  <button className="flex items-center gap-1.5 text-xs font-semibold hover:text-blue-500 transition-colors">
                    <MessageCircle size={15} /> Reply
                  </button>
                  <button className="flex items-center gap-1.5 text-xs font-semibold hover:text-medical-500 transition-colors">
                    <Share2 size={15} /> Share
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <MessageCircle size={48} className="mb-4 opacity-30" />
            <p className="text-lg font-bold">No posts yet.</p>
            <p className="text-sm">Be the first to share something with the community!</p>
          </div>
        )}
      </div>

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
            <div className="pt-6 border-t border-slate-100 dark:border-slate-700">
               <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Moderation</span>
               <p className="font-black text-medical-600 uppercase tracking-tighter">AI + Mentor Review Active</p>
            </div>
         </div>
      </div>
    </div>
  );
};

export default Community;
