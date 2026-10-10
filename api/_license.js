// api/_license.js
//
// Nursing License Renewal (milestone S8) — support module for the api/quiz.js
// serverless function (underscore prefix -> not deployed as its own function,
// keeping the Vercel Hobby 12-function budget intact).
//
// Endpoints (dispatched by api/quiz.js on the original req.url):
//   GET  /api/quiz/license-status   (or /api/license-status)  -> handleLicenseStatus
//   POST /api/quiz/license-start    (or /api/license-start)   -> handleLicenseStart
//   POST /api/quiz/license-submit   (or /api/license-submit)  -> handleLicenseSubmit
//
// Every rule is server-authoritative:
//   * The first license is issued automatically (12-month validity, free).
//   * The renewal exam costs 100 SC, charged ONCE through the canonical
//     _sc_apply (idempotent on the client attempt id) — never a client amount.
//   * 50 questions are selected by the server; grading happens per-answer via
//     /api/quiz-batch-answer, and the PASS/score are recomputed server-side
//     from the persisted, server-graded rows (the client score/pass is ignored).
//   * A failed attempt starts a 24h retry cooldown.
//   * A pass renews the license for another 12 months and records the attempt.
// The client never writes a license or an attempt row (RLS = read-own, write
// service_role only). This flow does NOT touch player_score/SC rewards.

import crypto from 'crypto';
import { authorizeRequest, getSupabaseAdmin } from './_utils.js';
import { QuestionSelectionService } from './_questionSelectionService.js';

const LICENSE_CONFIG_KEY = 'license_renewal';
const LICENSE_CONFIG_FALLBACK = {
  fee_sc: 100,
  question_count: 50,
  pass_pct: 80,
  retry_cooldown_hours: 24,
  validity_months: 12,
  reminder_days: [30, 7, 1],
};

// Sensitive per-question fields that must never reach the client for an exam.
const SENSITIVE_Q_FIELDS = new Set(['correct_answer', 'answer', 'correct', 'rationale', 'explanation', 'hint']);

const stripSensitive = (q) => {
  const out = {};
  for (const [k, v] of Object.entries(q || {})) {
    if (!SENSITIVE_Q_FIELDS.has(k)) out[k] = v;
  }
  return out;
};

const isUuid = (v) =>
  typeof v === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v);

async function readConfig(supabase) {
  try {
    const { data } = await supabase.rpc('server_config_get', { p_key: LICENSE_CONFIG_KEY });
    if (data && typeof data === 'object') return { ...LICENSE_CONFIG_FALLBACK, ...data };
  } catch {
    /* fall through to defaults */
  }
  return { ...LICENSE_CONFIG_FALLBACK };
}

function shapeLicense(lic, cfg) {
  const now = Date.now();
  const expiresMs = lic?.expires_at ? Date.parse(lic.expires_at) : null;
  const msRemaining = expiresMs != null ? expiresMs - now : null;
  const daysRemaining = msRemaining != null ? Math.floor(msRemaining / 86400000) : null;
  const status = lic?.status === 'suspended' ? 'suspended' : (msRemaining != null && msRemaining <= 0 ? 'expired' : 'valid');
  const remindersDue = (cfg.reminder_days || []).filter((d) => daysRemaining != null && daysRemaining <= d && daysRemaining >= 0);
  return {
    issued_at: lic?.issued_at ?? null,
    expires_at: lic?.expires_at ?? null,
    status,
    days_remaining: daysRemaining,
    renewed_count: lic?.renewed_count ?? 0,
    reminder_due: remindersDue.length > 0 ? Math.min(...remindersDue) : null,
  };
}

