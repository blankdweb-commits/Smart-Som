import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import {
  Loader2, Search, X, Swords, UserPlus, ShieldAlert,
} from './Icons';

/**
 * SocialPanel — the Friends tab and the Rivals tab of the social hub.
 *
 * ONE component serves both tabs because the data is one relationship list
 * with a `relType` discriminator, and `friend_list()` already returns every
 * pair regardless of type. Splitting them would have meant two identical
 * search boxes, two identical request lists and two chances for the two to
 * disagree about what "already related" means.
 *
 * `relType` decides only three things: which tab's list is on screen, which
 * request queue is shown, and which button the search results offer first.
 *
 * ERROR CODES. These are the codes migration-v89 actually returns, which are
 * LOWERCASE. The previous copy table in pages/Rivals.jsx was keyed on
 * uppercase (`ALREADY_RELATED`, `CANNOT_ADD_SELF`) and therefore matched
 * nothing at all - every refusal fell through to the generic fallback and the
 * user was told "That request could not be accepted." with no reason. Keyed
 * correctly here, and `null` means "say nothing", for codes that are the
 * caller's own doing and need no explanation.
 */
const ERROR_COPY = {
  unauthenticated: 'Please sign in again.',
  invalid_target: 'That scholar could not be added.',
  cannot_add_self: 'You cannot add yourself.',
  invalid_type: null,
  blocked: 'That scholar has blocked you, or you blocked them.',
  already_related: 'You already have a relationship with them.',
  not_found_or_not_target: 'That request is no longer available.',
  already_answered: 'That request was already answered.',
};

const SEARCH_DEBOUNCE_MS = 350;
const SEARCH_MIN = 2;

const chip = 'rounded-full px-3 py-2 text-[10px] font-black uppercase tracking-widest transition disabled:opacity-40';

