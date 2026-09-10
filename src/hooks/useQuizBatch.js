// ============================================================
// useQuizBatch — Client-side hook for the server-authoritative quiz batch system
//
// Manages the lifecycle of a quiz batch:
//   1. Create batch (calls /api/quiz-batch-create)
//   2. Get batch questions (calls /api/quiz-batch-get)
//   3. Record answers (calls /api/quiz-batch-answer per answer)
//   4. Complete batch (calls /api/quiz-batch-complete)
//
// Replaces the old client-side buildQuestionSet() + selectQuestions() flow.
// ============================================================

import { useState, useCallback, useRef } from 'react';
import { useAppContext } from '../context/AppContext';
import { authHeaders } from '../utils/apiHeaders';

// DB question rows use question_text / correct_answer / explanation while the
// quiz player renders flashcard-shaped rows (question / options / correctAnswer /
// hint). Normalize once here so both the hook state and the returned quiz
// payload are directly renderable.
const toPlayerQuestion = (q) => {
  const options = Array.isArray(q.options) && q.options.length > 0 ? q.options : null;
  const result = {
    ...q,
    question: q.question_text ?? q.question,
    correctAnswer: q.correctAnswer ?? q.correct_answer ?? q.correct_answer_text ?? q.answer,
    hint: q.hint ?? q.explanation,
  };
  if (options) {
    result.options = options;
  } else {
    delete result.options;
  }
  return result;
};

const normalizeQuestions = (list) => (list || []).map(toPlayerQuestion);

// Classify a failed /api/quiz-batch-create response into a stable, user-facing
// error code + message. The server error body is authoritative when present;
// transport problems (network down, gateway, misrouted HTML) are detected here
// so the UI never shows "no error details".
const classifyBatchError = (result, fallbackCourseKey) => {
  const isNetwork = result.networkError === true || result.status === 0;
  const isHtml = !isNetwork && !!result.contentType && result.contentType.includes('html');
  const status = result.status;

  let code = result.data?.error || result.body?.error || null;
  let message = result.data?.message || result.data?.error || null;

  if (isNetwork) {
    code = 'NETWORK_ERROR';
    message = message || 'Network connection failed. Check your connection and try again.';
  } else if (isHtml) {
    // Almost always a misrouted deploy: /api/* fell through to the SPA shell.
    code = 'API_MISROUTED';
    message = 'The API is not responding as expected on this deployment. Please try again shortly.';
  } else if (status >= 500) {
    code = 'SERVER_ERROR';
    message = message || 'The server hit an unexpected error. Please try again.';
  } else if (status === 401) {
    code = 'UNAUTHORIZED';
    message = message || 'Your session is no longer valid. Please sign in again.';
  } else if (status === 403 && (result.data?.code === 'DIFFICULTY_LOCKED')) {
    message = message || 'This difficulty is still locked for this course.';
  } else if (status === 403) {
    code = result.data?.code || 'QUOTA_EXHAUSTED';
    message = message || 'This course is currently on cooldown or out of rounds.';
  } else if (status === 400) {
    code = result.data?.code || 'INVALID_REQUEST';
    message = message || 'This request could not be validated by the server.';
  } else {
    code = code || 'SERVER_ERROR';
    message = message || 'Could not start this quiz right now.';
  }

  return {
    status: status ?? null,
    code,
    message,
    cooldown_remaining_seconds: result.data?.cooldown_remaining_seconds ?? null,
    window_expires_at: result.data?.window_expires_at ?? null,
    lockedDifficulty: result.data?.lockedDifficulty ?? null,
    courseKey: result.data?.courseKey ?? fallbackCourseKey,
  };
};

