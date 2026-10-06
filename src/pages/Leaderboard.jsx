import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { Trophy, Coins, Award, RefreshCw, Loader2, ArrowLeft } from '../components/Icons';
import BrandLogo from '../components/BrandLogo';

const PAGE_SIZE = 30;

const Leaderboard = () => {
  const navigate = useNavigate();
  const { supabase, session, fetchGlobalRank } = useAppContext();

  const [rows, setRows] = useState([]);
  const [myId] = useState(session?.user?.id || null);
  const [myRank, setMyRank] = useState(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);

  const loadPage = useCallback(async (offset) => {
    if (!supabase) return null;
    try {
      const { data, error: rpcError } = await supabase.rpc('get_player_leaderboard', {
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });
      if (rpcError) throw rpcError;
      if (!data || data.ok === false) throw new Error(data?.error || 'Leaderboard error');
      return data;
    } catch (err) {
      console.warn('[leaderboard] load:', err?.message);
      throw err;
    }
  }, [supabase]);

  const refresh = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    setLoading(true);
    try {
      const page = await loadPage(0);
      setRows(page.players || []);
      setTotal(Number(page.totalPlayers) || 0);
    } catch {
      setError('Could not load the leaderboard right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase, loadPage]);

  // Own rank (fresh, server-side)
  useEffect(() => {
    fetchGlobalRank().then(res => setMyRank(res && res.globalRank != null ? res : null));
  }, [fetchGlobalRank]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await loadPage(rows.length);
      setRows(prev => [...prev, ...(page.players || [])]);
    } catch {
      setError('Could not load more players.');
    } finally {
      setLoadingMore(false);
    }
  };

  const medal = (rank) => {
    if (rank === 1) return 'bg-amber-400 text-amber-900';
    if (rank === 2) return 'bg-slate-300 text-slate-700';
    if (rank === 3) return 'bg-orange-300 text-orange-800';
    return 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-slate-500 dark:text-slate-400 hover:text-polynurse-700 dark:hover:text-polynurse-300 font-bold text-sm transition"
        >
          <ArrowLeft size={18} /> Back
        </button>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-polynurse-700 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Trophy size={120} />
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tight relative z-10">Global Leaderboard</h1>
        <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
          Competitive power score · coins + duels + performance
        </p>
        {myRank ? (
          <p className="text-sm font-black text-white/90 relative z-10 mt-3">
            You're <span className="text-amber-300 text-xl font-black">#{myRank.globalRank}</span> with{' '}
            <span className="text-amber-300 font-black">{Number(myRank.playerScore || 0).toLocaleString()} pts</span>
            {' '}· {Number(total).toLocaleString()} ranked scholars
          </p>
        ) : (
          <p className="text-sm font-bold text-white/70 relative z-10 mt-3">
            Complete a quiz round to claim your spot.
          </p>
        )}
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold rounded-2xl px-4 py-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-polynurse-600" />
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-10 text-center">
          <Award className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={44} />
          <p className="text-slate-500 dark:text-slate-400 font-bold">
            No ranked scholars yet. Be the first — complete a quiz round!
          </p>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map(row => {
              const isMe = myId && row.userId === myId;
              const b = row.scoreBreakdown || {};
              return (
                <li
                  key={row.userId}
                  className={`flex items-center gap-3 bg-white dark:bg-slate-800 rounded-2xl shadow-clinical border px-4 py-3 transition ${
                    isMe
                      ? 'border-polynurse-400 ring-2 ring-polynurse-600/20 dark:border-polynurse-500'
                      : 'border-slate-100 dark:border-slate-700'
                  }`}
                >
                  <span className={`w-9 h-9 flex items-center justify-center rounded-xl font-black text-xs ${medal(row.rank)}`}>
                    {row.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-black text-slate-900 dark:text-white truncate">
                      {row.displayName || 'Scholar'}
                      {isMe && <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-polynurse-600 dark:text-polynurse-300">You</span>}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400 truncate">
                      {Number(row.playerScore || 0).toLocaleString()} scholar pts ·{' '}
                      {Number(row.totalAnswers || 0).toLocaleString()} answers
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="hidden sm:flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <Coins size={12} className="text-amber-500" /> {Number(b.coin || 0).toLocaleString()}
                    </span>
                    <span className="hidden sm:flex items-center gap-1 text-[9px] font-black uppercase tracking-widest text-slate-400">
                      <Award size={12} className="text-polynurse-600" /> {Number(b.duels || 0).toLocaleString()}
                    </span>
                    <span className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                      {Number(row.competitiveScore || 0).toLocaleString()}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          {rows.length < total && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mt-5 w-full flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl py-3 font-black text-xs uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300 hover:border-polynurse-300 disabled:opacity-50 transition"
            >
              {loadingMore ? <Loader2 size={16} className="animate-spin" /> : null}
              Load more ({Math.max(0, total - rows.length).toLocaleString()} left)
            </button>
          )}
        </>
      )}

      <div className="mt-8 flex justify-center">
        <BrandLogo variant="mark" size="md" />
      </div>
    </div>
  );
};

export default Leaderboard;