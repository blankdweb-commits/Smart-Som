import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ArrowLeft, Users, UserPlus, Loader2, RefreshCw, Search, X, Swords } from '../components/Icons';
import BrandLogo from '../components/BrandLogo';

// Search is debounced the same way the arena search is, and the server ignores
// anything shorter than 2 characters.
const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN = 2;

const ERROR_COPY = {
  ALREADY_RELATED: 'You already have a relationship with them.',
  INVITE_ALREADY_OPEN: null,
  CANNOT_ADD_SELF: null,
  INVALID_TARGET: null,
  UNAUTHENTICATED: 'Please sign in again.',
  NOT_FOUND_OR_NOT_TARGET: 'That request is no longer available.',
  NOT_YOUR_REQUEST: 'That request is no longer available.',
};

const Rivals = () => {
  const navigate = useNavigate();
  const { supabase } = useAppContext();

  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    try {
      const { data, error: rpcError } = await supabase.rpc('friend_list');
      if (rpcError) throw rpcError;
      if (!data || data.ok === false) throw new Error(data?.error || 'Could not load your list');
      setFriends(Array.isArray(data.friends) ? data.friends : []);
      setIncoming(Array.isArray(data.incoming) ? data.incoming : []);
      setOutgoing(Array.isArray(data.outgoing) ? data.outgoing : []);
      setError(null);
    } catch {
      setError('Could not load your friends and rivals right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN) { setActiveQuery(''); return; }
    const t = setTimeout(() => setActiveQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!supabase) return;
    if (!activeQuery) { setResults([]); return; }
    let stopped = false;
    (async () => {
      setSearching(true);
      const { data } = await supabase.rpc('friend_search', { p_query: activeQuery });
      if (stopped) return;
      setResults(Array.isArray(data?.results) ? data.results : []);
      setSearching(false);
    })();
    return () => { stopped = true; };
  }, [supabase, activeQuery]);

  const refreshAll = useCallback(async () => {
    await load();
    if (activeQuery && supabase) {
      const { data } = await supabase.rpc('friend_search', { p_query: activeQuery });
      setResults(Array.isArray(data?.results) ? data.results : []);
    }
  }, [load, activeQuery, supabase]);

  const add = useCallback(async (row, relType) => {
    setBusy(`add-${row.userId}-${relType}`);
    setNotice(null);
    const { error: rpcError } = await supabase.rpc('request_relationship', {
      p_target: row.userId, p_type: relType,
    });
    setBusy(null);
    if (rpcError) { setNotice(rpcError.message || 'Could not send that request.'); return; }
    setNotice(relType === 'rival'
      ? `Rival request sent to ${row.name}.`
      : `Friend request sent to ${row.name}.`);
    await refreshAll();
  }, [supabase, refreshAll]);

  const respond = useCallback(async (req, accept) => {
    setBusy(`req-${req.requestId}`);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('respond_relationship', {
      p_rel_id: req.requestId, p_accept: accept,
    });
    setBusy(null);
    if (rpcError) { setNotice(rpcError.message || 'Could not answer that request.'); return; }
    if (accept && data && data.ok === false) {
      const copy = ERROR_COPY[data.error];
      setNotice(copy !== undefined ? (copy || 'That request could not be accepted.') : 'That request could not be accepted.');
      return;
    }
    setNotice(accept ? `${req.name} is now your friend.` : 'Request declined.');
    await refreshAll();
  }, [supabase, refreshAll]);

  const remove = useCallback(async (friend) => {
    setBusy(`rm-${friend.userId}`);
    setNotice(null);
    const { error: rpcError } = await supabase.rpc('remove_relationship', { p_other: friend.userId });
    setBusy(null);
    if (rpcError) { setNotice(rpcError.message || 'Could not remove them.'); return; }
    setNotice(`Removed ${friend.name}.`);
    await refreshAll();
  }, [supabase, refreshAll]);

  const friendsLabel = useMemo(
    () => friends.filter((f) => f.relType === 'friend'),
    [friends],
  );
  const rivalsLabel = useMemo(
    () => friends.filter((f) => f.relType !== 'friend'),
    [friends],
  );

  const PersonCard = ({ person, actions }) => (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-clinical">
      <div className="min-w-0">
        <p className="font-black text-slate-900 dark:text-white truncate">{person.name || 'Scholar'}</p>
        {person.hasIdentityName === false && (
          <p className="text-[10px] font-bold text-slate-400">No display name set — shown as a handle</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">{actions}</div>
    </li>
  );

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
          onClick={refreshAll}
          disabled={loading}
          className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="bg-polynurse-700 rounded-[2.5rem] p-8 text-white shadow-xl relative overflow-hidden mb-6">
        <div className="absolute top-0 right-0 p-8 opacity-10"><Users size={110} /></div>
        <h1 className="text-2xl font-black uppercase tracking-tight relative z-10 flex items-center gap-2">
          <BrandLogo className="w-6 h-6" /> Friends &amp; Rivals
        </h1>
        <p className="text-[10px] uppercase font-black text-white/70 tracking-widest relative z-10 mt-1">
          Your people
        </p>
        <p className="text-sm font-bold text-white/90 relative z-10 mt-3">
          <span className="text-amber-300 text-xl font-black tabular-nums">{friendsLabel.length}</span> friends
          {' · '}
          <span className="text-amber-300 text-xl font-black tabular-nums">{rivalsLabel.length}</span> rivals
        </p>
      </div>

      {(error || notice) && (
        <div className="mb-4 rounded-2xl px-4 py-3 text-sm font-bold bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400">
          {error || notice}
        </div>
      )}

      {/* Add someone */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a scholar by name…"
          aria-label="Find a scholar to add"
          className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 py-3 pl-10 pr-10 text-sm font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-polynurse-400"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        )}
      </div>
      {query.trim() && query.trim().length < SEARCH_MIN && (
        <p className="text-[10px] font-bold text-slate-400 mb-3">
          Type at least {SEARCH_MIN} characters to search.
        </p>
      )}

      {searching && (
        <p className="flex items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400 mb-3">
          <Loader2 size={14} className="animate-spin" /> Searching…
        </p>
      )}
      {activeQuery && !searching && results.length === 0 && (
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-4">
          No scholars match “{activeQuery}”. They must have activated their account.
        </p>
      )}
      {results.length > 0 && (
        <ul className="space-y-2 mb-6">
          {results.map((r) => (
            <PersonCard
              key={r.userId}
              person={r}
              actions={(
                <>
                  <button
                    onClick={() => add(r, 'friend')}
                    disabled={busy === `add-${r.userId}-friend`}
                    className="rounded-full border border-polynurse-300 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300 disabled:opacity-40 transition"
                  >
                    <UserPlus size={12} className="inline mr-1" /> Friend
                  </button>
                  <button
                    onClick={() => add(r, 'rival')}
                    disabled={busy === `add-${r.userId}-rival`}
                    className="rounded-full bg-slate-800 dark:bg-slate-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40 transition"
                  >
                    <Swords size={12} className="inline mr-1" /> Rival
                  </button>
                </>
              )}
            />
          ))}
        </ul>
      )}

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-polynurse-600" /></div>
      ) : (
        <>
          {incoming.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
                Requests
              </h2>
              <ul className="space-y-2">
                {incoming.map((r) => (
                  <PersonCard
                    key={r.requestId}
                    person={r}
                    actions={(
                      <>
                        <button
                          onClick={() => respond(r, false)}
                          disabled={busy === `req-${r.requestId}`}
                          className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 disabled:opacity-40 transition"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => respond(r, true)}
                          disabled={busy === `req-${r.requestId}`}
                          className="rounded-full bg-polynurse-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40 transition"
                        >
                          Accept
                        </button>
                      </>
                    )}
                  />
                ))}
              </ul>
            </section>
          )}

          {outgoing.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
                Awaiting reply
              </h2>
              <ul className="space-y-2">
                {outgoing.map((r) => (
                  <PersonCard
                    key={r.requestId}
                    person={r}
                    actions={(
                      <button
                        onClick={() => remove({ userId: r.userId, name: r.name })}
                        disabled={busy === `rm-${r.userId}`}
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 disabled:opacity-40 transition"
                      >
                        Cancel
                      </button>
                    )}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className="mb-6">
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
              Friends ({friendsLabel.length})
            </h2>
            {friendsLabel.length === 0 ? (
              <p className="text-xs font-bold text-slate-400">No friends yet — search above to add someone.</p>
            ) : (
              <ul className="space-y-2">
                {friendsLabel.map((f) => (
                  <PersonCard
                    key={f.userId}
                    person={f}
                    actions={(
                      <button
                        onClick={() => remove(f)}
                        disabled={busy === `rm-${f.userId}`}
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 disabled:opacity-40 transition"
                      >
                        Remove
                      </button>
                    )}
                  />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
              Rivals ({rivalsLabel.length})
            </h2>
            {rivalsLabel.length === 0 ? (
              <p className="text-xs font-bold text-slate-400">No rivals yet.</p>
            ) : (
              <ul className="space-y-2">
                {rivalsLabel.map((f) => (
                  <PersonCard
                    key={f.userId}
                    person={f}
                    actions={(
                      <>
                        <button
                          onClick={() => navigate('/rumble')}
                          className="rounded-full bg-polynurse-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white transition"
                        >
                          Challenge
                        </button>
                        <button
                          onClick={() => remove(f)}
                          disabled={busy === `rm-${f.userId}`}
                          className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 disabled:opacity-40 transition"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  />
                ))}
              </ul>
            )}
          </section>

          <p className="mt-6 text-[10px] font-bold text-slate-400">
            A real name is shown only after you have completed a duel together.
          </p>
        </>
      )}
    </div>
  );
};

export default Rivals;