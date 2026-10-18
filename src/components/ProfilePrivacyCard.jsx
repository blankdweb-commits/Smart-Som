import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Loader2, RefreshCw, User } from '../components/Icons';
import { supabase } from '../utils/supabase';

/**
 * ProfilePrivacyCard — the two consents and the view list.
 *
 * WHY THIS CARD EXISTS. migration-v91 shipped the whole profile-views feature
 * on the server: the table, the two independent consents, the record RPC, the
 * list RPC, the count RPC, and zero client policies on the table. But NOTHING
 * called any of it. `profile_view_record` had no caller, the privacy toggles
 * had no UI, and the view list had nowhere to appear — so the feature recorded
 * nothing and showed nothing. It was the same failure as `friend_list()`:
 * a server built in full, and a client that never asked.
 *
 * THE TWO SWITCHES ARE INDEPENDENT, and this card is where that becomes
 * visible:
 *
 *   "Show my profile views"   - may anyone record that they opened my
 *                               profile at all. Off = nothing is recorded,
 *                               not even an anonymous count.
 *   "Share who viewed me"     - may a visitor be NAMED in my list. A visitor
 *                               who has not opted in still counts; they are
 *                               shown as "A scholar".
 *
 * So a scholar can be discoverable without being nameable, which is the whole
 * point of separating them.
 *
 * Everything here is server-authoritative. The toggles are written through
 * profile_privacy_set(), and the list comes from profile_view_list(), which
 * re-checks the visitor's own consent before naming them. The client never
 * decides what is visible.
 */

const fmtWhen = (iso) => {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(t).toLocaleDateString();
};

const Switch = ({ on, busy, onToggle, label, hint, id }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    aria-busy={busy ? 'true' : 'false'}
    disabled={busy}
    onClick={onToggle}
    className="w-full flex items-center justify-between gap-3 py-2.5 text-left group disabled:opacity-60"
  >
    <span className="min-w-0">
      <span className="block text-xs font-bold text-slate-600 dark:text-slate-300">{label}</span>
      {hint && <span className="block text-[10px] font-medium text-slate-400 leading-snug mt-0.5">{hint}</span>}
    </span>
    {/* `relative` is required: the knob is absolutely positioned inside this
        track, and without it the knob escapes the switch. */}
    <span className={`shrink-0 relative w-10 h-6 rounded-full transition-colors ${on ? 'bg-polynurse-600' : 'bg-slate-300 dark:bg-slate-600'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </span>
  </button>
);

const ProfilePrivacyCard = () => {
  const [privacy, setPrivacy] = useState({ showProfileViews: false, shareVisitorIdentity: false });
  const [views, setViews] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [p, l] = await Promise.all([
        supabase.rpc('profile_privacy_get'),
        supabase.rpc('profile_view_list', { p_limit: 10, p_offset: 0 }),
      ]);
      if (p?.error) throw p.error;
      if (l?.error) throw l.error;
      if (p?.data && p.data.ok !== false) {
        setPrivacy({
          showProfileViews: p.data.showProfileViews === true,
          shareVisitorIdentity: p.data.shareVisitorIdentity === true,
        });
      }
      if (l?.data && l.data.ok !== false) {
        setViews(Array.isArray(l.data.views) ? l.data.views : []);
        setTotal(Number(l.data.total || 0));
      }
    } catch (err) {
      console.warn('[profile-privacy] load:', err?.message);
      setError('Could not load your profile privacy settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // One switch at a time, so the other is never clobbered: the RPC treats a
  // null parameter as "leave this one alone".
  const setSwitch = useCallback(async (key, value) => {
    setBusy(key);
    setError(null);
    const params = key === 'showProfileViews'
      ? { p_show_profile_views: value, p_share_visitor_identity: null }
      : { p_show_profile_views: null, p_share_visitor_identity: value };
    const { data, error: rpcError } = await supabase.rpc('profile_privacy_set', params);
    setBusy(null);
    if (rpcError || !data || data.ok === false) {
      setError(rpcError?.message || 'That change could not be saved.');
      return;
    }
    setPrivacy({
      showProfileViews: data.showProfileViews === true,
      shareVisitorIdentity: data.shareVisitorIdentity === true,
    });
    // The list only changes when recording is switched on, so refresh it.
    load();
  }, [load]);

  return (
    <div className="bg-white dark:bg-slate-800 rounded-[2rem] border border-slate-100 dark:border-slate-700 p-6 sm:p-8 shadow-clinical">
      <div className="flex items-center justify-between gap-3 mb-5">
        <h2 className="text-sm font-black uppercase tracking-widest text-slate-400">Profile Privacy</h2>
        <button
          onClick={load}
          disabled={loading}
          aria-label="Refresh profile privacy"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition disabled:opacity-40"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        </button>
      </div>

      {error && (
        <p className="mb-3 text-[11px] font-bold text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="divide-y divide-slate-100 dark:divide-slate-700/60">
        <Switch
          id="pref-show-views"
          on={privacy.showProfileViews}
          busy={busy === 'showProfileViews'}
          onToggle={() => setSwitch('showProfileViews', !privacy.showProfileViews)}
          label="Show my profile views"
          hint="Off means nobody's visit to your profile is recorded at all — not even a count."
        />
        <Switch
          id="pref-share-viewers"
          on={privacy.shareVisitorIdentity}
          busy={busy === 'shareVisitorIdentity'}
          onToggle={() => setSwitch('shareVisitorIdentity', !privacy.shareVisitorIdentity)}
          label="Share who viewed me"
          hint="A visitor who has not opted in still counts, but is listed as a scholar without a name."
        />
      </div>

      <div className="mt-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
          Recent profile views {total > 0 ? `(${total})` : ''}
        </p>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 size={20} className="animate-spin text-polynurse-600" />
          </div>
        ) : views.length === 0 ? (
          <p className="text-xs font-bold text-slate-400">
            {privacy.showProfileViews
              ? 'Nobody has opened your profile yet.'
              : 'Profile views are switched off, so nothing is being recorded.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {views.map((v) => (
              <li
                key={v.userId}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 dark:border-slate-700 px-3 py-2.5"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {v.identified
                    ? <User size={14} className="shrink-0 text-polynurse-600" />
                    : <EyeOff size={14} className="shrink-0 text-slate-400" />}
                  <span className="min-w-0">
                    <span className="block text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                      {v.identified ? (v.name || 'A scholar') : 'A scholar'}
                    </span>
                    {v.identified && (
                      <span className="block text-[10px] font-medium text-slate-400">
                        viewed you {fmtWhen(v.viewedAt)}{Number(v.viewCount) > 1 ? ` · ${v.viewCount} times` : ''}
                      </span>
                    )}
                  </span>
                </span>
                {!v.identified && (
                  <span className="shrink-0 text-[10px] font-bold text-slate-400">
                    {fmtWhen(v.viewedAt)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-4 text-[10px] font-bold text-slate-400 leading-snug">
        <Eye size={11} className="inline mr-1 -mt-0.5" />
        Profile views count visits to your profile. They are never sold, never
        used to rank you, and never visible to anyone but you.
      </p>
    </div>
  );
};

export default ProfilePrivacyCard;
