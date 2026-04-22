import React, { useState, useEffect, useRef } from 'react';
import { MessageSquare, Send, ThumbsUp, User, Clock, Share2, Award, Info, ImageIcon, X } from '../components/Icons';
import { supabase, isSupabaseConfigured } from '../utils/supabase';

const Community = () => {
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState('');
  const [category, setCategory] = useState('Study Tips');
  const [activeTab, setActiveTab] = useState('feed'); // 'feed' or 'suggestions'
  const [image, setImage] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const fileInputRef = useRef(null);

  const fetchPosts = React.useCallback(async () => {
    if (isSupabaseConfigured()) {
      const { data } = await supabase
        .from('posts')
        .select('*, replies (*)')
        .order('created_at', { ascending: false });

      if (data) setPosts(data);
    } else {
      const savedPosts = localStorage.getItem('nursing_community_posts');
      if (savedPosts) {
        setPosts(JSON.parse(savedPosts));
      } else {
        const initialPosts = [
          {
            id: 1,
            user: 'Nur_Kemi',
            content: 'Found a great mnemonic for the 12 cranial nerves: "On Occasion Our Trusty Truck Acts Funny, Very Good Vehicle Any How"!',
            category: 'Mnemonics',
            likes: 12,
            created_at: new Date(Date.now() - 3600000).toISOString(),
            replies: [
              { id: 101, user: 'Student_Jay', content: 'This is brilliant! Saving it.', created_at: new Date(Date.now() - 1800000).toISOString() }
            ]
          }
        ];
        setPosts(initialPosts);
        localStorage.setItem('nursing_community_posts', JSON.stringify(initialPosts));
      }
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchPosts(), 0);
    return () => clearTimeout(timer);
  }, [fetchPosts]);

  const handlePost = async (e) => {
    e.preventDefault();
    if (!newPost.trim() && !image) return;

    let imageUrl = null;
    if (image && isSupabaseConfigured()) {
      setIsUploading(true);
      const fileExt = image.name.split('.').pop();
      const fileName = `${Math.random()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('community-images')
        .upload(filePath, image);

      if (!uploadError) {
        const { data } = supabase.storage
          .from('community-images')
          .getPublicUrl(filePath);
        imageUrl = data.publicUrl;
      }
      setIsUploading(false);
    }

    const postData = {
      user: 'You',
      content: newPost,
      category: category,
      likes: 0,
      image_url: imageUrl,
      created_at: new Date().toISOString(),
      comments: 0
    };

    if (isSupabaseConfigured()) {
      const { error } = await supabase.from('posts').insert([postData]);
      if (!error) fetchPosts();
    } else {
      const updatedPosts = [{ ...postData, id: Date.now() }, ...posts];
      setPosts(updatedPosts);
      localStorage.setItem('nursing_community_posts', JSON.stringify(updatedPosts));
    }

    setNewPost('');
    setImage(null);
  };

  const handleLike = async (id) => {
    if (isSupabaseConfigured()) {
      const targetPost = posts.find(p => p.id === id);
      const { error } = await supabase
        .from('posts')
        .update({ likes: (targetPost.likes || 0) + 1 })
        .eq('id', id);
      if (!error) fetchPosts();
    } else {
      const updatedPosts = posts.map(p => p.id === id ? { ...p, likes: (p.likes || 0) + 1 } : p);
      setPosts(updatedPosts);
      localStorage.setItem('nursing_community_posts', JSON.stringify(updatedPosts));
    }
  };

  const handleReply = async (postId, content) => {
    if (!content.trim()) return;

    const replyData = {
      post_id: postId,
      user: 'You',
      content,
      created_at: new Date().toISOString()
    };

    if (isSupabaseConfigured()) {
      const { error } = await supabase.from('replies').insert([replyData]);
      if (!error) fetchPosts();
    } else {
      const updatedPosts = posts.map(p => {
        if (p.id === postId) {
          return { ...p, replies: [...(p.replies || []), { ...replyData, id: Date.now() }] };
        }
        return p;
      });
      setPosts(updatedPosts);
      localStorage.setItem('nursing_community_posts', JSON.stringify(updatedPosts));
    }
    setReplyTo(null);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-20 animate-in fade-in duration-500">
      <header className="space-y-4">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 dark:text-white">Community</h2>
          <p className="text-slate-600 dark:text-slate-400">Collaborate with fellow students and share study tips.</p>
        </div>

        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab('feed')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'feed' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            Feed
          </button>
          <button
            onClick={() => setActiveTab('suggestions')}
            className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeTab === 'suggestions' ? 'bg-white dark:bg-slate-700 shadow-sm text-medical-600' : 'text-slate-500'}`}
          >
            Suggestions
          </button>
        </div>
      </header>

      {activeTab === 'suggestions' ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-medical-100 dark:bg-medical-900/30 rounded-full flex items-center justify-center text-medical-600 mx-auto">
            <Award size={32} />
          </div>
          <div className="max-w-md mx-auto space-y-2">
            <h3 className="text-xl font-bold text-slate-800 dark:text-white">Have a Suggestion?</h3>
            <p className="text-slate-600 dark:text-slate-400 text-sm">
              Missing a specialized unit? Found an error?
              Post your suggestions in the feed using the <strong className="text-medical-600">"Support"</strong> category.
            </p>
          </div>
          <button
            onClick={() => { setActiveTab('feed'); setCategory('Support'); }}
            className="px-6 py-3 bg-medical-600 text-white rounded-xl font-bold shadow-lg shadow-medical-600/20 active:scale-95 transition-all"
          >
            Write a Suggestion
          </button>
        </div>
      ) : (
      <>
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
              className="w-full bg-slate-50 dark:bg-slate-900/50 rounded-xl p-4 border-none focus:ring-2 focus:ring-medical-500 dark:text-white resize-none text-sm font-medium"
              rows="3"
            />
          </div>
          {image && (
            <div className="relative inline-block ml-14">
              <img src={URL.createObjectURL(image)} alt="Preview" className="h-32 w-32 object-cover rounded-xl border-2 border-medical-200" />
              <button
                type="button"
                onClick={() => setImage(null)}
                className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full shadow-lg"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="p-2 text-slate-500 hover:text-medical-600 hover:bg-medical-50 dark:hover:bg-medical-900/20 rounded-lg transition-colors"
                title="Add Image"
              >
                <ImageIcon size={20} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => setImage(e.target.files[0])}
                className="hidden"
                accept="image/*"
              />
              <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-2" />
              <div className="flex gap-2 overflow-x-auto pb-1 max-w-[200px] sm:max-w-none no-scrollbar">
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
            </div>
            <button
              type="submit"
              disabled={isUploading}
              className={`flex items-center gap-2 px-6 py-2 bg-medical-600 text-white rounded-xl font-bold hover:bg-medical-700 transition-colors shadow-lg shadow-medical-600/20 active:scale-95 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <Send size={18} />
              {isUploading ? 'Uploading...' : 'Post'}
            </button>
          </div>
        </form>
      </div>

      {/* Community Feed */}
      <div className="space-y-4 sm:space-y-6">
        {posts.map(post => (
          <div key={post.id} className="bg-white dark:bg-slate-800 rounded-2xl sm:rounded-3xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden transition-all duration-300">
            <div className="p-4 sm:p-6 space-y-4">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                    <User size={20} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-slate-800 dark:text-white text-sm sm:text-base truncate">{post.user}</h4>
                    <div className="flex flex-wrap items-center gap-2 text-[10px] sm:text-xs text-slate-500 mt-0.5">
                      <div className="flex items-center gap-1">
                        <Clock size={10} />
                        {new Date(post.created_at).toLocaleDateString()}
                      </div>
                      <span className="px-2 py-0.5 bg-medical-50 dark:bg-medical-900/20 text-medical-600 rounded-full font-bold">
                        {post.category}
                      </span>
                    </div>
                  </div>
                </div>
                <button className="text-slate-400 hover:text-medical-600 transition-colors p-1">
                  <Share2 size={16} />
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-slate-700 dark:text-slate-300 text-sm sm:text-base leading-relaxed">
                  {post.content}
                </p>
                {post.image_url && (
                  <img src={post.image_url} alt="Post content" className="rounded-xl w-full max-h-96 object-cover border border-slate-100 dark:border-slate-700" />
                )}
              </div>

              <div className="flex items-center gap-6 pt-2 border-t border-slate-50 dark:border-slate-700/50">
                <button
                  onClick={() => handleLike(post.id)}
                  className="flex items-center gap-2 text-slate-500 hover:text-medical-600 transition-colors font-medium text-xs sm:text-sm"
                >
                  <ThumbsUp size={16} className={post.likes > 20 ? 'fill-medical-600 text-medical-600' : ''} />
                  {post.likes || 0}
                </button>
                <button
                  onClick={() => setReplyTo(replyTo === post.id ? null : post.id)}
                  className="flex items-center gap-2 text-slate-500 hover:text-medical-600 transition-colors font-medium text-xs sm:text-sm"
                >
                  <MessageSquare size={16} />
                  {post.replies?.length || 0} Replies
                </button>
              </div>
            </div>

            {/* Replies Section */}
            {post.replies && post.replies.length > 0 && (
              <div className="bg-slate-50/50 dark:bg-slate-900/30 border-t border-slate-100 dark:border-slate-700/50 p-4 sm:p-6 space-y-3">
                {post.replies.map(reply => (
                  <div key={reply.id} className="flex gap-2 sm:gap-3">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                      <User size={12} sm={14} />
                    </div>
                    <div className="flex-1 bg-white/50 dark:bg-slate-800/50 p-2 sm:p-3 rounded-2xl rounded-tl-none shadow-sm border border-slate-100/50 dark:border-slate-700/30">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-bold text-[10px] sm:text-xs text-slate-800 dark:text-white">{reply.user}</span>
                        <span className="text-[8px] sm:text-[10px] text-slate-400">{new Date(reply.created_at).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">{reply.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Reply Input */}
            {replyTo === post.id && (
              <div className="p-4 bg-white dark:bg-slate-800 border-t border-slate-100 dark:border-slate-700">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Write a reply..."
                    className="flex-1 bg-slate-50 dark:bg-slate-900/50 rounded-xl px-4 py-2 text-sm border-none focus:ring-1 focus:ring-medical-500 dark:text-white"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleReply(post.id, e.target.value);
                        e.target.value = '';
                      }
                    }}
                  />
                  <button
                    onClick={(e) => {
                      const input = e.currentTarget.previousSibling;
                      handleReply(post.id, input.value);
                      input.value = '';
                    }}
                    className="p-2 bg-medical-600 text-white rounded-xl shadow-md active:scale-95"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      </>
      )}

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
