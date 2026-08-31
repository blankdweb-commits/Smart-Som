import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { supabase } from '../utils/supabase';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2, Send, CheckCircle, Clock, ChevronDown, TrendingUp, X
} from 'lucide-react';

// VOTING (user-requested polls, admin-approved).
// Learners can vote on live polls and REQUEST new polls. Requests are stored
// for admin approval — they do not go live until an admin approves them.
const POLL_TYPES = [
  { label: 'Study topic', value: 'study_topic' },
  { label: 'Feature wish', value: 'feature' },
  { label: 'Subject focus', value: 'subject_focus' }
];

export default function Voting() {
  const { session, userProfile } = useAppContext();

  // Live polls (approved + live)
  // Admin can view/handle pending requests.
  const [livePolls, setLivePolls] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [selected, setSelected] = useState({}); // poll_id -> option_id
  const [votedIds, setVotedIds] = useState({}); // poll_id -> true (has voted)
  const [expanded, setExpanded] = useState({});
  const [loading, setLoading] = useState(true);

  // Request form
  const [showRequest, setShowRequest] = useState(false);
  const [req, setReq] = useState({ question: '', type: 'study_topic', options: ['', ''] });
  const [requested, setRequested] = useState(false);
  const [requestStatus, setRequestStatus] = useState(null);

  const isAdmin = !!userProfile.isAdmin;

  const loadPolls = useCallback(async () => {
    if (!supabase || !session) return;
    setLoading(true);
    try {
      const [liveRes, pendingRes] = await Promise.all([
        supabase
          .from('voting_polls')
          .select('*, voting_options(id, text, sort_order), voting_responses(option_id)')
          .eq('status', 'active')
          .order('created_at', { ascending: false }),
        isAdmin
          ? supabase
              .from('voting_polls')
              .select('*, voting_options(id, text)')
              .eq('status', 'pending')
              .order('created_at', { ascending: false })
          : Promise.resolve({ data: [] })
      ]);
      setLivePolls(liveRes.data || []);
      const myVoteMap = {};
      (liveRes.data || []).forEach(p => {
        if (Array.isArray(p.voting_responses) && p.voting_responses.length > 0) {
          myVoteMap[p.id] = true;
        }
      });
      setVotedIds(myVoteMap);
      setPendingRequests(pendingRes.data || []);
    } catch (err) {
      console.warn('Voting load failed:', err.message);
    } finally {
      setLoading(false);
    }
  }, [supabase, session, isAdmin]);

  useEffect(() => {
    loadPolls();
  }, [loadPolls]);

  const castVote = async (poll) => {
    const optionId = selected[poll.id];
    if (!optionId || votedIds[poll.id]) return;
    try {
      const { error } = await supabase.rpc('cast_vote', {
        p_user_id: session.user.id,
        p_poll_id: poll.id,
        p_option_id: optionId
      });
      if (error) throw error;
      setVotedIds(prev => ({ ...prev, [poll.id]: true }));
      await loadPolls();
    } catch (err) {
      console.warn('Vote failed:', err.message);
    }
  };

  const addOption = () => setReq(r => ({ ...r, options: [...r.options, ''] }));
  const updateOption = (i, v) =>
    setReq(r => ({ ...r, options: r.options.map((o, j) => (j === i ? v : o)) }));

  const submitRequest = async () => {
    const question = req.question.trim();
    const options = req.options.map(o => o.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      setRequestStatus({ ok: false, msg: 'Add a question and at least two options.' });
      return;
    }
    try {
      const { data, error } = await supabase
        .from('voting_polls')
        .insert({ creator_id: session.user.id, question, type: req.type, status: 'pending' })
        .select('id')
        .single();
      if (error) throw error;
      // Insert options for the requested poll
      await supabase.from('voting_options').insert(
        options.map((opt, i) => ({ poll_id: data.id, text: opt, sort_order: i }))
      );
      setRequested(true);
      setRequestStatus({ ok: true, msg: 'Your poll request has been sent for review.' });
      setShowRequest(false);
    } catch (err) {
      console.warn('Request failed:', err.message);
      setRequestStatus({ ok: false, msg: 'Could not submit request. Please try again.' });
    }
  };

  const approveRequest = async (pollId, approve) => {
    try {
      await supabase
        .from('voting_polls')
        .update({ status: approve ? 'active' : 'closed' })
        .eq('id', pollId);
      await loadPolls();
    } catch (err) {
      console.warn('Approval failed:', err.message);
    }
  };

  const maxCount = (poll) =>
    Math.max(1, ...(poll.voting_options || []).map(o =>
      (poll.voting_responses || []).filter(r => r.option_id === o.id).length
    ));

  // Tally per option from the response rows.
  const optionVotes = (poll, optId) =>
    (poll.voting_responses || []).filter(r => r.option_id === optId).length;

  return (
    <div className="max-w-md mx-auto px-4 pt-6 pb-28">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <BarChart2 className="text-teal-600" /> Voting
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Have your say on what matters</p>
        </div>
        <div className="bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-xs font-semibold px-3 py-1.5 rounded-full whitespace-nowrap">
          {livePolls.filter(p => !votedIds[p.id]).length} open
        </div>
      </div>

      <button
        onClick={() => setShowRequest(true)}
        className="w-full mb-6 flex items-center justify-center gap-2 bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3.5 rounded-xl transition-colors shadow-sm"
      >
        <Send className="w-4 h-4" />
        Request a new poll
      </button>

      {/* Request modal */}
      <AnimatePresence>
        {showRequest && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="Xed inset-0 bg-black/50 z-50 flex items-end justify-center"
            onClick={() => setShowRequest(false)}
          >
            <motion.div
              initial={{ y: 60 }}
              animate={{ y: 0 }}
              exit={{ y: 60 }}
              transition={{ type: 'spring', damping: 26, stiffness: 300 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-3xl p-6 pb-8 max-h-[85vh] overflow-y-auto"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">Request a poll</h2>
                <button
                  onClick={() => setShowRequest(false)}
                  className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Your request goes to our team for approval before it goes live.
              </p>

              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Question</label>
              <input
                value={req.question}
                onChange={e => setReq(r => ({ ...r, question: e.target.value }))}
                placeholder="e.g. Which topic should we focus on next?"
                className="w-full mb-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-sm text-slate-800 dark:text-slate-100"
              />

              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Type</label>
              <div className="flex flex-wrap gap-2 mb-4">
                {POLL_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setReq(r => ({ ...r, type: t.value }))}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      req.type === t.value
                        ? 'bg-teal-600 text-white border-teal-600'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Options</label>
              {req.options.map((opt, i) => (
                <input
                  key={i}
                  value={opt}
                  onChange={e => updateOption(i, e.target.value)}
                  placeholder={`Option ${i + 1}`}
                  className="w-full mb-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-sm text-slate-800 dark:text-slate-100"
                />
              ))}
              {req.options.length < 4 && (
                <button onClick={addOption} className="text-xs font-medium text-teal-600 mb-4">
                  + Add option
                </button>
              )}

              {requestStatus && (
                <p className={`text-xs mb-3 ${requestStatus.ok ? 'text-teal-600' : 'text-red-500'}`}>
                  {requestStatus.msg}
                </p>
              )}

              <button
                onClick={submitRequest}
                className="w-full bg-teal-600 hover:bg-teal-500 text-white font-semibold py-3 rounded-xl transition-colors"
              >
                Submit for review
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {requested && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 rounded-2xl bg-teal-50 dark:bg-teal-900/30 border border-teal-200 dark:border-teal-800 p-4 flex items-start gap-3"
        >
          <CheckCircle className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-teal-800 dark:text-teal-200">Request sent</p>
            <p className="text-xs text-teal-700 dark:text-teal-300">
              Our team will review your poll. You'll see it here once it's live.
            </p>
          </div>
        </motion.div>
      )}

      {/* Admin: pending approvals */}
      {isAdmin && pendingRequests.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
            <Clock className="text-amber-500" /> Awaiting approval ({pendingRequests.length})
          </h2>
          <div className="space-y-3">
            {pendingRequests.map(p => (
              <div key={p.id} className="rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-4">
                <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm mb-1">{p.question}</h3>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {p.voting_options?.map(o => (
                    <span key={o.id} className="text-xs bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-1 rounded-full">
                      {o.text}
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => approveRequest(p.id, true)}
                    className="flex-1 bg-teal-600 hover:bg-teal-500 text-white font-semibold py-2 rounded-lg text-sm"
                  >
                    Approve & go live
                  </button>
                  <button
                    onClick={() => approveRequest(p.id, false)}
                    className="flex-1 border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-semibold py-2 rounded-lg text-sm"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Live polls */}
      <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">
        <TrendingUp className="text-teal-600" /> Live polls
      </h2>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 animate-pulse">
              <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-2/3 mb-3" />
              <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-full mb-2" />
              <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded w-5/6" />
            </div>
          ))}
        </div>
      ) : livePolls.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">No live polls right now.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {livePolls.map(poll => {
            const open = expanded[poll.id] || !votedIds[poll.id];
            const myVote = votedIds[poll.id];
            return (
              <div key={poll.id} className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-snug">{poll.question}</h3>
                  <button
                    onClick={() => setExpanded(e => ({ ...e, [poll.id]: !e[poll.id] }))}
                    className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
                  >
                    <ChevronDown className="w-4 h-4 text-slate-400" />
                  </button>
                </div>

                {open ? (
                  <div className="space-y-2">
                    {(poll.voting_options || []).map(opt => {
                      const votes = optionVotes(poll, opt.id);
                      const pct = myVote && votes > 0 ? Math.round((votes / maxCount(poll)) * 100) : 0;
                      const isSel = selected[poll.id] === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => !myVote && setSelected(s => ({ ...s, [poll.id]: opt.id }))}
                          disabled={myVote}
                          className={`w-full text-left rounded-xl border p-3 text-sm transition-colors ${
                            myVote
                              ? 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                              : isSel
                                ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30'
                                : 'border-slate-200 dark:border-slate-700 hover:border-teal-400 bg-white dark:bg-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-slate-700 dark:text-slate-200">{opt.text}</span>
                            {myVote && <span className="text-xs text-slate-400 font-medium">{votes}</span>}
                          </div>
                          {myVote && (
                            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                              <div className="h-full bg-teal-500 rounded-full" style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </button>
                      );
                    })}
                    {!myVote && (
                      <button
                        onClick={() => castVote(poll)}
                        disabled={!selected[poll.id]}
                        className="w-full bg-teal-600 disabled:opacity-40 hover:bg-teal-500 text-white font-semibold py-2.5 rounded-xl text-sm mt-1 transition-colors"
                      >
                        Cast vote
                      </button>
                    )}
                    {myVote && <p className="text-xs text-slate-400 text-center pt-1">Thanks for voting!</p>}
                  </div>
                ) : (
                  <div className="text-xs text-slate-400 flex items-center justify-between">
                    <span>{myVote ? 'You voted' : 'Tap to vote'}</span>
                    <span>{(poll.voting_options || []).reduce((s, o) => s + optionVotes(poll, o.id), 0)} votes</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
