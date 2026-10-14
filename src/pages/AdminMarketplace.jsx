import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  Plus,
  Save,
  Search,
  Shield,
  Star,
  Trash2,
  X,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Eye,
  EyeOff,
  Info
} from '../components/Icons';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';

const ACCESS_OPTIONS = [
  { value: 'one-time', label: 'One-time paid' },
  { value: 'free', label: 'Free' },
  { value: 'premium', label: 'Premium included' }
];

const EMPTY_FORM = {
  title: '',
  category_id: '',
  description: '',
  price: '',
  access_type: 'one-time',
  content_url: '',
  is_published: true,
  is_featured: false
};

const PLATFORM_SELLER_NAME = 'polynurse';

const isPlatformSeller = (seller) =>
  seller && String(seller.business_name || '').toLowerCase() === PLATFORM_SELLER_NAME;

export default function AdminMarketplace() {
  const { userProfile, loadingAuth } = useAppContext();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [sellers, setSellers] = useState([]);
  const [purchaseCounts, setPurchaseCounts] = useState({});
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    if (!supabase) {
      setLoading(false);
      setError('UNCONFIGURED');
      return;
    }
    try {
      const [prod, cat, sell, purchases] = await Promise.all([
        supabase
          .from('marketplace_products')
          .select('*, marketplace_sellers(id, business_name, is_verified, verification_status), marketplace_categories(id, name, slug)')
          .order('created_at', { ascending: false }),
        supabase.from('marketplace_categories').select('*').order('sort_order', { ascending: true }),
        supabase.from('marketplace_sellers').select('*').order('business_name', { ascending: true }),
        supabase.from('marketplace_purchases').select('product_id, status')
      ]);
      for (const r of [prod, cat, sell, purchases]) {
        if (r.error) {
          setError('LOAD');
          setLoading(false);
          return;
        }
      }
      setProducts(prod.data || []);
      setCategories(cat.data || []);
      setSellers(sell.data || []);
      const counts = {};
      for (const p of purchases.data || []) {
        if (p.status === 'complete') counts[p.product_id] = (counts[p.product_id] || 0) + 1;
      }
      setPurchaseCounts(counts);
      setLoading(false);
    } catch {
      setError('NETWORK');
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!loadingAuth && userProfile && !userProfile.isAdmin) navigate('/dashboard', { replace: true });
  }, [loadingAuth, userProfile, navigate]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (!showArchived && p.is_archived) return false;
      if (!q) return true;
      return (
        (p.title || '').toLowerCase().includes(q) ||
        (p.marketplace_sellers?.business_name || '').toLowerCase().includes(q)
      );
    });
  }, [products, search, showArchived]);

  const published = products.filter((p) => p.is_published && !p.is_archived).length;
  const owned = Object.values(purchaseCounts).reduce((a, b) => a + b, 0);

  if (loadingAuth) return <LoadingScreen label="Initializing Marketplace Admin…" />;

  if (!userProfile?.isAdmin) return null;

  const openNew = () => {
    const platformSeller = sellers.find((s) => isPlatformSeller(s));
    setEditing({ ...EMPTY_FORM, seller_id: platformSeller?.id ?? '' });
    setFormError(null);
  };

  const openEdit = (p) => {
    setEditing({
      id: p.id,
      seller_id: p.seller_id || '',
      title: p.title || '',
      category_id: p.category_id || '',
      description: p.description || '',
      price: p.price != null ? String(p.price) : '',
      access_type: p.access_type,
      content_url: p.content_url || '',
      is_published: p.is_published,
      is_featured: p.is_featured
    });
    setFormError(null);
  };

  const save = async (e) => {
    e.preventDefault();
    setFormError(null);
    if (!supabase) { setFormError('UNCONFIGURED'); return; }
    const f = editing;
    const title = (f.title || '').trim();
    if (!title) { setFormError('TITLE'); return; }
    if (!f.seller_id) { setFormError('SELLER'); return; }
    const price = Number(f.price);
    if (!Number.isFinite(price) || price < 0) { setFormError('PRICE'); return; }
    if (f.access_type === 'one-time' && price <= 0) { setFormError('PRICE_NEEDED'); return; }

    const categoryId = f.category_id ? Number(f.category_id) : null;
    const contentUrl = (f.content_url || '').trim();
    const payload = {
      seller_id: Number(f.seller_id),
      category_id: categoryId,
      title,
      description: (f.description || '').trim(),
      price,
      access_type: f.access_type,
      content_url: contentUrl && /^https?:\/\//i.test(contentUrl) ? contentUrl : null,
      is_published: !!f.is_published,
      is_featured: !!f.is_featured
    };

    setSaving(true);
    try {
      const res = f.id
        ? await supabase.from('marketplace_products').update(payload).eq('id', f.id)
        : await supabase.from('marketplace_products').insert({ ...payload, slug: slugFor(title) }).select().maybeSingle();
      if (res.error) {
        setFormError('WRITE');
      } else {
        setEditing(null);
        setNotice(f.id ? 'Product updated.' : 'Product created.');
        load();
      }
    } catch {
      setFormError('NETWORK');
    } finally {
      setSaving(false);
    }
  };

  const setFlag = async (p, patch, doneLabel) => {
    const { error } = await supabase.from('marketplace_products').update(patch).eq('id', p.id);
    if (error) {
      setNotice('Could not update product: ' + error.message);
    } else {
      setNotice(doneLabel);
      load();
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28 space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-teal-600/10 text-teal-600 flex items-center justify-center">
            <Shield size={22} />
          </div>
          <div>
            <h1 className="text-xl font-black text-slate-900 dark:text-white">Marketplace Admin</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">PolyNurse first-party products</p>
          </div>
        </div>
        <button onClick={() => navigate('/dashboard')} className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500">
          <ArrowLeft size={18} />
        </button>
      </header>

      {error && (
        <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-600 dark:text-red-400">
              {error === 'UNCONFIGURED' ? 'Admin console is not configured' : error === 'NETWORK' ? 'Could not reach the service' : 'Could not load marketplace data'}
            </p>
            <button onClick={() => { setLoading(true); load(); }} className="mt-2 inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-red-600 dark:text-red-400">
              <RefreshCw size={13} /> Retry
            </button>
          </div>
        </div>
      )}

      {!error && (loading || !products) && (
        <div className="py-16 flex items-center justify-center text-slate-400">
          <Loader2 size={26} className="animate-spin" />
        </div>
      )}

      {!error && !loading && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Products" value={products.length} />
            <StatCard label="Live" value={published} tone="teal" />
            <StatCard label="Sold" value={owned} tone="teal" />
          </div>

          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`px-3 py-2.5 rounded-xl border text-xs font-bold whitespace-nowrap transition-colors ${
                showArchived
                  ? 'bg-teal-600 border-teal-600 text-white'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400'
              }`}
            >
              {showArchived ? 'All' : 'Live only'}
            </button>
            <button onClick={openNew} className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black uppercase tracking-widest transition-colors">
              <Plus size={15} /> New
            </button>
          </div>

          {notice && (
            <div className="rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/20 p-3 flex items-center justify-between gap-3">
              <p className="text-xs font-bold text-teal-700 dark:text-teal-300 inline-flex items-center gap-1.5">
                <CheckCircle2 size={14} /> {notice}
              </p>
              <button onClick={() => setNotice(null)} className="text-teal-500"><X size={14} /></button>
            </div>
          )}

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 py-12 px-6 text-center">
              <FileText size={30} className="mx-auto text-slate-300 dark:text-slate-600 mb-3" />
              <p className="font-bold text-slate-600 dark:text-slate-300">{products.length === 0 ? 'No products yet' : 'No products match'}</p>
              <p className="text-xs text-slate-400 mt-1">
                {products.length === 0 ? 'Create your first first-party product with “New”.' : 'Try a different search or toggle the scope.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((p) => {
                const platform = isPlatformSeller(p.marketplace_sellers);
                return (
                  <div key={p.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 truncate">{p.title}</h3>
                          {p.is_featured && <Star size={13} className="text-amber-400 fill-amber-400 shrink-0" />}
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-0.5 truncate">
                          {p.marketplace_sellers?.business_name || 'No seller'} · {p.marketplace_categories?.name || 'Uncategorised'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <RowFlag on={p.is_published} title="Published">
                          <Eye size={14} />
                        </RowFlag>
                        <RowFlag on={p.access_type !== 'one-time'} title={p.access_type === 'free' ? 'Free' : 'Premium'}>
                          <FileText size={14} />
                        </RowFlag>
                        <RowFlag on={p.is_archived} title="Archived">
                          <EyeOff size={14} />
                        </RowFlag>
                      </div>
                    </div>

                    <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/60">
                      <div className="flex items-center gap-3 text-xs">
                        <span className="font-black text-slate-900 dark:text-white">
                          {p.access_type === 'one-time' ? `₦${(Number(p.price) || 0).toLocaleString()}` : p.access_type === 'free' ? 'Free' : 'Premium'}
                        </span>
                        {platform ? (
                          <span className="inline-flex items-center gap-1 text-teal-600 dark:text-teal-400 font-bold text-[10px]"><Shield size={11} /> First-party</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold text-[10px]"><Info size={11} /> Informational</span>
                        )}
                        <span className="text-slate-400 font-bold">{purchaseCounts[p.id] || 0} owned</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {(!p.is_published || p.is_archived) && (
                          <button
                            onClick={() => setFlag(p, { is_published: true, is_archived: false }, 'Product published.')}
                            className="p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-emerald-600"
                            title="Publish"
                          >
                            <Eye size={15} />
                          </button>
                        )}
                        {p.is_published && !p.is_archived && (
                          <button
                            onClick={() => setFlag(p, { is_published: false }, 'Product unpublished.')}
                            className="p-2 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600"
                            title="Unpublish"
                          >
                            <EyeOff size={15} />
                          </button>
                        )}
                        {!p.is_archived && (
                          <button
                            onClick={() => setFlag(p, { is_archived: true, is_published: false }, 'Product archived.')}
                            className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500"
                            title="Archive"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => { openEdit(p); setFormError(null); }}
                          className="px-3 py-2 rounded-lg text-[11px] font-black uppercase tracking-widest text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-3">Categories ({categories.length})</h3>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700/60 text-xs font-bold text-slate-600 dark:text-slate-300">
                  {c.name}
                  <span className="text-slate-400 text-[10px]">{products.filter((p) => p.category_id === c.id && !p.is_archived).length}</span>
                </span>
              ))}
            </div>
            <p className="text-[10px] text-slate-400 mt-3 leading-relaxed">
              First-party status is driven by the product's seller being <span className="font-bold text-teal-600 dark:text-teal-400">PolyNurse</span> (seller id platform). Listings attached to other sellers are informational-only and can never be purchased.
            </p>
          </div>
        </>
      )}

      {editing && (
        <EditorModal
          form={editing}
          categories={categories}
          sellers={sellers}
          saving={saving}
          formError={formError}
          onField={(patch) => { setEditing((f) => ({ ...f, ...patch })); setFormError(null); }}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

const LoadingScreen = ({ label }) => (
  <div className="min-h-screen flex flex-col items-center justify-center gap-3 text-slate-400">
    <Loader2 size={28} className="animate-spin" />
    <p className="text-xs font-black uppercase tracking-widest">{label}</p>
  </div>
);

const StatCard = ({ label, value, tone }) => (
  <div className={`rounded-2xl border bg-white dark:bg-slate-800 p-4 text-center border-slate-100 dark:border-slate-700 ${tone ? 'text-teal-600' : 'text-slate-900 dark:text-white'}`}>
    <p className="text-2xl font-black">{value}</p>
    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mt-0.5">{label}</p>
  </div>
);

const RowFlag = ({ on, title, children }) => (
  <span title={title} className={`w-8 h-8 rounded-lg flex items-center justify-center border ${on ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 border-teal-200 dark:border-teal-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-300 dark:text-slate-600 border-slate-200 dark:border-slate-700'}`}>
    {children}
  </span>
);

const slugFor = (title) => {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base}-${Date.now().toString(36)}`;
};

const EditorModal = ({ form, categories, sellers, saving, formError, onField, onClose, onSave }) => {
  const platformSeller = sellers.find((s) => isPlatformSeller(s));
  const errText = {
    UNCONFIGURED: 'Admin console is not configured.',
    TITLE: 'A title is required.',
    SELLER: 'Pick a seller for this product.',
    PRICE: 'Enter a valid price (0 or more).',
    PRICE_NEEDED: 'One-time paid products need a price greater than 0.',
    WRITE: 'The database refused this change. Check the fields and try again.',
    NETWORK: 'Could not reach the database. Try again.'
  }[formError];

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-t-[2rem] p-6 pb-8 shadow-2xl">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-black text-slate-900 dark:text-white">{form.id ? 'Edit product' : 'New product'}</h2>
          <button onClick={onClose} aria-label="Close" className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={onSave} className="space-y-4">
          <Field label="Title">
            <input
              value={form.title}
              onChange={(e) => onField({ title: e.target.value })}
              placeholder="e.g. PolyNurse NCLEX Rapid Review Pack"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select
                value={form.category_id}
                onChange={(e) => onField({ category_id: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Seller">
              <select
                value={form.seller_id}
                onChange={(e) => onField({ seller_id: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="">Pick a seller…</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.business_name}{isPlatformSeller(s) ? ' (PolyNurse)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Description">
            <textarea
              value={form.description}
              onChange={(e) => onField({ description: e.target.value })}
              rows={3}
              placeholder="What the student gets, format, coverage…"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Access">
              <select
                value={form.access_type}
                onChange={(e) => onField({ access_type: e.target.value })}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {ACCESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label={form.access_type === 'one-time' ? 'Price (₦)' : 'Price (₦, informational)'}>
              <input
                type="number" min="0" step="0.01"
                value={form.price}
                onChange={(e) => onField({ price: e.target.value })}
                placeholder="0"
                className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </Field>
          </div>

          <Field label="Content URL (opened by buyers)">
            <input
              value={form.content_url}
              onChange={(e) => onField({ content_url: e.target.value })}
              placeholder="https://…"
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </Field>

          <div className="flex flex-wrap gap-3">
            <Toggle
              label="Published"
              on={form.is_published}
              onClick={() => onField({ is_published: !form.is_published })}
            />
            <Toggle
              label="Featured"
              on={form.is_featured}
              onClick={() => onField({ is_featured: !form.is_featured })}
            />
          </div>

          {form.access_type === 'one-time' && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-start gap-2">
              <Info size={15} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                Price is set by you and charged exactly via Paystack. Never apply an unverified “before” price or discount percentage.
              </p>
            </div>
          )}
          {form.seller_id && sellers.find((s) => String(s.id) === String(form.seller_id)) && !isPlatformSeller(sellers.find((s) => String(s.id) === String(form.seller_id))) && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 flex items-start gap-2">
              <Info size={15} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-relaxed">
                This seller is not PolyNurse — the product is an informational listing only. {"It won't be purchasable."}
              </p>
            </div>
          )}
          {platformSeller && <p className="text-[10px] text-slate-400">First-party products are attached to “{platformSeller.business_name}”.</p>}

          {errText && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-2">
              <AlertCircle size={15} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs font-bold text-red-600 dark:text-red-400">{errText}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full inline-flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-bold py-4 rounded-xl transition-colors disabled:opacity-60"
          >
            {saving ? <><Loader2 size={18} className="animate-spin" /> Saving…</> : <><Save size={18} /> {form.id ? 'Save changes' : 'Create product'}</>}
          </button>
        </form>
      </div>
    </div>
  );
};

const Field = ({ label, children }) => (
  <label className="block">
    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">{label}</span>
    {children}
  </label>
);

const Toggle = ({ label, on, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-xs font-bold transition-colors ${
      on
        ? 'bg-teal-600 border-teal-600 text-white'
        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'
    }`}
  >
    {on ? <CheckCircle2 size={14} /> : <X size={14} />} {label}
  </button>
);