const SocialPanel = ({ relType, stake = 2, onOpenProfile, onChallenge, challengeBusy }) => {
  const { supabase, session } = useAppContext();
  const myId = session?.user?.id || null;
  const other = relType === 'rival' ? 'friend' : 'rival';

  const [friends, setFriends] = useState([]);
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(null);
  // Which row's Block button is armed. Blocking removes the relationship as
  // well, so it takes two deliberate taps rather than one stray one.
  const [armedBlock, setArmedBlock] = useState(null);

  const load = useCallback(async () => {
    if (!supabase) return null;
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc('friend_list');
      if (rpcError) throw rpcError;
      if (!data || data.ok === false) throw new Error(data?.error || 'Could not load your list');
      setFriends(Array.isArray(data.friends) ? data.friends : []);
      setIncoming(Array.isArray(data.incoming) ? data.incoming : []);
      setOutgoing(Array.isArray(data.outgoing) ? data.outgoing : []);
      setBlocks(Array.isArray(data.blocks) ? data.blocks : []);
      return data;
    } catch (err) {
      setError(err?.message === 'undefined_column'
        ? 'Your relationships could not be read. Please try again.'
        : 'Could not load your friends and rivals right now.');
      return null;
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN) { setActiveQuery(''); return undefined; }
    const t = setTimeout(() => setActiveQuery(trimmed), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Search runs only while the box has a real query, so the tab opens fast.
  useEffect(() => {
    if (!supabase || !activeQuery) { setResults([]); setSearching(false); return undefined; }
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

  // Every mutation reports through `notice`, and a refusal shows its own
  // reason rather than a generic failure.
  const say = useCallback((code, fallback) => {
    if (code == null) { setNotice(null); return true; }
    const copy = ERROR_COPY[code];
    setNotice(copy === undefined ? (fallback || 'Something went wrong.') : (copy || null));
    return copy !== null;
  }, []);

  const add = useCallback(async (row, type) => {
    setBusy(`add-${row.userId}-${type}`);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('request_relationship', {
      p_target: row.userId, p_type: type,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      say(data?.error, rpcError?.message || 'Could not send that request.');
      return;
    }
    setNotice(type === 'rival'
      ? `Rival request sent to ${row.name}.`
      : `Friend request sent to ${row.name}.`);
    await refreshAll();
  }, [supabase, refreshAll, say]);

  const respond = useCallback(async (req, accept) => {
    setBusy(`req-${req.requestId}`);
    setNotice(null);
    const { data, error: rpcError } = await supabase.rpc('respond_relationship', {
      p_rel_id: req.requestId, p_accept: accept,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      say(data?.error, rpcError?.message || 'Could not answer that request.');
      return;
    }
    setNotice(accept
      ? `${req.name} is now your ${req.relType === 'rival' ? 'rival' : 'friend'}.`
      : 'Request declined.');
    await refreshAll();
  }, [supabase, refreshAll, say]);

  const remove = useCallback(async (person) => {
    setBusy(`rm-${person.userId}`);
    setNotice(null);
    const { error: rpcError } = await supabase.rpc('remove_relationship', { p_other: person.userId });
    setBusy(null);
    if (rpcError) { setNotice(rpcError.message || 'Could not remove them.'); return; }
    setNotice(`Removed ${person.name}.`);
    await refreshAll();
  }, [supabase, refreshAll]);

  // Blocks are table writes, not RPCs (migration-v89 gives user_blocks
  // self-scoped insert/delete policies and nothing else), so this reads and
  // deletes directly rather than going through friend_list().
  const unblock = useCallback(async (person) => {
    if (!myId) { setNotice(ERROR_COPY.unauthenticated); return; }
    setBusy(`ub-${person.userId}`);
    setNotice(null);
    const { error: dbError } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', myId)
      .eq('blocked_id', person.userId);
    setBusy(null);
    if (dbError) { setNotice(dbError.message || 'Could not unblock them.'); return; }
    setNotice(`Unblocked ${person.name}.`);
    await refreshAll();
  }, [supabase, myId, refreshAll]);

  const block = useCallback(async (person) => {
    if (!myId) { setNotice(ERROR_COPY.unauthenticated); return; }
    setBusy(`bl-${person.userId}`);
    setNotice(null);
    // Blocking implies removing the relationship in both directions, otherwise
    // a blocked scholar keeps appearing as a friend on their side.
    await supabase.rpc('remove_relationship', { p_other: person.userId });
    const { error: dbError } = await supabase
      .from('user_blocks')
      .upsert(
        { blocker_id: myId, blocked_id: person.userId },
        { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true },
      );
    setBusy(null);
    setArmedBlock(null);
    if (dbError) { setNotice(dbError.message || 'Could not block them.'); return; }
    setNotice(`Blocked ${person.name}. They no longer appear in search or as a challenge target.`);
    await refreshAll();
  }, [supabase, myId, refreshAll]);

  const mine = useMemo(
    () => friends.filter((f) => (f.relType === 'rival') === (relType === 'rival')),
    [friends, relType],
  );
  const incomingMine = useMemo(
    () => incoming.filter((r) => (r.relType === 'rival') === (relType === 'rival')),
    [incoming, relType],
  );
  const outgoingMine = useMemo(
    () => outgoing.filter((r) => (r.relType === 'rival') === (relType === 'rival')),
    [outgoing, relType],
  );
  // Ids that are settled or pending, so search results can say "Add" only when
  // adding is actually possible.
  const knownIds = useMemo(() => {
    const s = new Set();
    for (const f of friends) s.add(f.userId);
    for (const r of incoming) s.add(r.userId);
    for (const r of outgoing) s.add(r.userId);
    return s;
  }, [friends, incoming, outgoing]);
  const blockedIds = useMemo(() => new Set(blocks.map((b) => b.userId)), [blocks]);

  const PersonRow = ({ person, actions }) => (
    <li className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 shadow-clinical">
      <button
        type="button"
        onClick={() => onOpenProfile({ userId: person.userId, displayName: person.name })}
        className="min-w-0 flex-1 text-left"
        aria-label={`Open ${person.name || 'scholar'}’s profile`}
      >
        <p className="font-black text-slate-900 dark:text-white truncate">{person.name || 'Scholar'}</p>
        {person.hasIdentityName === false && (
          <p className="text-[10px] font-bold text-slate-400">No display name set — shown as a handle</p>
        )}
      </button>
      <div className="flex items-center gap-2 shrink-0">{actions}</div>
    </li>
  );

  const countFor = (type) => friends.filter((f) => (f.relType === 'rival') === (type === 'rival')).length;

  return (
    <div>
      {(error || notice) && (
        <div
          role="status"
          className={`mb-4 rounded-2xl px-4 py-3 text-sm font-bold ${
            error
              ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
              : 'bg-polynurse-50 dark:bg-slate-800/60 text-polynurse-800 dark:text-polynurse-200'
          }`}
        >
          {error || notice}
        </div>
      )}

      {/* Add someone. Both types are offered from either tab, because a search
          hit is a person, not a category - the tab is a view filter, not a
          constraint on what a relationship may be. */}
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
          {results.map((r) => {
            const known = knownIds.has(r.userId);
            const isBlocked = blockedIds.has(r.userId);
            return (
              <PersonRow
                key={r.userId}
                person={r}
                actions={isBlocked ? (
                  <span className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-400`}>Blocked</span>
                ) : (
                  <>
                    <button
                      onClick={() => add(r, relType)}
                      disabled={known || busy === `add-${r.userId}-${relType}`}
                      className={`${chip} bg-polynurse-700 text-white disabled:bg-slate-200 disabled:text-slate-500`}
                    >
                      {known ? 'Requested' : <><UserPlus size={12} className="inline mr-1" />{relType === 'rival' ? 'Rival' : 'Friend'}</>}
                    </button>
                    <button
                      onClick={() => add(r, other)}
                      disabled={known || busy === `add-${r.userId}-${other}`}
                      className={`${chip} border border-polynurse-300 text-polynurse-700 dark:text-polynurse-300 disabled:border-slate-200 dark:disabled:text-slate-400 dark:disabled:border-slate-700`}
                    >
                      {other === 'rival' ? <Swords size={12} className="inline mr-1" /> : null}
                      {other === 'rival' ? 'Rival' : 'Friend'}
                    </button>
                  </>
                )}
              />
            );
          })}
        </ul>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin text-polynurse-600" />
        </div>
      ) : (
        <>
          {incomingMine.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
                Requests
              </h2>
              <ul className="space-y-2">
                {incomingMine.map((r) => (
                  <PersonRow
                    key={r.requestId}
                    person={r}
                    actions={(
                      <>
                        <button
                          onClick={() => respond(r, false)}
                          disabled={busy === `req-${r.requestId}`}
                          className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => respond(r, true)}
                          disabled={busy === `req-${r.requestId}`}
                          className={`${chip} bg-polynurse-700 px-4 text-white`}
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

          {outgoingMine.length > 0 && (
            <section className="mb-6">
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
                Awaiting reply
              </h2>
              <ul className="space-y-2">
                {outgoingMine.map((r) => (
                  <PersonRow
                    key={r.requestId}
                    person={r}
                    actions={(
                      <button
                        onClick={() => remove({ userId: r.userId, name: r.name })}
                        disabled={busy === `rm-${r.userId}`}
                        className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
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
              {relType === 'rival' ? 'Rivals' : 'Friends'} ({countFor(relType)})
            </h2>
            {mine.length === 0 ? (
              <p className="text-xs font-bold text-slate-400">
                {relType === 'rival'
                  ? 'No rivals yet — search above to add someone.'
                  : 'No friends yet — search above to add someone.'}
              </p>
            ) : (
              <ul className="space-y-2">
                {mine.map((f) => (
                  <PersonRow
                    key={f.userId}
                    person={f}
                    actions={(
                      <>
                        <button
                          onClick={() => onChallenge({ userId: f.userId, displayName: f.name, ...f })}
                          disabled={challengeBusy === f.userId}
                          title={`Challenge ${f.name} to a ${stake} SC duel. Nothing is held until they accept.`}
                          className={`${chip} bg-polynurse-700 text-white disabled:opacity-40`}
                        >
                          <Swords size={12} className="inline mr-1" />
                          {challengeBusy === f.userId ? 'Sending' : `Challenge · ${stake} SC`}
                        </button>
                        <button
                          onClick={() => (armedBlock === f.userId ? block(f) : setArmedBlock(f.userId))}
                          onBlur={() => setArmedBlock((a) => (a === f.userId ? null : a))}
                          disabled={busy === `bl-${f.userId}`}
                          aria-label={armedBlock === f.userId ? `Confirm blocking ${f.name}` : `Block ${f.name}`}
                          title={armedBlock === f.userId
                            ? 'Tap again to confirm — this also removes the relationship'
                            : 'Block this scholar'}
                          className={`${chip} border ${armedBlock === f.userId
                            ? 'border-red-400 bg-red-500/10 text-red-500'
                            : 'border-slate-200 dark:border-slate-700 text-slate-400'}`}
                        >
                          {armedBlock === f.userId ? 'Confirm?' : <ShieldAlert size={12} className="inline" />}
                        </button>
                        <button
                          onClick={() => remove(f)}
                          disabled={busy === `rm-${f.userId}`}
                          className={`${chip} border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400`}
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

          {/* The blocked list lives on ONE tab, not both. Blocks are not typed,
              so rendering it here and on Rivals would duplicate it verbatim;
              Friends is the "manage your people" surface. */}
          {relType === 'friend' && blocks.length > 0 && (
            <section>
              <h2 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-2">
                Blocked ({blocks.length})
              </h2>
              <ul className="space-y-2">
                {blocks.map((b) => (
                  <PersonRow
                    key={b.userId}
                    person={b}
                    actions={(
                      <button
                        onClick={() => unblock(b)}
                        disabled={busy === `ub-${b.userId}`}
                        className={`${chip} border border-polynurse-300 text-polynurse-700 dark:text-polynurse-300`}
                      >
                        Unblock
                      </button>
                    )}
                  />
                ))}
              </ul>
            </section>
          )}

          <p className="mt-6 text-[10px] font-bold text-slate-400">
            A real name is shown only after you have completed a duel together.
          </p>
        </>
      )}
    </div>
  );
};

export default SocialPanel;