// ============================================================
// GET /api/quiz/license-status
// Returns the caller's license, recent attempts, and exam config.
// ============================================================
export async function handleLicenseStatus(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  try {
    const supabase = getSupabaseAdmin();
    const cfg = await readConfig(supabase);

    const { data: ensured, error: ensureErr } = await supabase.rpc('license_ensure', { p_user_id: user.id });
    if (ensureErr || !ensured || ensured.ok === false) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to load license.' });
    }

    const { data: attempts } = await supabase
      .from('license_renewal_attempts')
      .select('id, started_at, submitted_at, score, total, passed, fee_sc')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(20);

    // Cooldown = 24h after the most recent FAILED attempt.
    const cooldownMs = (Number(cfg.retry_cooldown_hours) || 24) * 3600000;
    const lastFail = (attempts || []).find((a) => a.passed === false && a.submitted_at);
    const cooldownRemainingMs = lastFail
      ? Math.max(0, Date.parse(lastFail.submitted_at) + cooldownMs - Date.now())
      : 0;

    return res.status(200).json({
      ok: true,
      license: shapeLicense(ensured, cfg),
      attempts: attempts || [],
      config: {
        fee_sc: Number(cfg.fee_sc) || LICENSE_CONFIG_FALLBACK.fee_sc,
        question_count: Number(cfg.question_count) || LICENSE_CONFIG_FALLBACK.question_count,
        pass_pct: Number(cfg.pass_pct) || LICENSE_CONFIG_FALLBACK.pass_pct,
        retry_cooldown_hours: Number(cfg.retry_cooldown_hours) || LICENSE_CONFIG_FALLBACK.retry_cooldown_hours,
        validity_months: Number(cfg.validity_months) || LICENSE_CONFIG_FALLBACK.validity_months,
        reminder_days: cfg.reminder_days || LICENSE_CONFIG_FALLBACK.reminder_days,
      },
      can_renew: cooldownRemainingMs <= 0,
      cooldown_remaining_ms: cooldownRemainingMs,
    });
  } catch (err) {
    console.error('[license status] Error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to load license status.' });
  }
}

// ============================================================
// POST /api/quiz/license-start   body: { attemptId? }
// Charges the fee (once) and issues a fresh server-selected exam.
// ============================================================
export async function handleLicenseStart(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  try {
    const cfg = await readConfig(supabase);
    const fee = Number(cfg.fee_sc) || LICENSE_CONFIG_FALLBACK.fee_sc;

    // Ensure the license row exists (free first issue) before any charge.
    const { data: ensured } = await supabase.rpc('license_ensure', { p_user_id: user.id });
    if (!ensured || ensured.ok === false) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to load license.' });
    }

    // 24h retry cooldown after a FAILED attempt (server-enforced).
    const cooldownMs = (Number(cfg.retry_cooldown_hours) || 24) * 3600000;
    const { data: lastFail } = await supabase
      .from('license_renewal_attempts')
      .select('submitted_at')
      .eq('user_id', user.id)
      .eq('passed', false)
      .not('submitted_at', 'is', null)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastFail?.submitted_at) {
      const remaining = Date.parse(lastFail.submitted_at) + cooldownMs - Date.now();
      if (remaining > 0) {
        return res.status(429).json({
          error: 'RETRY_COOLDOWN',
          message: 'You can retry after the cooldown ends.',
          cooldown_remaining_ms: remaining,
        });
      }
    }

    const requestId = isUuid(req.body?.attemptId) ? req.body.attemptId : crypto.randomUUID();

    // Atomic, idempotent fee via the canonical ledger mutator (service_role).
    const { data: charge, error: chargeErr } = await supabase.rpc('_sc_apply', {
      p_user_id: user.id,
      p_amount: -fee,
      p_reason: 'license_renewal_fee',
      p_source: 'license',
      p_transaction_type: 'spend',
      p_ref_type: 'license_renewal',
      p_ref_id: requestId,
      p_metadata: { product: 'license_renewal' },
      p_client_request_id: requestId,
    });
    if (chargeErr) {
      console.error('[license start] charge error:', chargeErr);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to charge the renewal fee.' });
    }
    if (!charge || charge.ok === false) {
      if (charge?.error === 'INSUFFICIENT_FUNDS') {
        return res.status(402).json({
          error: 'INSUFFICIENT_FUNDS',
          message: `Renewing your license costs ${fee} SC.`,
          required_sc: fee,
        });
      }
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to charge the renewal fee.' });
    }

    const service = new QuestionSelectionService(supabase);
    const exam = await service.createLicenseExam({
      userId: user.id,
      batchSize: Number(cfg.question_count) || LICENSE_CONFIG_FALLBACK.question_count,
      metadata: { licenseRequestId: requestId, feeSc: fee },
    });
    if (exam.error) {
      return res.status(400).json({ error: exam.error, message: exam.message });
    }

    // Load + strip the exam questions (never send correct answers).
    const fetched = await service.getBatch(exam.batchId, user.id);
    if (fetched.error) {
      return res.status(400).json({ error: fetched.error, message: fetched.message });
    }

    return res.status(200).json({
      ok: true,
      batch_id: exam.batchId,
      license_request_id: requestId,
      fee_sc: fee,
      question_count: exam.total,
      pass_pct: Number(cfg.pass_pct) || LICENSE_CONFIG_FALLBACK.pass_pct,
      balance_after: charge.balanceAfter ?? null,
      questions: (fetched.questions || []).map(stripSensitive),
    });
  } catch (err) {
    console.error('[license start] Error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to start the renewal exam.' });
  }
}

