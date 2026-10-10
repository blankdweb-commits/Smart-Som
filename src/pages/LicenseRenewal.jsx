import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import {
  ArrowLeft, Award, ShieldCheck, Shield, RefreshCw, Loader2, Coins,
  Check, XCircle, AlertTriangle, Clock, CheckCircle,
} from '../components/Icons';
import {
  fetchLicenseStatus, startLicenseRenewal, answerLicenseQuestion, submitLicenseRenewal,
} from '../utils/licenseApi';

const optionList = (q) => {
  if (Array.isArray(q?.options)) return q.options;
  if (q?.options && typeof q.options === 'object') return Object.values(q.options);
  return [];
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
};

const fmtCountdown = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const statusTone = (status) =>
  status === 'valid' ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    : status === 'expired' ? 'text-red-400 border-red-500/30 bg-red-500/10'
      : 'text-amber-400 border-amber-500/30 bg-amber-500/10';

function LicenseRenewal() {
  const navigate = useNavigate();
  const { session } = useAppContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  const [exam, setExam] = useState(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [startError, setStartError] = useState(null);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchLicenseStatus(session);
      setData(res);
    } catch (e) {
      setError(e?.message || 'Could not load your license.');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => { load(); }, [load]);

  const license = data?.license || null;
  const config = data?.config || null;
  const attempts = data?.attempts || [];
  const canRenew = data?.can_renew !== false;

  const startExam = async () => {
    setStartError(null);
    setBusy(true);
    try {
      const attemptId = (crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
      const res = await startLicenseRenewal(session, attemptId);
      setExam(res);
      setIndex(0);
      setAnswers({});
      setResult(null);
    } catch (e) {
      setStartError(e?.message || 'Could not start the renewal exam.');
    } finally {
      setBusy(false);
    }
  };

  const current = exam?.questions?.[index] || null;
  const total = exam?.questions?.length || 0;

  const choose = async (option) => {
    if (!current || busy || answers[current.id]) return;
    setBusy(true);
    try {
      const res = await answerLicenseQuestion(session, {
        batchId: exam.batch_id,
        questionId: current.id,
        selectedAnswer: option,
      });
      setAnswers((prev) => ({ ...prev, [current.id]: { selected: option, correct: !!res?.correct } }));
      setTimeout(() => setIndex((i) => Math.min(i + 1, total)), 250);
    } catch (e) {
      setStartError(e?.message || 'Could not record your answer.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!exam || busy) return;
    setBusy(true);
    try {
      const res = await submitLicenseRenewal(session, exam.batch_id);
      setResult(res);
      setExam(null);
      await load();
    } catch (e) {
      setStartError(e?.message || 'Could not submit the exam.');
    } finally {
      setBusy(false);
    }
  };

  const answeredCount = useMemo(() => Object.keys(answers).length, [answers]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-10 flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
        <button
          onClick={() => navigate('/dashboard')}
          className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400 hover:text-white"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="ml-auto flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
          <ShieldCheck size={16} className="text-apex-400" /> Nursing License
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {loading && (
          <div className="flex items-center gap-2 text-slate-400 text-sm font-bold">
            <Loader2 size={16} className="animate-spin" /> Loading your license…
          </div>
        )}

        {error && !loading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm font-bold text-red-300">
            {error}
            <button onClick={load} className="ml-3 underline">Retry</button>
          </div>
        )}

        {!loading && license && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Status</div>
                <div className={`mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-black uppercase tracking-widest ${statusTone(license.status)}`}>
                  <Shield size={13} />
                  {license.status === 'valid' ? 'Active' : license.status}
                </div>
              </div>
              <Award size={34} className="text-apex-400/70" />
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Issued</div>
                <div className="font-bold">{fmtDate(license.issued_at)}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Expires</div>
                <div className="font-bold">{fmtDate(license.expires_at)}</div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Days remaining</div>
                <div className="font-bold">
                  {license.days_remaining == null ? '—' : Math.max(0, license.days_remaining)}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Renewals</div>
                <div className="font-bold">{license.renewed_count}</div>
              </div>
            </div>

            {license.reminder_due != null && (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300">
                <AlertTriangle size={14} /> Renewal window open — {license.reminder_due} days or fewer remaining.
              </div>
            )}
          </section>
        )}

        {!loading && config && !exam && !result && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center gap-2 text-sm font-black uppercase tracking-widest text-slate-300">
              <RefreshCw size={15} className="text-apex-400" /> Renew your license
            </div>
            <p className="mt-2 text-sm text-slate-400">
              The renewal exam draws <b>{config.question_count}</b> questions from the live question bank.
              You need <b>{config.pass_pct}%</b> to pass. The attempt costs <b>{config.fee_sc} SC</b> (charged once).
              A failed attempt locks retries for {config.retry_cooldown_hours}h.
            </p>
            {!canRenew && data?.cooldown_remaining_ms > 0 && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300">
                <Clock size={14} /> Retry cooldown active — available in {fmtCountdown(data.cooldown_remaining_ms)}.
              </div>
            )}
            {startError && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
                <XCircle size={14} /> {startError}
              </div>
            )}
            <button
              onClick={startExam}
              disabled={busy || !canRenew}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-apex-600 px-5 py-3 text-sm font-black uppercase tracking-widest text-white hover:bg-apex-500 disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Coins size={16} />}
              Start renewal exam · {config.fee_sc} SC
            </button>
          </section>
        )}

        {result && (
          <section className={`rounded-3xl border p-5 ${result.passed ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
            <div className={`flex items-center gap-2 text-sm font-black uppercase tracking-widest ${result.passed ? 'text-emerald-300' : 'text-red-300'}`}>
              {result.passed ? <CheckCircle size={16} /> : <XCircle size={16} />}
              {result.passed ? 'License renewed' : 'Not passed'}
            </div>
            <p className="mt-2 text-sm text-slate-200">
              Score: <b>{result.score}/{result.total}</b> ({result.total ? Math.round((result.score / result.total) * 100) : 0}%).
              Need {result.pass_pct}%.
            </p>
            {result.passed && result.license?.expires_at && (
              <p className="mt-1 text-sm text-slate-300">New expiry: <b>{fmtDate(result.license.expires_at)}</b>.</p>
            )}
            {!result.passed && (
              <p className="mt-1 text-sm text-slate-300">You can retry after the {config?.retry_cooldown_hours}h cooldown.</p>
            )}
            <button
              onClick={() => setResult(null)}
              className="mt-4 rounded-2xl bg-slate-800 px-5 py-2.5 text-xs font-black uppercase tracking-widest text-slate-200 hover:bg-slate-700"
            >
              Done
            </button>
          </section>
        )}

        {exam && current && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-500">
              <span>Question {index + 1} / {total}</span>
              <span>{answeredCount} answered</span>
            </div>
            <div className="mt-2 h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-apex-500 transition-all" style={{ width: `${(answeredCount / Math.max(1, total)) * 100}%` }} />
            </div>

            <h2 className="mt-4 text-base font-bold leading-relaxed text-slate-100">{current.question}</h2>

            <div className="mt-4 space-y-2">
              {optionList(current).map((option, i) => {
                const picked = answers[current.id];
                const isThis = picked?.selected === option;
                return (
                  <button
                    key={i}
                    onClick={() => choose(option)}
                    disabled={busy || !!picked}
                    className={`w-full rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                      isThis
                        ? (picked.correct ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200' : 'border-red-500/50 bg-red-500/10 text-red-200')
                        : 'border-slate-800 bg-slate-900 hover:border-apex-500/50 text-slate-200'
                    } disabled:opacity-70`}
                  >
                    <span className="mr-2 font-black text-slate-500">{String.fromCharCode(65 + i)}.</span>
                    {option}
                  </button>
                );
              })}
            </div>

            {startError && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300">
                <XCircle size={14} /> {startError}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between">
              <button
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                className="rounded-2xl bg-slate-800 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-300 disabled:opacity-40"
              >
                Previous
              </button>
              {index < total - 1 ? (
                <button
                  onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}
                  className="rounded-2xl bg-slate-800 px-4 py-2 text-xs font-black uppercase tracking-widest text-slate-200"
                >
                  Next
                </button>
              ) : (
                <button
                  onClick={submit}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-2xl bg-apex-600 px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-apex-500 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Submit exam
                </button>
              )}
            </div>
          </section>
        )}

        {!loading && attempts.length > 0 && (
          <section className="rounded-3xl border border-slate-800 bg-slate-900/60 p-5">
            <div className="text-sm font-black uppercase tracking-widest text-slate-300">Attempt history</div>
            <div className="mt-3 divide-y divide-slate-800">
              {attempts.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    {a.passed ? <CheckCircle size={15} className="text-emerald-400" /> : <XCircle size={15} className="text-red-400" />}
                    <span className="font-bold text-slate-200">{a.passed ? 'Passed' : 'Failed'}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-slate-300">{a.score ?? '—'}/{a.total ?? '—'}</div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{fmtDate(a.submitted_at || a.started_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default LicenseRenewal;
