import React, { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { Crown, Coins, Loader2, RefreshCw } from './Icons';

/**
 * CosmeticsPanel — buy and equip cosmetic items with Smart Coins.
 *
 * The catalogue and the balance both come from the server (my_cosmetics /
 * cosmetic_catalog). The client never decides a price, never decides whether
 * an item is affordable, and never writes an entitlement: cosmetic_purchase()
 * owns all three. That is the whole reason this panel has no "confirm price"
 * step - there is no second number that could disagree with the server's.
 *
 * NO GAMEPLAY EFFECT, stated in the copy on purpose. A cosmetic that is sold
 * for real money has to be visibly cosmetic or it is pay-to-win. The server
 * enforces this too: nothing in v_competitive_base, _competitive_partials or the
 * leaderboard's ORDER BY references user_cosmetics at all.
 */
// Module scope, not inside the component: it is a constant lookup table, and
// declaring it in the body would make every render a new object identity and
// force `buy` to list it as a dependency.
const BUY_ERRORS = {
  INSUFFICIENT_FUNDS: 'Not enough Smart Coins.',
  INSUFFICIENT_SC: 'Not enough Smart Coins.',
  ALREADY_OWNED: 'You already own that.',
  NOT_FOUND: 'That item is no longer available.',
  PURCHASE_FAILED: 'The purchase could not be completed.',
  UNAUTHENTICATED: 'Please sign in again.',
};

const CosmeticsPanel = () => {
  const { supabase, setSmartCoins } = useAppContext();

  const [catalog, setCatalog] = useState([]);
  const [owned, setOwned] = useState({ items: [], balance: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    if (!supabase) return;
    setError(null);
    try {
      const [{ data: cat }, { data: mine }] = await Promise.all([
        supabase.rpc('cosmetic_catalog'),
        supabase.rpc('my_cosmetics'),
      ]);
      if (cat?.error) throw cat.error;
      if (mine?.error) throw mine.error;
      if (cat && cat.ok === false) throw new Error(cat.error || 'Catalogue unavailable');
      if (mine && mine.ok === false) throw new Error(mine.error || 'Inventory unavailable');
      setCatalog(Array.isArray(cat?.items) ? cat.items : []);
      setOwned({
        items: Array.isArray(mine?.items) ? mine.items : [],
        balance: Number(mine?.balance || 0),
      });
    } catch (err) {
      console.warn('[cosmetics] load:', err?.message);
      setError('Could not load cosmetics right now.');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const ownedBySku = useCallback(
    () => new Map(owned.items.map((i) => [i.sku, i])),
    [owned.items],
  );

  const buy = useCallback(async (item) => {
    if (busy) return;
    setBusy(item.sku);
    setNotice(null);
    setError(null);
    const { data, error: rpcError } = await supabase.rpc('cosmetic_purchase', { p_sku: item.sku });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      const code = data?.error;
      setError(BUY_ERRORS[code]
        || rpcError?.message
        || 'That purchase could not be completed.');
      return;
    }
    // Keep the wallet pill in AppContext honest without a full refetch.
    if (typeof data.balance === 'number') setSmartCoins(data.balance);
    setNotice(`${item.title} unlocked and equipped.`);
    await load();
  }, [supabase, busy, setSmartCoins, load]);

  const toggle = useCallback(async (item) => {
    if (busy) return;
    setBusy(item.sku);
    setNotice(null);
    setError(null);
    const next = !item.equipped;
    const { data, error: rpcError } = await supabase.rpc('cosmetic_equip', {
      p_sku: item.sku, p_equipped: next,
    });
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      setError(data?.error === 'NOT_OWNED'
        ? 'You do not own that item.'
        : rpcError?.message || 'That could not be changed.');
      return;
    }
    await load();
  }, [supabase, busy, load]);

  const mine = ownedBySku();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
          <Coins size={12} className="text-amber-500" />
          <span className="text-slate-700 dark:text-slate-200 tabular-nums">{owned.balance.toLocaleString()}</span>
          <span>Smart Coins</span>
        </p>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-2 text-polynurse-700 dark:text-polynurse-300 font-black text-xs uppercase tracking-widest disabled:opacity-40 transition"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-bold rounded-2xl px-4 py-3">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 flex items-center gap-2 bg-polynurse-50 dark:bg-slate-800/60 text-polynurse-800 dark:text-polynurse-200 text-sm font-bold rounded-2xl px-4 py-3">
          <Crown size={15} className="shrink-0 text-amber-500" />
          <span className="flex-1">{notice}</span>
          <button onClick={() => setNotice(null)} className="underline shrink-0">Dismiss</button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 size={28} className="animate-spin text-polynurse-600" />
        </div>
      ) : catalog.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-[2rem] shadow-clinical border border-slate-100 dark:border-slate-700 p-10 text-center">
          <Crown className="mx-auto text-slate-300 dark:text-slate-600 mb-3" size={44} />
          <p className="text-slate-500 dark:text-slate-400 font-bold">
            No cosmetics on sale yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {catalog.map((item) => {
            const held = mine.get(item.sku);
            const price = Number(item.scPrice || 0);
            const affordable = owned.balance >= price;
            return (
              <li key={item.sku} className="rounded-2xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-4 shadow-clinical">
                <div className="flex items-start gap-3">
                  <span className="w-12 h-12 shrink-0 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center">
                    <Crown size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-black text-slate-900 dark:text-white">
                      {item.title}
                      {held?.equipped && (
                        <span className="ml-2 text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400">
                          Equipped
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  {held ? (
                    <button
                      onClick={() => toggle(held)}
                      disabled={busy === item.sku}
                      className="rounded-full border border-polynurse-300 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-polynurse-700 dark:text-polynurse-300 disabled:opacity-40 transition"
                    >
                      {busy === item.sku ? 'Working' : held.equipped ? 'Unequip' : 'Equip'}
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() => buy(item)}
                        disabled={busy === item.sku || !affordable}
                        title={affordable ? `Buy for ${price} Smart Coins` : 'Not enough Smart Coins'}
                        className="rounded-full bg-polynurse-700 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-white transition hover:bg-polynurse-800 disabled:bg-slate-200 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 disabled:cursor-not-allowed"
                      >
                        {busy === item.sku ? 'Buying' : `Buy · ${price} SC`}
                      </button>
                      {!affordable && (
                        <span className="text-[10px] font-bold text-slate-400">
                          {Math.max(0, price - owned.balance)} SC short
                        </span>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-6 text-[10px] font-bold text-slate-400 leading-snug">
        Cosmetics are decoration. They change how your name looks and nothing else —
        they do not affect quiz difficulty, scoring, answer speed, Smart Coin rewards,
        your rank, or any credential you earn.
      </p>
    </div>
  );
};

export default CosmeticsPanel;
