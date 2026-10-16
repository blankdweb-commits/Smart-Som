import React, { useCallback, useEffect, useMemo, useState } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  Filter,
  Info,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  X,
  FileText,
  ShoppingCart,
  Wallet
} from './../components/Icons';
import { useAppContext } from '../context/AppContext';
import TutorialTip from '../components/TutorialTip';
import { supabase } from '../utils/supabase';

const PLATFORM_SELLER = 'polynurse';

const ACCESS_LABELS = {
  free: 'Free',
  premium: 'Premium',
  'one-time': 'Paid'
};

const ACCESS_STYLES = {
  free: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
  premium: 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30',
  'one-time': 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
};

const CATEGORY_COLORS = [
  'bg-teal-500', 'bg-blue-500', 'bg-amber-500', 'bg-violet-500',
  'bg-emerald-500', 'bg-rose-500', 'bg-indigo-500', 'bg-cyan-500'
];

const SORTS = [
  { key: 'featured', label: 'Featured' },
  { key: 'newest', label: 'Newest' },
  { key: 'price-asc', label: 'Price: Low to High' },
  { key: 'price-desc', label: 'Price: High to Low' }
];

const isPlatformSeller = (seller) =>
  seller && String(seller.business_name || '').toLowerCase() === PLATFORM_SELLER;

const safeContentUrl = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