// ============================================================
// POST /api/quiz/license-submit   body: { batchId }
// Scores the persisted, server-graded answers and applies the result.
// ============================================================
export async function handleLicenseSubmit(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { status, body: authBody, user } = await authorizeRequest(req);
  if (status !== 200) return res.status(status).json(authBody);

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Server not configured.' });
  }

  try {
    const batchId = req.body?.batchId;
    if (!isUuid(batchId)) {
      return res.status(400).json({ error: 'INVALID_REQUEST', message: 'batchId is required.' });
    }

    const { data: batch, error: bErr } = await supabase
      .from('quiz_batches')
      .select('id, user_id, course_key, metadata')
      .eq('id', batchId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (bErr || !batch || batch.course_key !== 'license-renewal') {
      return res.status(404).json({ error: 'BATCH_NOT_FOUND', message: 'Renewal exam not found.' });
    }

    const requestId = batch.metadata?.licenseRequestId;
    const fee = Number(batch.metadata?.feeSc) || 0;
    if (!isUuid(requestId)) {
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Exam is missing its request id.' });
    }

    const cfg = await readConfig(supabase);
    const passPct = Number(cfg.pass_pct) || LICENSE_CONFIG_FALLBACK.pass_pct;

    // Score from the persisted, SERVER-GRADED rows (client score never trusted).
    const { data: rows } = await supabase
      .from('quiz_batch_questions')
      .select('answered, correct')
      .eq('batch_id', batchId);
    const answered = (rows || []).filter((r) => r.answered);
    const total = answered.length;
    const score = answered.filter((r) => r.correct).length;
    const pct = total > 0 ? (score / total) * 100 : 0;
    const passed = total > 0 && pct >= passPct;

    const { data: applied, error: applyErr } = await supabase.rpc('license_apply_result', {
      p_user_id: user.id,
      p_batch_id: batchId,
      p_score: score,
      p_total: total,
      p_passed: passed,
      p_fee_sc: fee,
      p_client_request_id: requestId,
    });
    if (applyErr || !applied || applied.ok === false) {
      console.error('[license submit] apply error:', applyErr || applied);
      return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to record the result.' });
    }

    // Finalize the batch WITHOUT the player_score award (license exams are not
    // ranked rounds). Idempotent: only moves reserved/started -> completed.
    await supabase
      .from('quiz_batches')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', batchId)
      .eq('user_id', user.id)
      .in('status', ['reserved', 'started']);

    const { data: lic } = await supabase
      .from('nursing_licenses')
      .select('issued_at, expires_at, status, renewed_count')
      .eq('user_id', user.id)
      .maybeSingle();

    return res.status(200).json({
      ok: true,
      score,
      total,
      pass_pct: passPct,
      passed,
      replay: applied.replay === true,
      license: shapeLicense(lic, cfg),
    });
  } catch (err) {
    console.error('[license submit] Error:', err);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to submit the renewal exam.' });
  }
}
