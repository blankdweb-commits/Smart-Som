import React, { useState, useEffect } from 'react';
import { MessageSquare, Send, ThumbsUp, User, Clock, Share2, Award, Info } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

const Community = () => {
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState('');
  const [category, setCategory] = useState('Study Tips');

  useEffect(() => {
    const savedPosts = localStorage.getItem('nursing_community_posts');
    if (savedPosts) {
      setPosts(JSON.parse(savedPosts));
    } else {
      // Seed initial community data
      const initialPosts = [
        {
          id: 1,
          user: 'Nur_Kemi',
          content: 'Found a great mnemonic for the 12 cranial nerves: "On Occasion Our Trusty Truck Acts Funny, Very Good Vehicle Any How"!',
          category: 'Mnemonics',
          likes: 12,
          time: new Date(Date.now() - 3600000).toISOString(),
          comments: 3
        },
        {
          id: 2,
          user: 'Midwife_Amaka',
          content: 'Just passed my Midwifery Council exam! The OSCE section here really helped with the Leopold maneuvers steps.',
          category: 'Success Stories',
          likes: 24,
          time: new Date(Date.now() - 86400000).toISOString(),
          comments: 5
        },
        {
          id: 3,
          user: 'Student_Bolu',
          content: 'Does anyone have tips for remembering drug dosages for Pediatric patients? I find them tricky.',
          category: 'Study Tips',
          likes: 8,
          time: new Date(Date.now() - 172800000).toISOString(),
          comments: 10
        }
      ];
      setPosts(initialPosts);
      localStorage.setItem('nursing_community_posts', JSON.stringify(initialPosts));
    }
  }, []);

  const handlePost = (e) => {
    e.preventDefault();
    if (!newPost.trim()) return;

    const post = {
      id: Date.now(),
      user: 'You',
      content: newPost,
      category: category,
      likes: 0,
      time: new Date().toISOString(),
      comments: 0
    };

    const updatedPosts = [post, ...posts];
    setPosts(updatedPosts);
    localStorage.setItem('nursing_community_posts', JSON.stringify(updatedPosts));
    setNewPost('');
  };

  const handleLike = (id) => {
    const updatedPosts = posts.map(p => p.id === id ? { ...p, likes: p.likes + 1 } : p);
    setPosts(updatedPosts);
    localStorage.setItem('nursing_community_posts', JSON.stringify(updatedPosts));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-500 pb-20">
      <header className="space-y-2">
        <h2 className="text-3xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <MessageSquare className="text-medical-600" />
          Nursing Community
        </h2>
        <p className="text-slate-600 dark:text-slate-400">Share findings, mnemonics, and support your fellow students.</p>
      </header>

      {/* Post Box */}
      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
        <form onSubmit={handlePost} className="space-y-4">
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-full bg-medical-100 dark:bg-medical-900/30 flex items-center justify-center text-medical-600 shrink-0">
              <User size={20} />
            </div>
            <textarea
              value={newPost}
              onChange={(e) => setNewPost(e.target.value)}
              placeholder="Share a study tip or finding..."
              className="w-full bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 border-none focus:ring-2 focus:ring-medical-500 dark:text-white resize-none"
              rows="3"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex gap-2">
              {['Study Tips', 'Mnemonics', 'Findings', 'Support'].map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${
                    category === cat
                      ? 'bg-medical-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
            <button
              type="submit"
              className="flex items-center gap-2 px-6 py-2 bg-medical-600 text-white rounded-xl font-bold hover:bg-medical-700 transition-colors shadow-lg shadow-medical-600/20 active:scale-95"
            >
              <Send size={18} />
              Post
            </button>
          </div>
        </form>
      </div>

      {/* Community Feed */}
      <div className="space-y-4">
        {posts.map(post => (
          <div key={post.id} className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6 space-y-4 hover:border-medical-500/30 transition-colors group">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                  <User size={20} />
                </div>
                <div>
                  <h4 className="font-bold text-slate-800 dark:text-white">{post.user}</h4>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock size={12} />
                    {new Date(post.time).toLocaleDateString()}
                    <span className="px-2 py-0.5 bg-medical-50 dark:bg-medical-900/20 text-medical-600 rounded-full font-bold">
                      {post.category}
                    </span>
                  </div>
                </div>
              </div>
              <button className="text-slate-400 hover:text-medical-600 transition-colors">
                <Share2 size={18} />
              </button>
            </div>

            <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
              {post.content}
            </p>

            <div className="flex items-center gap-6 pt-2 border-t border-slate-50 dark:border-slate-700/50">
              <button
                onClick={() => handleLike(post.id)}
                className="flex items-center gap-2 text-slate-500 hover:text-medical-600 transition-colors font-medium text-sm group-active:scale-125 transition-transform"
              >
                <ThumbsUp size={18} className={post.likes > 20 ? 'fill-medical-600 text-medical-600' : ''} />
                {post.likes}
              </button>
              <div className="flex items-center gap-2 text-slate-500 font-medium text-sm">
                <MessageSquare size={18} />
                {post.comments}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Study Hall Info */}
      <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-2xl p-6 flex gap-4">
        <Info className="text-amber-600 shrink-0" size={24} />
        <div>
          <h4 className="font-bold text-amber-800 dark:text-amber-400">Collaborative Learning</h4>
          <p className="text-sm text-amber-700 dark:text-amber-500/80 mt-1">
            Research shows that teaching others is one of the best ways to reinforce your own learning.
            Share your best mnemonics and tricky exam questions here!
          </p>
        </div>
      </div>
    </div>
  );
};

export default Community;