export default function Marketplace() {
  const { userProfile, session } = useAppContext();
  const me = session?.user?.id;

  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [ownedIds, setOwnedIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [sortKey, setSortKey] = useState('featured');

  const [active, setActive] = useState(null);
  const [buyingId, setBuyingId] = useState(null);
  const [buyError, setBuyError] = useState(null);

  const loadMarketplace = useCallback(async () => {
    setLoadError(null);
    if (!supabase) {
      setLoading(false);
      setLoadError('UNCONFIGURED');
      return;
    }
    try {
      const [catRes, prodRes] = await Promise.all([
        supabase.from('marketplace_categories').select('*').eq('is_active', true).order('sort_order', { ascending: true }),
        supabase.from('marketplace_products')
          .select('*, marketplace_sellers(business_name, is_verified, contact_email)')
          .eq('is_published', true)
          .eq('is_archived', false)
          .order('created_at', { ascending: false })
      ]);
      const catError = catRes.error ? 'storefront' : null;
      const prodError = prodRes.error ? 'storefront' : null;
      if (catError || prodError) {
        setLoadError('STORE');
        setLoading(false);
        return;
      }
      setCategories(catRes.data || []);
      setProducts(prodRes.data || []);
      if (me) {
        const ownRes = await supabase
          .from('marketplace_purchases')
          .select('product_id, status')
          .eq('user_id', me)
          .eq('status', 'complete');
        if (!ownRes.error) setOwnedIds(new Set((ownRes.data || []).map((p) => p.product_id)));
      }
      setLoading(false);
    } catch {
      setLoadError('NETWORK');
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    loadMarketplace();
  }, [loadMarketplace]);

  const visible = useMemo(() => {
    let list = [...products];
    if (category !== 'all') list = list.filter((p) => String(p.category_id) === category);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        (p.title || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    }
    const price = (p) => Number(p.price) || 0;
    list.sort((a, b) => {
      switch (sortKey) {
        case 'price-asc': return price(a) - price(b);
        case 'price-desc': return price(b) - price(a);
        case 'newest': return new Date(b.created_at) - new Date(a.created_at);
        default:
          return (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) ||
            new Date(b.created_at) - new Date(a.created_at);
      }
    });
    return list;
  }, [products, category, query, sortKey]);

  const ownedProducts = useMemo(
    () => products.filter((p) => ownedIds.has(p.id)),
    [products, ownedIds]
  );

  const refreshOwned = useCallback(async () => {
    if (!me || !supabase) return;
    const ownRes = await supabase
      .from('marketplace_purchases')
      .select('product_id')
      .eq('user_id', me)
      .eq('status', 'complete');
    if (!ownRes.error) setOwnedIds(new Set((ownRes.data || []).map((p) => p.product_id)));
  }, [me]);

  const grantSelfEntitlement = useCallback(async (product) => {
    setBuyError(null);
    if (!supabase || !me) {
      setBuyError('AUTH');
      return;
    }
    const ref = `${product.access_type === 'premium' ? 'premium' : 'free'}-${crypto.randomUUID()}`;
    const { error } = await supabase.from('marketplace_purchases').insert({
      user_id: me,
      product_id: product.id,
      amount: 0,
      reference: ref,
      status: 'complete'
    });
    if (error) {
      setBuyError('GRANT');
      return;
    }
    await refreshOwned();
  }, [me, refreshOwned]);

  const buyProduct = useCallback(async (product) => {
    setBuyError(null);
    if (!session?.access_token) {
      setBuyError('AUTH');
      return;
    }
    setBuyingId(product.id);
    try {
      const res = await fetch('/api/initiate-payment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ product: 'marketplace_product', product_id: product.id })
      });
      const body = await res.json();
      if (res.ok && body.authorization_url) {
        window.location.assign(body.authorization_url);
        return;
      }
      setBuyError(body.error || body.message || 'PAYSTACK');
    } catch {
      setBuyError('NETWORK');
    } finally {
      setBuyingId(null);
    }
  }, [session]);

  const catById = useMemo(() => {
    const m = new Map();
    for (const c of categories) m.set(String(c.id), c);
    return m;
  }, [categories]);

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28">
      <TutorialTip tutorialKey="marketplace">
        First time? The Marketplace tour shows which listings you can actually buy.
      </TutorialTip>
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="space-y-6"
      >
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 to-emerald-700 text-white p-6 shadow-lg">
          <div className="absolute -right-6 -top-10 w-40 h-40 rounded-full bg-white/10" />
          <div className="absolute right-12 -bottom-12 w-32 h-32 rounded-full bg-white/10" />
          <div className="relative">
            <div className="w-11 h-11 rounded-2xl bg-white/15 flex items-center justify-center mb-4">
              <Store className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold mb-1">PolyNurse Marketplace</h1>
            <p className="text-white/85 text-sm leading-relaxed">
              First-party learning products sold directly by PolyNurse, alongside informational listings from verified sellers.
            </p>
          </div>
        </div>

        {loadError && <LoadError loadError={loadError} onRetry={() => { setLoading(true); loadMarketplace(); }} />}

        {!loadError && (loading) && (
          <div className="py-16 flex flex-col items-center gap-3 text-slate-400">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-xs font-bold uppercase tracking-widest">Loading marketplace…</p>
          </div>
        )}

        {!loadError && !loading && (
          <>
            <SearchableControls
              categories={categories}
              category={category}
              setCategory={setCategory}
              query={query}
              setQuery={setQuery}
              sortKey={sortKey}
              setSortKey={setSortKey}
            />

            {ownedProducts.length > 0 && (
              <MyPurchases products={ownedProducts} productsLoading={false} />
            )}

            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 uppercase tracking-wide">
                  {category !== 'all'
                    ? catById.get(category)?.name || 'Products'
                    : query.trim()
                    ? `Search results (${visible.length})`
                    : 'All products'}
                </h3>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {visible.length} {visible.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              {products.length === 0 ? (
                <EmptyState
                  title="No products yet"
                  note="Admins publish first-party products here. Check back soon."
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  title="Nothing matches"
                  note="Try a different category, search term or sort order."
                  action={() => { setQuery(''); setCategory('all'); }}
                  actionLabel="Clear filters"
                />
              ) : (
                <div className="space-y-3">
                  {visible.map((p, i) => (
                    <motion.div
                      key={p.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(i * 0.05, 0.5) }}
                    >
                      <ProductCard
                        product={p}
                        categoryColor={CATEGORY_COLORS[Math.abs(p.category_id) % CATEGORY_COLORS.length]}
                        owned={ownedIds.has(p.id)}
                        onClick={() => { setActive(p); setBuyError(null); }}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </section>

            <FooterNote />
          </>
        )}

        {active && (
          <ProductSheet
            product={active}
            categoryColor={CATEGORY_COLORS[Math.abs(active.category_id) % CATEGORY_COLORS.length]}
            owned={ownedIds.has(active.id)}
            premium={!!userProfile?.isPremium}
            isPlatform={isPlatformSeller(active.marketplace_sellers)}
            buying={buyingId === active.id}
            buyError={buyError}
            onClose={() => setActive(null)}
            onBuy={() => buyProduct(active)}
            onGrant={() => grantSelfEntitlement(active)}
          />
        )}
      </motion.div>
    </div>
  );
}

const LoadError = ({ loadError, onRetry }) => {
  const config = loadError === 'UNCONFIGURED';
  const network = loadError === 'NETWORK';
  return (
    <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-5 flex items-start gap-3">
      <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-red-600 dark:text-red-400 text-sm font-bold">
          {config ? 'Storefront is not configured' : network ? 'Could not reach the service' : 'Storefront is temporarily unavailable'}
        </p>
        <p className="text-red-500/90 dark:text-red-400/80 text-xs mt-1 leading-relaxed">
          {config
            ? 'Live data is disabled because Supabase is not configured on this device.'
            : network
            ? 'Check your connection and try again. No products were modified.'
            : 'There was a problem loading the storefront. No products were modified.'}
        </p>
        <button
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
        >
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    </div>
  );
};

const SearchableControls = ({ categories, category, setCategory, query, setQuery, sortKey, setSortKey }) => (
  <div className="space-y-3">
    <div className="relative">
      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search products…"
        className="w-full pl-10 pr-10 py-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
      />
      {query && (
        <button
          onClick={() => setQuery('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          aria-label="Clear search"
        >
          <X size={16} />
        </button>
      )}
    </div>

    {categories.length > 0 && (
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <CategoryChip active={category === 'all'} onClick={() => setCategory('all')} label="All" />
        {categories.map((c) => (
          <CategoryChip
            key={c.id}
            active={String(category) === String(c.id)}
            onClick={() => setCategory(String(c.id))}
            label={c.name}
          />
        ))}
      </div>
    )}

    <div className="flex items-center justify-between">
      <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
        <Filter size={14} /> Sort
      </label>
      <select
        value={sortKey}
        onChange={(e) => setSortKey(e.target.value)}
        className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500 truncate"
      >
        {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      </select>
    </div>
  </div>
);

const CategoryChip = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-bold transition-all ${
      active
        ? 'bg-teal-600 text-white shadow-sm'
        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
    }`}
  >
    {label}
  </button>
);

const AccessBadge = ({ p }) => (
  <span className={`px-2 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-widest ${ACCESS_STYLES[p.access_type] || ACCESS_STYLES['one-time']}`}>
    {ACCESS_LABELS[p.access_type] || 'Paid'}
  </span>
);

const SellerLine = ({ product }) => {
  const platform = isPlatformSeller(product.marketplace_sellers);
  return platform ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-teal-600 dark:text-teal-400">
      <ShieldCheck size={12} /> Sold by PolyNurse
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400">
      <Info size={12} /> Listed by {product.marketplace_sellers?.business_name || 'a third-party seller'}
    </span>
  );
};

const ProductCard = ({ product, categoryColor, owned, onClick }) => (
  <button
    onClick={onClick}
    className="w-full text-left rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-4 hover:border-teal-500/60 transition-colors active:scale-[0.99]"
  >
    <div className={`w-12 h-12 rounded-xl ${categoryColor} flex items-center justify-center text-white shrink-0`}>
      <FileText size={20} />
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 truncate">{product.title}</h3>
        {product.is_featured && <Star size={13} className="text-amber-400 shrink-0 fill-amber-400" />}
      </div>
      <div className="flex items-center gap-2 mt-1 flex-wrap">
        <SellerLine product={product} />
        {owned && (
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest">
            <CheckCircle2 size={12} /> Owned
          </span>
        )}
      </div>
    </div>
    <div className="flex flex-col items-end gap-2 shrink-0">
      <AccessBadge p={product} />
      {renderPriceInline(product)}
      {!isPlatformSeller(product.marketplace_sellers) && (
        <span className="text-[9px] font-bold uppercase tracking-widest text-amber-600 dark:text-amber-400">Informational</span>
      )}
    </div>
  </button>
);

const renderPriceInline = (p) => {
  if (p.access_type === 'free') return <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">Free</span>;
  if (p.access_type === 'premium') return <span className="text-[10px] font-black text-violet-600 dark:text-violet-400">With Premium</span>;
  return <span className="text-sm font-black text-slate-900 dark:text-white">₦{(Number(p.price) || 0).toLocaleString()}</span>;
};

const MyPurchases = ({ products }) => (
  <section>
    <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 uppercase tracking-wide mb-3">My purchases</h3>
    <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10 divide-y divide-emerald-100 dark:divide-emerald-800/50">
      {products.map((p) => {
        const url = safeContentUrl(p.content_url);
        return (
          <div key={p.id} className="flex items-center gap-3 p-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
              <CheckCircle2 size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">{p.title}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">Purchased</p>
            </div>
            {url ? (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
              >
                <ExternalLink size={13} /> Open
              </a>
            ) : (
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Available in your account</span>
            )}
          </div>
        );
      })}
    </div>
  </section>
);

const EmptyState = ({ title, note, action, actionLabel }) => (
  <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 py-12 px-6 text-center">
    <Wallet size={32} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
    <p className="font-bold text-slate-600 dark:text-slate-300">{title}</p>
    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{note}</p>
    {action && (
      <button onClick={action} className="mt-4 text-xs font-black uppercase tracking-widest text-teal-600 dark:text-teal-400">
        {actionLabel}
      </button>
    )}
  </div>
);

const ProductSheet = ({ product, categoryColor, owned, premium, isPlatform, buying, buyError, onClose, onBuy, onGrant }) => {
  const url = safeContentUrl(product.content_url);
  const price = Number(product.price) || 0;

  let cta = null;
  if (!isPlatform) {
    cta = (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4 space-y-2">
        <p className="flex items-center gap-2 text-amber-700 dark:text-amber-300 text-sm font-bold">
          <Info size={16} /> Informational listing
        </p>
        <p className="text-xs text-amber-700/90 dark:text-amber-300/80 leading-relaxed">
          This item is listed by a third-party seller. PolyNurse does not sell it and cannot process payment for it.
          {product.marketplace_sellers?.contact_email
            ? ` Contact the seller directly: ${product.marketplace_sellers.contact_email}`
            : ' Contact the seller directly for availability.'}
        </p>
      </div>
    );
  } else if (owned) {
    cta = (
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 p-4 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-sm font-bold">
          <CheckCircle2 size={16} /> You own this product
        </p>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-colors">
            <ExternalLink size={14} /> Open
          </a>
        )}
      </div>
    );
  } else if (product.access_type === 'free') {
    cta = (
      <button onClick={onGrant} className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl transition-colors">
        <Download size={18} /> Get free product
      </button>
    );
  } else if (product.access_type === 'premium') {
    cta = premium ? (
      <button onClick={onGrant} className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-500 text-white font-bold py-4 rounded-xl transition-colors">
        <Sparkles size={18} /> Included with Premium — Open
      </button>
    ) : (
      <div className="rounded-2xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-900/20 p-4 flex items-center gap-3">
        <Lock size={18} className="text-violet-500 shrink-0" />
        <div>
          <p className="text-violet-700 dark:text-violet-300 text-sm font-bold">Needs Premium</p>
          <p className="text-xs text-violet-600/90 dark:text-violet-300/80">This product is included with a premium subscription.</p>
        </div>
      </div>
    );
  } else {
    cta = (
      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-1.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500 dark:text-slate-400 font-medium">Total payable</span>
            <span className="font-black text-slate-900 dark:text-white text-lg">₦{price.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">One-time purchase · NGN</span>
            <span className="text-slate-400">You'll be redirected to Paystack to pay securely</span>
          </div>
        </div>
        <button
          onClick={onBuy}
          disabled={buying}
          className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-xl transition-colors disabled:opacity-60"
        >
          {buying ? <><Loader2 size={18} className="animate-spin" /> Starting checkout…</> : <><ShoppingCart size={18} /> Buy now — ₦{price.toLocaleString()}</>}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-[2rem] p-6 pb-8 shadow-2xl">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl ${categoryColor} flex items-center justify-center text-white shrink-0`}>
              <FileText size={22} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900 dark:text-white leading-tight">{product.title}</h2>
              <div className="mt-1"><SellerLine product={product} /></div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X size={20} />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-4">
          <AccessBadge p={product} />
          {product.is_featured && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30 text-[9px] font-black uppercase tracking-widest">
              <Star size={11} className="fill-amber-400" /> Featured
            </span>
          )}
          {!isPlatform && (
            <span className="text-[9px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-full px-2 py-0.5">
              Listing price shown by the seller
            </span>
          )}
        </div>

        <div className="mb-5 min-h-[3rem]">
          {product.description ? (
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">{product.description}</p>
          ) : (
            <p className="text-sm text-slate-400 italic">No description provided.</p>
          )}
        </div>

        {cta}

        {buyError && <BuyError buyError={buyError} onClear={() => {}} />}
      </div>
    </div>
  );
};

const BuyError = ({ buyError }) => {
  const msg = {
    AUTH: 'Please sign in to purchase products.',
    NETWORK: 'Could not start payment. Check your connection and try again.',
    PAYSTACK: 'Payment could not be started. Please try again.',
    GRANT: 'Could not grant access. Please try again.',
    THIRD_PARTY_NOT_PURCHASABLE: 'This listing is informational only and cannot be purchased.',
    PRODUCT_NOT_FOUND: 'This product is no longer available.',
    PRODUCT_NOT_AVAILABLE: 'This product is not available for purchase right now.',
    FREE_PRODUCT: 'This product is free — use “Get free product”.',
    PREMIUM_ONLY: 'This product is included with Premium, not sold separately.',
    ALREADY_OWNED: 'You already own this product.'
  }[buyError] || buyError;
  return (
    <div className="mt-3 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
      <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
      <p className="text-red-600 dark:text-red-400 text-xs font-bold">{msg}</p>
    </div>
  );
};

const FooterNote = () => (
  <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-start gap-3">
    <ShieldCheck size={18} className="text-teal-600 shrink-0 mt-0.5" />
    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
      Only <span className="font-bold text-teal-600 dark:text-teal-400">Sold by PolyNurse</span> items can be
      purchased here. Third-party listings are informational only; PolyNurse never processes payment for them.
    </p>
  </div>
);