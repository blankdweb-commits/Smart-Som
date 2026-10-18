import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
import { authHeaders } from '../utils/apiHeaders';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  Star, Send, MessageSquare, Inbox, CheckCircle, Clock, AlertCircle
} from 'lucide-react';

// REVIEWS & SUGGESTIONS.
// Learners can submit app reviews and feature suggestions. Sent via the
// /api/feedback endpoint (server-verified auth) into feedback_submissions.
// Admin can view/reply and mark resolved from a dedicated admin section.
const CATEGORIES = [
  { value: 'app_review', label: 'App review', icon: Star },
  { value: 'feature_suggestion', label: 'Feature idea', icon: MessageSquare }
];

export default function Reviews() {
  const { session, userProfile } = useAppContext();
  const isAdmin = !!userProfile.isAdmin;

  const [tab, setTab] = useState('submit');
  const [category, setCategory] = useState('app_review');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(null);

  // Admin view state
  const [allSubmissions, setAllSubmissions] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [statusError, setStatusError] = useState('');

  const loadAll = useCallback(async () => {
    if (!supabase || !session) return;
    setLoading(true);
    // supabase-js RESOLVES with { error } rather than throwing, so the old
    // try/catch around this could never fire: every failed admin load was
    // silent and the inbox rendered as permanently empty.
    const { data, error } = await supabase
      .from('feedback_submissions')
      .select('*, profiles(identity_name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      setLoadError('Could not load the feedback inbox.');
      setAllSubmissions([]);
    } else {
      setLoadError('');
      setAllSubmissions(data || []);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (isAdmin) loadAll();
  }, [isAdmin, loadAll]);

  const submit = async () => {
    if (!message.trim()) { setSent({ ok: false, msg: 'Please enter a message.' }); return; }
    if (category === 'app_review' && rating === 0) {
      setSent({ ok: false, msg: 'Please select a star rating.' });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: authHeaders(session, { json: true }),
        body: JSON.stringify({ type: category, message: message.trim() })
      });
      const body = await res.json();
      if (res.ok) {
        setSent({ ok: true, msg: 'Thanks for your feedback! Our team will review it.' });
        setMessage('');
        setRating(0);
      } else {
        setSent({ ok: false, msg: body.error || 'Could not send. Please try again.' });
      }
    } catch (err) {
      console.warn('Submit feedback failed:', err.message);
      setSent({ ok: false, msg: 'Network issue. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id, status) => {
    const { error } = await supabase.from('feedback_submissions').update({ status }).eq('id', id);
    // The column carries a CHECK constraint of ('open','reviewing','resolved',
    // 'ignored'). The old UI wrote 'new' and 'archived', which are NOT in that
    // list, so every write was rejected by Postgres - while the RLS-select-own
    // policy made the failure invisible. Hence the vocabulary below.
    if (error) setStatusError(error.message || 'Could not update that item.');
    else setStatusError('');
    loadAll();
  };

  const filtered = allSubmissions.filter(s =>
    filter === 'all' ? true : s.status === filter
  );

  // These keys MUST match feedback_submissions_status_check in
  // migration-v10-upgrade.sql: ('open','reviewing','resolved','ignored').
  // 'new' and 'archived' were never legal values, which is why the Inbox badge
  // was permanently 0 and two of the four filter chips were always empty.
  const statusMeta = {
    open: { label: 'Open', color: 'bg-blue-100 text-blue-700', icon: Clock },
    reviewing: { label: 'Reviewing', color: 'bg-amber-100 text-amber-700', icon: AlertCircle },
    resolved: { label: 'Resolved', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
    ignored: { label: 'Ignored', color: 'bg-slate-100 text-slate-500', icon: Inbox }
  };

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Reviews & Suggestions</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Help shape Polynurse Exam Center for you.</p>
      </div>

      {isAdmin && (
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl mb-5">
          <button
            onClick={() => setTab('submit')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${tab === 'submit' ? 'bg-white dark:bg-slate-700 text-teal-600 shadow-sm' : 'text-slate-500'}`}
          >
            Submit
          </button>
          <button
            onClick={() => setTab('inbox')}
            className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${tab === 'inbox' ? 'bg-white dark:bg-slate-700 text-teal-600 shadow-sm' : 'text-slate-500'}`}
          >
            Inbox ({allSubmissions.filter(s => s.status === 'open').length})
          </button>
        </div>
      )}

      {tab === 'submit' ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5"
        >
          <div className="flex flex-wrap gap-2 mb-5">
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                onClick={() => setCategory(c.value)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  category === c.value
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <c.icon className="w-3.5 h-3.5" /> {c.label}
              </button>
            ))}
          </div>

          {category === 'app_review' && (
            <div className="mb-5">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">How would you rate Polynurse Exam Center?</p>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4, 5].map(star => (
                  <button
                    key={star}
                    onClick={() => setRating(star)}
                    className={`text-3xl transition-colors ${star <= rating ? 'text-amber-400' : 'text-slate-200 dark:text-slate-700'}`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">
            Your message
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={4}
            placeholder={category === 'feature_suggestion' ? 'Describe the feature you\'d love to see…' : 'Tell us what you think…'}
            className="w-full mb-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm text-slate-800 dark:text-slate-100 resize-none"
          />

          {sent && (
            <AnimatePresence>
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`text-xs mb-3 flex items-center gap-1.5 ${sent.ok ? 'text-teal-600' : 'text-red-500'}`}
              >
                {sent.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                {sent.msg}
              </motion.p>
            </AnimatePresence>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-semibold py-3.5 rounded-xl transition-colors"
          >
            <Send className="w-4 h-4" />
            {submitting ? 'Sending…' : 'Submit feedback'}
          </button>
        </motion.div>
      ) : (
        <div>
          {statusError && (
            <p className="mb-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs font-bold text-red-600 dark:text-red-400">
              {statusError}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mb-4">
            {['all', 'open', 'reviewing', 'resolved', 'ignored'].map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium border capitalize ${
                  filter === f
                    ? 'bg-teal-600 text-white border-teal-600'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500'
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          {loadError ? (
            <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-4 text-center">
              <p className="text-sm font-bold text-red-600 dark:text-red-400">{loadError}</p>
              <button
                onClick={loadAll}
                className="mt-3 px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-bold uppercase tracking-widest"
              >
                Try again
              </button>
            </div>
          ) : loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 animate-pulse">
                  <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/3 mb-2" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-full" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">No {filter !== 'all' ? filter : ''} submissions.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(s => {
                const meta = statusMeta[s.status] || statusMeta.open;
                return (
                  <div key={s.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${meta.color}`}>
                          {meta.label}
                        </span>
                        <span className="text-[10px] text-slate-400">{s.type?.replace('_', ' ')}</span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {new Date(s.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-200 mb-1">{s.message}</p>
                    <p className="text-[10px] text-slate-400 mb-2">
                      {s.profiles?.identity_name || 'Anonymous'}
                    </p>
                    {s.status !== 'resolved' && (
                      <button
                        onClick={() => updateStatus(s.id, 'resolved')}
                        className="text-xs font-semibold text-teal-600"
                      >
                        Mark resolved
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