export function useQuizBatch() {
  const { session, callApexApi } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [errorInfo, setErrorInfo] = useState(null); // { status, code, cooldown_remaining_seconds, window_expires_at, lockedDifficulty, courseKey, message }
  const [batch, setBatch] = useState(null);
  const [questions, setQuestions] = useState([]);
  const answersRef = useRef(new Map());

  // ── Create a new batch ───────────────────────────────────
  const createBatch = useCallback(async ({
    mode,
    courseKey,
    examFramework,
    batchSize,
    difficultyDistribution,
    subjectFilter,
    topicFilter,
    attemptId,
  }) => {
    setLoading(true);
    setError(null);
    setErrorInfo(null);
    setBatch(null);
    setQuestions([]);
    answersRef.current.clear();

    try {
      const headers = authHeaders(session, { json: true });
      const body = {
        mode,
        courseKey,
        ...(examFramework && { examFramework }),
        ...(batchSize && { batchSize }),
        ...(difficultyDistribution && { difficultyDistribution }),
        ...(subjectFilter && { subjectFilter }),
        ...(topicFilter && { topicFilter }),
        ...(attemptId && { attemptId }),
      };

      const result = await callApexApi('/api/quiz-batch-create', {
        method: 'POST',
        headers,
        body,
      });

      if (!result.ok) {
        const info = classifyBatchError(result, courseKey);
        setError(info.message);
        setErrorInfo(info);
        setLoading(false);
        // Return the failure inline so callers never read the (still stale)
        // state snapshot from the same render.
        return { success: false, error: info.message, errorInfo: info };
      }

      const data = result.data;
      setBatch(data.batch);
      setQuestions(normalizeQuestions(data.questions));
      setLoading(false);
      return { success: true, batch: data.batch, questions: normalizeQuestions(data.questions), meta: data.meta };
    } catch (err) {
      const info = { status: 0, code: 'NETWORK', message: err.message };
      setError(err.message);
      setErrorInfo(info);
      setLoading(false);
      return { success: false, error: err.message, errorInfo: info };
    }
  }, [session, callApexApi]);

  // ── Fetch batch questions ────────────────────────────────
  const fetchBatch = useCallback(async (batchId) => {
    setLoading(true);
    setError(null);

    try {
      const headers = authHeaders(session);
      const result = await callApexApi(`/api/quiz-batch-get?id=${batchId}`, {
        method: 'GET',
        headers,
      });

      if (!result.ok) {
        const errMsg = result.data?.message || result.data?.error || 'Failed to fetch batch';
        setError(errMsg);
        setLoading(false);
        return null;
      }

      const data = result.data;
      setBatch(data.batch);
      setQuestions(normalizeQuestions(data.questions));
      setLoading(false);
      return data;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return null;
    }
  }, [session, callApexApi]);

  // ── Record an answer ─────────────────────────────────────
  const recordAnswer = useCallback(async ({
    questionId,
    selectedAnswer,
    correct,
    elapsedMs,
  }) => {
    if (!batch?.id) return null;

    try {
      const headers = authHeaders(session, { json: true });
      const result = await callApexApi('/api/quiz-batch-answer', {
        method: 'POST',
        headers,
        body: {
          batchId: batch.id,
          questionId,
          selectedAnswer,
          correct,
          elapsedMs,
        },
      });

      if (result.ok) {
        answersRef.current.set(questionId, {
          selectedAnswer,
          correct,
          elapsedMs,
        });
      }

      return result.ok ? result.data : null;
    } catch (err) {
      console.error('[useQuizBatch] recordAnswer error:', err);
      return null;
    }
  }, [batch, session, callApexApi]);

  // ── Complete the batch ───────────────────────────────────
  const completeBatch = useCallback(async () => {
    if (!batch?.id) return null;

    setLoading(true);

    try {
      const headers = authHeaders(session, { json: true });
      const result = await callApexApi('/api/quiz-batch-complete', {
        method: 'POST',
        headers,
        body: { batchId: batch.id },
      });

      setLoading(false);

      if (result.ok) {
        return result.data;
      }
      return null;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return null;
    }
  }, [batch, session, callApexApi]);

  // ── Reset state ──────────────────────────────────────────
  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setErrorInfo(null);
    setBatch(null);
    setQuestions([]);
    answersRef.current.clear();
  }, []);

  return {
    // State
    loading,
    error,
    errorInfo,
    batch,
    questions,

    // Actions
    createBatch,
    fetchBatch,
    recordAnswer,
    completeBatch,
    reset,
  };
}
