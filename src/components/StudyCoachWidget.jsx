import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { authHeaders } from '../utils/apiHeaders';
import { Sparkles, Send, Loader2 } from 'lucide-react';

// Personal Study Coach — powered by Gemini, personalized with the learner's
// real in-app data (accuracy, streak, weak topics) fetched server-side.
// The coach never controls answers, scores, unlocks, payments or premium.
const QUICK_ACTIONS = [
  { label: 'Teach me', intent: 'teach' },
  { label: 'Give me practice', intent: 'practice' },
  { label: 'Explain my mistakes', intent: 'mistakes' },
  { label: 'Plan my day', intent: 'plan' }
];

export default function StudyCoachWidget({ questionContext }) {
  const { session } = useAppContext();
  const [userText, setUserText] = useState('');
  const [reply, setReply] = useState(null); // { coach, options, degraded }
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(null);

  const ask = async (intent, extra = {}) => {
    if (!session) { setError('Sign in to use the coach.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/study-coach', {
        method: 'POST',
        headers: authHeaders(session, { json: true }),
        body: JSON.stringify({ intent, ...extra })
      });
      const body = await res.json();
      if (res.ok && body?.coach) {
        setReply({ coach: body.coach, options: body.options || [], degraded: body.degraded });
      } else {
        setError(body?.error || 'Could not reach the coach.');
      }
    } catch {
      setError('Network issue. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const sendChat = () => {
    const text = userText.trim();
    if (!text) return;
    ask('chat', { userQuestion: text });
    setUserText('');
  };

  const teach = () => {
    if (questionContext) ask('teach', questionContext);
    else ask('teach');
  };

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden shadow-soft">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">Study Coach</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Your personal study mentor</p>
          </div>
        </div>
        <span className="text-slate-400">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="bg-slate-50 dark:bg-slate-900/60 rounded-2xl p-4 min-h-[80px]">
            {loading ? (
              <div className="flex items-center gap-2 text-slate-500 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
              </div>
            ) : error ? (
              <p className="text-red-500 text-sm">{error}</p>
            ) : reply ? (
              <div>
                <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-line leading-relaxed">
                  {reply.coach}
                </p>
                {reply.degraded && (
                  <p className="text-[10px] text-amber-500 mt-2">Basic response (coach service busy).</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                Ask me anything about your studying — I'll use your progress to personalise.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={teach} className="px-3 py-1.5 rounded-full text-xs font-medium bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
              Teach me
            </button>
            <button onClick={() => ask('practice')} className="px-3 py-1.5 rounded-full text-xs font-medium bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
              Give me practice
            </button>
            <button onClick={() => ask('mistakes')} className="px-3 py-1.5 rounded-full text-xs font-medium bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
              Explain my mistakes
            </button>
            <button onClick={() => ask('plan')} className="px-3 py-1.5 rounded-full text-xs font-medium bg-teal-50 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
              Plan my day
            </button>
          </div>

          {reply && reply.options && reply.options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {reply.options.filter(o => !['Teach Me', 'Give Me Practice', 'Explain My Mistakes', "Create Today's Plan"].includes(o)).map(o => (
                <button key={o} onClick={() => ask('chat', { userQuestion: o })} className="text-[11px] text-slate-500 hover:text-teal-600 underline">
                  {o}
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={userText}
              onChange={e => setUserText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="Ask anything…"
              className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100"
            />
            <button
              onClick={sendChat}
              disabled={loading || !userText.trim()}
              className="w-11 h-11 rounded-xl bg-teal-600 hover:bg-teal-500 disabled:opacity-40 flex items-center justify-center text-white"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
