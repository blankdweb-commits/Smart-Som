// ============================================================
// Controlled-Random Question Selection Service
//
// Server-authoritative, transactional, reusable across ALL quiz modes.
//
// CRITICAL ARCHITECTURE RULE:
//   This service is NEVER called from client-side components.
//   It runs exclusively on the server (API routes / RPCs).
//
// The service is callable by:
//   Practice, Daily Quiz, Topic Quiz, Mixed Quiz, Exam Simulation,
//   NCLEX, NMCN, 1v1
//
// Each mode provides its own configuration via SELECTION_CONFIG.MODE_CONFIGS.
// ============================================================

import crypto from 'crypto';
import { SELECTION_CONFIG as C } from './selectionConfig.js';

// ============================================================
// Canonical course metadata: maps client-facing courseKey prefixes to the
// canonical `questions.course_id` value(s) used in the DB, plus the exam
// framework a framework-dedicated course must carry.
//
//   courseKey prefix        DB course_id(s)             framework
//   ---------------------   ---------------------------  ---------
//   clinical-challenge      nclex | nmcn                NCLEX/NMCN (via suffix)
//   quick-quiz              nclex | nmcn                NCLEX/NMCN (via suffix)
//   uselu-test              uselu                        (none)
//   nursing-200             nursing200                   (none)
//   midwifery-200           midwifery                    (none)
//   nursing-300             nursing300                   (none, per-subject)
//   midwifery-300           midwifery300                 (none, grouped -> subjects)
//   midwifery-200-s2        midwifery200s2               (none, grouped -> subjects)
//   weakness-challenge      ALL banks (aggregate)        (none)
//   daily-challenge         ALL banks (aggregate)        (none)
//
// COURSE SUBJECT GROUPS (authoritative course catalogue):
// Midwifery 300-Level and 200-Level · 2nd Semester expose canonically-named
// COURSES (not the DB's fine-grained unit subjects). Each canonical course
// maps to one or more `questions.subject_id` values (exactly — every DB
// subject appears once, nothing is dropped). Decision log (Sep 7 2026):
// grouping chosen by the product owner after the DB granularity was audited;
// totals reconcile exactly (midwifery300 = 2,764; midwifery200s2 = 2,245).
// ============================================================
const MIDWIFERY_300_GROUPS = {
  'Neonatal Nursing': ['Neonatal Nursing'],
  'Research & Statistics': ['Research and Statistics', 'Data Collection'],
  'Quality Improvement, Patient Safety & Management': [
    'Quality Improvement in Healthcare and Patient Safety',
    'Clinic Management',
  ],
  'Complicated Midwifery & Obstetric Emergencies': [
    'Complications of Puerperium',
    'Obstetric Emergencies and Life-Saving Skills',
    'Complications in Pregnancy and Childbirth',
    'Preventive Strategies of Risk Conditions',
    'Midwifery Procedures',
  ],
  'Reproductive Health & Fertility': ['Reproductive Health Conditions', 'Introduction to Fertility'],
  'Family Planning': ['Family Planning Methods', 'Introduction to Family Planning'],
};

const MIDWIFERY_200_S2_GROUPS = {
  'Normal Midwifery': ['Midwifery'],
  'Community Midwifery': ['Community Midwifery'],
  'Pharmacology in Midwifery': ['Pharmacology in Midwifery'],
  'Anatomy & Physiology': ['Applied Anatomy and Physiology'],
  'Infant & Newborn Care': [
    'The Newborn',
    'Newborn Assessment & Resuscitation',
    'Subsequent Care of the Newborn',
    'Newborn Feeding',
    'Discharge and Follow-up Care',
  ],
  'Ethics, Law & Professional Issues': [
    'Contemporary Legal Issues',
    'The Law and the Midwife',
    'Ethics in Midwifery Practice',
  ],
  'Foundations of Midwifery Practice': [
    'Introduction to Midwifery Practice',
    'Theories and Concepts',
    'Quality Improvement in Midwifery Practice',
    'Complicated midwifery',
  ],
};

const COURSE_METADATA = {
  'clinical-challenge': { dbCourseIdByFramework: { NCLEX: 'nclex', NMCN: 'nmcn' } },
  'quick-quiz': { dbCourseIdByFramework: { NCLEX: 'nclex', NMCN: 'nmcn' } },
  'uselu-test': { dbCourseId: 'uselu' },
  'nursing-200': { dbCourseId: 'nursing200', hasSubjects: true },
  'midwifery-200': { dbCourseId: 'midwifery', hasSubjects: true },
  'nursing-300': { dbCourseId: 'nursing300', hasSubjects: true },
  'midwifery-300': { dbCourseId: 'midwifery300', hasSubjects: true, subjectGroups: MIDWIFERY_300_GROUPS },
  'midwifery-200-s2': { dbCourseId: 'midwifery200s2', hasSubjects: true, subjectGroups: MIDWIFERY_200_S2_GROUPS },
  'weakness-challenge': { aggregate: true },
  'daily-challenge': { aggregate: true },
};

// ============================================================
// Fisher-Yates shuffle (unbiased)
// ============================================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// Random float in [min, max]
// ============================================================
function randomInRange([min, max]) {
  return min + Math.random() * (max - min);
}

// ============================================================
// Batch distance recency weight
// ============================================================
function batchRecencyWeight(batchDistance) {
  if (batchDistance === null || batchDistance === undefined) return C.RECENCY_WEIGHTS.never_seen;
  if (batchDistance === 0) return C.RECENCY_WEIGHTS.previous_batch;
  if (batchDistance === 1) return C.RECENCY_WEIGHTS.two_batches_ago;
  if (batchDistance === 2) return C.RECENCY_WEIGHTS.three_batches_ago;
  if (batchDistance === 3) return C.RECENCY_WEIGHTS.four_batches_ago;
  if (batchDistance === 4) return C.RECENCY_WEIGHTS.five_batches_ago;
  return C.RECENCY_WEIGHTS.six_plus_batches_ago;
}

// ============================================================
// Time-based recency decay
// ============================================================
function timeRecencyWeight(hoursSinceSeen) {
  if (hoursSinceSeen === null || hoursSinceSeen === undefined || !isFinite(hoursSinceSeen)) {
    return 1.0;
  }
  const decay = Math.exp(-hoursSinceSeen / C.TIME_RECENCY_HALF_LIFE_HOURS);
  return 1.0 - (decay * C.TIME_RECENCY_MAX_PENALTY);
}

// ============================================================
// QuestionSelectionService
// ============================================================
export class QuestionSelectionService {
  constructor(supabaseAdmin) {
    this.supabase = supabaseAdmin;
  }

  // --------------------------------------------------------
  // MAIN ENTRY: Create a quiz batch with transactional guarantees
  // --------------------------------------------------------
  async createQuizBatch({
    userId,
    mode,
    examFramework = null,
    courseKey,
    difficultyDistribution = null,
    batchSize = null,
    subjectFilter = null,
    topicFilter = null,
  }) {
    const startTime = Date.now();
    const selectionId = crypto.randomUUID();

    // 1. Resolve mode configuration
    const modeConfig = C.MODE_CONFIGS[mode] || C.MODE_CONFIGS.practice;
    const finalBatchSize = batchSize || modeConfig.batchSize;
    // When no difficulty is explicitly requested, default to Easy only (always
    // unlocked). Multi-tier mode defaults would otherwise spuriously trigger
    // DIFFICULTY_LOCKED under the progressive per-course unlocking model.
    const finalDiffDist = difficultyDistribution || { Easy: finalBatchSize };
    const framework = modeConfig.framework || examFramework;

    // 2. Validate hard constraints
    this._validateRequest({ userId, mode, courseKey, framework, finalDiffDist });

    // 2b. Resolve canonical course metadata + framework validation (fail closed).
    const courseMeta = this._resolveCourseMetadata(courseKey);
    if (courseMeta.framework && framework && courseMeta.framework !== framework) {
      throw new Error(`FRAMEWORK_MISMATCH: course ${courseKey} requires ${courseMeta.framework}`);
    }

    // 2c. Authoritative per-course difficulty progression check.
    const requested = Object.entries(finalDiffDist)
      .filter(([, n]) => n > 0)
      .map(([d]) => d);
    if (requested.length > 0) {
      const access = await this._validateDifficultyAccess({ userId, courseKey, difficulties: requested });
      if (!access.unlocked) {
        const err = new Error(`DIFFICULTY_LOCKED: ${access.locked} is not unlocked for course ${courseKey}`);
        err.code = 'DIFFICULTY_LOCKED';
        err.lockedDifficulty = access.locked;
        err.courseKey = courseKey;
        throw err;
      }
    }

    // 3. Clean up expired batches for this user
    await this._cleanupExpiredBatches(userId);

    // 4. Fetch user's question history
    const userHistory = await this._fetchUserHistory(userId);

    // 5. Fetch candidate questions (hard-filtered) using the resolved course.
    // For "both"-source clinical/quick courses we span both banks, so the
    // exam_framework hard-constraint is dropped in favour of the course list.
    let candidates = await this._fetchCandidates({
      courseId: courseMeta.dbCourseId,
      courseIds: courseMeta.dbCourseIds,
      subject: courseMeta.subject,
      subjects: courseMeta.subjects,
      aggregate: courseMeta.aggregate,
      framework: courseMeta.dbCourseIds ? null : framework,
      subjectFilter,
      topicFilter,
    });

    // 5b. Content-gap fallback: a legitimate course/subject may exist in the
    // catalogue but have no questions in the bank yet (e.g. Nursing 200-Level
    // "Nutrition & Dietetics"). Instead of failing the round, fall back to the
    // parent course's available questions so the user always gets a quiz, and
    // surface a note so the client can explain what happened.
    let fallbackNote = null;
    if (candidates.length === 0 && !courseMeta.aggregate && (courseMeta.dbCourseId || courseMeta.dbCourseIds)) {
      const requestedSubject =
        subjectFilter ||
        courseMeta.subject ||
        (courseMeta.subjects && courseMeta.subjects.length > 1 ? courseMeta.subjects.join(' / ') : courseMeta.subjects?.[0]);
      candidates = await this._fetchCandidates({
        courseId: courseMeta.dbCourseId,
        courseIds: courseMeta.dbCourseIds,
        subject: null,
        subjects: null,
        aggregate: false,
        framework: courseMeta.dbCourseIds ? null : framework,
        subjectFilter: null,
        topicFilter,
      });
      if (candidates.length > 0) {
        fallbackNote = {
          requestedSubject,
          availableCount: candidates.length,
          note:
            requestedSubject
              ? `No questions available for "${requestedSubject}" yet — showing questions from the full ${courseKey} course instead.`
              : `No questions available for those filters — showing questions from the ${courseKey} course instead.`,
        };
      }
    }

    if (candidates.length === 0) {
      return {
        selectionId,
        error: 'NO_CANDIDATES',
        message: 'No questions available for the requested criteria.',
        batch: null,
      };
    }

    // 6. Select questions per difficulty group
    const selectedIds = [];
    const selectedSet = new Set();
    const topicCounts = new Map();
    const conceptCounts = new Map();
    let relaxationLevel = 0;

    for (const [difficulty, count] of Object.entries(finalDiffDist)) {
      if (count <= 0) continue;

      const diffCandidates = candidates.filter(
        q => q.difficulty === difficulty && !selectedSet.has(q.id)
      );

      const { selected, level } = this._selectWithRelaxation(
        diffCandidates,
        count,
        userHistory,
        selectedSet,
        topicCounts,
        conceptCounts
      );

      relaxationLevel = Math.max(relaxationLevel, level);

      for (const q of selected) {
        selectedIds.push(q.id);
        selectedSet.add(q.id);

        // Update diversity tracking
        if (q.topic_id) {
          topicCounts.set(q.topic_id, (topicCounts.get(q.topic_id) || 0) + 1);
        }
        if (q.concept_id) {
          conceptCounts.set(q.concept_id, (conceptCounts.get(q.concept_id) || 0) + 1);
        }
      }
    }

    // 7. If we couldn't fill all difficulty groups, try with remaining candidates
    if (selectedIds.length < finalBatchSize) {
      const remaining = candidates.filter(q => !selectedSet.has(q.id));
      const stillNeeded = finalBatchSize - selectedIds.length;

      const { selected, level } = this._selectWithRelaxation(
        remaining,
        stillNeeded,
        userHistory,
        selectedSet,
        topicCounts,
        conceptCounts
      );

      relaxationLevel = Math.max(relaxationLevel, level);

      for (const q of selected) {
        selectedIds.push(q.id);
        selectedSet.add(q.id);
      }
    }

    if (selectedIds.length === 0) {
      return {
        selectionId,
        error: 'SELECTION_FAILED',
        message: 'Could not select any questions satisfying hard constraints.',
        batch: null,
      };
    }

    // 8. Shuffle final order (spec §13)
    const shuffledIds = shuffle(selectedIds);

    // 9. Create the batch record (transactional reservation)
    const batch = await this._createBatchTransaction({
      userId,
      mode,
      examFramework: framework,
      courseKey,
      difficultyDistribution: finalDiffDist,
      questionIds: shuffledIds,
      selectionId,
      relaxationLevel,
    });

    const elapsedMs = Date.now() - startTime;

    // The batch was reserved above; also return the full question rows so a
    // client that launches straight from batch-create has everything it needs
    // (parity with getBatch). Keeps /api/quiz-batch-create authoritative for
    // quiz launch without an extra round-trip.
    const questions = shuffledIds
      .map(id => candidates.find(q => q.id === id))
      .filter(Boolean)
      .map((q, i) => ({
        ...q,
        sequence: i + 1,
        timeLimitSeconds: shuffledIds.length <= 10 ? 15 : null,
      }));

    return {
      selectionId,
      batch: {
        id: batch.id,
        mode,
        courseKey,
        questionCount: shuffledIds.length,
        questionIds: shuffledIds,
        difficultyDistribution: finalDiffDist,
        expiresAt: batch.expires_at,
        status: batch.status,
      },
      questions,
      meta: {
        candidateCount: candidates.length,
        selectedCount: shuffledIds.length,
        relaxationLevel,
        elapsedMs,
        ...(fallbackNote ? { fallbackNote } : {}),
      },
    };
  }

  // --------------------------------------------------------
  // 1v1 Special: Create shared match batch
  // --------------------------------------------------------
  async createMatchBatch({
    matchId,
    playerIds,
    examFramework = null,
    courseKey,
    difficultyDistribution = null,
    batchSize = null,
  }) {
    const modeConfig = C.MODE_CONFIGS.oneVsOne;
    const finalBatchSize = batchSize || modeConfig.batchSize;
    const finalDiffDist = difficultyDistribution || modeConfig.difficultyDistribution;
    const framework = modeConfig.framework || examFramework;

    // Validate
    if (!matchId || !playerIds || playerIds.length !== 2) {
      throw new Error('1v1 match requires exactly 2 player IDs');
    }

    // Select ONE question sequence for the match
    // Use first player's history for selection (both get same questions)
    const primaryHistory = await this._fetchUserHistory(playerIds[0]);
    // 1v1 matches are cross-bank; do not pin to a single course_id unless the
    // match explicitly names a known course.
    let dbCourseId = null;
    let dbSubject = null;
    let dbSubjects = null;
    let dbCourseIds = null;
    try {
      const meta = this._resolveCourseMetadata(courseKey);
      if (!meta.aggregate) {
        dbCourseId = meta.dbCourseId || null;
        dbCourseIds = meta.dbCourseIds || null;
        dbSubject = meta.subject || null;
        dbSubjects = meta.subjects || null;
      }
    } catch {
      dbCourseId = null;
      dbSubject = null;
      dbSubjects = null;
      dbCourseIds = null;
    }
    const candidates = await this._fetchCandidates({ courseId: dbCourseId, courseIds: dbCourseIds, subject: dbSubject, subjects: dbSubjects, framework });

    const selectedIds = [];
    const selectedSet = new Set();
    const topicCounts = new Map();
    const conceptCounts = new Map();

    for (const [difficulty, count] of Object.entries(finalDiffDist)) {
      if (count <= 0) continue;

      const diffCandidates = candidates.filter(
        q => q.difficulty === difficulty && !selectedSet.has(q.id)
      );

      const { selected } = this._selectWithRelaxation(
        diffCandidates,
        count,
        primaryHistory,
        selectedSet,
        topicCounts,
        conceptCounts
      );

      for (const q of selected) {
        selectedIds.push(q.id);
        selectedSet.add(q.id);
        if (q.topic_id) topicCounts.set(q.topic_id, (topicCounts.get(q.topic_id) || 0) + 1);
        if (q.concept_id) conceptCounts.set(q.concept_id, (conceptCounts.get(q.concept_id) || 0) + 1);
      }
    }

    // Pad if needed
    if (selectedIds.length < finalBatchSize) {
      const remaining = candidates.filter(q => !selectedSet.has(q.id));
      const { selected } = this._selectWithRelaxation(
        remaining,
        finalBatchSize - selectedIds.length,
        primaryHistory,
        selectedSet,
        topicCounts,
        conceptCounts
      );
      for (const q of selected) {
        selectedIds.push(q.id);
        selectedSet.add(q.id);
      }
    }

    const shuffledIds = shuffle(selectedIds);

    // Create batch for each player + record shared sequence in match metadata
    const batches = [];
    for (const playerId of playerIds) {
      const batch = await this._createBatchTransaction({
        userId: playerId,
        mode: 'oneVsOne',
        examFramework: framework,
        courseKey,
        difficultyDistribution: finalDiffDist,
        questionIds: shuffledIds,
        selectionId: matchId,
        relaxationLevel: 0,
        userHistory: await this._fetchUserHistory(playerId),
        metadata: { matchId, sharedSequence: true },
      });
      batches.push(batch);
    }

    return {
      matchId,
      questionIds: shuffledIds,
      questionCount: shuffledIds.length,
      batches: batches.map(b => ({ id: b.id, userId: b.user_id })),
    };
  }

  // --------------------------------------------------------
  // Get a batch's questions (for the player)
  // --------------------------------------------------------
  async getBatch(batchId, userId) {
    const { data: batch, error } = await this.supabase
      .from('quiz_batches')
      .select('*')
      .eq('id', batchId)
      .eq('user_id', userId)
      .single();

    if (error || !batch) {
      return { error: 'BATCH_NOT_FOUND', message: 'Batch not found or expired.' };
    }

    if (batch.status === 'abandoned') {
      return { error: 'BATCH_ABANDONED', message: 'This batch has expired.' };
    }

    // Check expiry
    if (new Date(batch.expires_at) < new Date()) {
      await this.supabase
        .from('quiz_batches')
        .update({ status: 'abandoned', completed_at: new Date().toISOString() })
        .eq('id', batchId);
      return { error: 'BATCH_EXPIRED', message: 'This batch has expired.' };
    }

    // Fetch full question data
    const { data: questions, error: qError } = await this.supabase
      .from('questions')
      .select('*')
      .in('id', batch.question_ids);

    if (qError) {
      return { error: 'QUESTIONS_FETCH_FAILED', message: 'Failed to load questions.' };
    }

    // Maintain the batch's question order
    const orderedQuestions = batch.question_ids
      .map(id => questions.find(q => q.id === id))
      .filter(Boolean);

    // Mark as started if still reserved
    if (batch.status === 'reserved') {
      await this.supabase
        .from('quiz_batches')
        .update({ status: 'started', started_at: new Date().toISOString() })
        .eq('id', batchId)
        .eq('status', 'reserved');
    }

    // Fetch any existing answers for this batch
    const { data: existingAnswers } = await this.supabase
      .from('quiz_batch_questions')
      .select('*')
      .eq('batch_id', batchId);

    const answerMap = new Map(
      (existingAnswers || []).map(a => [a.question_id, a])
    );

    return {
      batch: {
        id: batch.id,
        mode: batch.mode,
        courseKey: batch.course_key,
        examFramework: batch.exam_framework,
        difficultyDistribution: batch.difficulty_distribution,
        expiresAt: batch.expires_at,
        status: 'started',
      },
      questions: orderedQuestions.map((q, i) => ({
        ...q,
        sequence: i + 1,
        timeLimitSeconds: batch.question_ids.length <= 10 ? 15 : null,
        existingAnswer: answerMap.get(q.id) || null,
      })),
    };
  }

  // --------------------------------------------------------
  // Record an answer
  // --------------------------------------------------------
  async recordAnswer({ batchId, userId, questionId, selectedAnswer, elapsedMs }) {
    // Verify batch ownership
    const { data: batch, error: bError } = await this.supabase
      .from('quiz_batches')
      .select('*')
      .eq('id', batchId)
      .eq('user_id', userId)
      .single();

    if (bError || !batch) {
      return { error: 'BATCH_NOT_FOUND' };
    }

    if (batch.status === 'abandoned') {
      return { error: 'BATCH_ABANDONED' };
    }

    // Check expiry
    if (new Date(batch.expires_at) < new Date()) {
      return { error: 'BATCH_EXPIRED' };
    }

    // The question must actually belong to this batch. Rejects injection of a
    // foreign questionId into an owned batch.
    if (!Array.isArray(batch.question_ids) || !batch.question_ids.includes(questionId)) {
      return { error: 'QUESTION_NOT_IN_BATCH' };
    }

    // ============================================================
    // SERVER-AUTHORITATIVE GRADING
    // The client-supplied `correct` flag is IGNORED. Correctness is derived
    // here by comparing the submitted answer against the stored canonical
    // answer for the question. A malicious client can no longer POST
    // all-true answers to fabricate scores or unlock difficulty tiers.
    // ============================================================
    const serverCorrect = await this._gradeAnswer(questionId, selectedAnswer);

    // Upsert answer in quiz_batch_questions
    const { error: upsertError } = await this.supabase
      .from('quiz_batch_questions')
      .upsert({
        batch_id: batchId,
        question_id: questionId,
        sequence: batch.question_ids.indexOf(questionId) + 1,
        answered: true,
        selected_answer: selectedAnswer,
        correct: serverCorrect,
        answered_at: new Date().toISOString(),
        elapsed_ms: elapsedMs,
      }, { onConflict: 'batch_id,question_id' });

    if (upsertError) {
      return { error: 'ANSWER_RECORD_FAILED', message: upsertError.message };
    }

    // Update user_question_history
    await this._updateHistory({
      userId,
      questionId,
      batchId,
      selectedAnswer,
      correct: serverCorrect,
      mode: batch.mode,
      difficulty: null, // will be resolved from question
      examFramework: batch.exam_framework,
    });

    // Authoritative per-course difficulty-progression credit. Only genuinely
    // correct answers (server-graded) advance the difficulty unlock counts.
    if (serverCorrect && batch.course_key && batch.course_key !== 'global') {
      try {
        const { data: q } = await this.supabase
          .from('questions')
          .select('difficulty')
          .eq('id', questionId)
          .maybeSingle();
        const qDifficulty = q?.difficulty;
        if (qDifficulty && ['Easy', 'Moderate', 'Hard', 'Expert'].includes(qDifficulty)) {
          await this.supabase.rpc('record_difficulty_correct', {
            p_user_id: userId,
            p_difficulty: qDifficulty,
            p_course_key: batch.course_key,
          });
        }
      } catch (e) {
        console.warn('[QuestionSelection] difficulty credit failed:', e?.message);
      }
    }

    return { success: true, correct: serverCorrect };
  }

  // --------------------------------------------------------
  // PRIVATE: Grade a submitted answer against the stored canonical answer.
  // Returns true only when the stored correct_answer matches the submission
  // (trimmed, case-insensitive; also handles numeric/letter indices).
  // --------------------------------------------------------
  async _gradeAnswer(questionId, selectedAnswer) {
    if (selectedAnswer === null || selectedAnswer === undefined || selectedAnswer === '') {
      return false;
    }
    try {
      const { data: q, error } = await this.supabase
        .from('questions')
        .select('correct_answer, options')
        .eq('id', questionId)
        .maybeSingle();
      if (error || !q) return false;

      const normalize = (v) => String(v ?? '').trim().toLowerCase();
      const submitted = normalize(selectedAnswer);
      const canonical = normalize(q.correct_answer);

      if (submitted === canonical) return true;

      // Fallback: the client may submit the option INDEX instead of the text.
      // If `selectedAnswer` is an integer index into q.options, compare the
      // indexed option against the canonical answer.
      const asIndex = Number(selectedAnswer);
      if (Array.isArray(q.options) && Number.isInteger(asIndex) && asIndex >= 0 && asIndex < q.options.length) {
        if (normalize(q.options[asIndex]) === canonical) return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------
  // Complete a batch
  // --------------------------------------------------------
  async completeBatch({ batchId, userId }) {
    const { data: batch, error } = await this.supabase
      .from('quiz_batches')
      .select('*')
      .eq('id', batchId)
      .eq('user_id', userId)
      .single();

    if (error || !batch) {
      return { error: 'BATCH_NOT_FOUND' };
    }

    // Duplicate-completion guard: a batch is finalized exactly once. A replayed
    // completion request returns the already-recorded result WITHOUT touching
    // the DB again, so replays can't re-record or double-credit anything.
    if (batch.status === 'completed') {
      const { data: prevAnswers } = await this.supabase
        .from('quiz_batch_questions')
        .select('*')
        .eq('batch_id', batchId);
      const prev = (prevAnswers || []).filter(a => a.answered);
      return {
        success: true,
        alreadyCompleted: true,
        score: prev.filter(a => a.correct).length,
        total: prev.length,
        answers: prev,
      };
    }

    // Fetch answers for scoring
    const { data: answers } = await this.supabase
      .from('quiz_batch_questions')
      .select('*')
      .eq('batch_id', batchId);

    const correct = (answers || []).filter(a => a.correct).length;
    const total = (answers || []).filter(a => a.answered).length;

    // Guard the status transition with a conditional update so two concurrent
    // completions cannot double-fire (only the first flips the status).
    const { error: upErr } = await this.supabase
      .from('quiz_batches')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', batchId)
      .in('status', ['reserved', 'started']);

    if (upErr) {
      return { error: 'COMPLETE_FAILED', message: upErr.message };
    }

    return {
      success: true,
      alreadyCompleted: false,
      score: correct,
      total,
      answers: answers || [],
    };
  }

  // ============================================================
  // PRIVATE: Candidate fetching (hard constraints only)
  // ============================================================
  async _fetchCandidates({ courseId, courseIds, subject, subjects, aggregate, framework, subjectFilter, topicFilter }) {
    let query = this.supabase
      .from('questions')
      .select('*')
      .eq('is_active', true);

    // Hard constraint: exam framework
    if (framework) {
      query = query.eq('exam_framework', framework);
    }

    // Hard constraint: course. Aggregate courses (weakness/daily) span all
    // banks and must NOT be pinned to a single course_id. `courseIds` covers
    // "both" exam sources (NCLEX + NMCN) for clinical/quick courses.
    if (courseIds && courseIds.length > 0) {
      query = query.in('course_id', courseIds);
    } else if (courseId && !aggregate) {
      query = query.eq('course_id', courseId);
    }
    if (subjects && subjects.length > 0) {
      query = query.in('subject_id', subjects);
    } else if (subject) {
      query = query.eq('subject_id', subject);
    }

    // Hard constraint: subject filter (explicit, overrides course subject)
    if (subjectFilter) {
      query = query.eq('subject_id', subjectFilter);
    }

    // Hard constraint: topic filter
    if (topicFilter) {
      query = query.eq('topic_id', topicFilter);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[QuestionSelection] Candidate fetch error:', error);
      return [];
    }

    return data || [];
  }

  // ============================================================
  // PRIVATE: Fetch user's question history
  // ============================================================
  async _fetchUserHistory(userId) {
    const { data, error } = await this.supabase
      .from('user_question_history')
      .select('*')
      .eq('user_id', userId);

    if (error || !data) {
      return { questions: new Map(), batchDistance: new Map(), totalBatches: 0 };
    }

    // Build lookup maps
    const questions = new Map();
    for (const row of data) {
      questions.set(row.question_id, row);
    }

    // Calculate batch distance for each question
    // We need the batch creation times to determine "distance"
    const batchIds = [...new Set(data.map(r => r.batch_id).filter(Boolean))];
    let batchDistance = new Map();

    if (batchIds.length > 0) {
      const { data: batches } = await this.supabase
        .from('quiz_batches')
        .select('id, created_at')
        .in('id', batchIds)
        .order('created_at', { ascending: false });

      if (batches) {
        // Most recent batch = distance 0, next = distance 1, etc.
        const latestBatchTime = batches.length > 0 ? new Date(batches[0].created_at).getTime() : 0;

        for (let i = 0; i < batches.length; i++) {
          const batchTime = new Date(batches[i].created_at).getTime();
          const hoursDiff = (latestBatchTime - batchTime) / 3600000;
          // Convert hours to approximate batch distance
          let distance;
          if (hoursDiff < 1) distance = 0;
          else if (hoursDiff < 24) distance = 1;
          else if (hoursDiff < 72) distance = 2;
          else if (hoursDiff < 168) distance = 3;
          else if (hoursDiff < 336) distance = 4;
          else if (hoursDiff < 504) distance = 5;
          else distance = 6;

          batchDistance.set(batches[i].id, distance);
        }
      }
    }

    // Count total batches for this user
    const { count } = await this.supabase
      .from('quiz_batches')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'completed');

    return {
      questions,
      batchDistance,
      totalBatches: count || 0,
    };
  }

  // ============================================================
  // PRIVATE: Calculate weight for a single question
  // ============================================================
  _calculateWeight(question, userHistory, topicCounts, conceptCounts, relaxation) {
    const qid = question.id;
    const history = userHistory.questions.get(qid);
    const isUnseen = !history;

    // 1. Base weight
    let weight = isUnseen
      ? C.BASE_WEIGHT * C.UNSEEN_MULTIPLIER
      : C.BASE_WEIGHT;

    // 2. Recency weight (batch distance)
    let recencyWeight = 1.0;
    if (!isUnseen && history.batch_id) {
      const distance = userHistory.batchDistance.get(history.batch_id);
      recencyWeight = batchRecencyWeight(distance);
    }
    weight *= recencyWeight * relaxation.recencyMultiplier;

    // 3. Time-based recency
    if (!isUnseen && relaxation.useTimeDecay && history.last_seen_at) {
      const hoursSinceSeen = (Date.now() - new Date(history.last_seen_at).getTime()) / 3600000;
      const timeWeight = timeRecencyWeight(hoursSinceSeen);
      weight *= timeWeight;
    }

    // 4. Topic diversity penalty
    if (question.topic_id && topicCounts) {
      const topicCount = topicCounts.get(question.topic_id) || 0;
      const topicPenalty = topicCount * C.TOPIC_PENALTY_PER_QUESTION * relaxation.topicPenaltyMultiplier;
      weight *= Math.max(0.1, 1.0 - topicPenalty);
    }

    // 5. Concept diversity penalty
    if (question.concept_id && conceptCounts) {
      const conceptCount = conceptCounts.get(question.concept_id) || 0;
      const conceptPenalty = conceptCount * C.CONCEPT_PENALTY_PER_QUESTION * relaxation.conceptPenaltyMultiplier;
      weight *= Math.max(0.1, 1.0 - conceptPenalty);
    }

    // 6. Randomness factor
    weight *= randomInRange(C.RANDOMNESS_RANGE);

    return Math.max(0.001, weight); // Never zero
  }

  // ============================================================
  // PRIVATE: Weighted random selection
  // ============================================================
  _weightedRandomSelect(candidates, weights) {
    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    if (totalWeight <= 0) return null;

    let random = Math.random() * totalWeight;
    for (let i = 0; i < candidates.length; i++) {
      random -= weights[i];
      if (random <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  // ============================================================
  // PRIVATE: Select with progressive relaxation
  // ============================================================
  _selectWithRelaxation(candidates, targetCount, userHistory, selectedSet, topicCounts, conceptCounts) {
    if (candidates.length === 0 || targetCount <= 0) {
      return { selected: [], level: 0 };
    }

    const levels = C.RELAXATION_LEVELS;

    for (let l = 0; l < levels.length; l++) {
      const relaxation = levels[l];

      // Fresh diversity tracking per relaxation level
      const localTopicCounts = new Map();
      const localConceptCounts = new Map();

      // Calculate weights for all candidates
      const weights = candidates.map(q =>
        this._calculateWeight(q, userHistory, localTopicCounts, localConceptCounts, relaxation)
      );

      // Weighted selection without replacement
      const pool = [...candidates];
      const poolWeights = [...weights];
      const selected = [];

      for (let i = 0; i < targetCount && pool.length > 0; i++) {
        const chosen = this._weightedRandomSelect(pool, poolWeights);
        if (!chosen) break;

        selected.push(chosen);

        // Remove chosen from pool (prevents re-selection)
        const idx = pool.indexOf(chosen);
        pool.splice(idx, 1);
        poolWeights.splice(idx, 1);

        // Update diversity tracking for subsequent selections within this level
        if (chosen.topic_id) {
          localTopicCounts.set(chosen.topic_id, (localTopicCounts.get(chosen.topic_id) || 0) + 1);
        }
        if (chosen.concept_id) {
          localConceptCounts.set(chosen.concept_id, (localConceptCounts.get(chosen.concept_id) || 0) + 1);
        }
      }

      if (selected.length >= targetCount) {
        // Update the parent-level tracking with this level's selections
        for (const [topic, count] of localTopicCounts) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + count);
        }
        for (const [concept, count] of localConceptCounts) {
          conceptCounts.set(concept, (conceptCounts.get(concept) || 0) + count);
        }
        return { selected, level: l };
      }
    }

    // If we couldn't fill the target, return whatever we got from the last level
    // (the last level's selected array is lost, so re-select with minimal constraints)
    const pool = [...candidates];
    const selected = [];
    for (let i = 0; i < targetCount && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      selected.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return { selected, level: levels.length - 1 };
  }

  // ============================================================
  // PRIVATE: Create batch transactionally
  // ============================================================
  async _createBatchTransaction({
    userId,
    mode,
    examFramework,
    courseKey,
    difficultyDistribution,
    questionIds,
    selectionId,
    relaxationLevel,
    metadata = {},
  }) {
    const expiresAt = new Date(
      Date.now() + C.BATCH_EXPIRY_MINUTES * 60000
    ).toISOString();

    // Create the batch
    const { data: batch, error: batchError } = await this.supabase
      .from('quiz_batches')
      .insert({
        user_id: userId,
        mode,
        exam_framework: examFramework,
        course_key: courseKey,
        difficulty_distribution: difficultyDistribution,
        question_ids: questionIds,
        total_questions: questionIds.length,
        status: 'reserved',
        expires_at: expiresAt,
        metadata: {
          ...metadata,
          selectionId,
          relaxationLevel,
          candidateCount: questionIds.length,
        },
      })
      .select()
      .single();

    if (batchError) {
      console.error('[QuestionSelection] Batch creation error:', batchError);
      throw new Error(`Failed to create batch: ${batchError.message}`);
    }

    // Record exposure for each question in user_question_history
    const historyInserts = questionIds.map((qid) => ({
      user_id: userId,
      question_id: qid,
      batch_id: batch.id,
      last_seen_at: new Date().toISOString(),
      last_batch_id: batch.id,
      last_mode: mode,
      last_exam_framework: examFramework,
    }));

    // Use upsert to handle conflicts (update times_seen)
    for (const insert of historyInserts) {
      await this.supabase
        .from('user_question_history')
        .upsert(insert, {
          onConflict: 'user_id,question_id',
          ignoreDuplicates: false,
        });
    }

    return batch;
  }

  // ============================================================
  // PRIVATE: Update history after answer
  // ============================================================
  async _updateHistory({ userId, questionId, batchId, selectedAnswer, correct, mode, difficulty, examFramework }) {
    const { data: existing } = await this.supabase
      .from('user_question_history')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .single();

    if (existing) {
      await this.supabase
        .from('user_question_history')
        .update({
          last_answered_at: new Date().toISOString(),
          correct_count: existing.correct_count + (correct ? 1 : 0),
          incorrect_count: existing.incorrect_count + (correct ? 0 : 1),
          last_selected_answer: selectedAnswer,
          last_mode: mode || existing.last_mode,
          last_difficulty: difficulty || existing.last_difficulty,
          last_exam_framework: examFramework || existing.last_exam_framework,
        })
        .eq('user_id', userId)
        .eq('question_id', questionId);
    } else {
      await this.supabase
        .from('user_question_history')
        .insert({
          user_id: userId,
          question_id: questionId,
          batch_id: batchId,
          times_seen: 1,
          last_seen_at: new Date().toISOString(),
          last_answered_at: new Date().toISOString(),
          correct_count: correct ? 1 : 0,
          incorrect_count: correct ? 0 : 1,
          last_selected_answer: selectedAnswer,
          last_mode: mode,
          last_difficulty: difficulty,
          last_exam_framework: examFramework,
        });
    }
  }

  // ============================================================
  // PRIVATE: Cleanup expired batches
  // ============================================================
  async _cleanupExpiredBatches(userId) {
    await this.supabase
      .from('quiz_batches')
      .update({ status: 'abandoned', completed_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('status', ['reserved', 'started'])
      .lt('expires_at', new Date().toISOString());
  }

  // ============================================================
  // PRIVATE: Validate request (hard constraints)
  // ============================================================
  _validateRequest({ userId, mode, courseKey, framework, finalDiffDist }) {
    if (!userId) throw new Error('userId is required');
    if (!mode || !C.VALID_MODES.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Must be one of: ${C.VALID_MODES.join(', ')}`);
    }
    if (!courseKey) throw new Error('courseKey is required');
    if (framework && !C.VALID_FRAMEWORKS.includes(framework)) {
      throw new Error(`Invalid exam framework: ${framework}. Must be one of: ${C.VALID_FRAMEWORKS.join(', ')}`);
    }
    if (!finalDiffDist || typeof finalDiffDist !== 'object') {
      throw new Error('difficultyDistribution must be an object');
    }

    // Validate difficulty keys
    for (const key of Object.keys(finalDiffDist)) {
      if (!C.VALID_DIFFICULTIES.includes(key)) {
        throw new Error(`Invalid difficulty: ${key}. Must be one of: ${C.VALID_DIFFICULTIES.join(', ')}`);
      }
      if (typeof finalDiffDist[key] !== 'number' || finalDiffDist[key] < 0) {
        throw new Error(`Difficulty count for ${key} must be a non-negative number`);
      }
    }
  }

  // ============================================================
  // PRIVATE: Resolve canonical course metadata (fail closed).
  // Maps courseKey -> { dbCourseId, framework?, subject?, aggregate } and
  // validates that any framework-dedicated courseKey carries a recognised
  // framework suffix.
  // ============================================================
  _resolveCourseMetadata(courseKey) {
    const [courseId, suffix] = String(courseKey || '').split(':');
    const meta = COURSE_METADATA[courseId];
    if (!meta) {
      throw new Error(`UNKNOWN_COURSE: no course matches "${courseId}"`);
    }
    if (meta.aggregate) {
      return { dbCourseId: null, framework: null, subject: null, aggregate: true };
    }
    if (meta.dbCourseIdByFramework) {
      const fw = suffix ? suffix.toUpperCase() : null;
      // The client's default exam source is 'both' -> span NCLEX + NMCN banks.
      if (fw === 'BOTH') {
        return {
          dbCourseIds: ['nclex', 'nmcn'],
          framework: null,
          subject: null,
          aggregate: false,
        };
      }
      const dbCourseId = fw ? meta.dbCourseIdByFramework[fw] : null;
      if (!fw || !dbCourseId) {
        throw new Error(
          `INVALID_COURSE_KEY: "${courseKey}" requires an explicit framework suffix (${Object.keys(meta.dbCourseIdByFramework).join('|').toLowerCase()})`
        );
      }
      return { dbCourseId, framework: fw, subject: null, aggregate: false };
    }
    if (meta.hasSubjects) {
      if (!suffix) {
        throw new Error(`INVALID_COURSE_KEY: "${courseKey}" requires a subject suffix`);
      }
      if (meta.subjectGroups) {
        const subjects = meta.subjectGroups[suffix];
        if (!subjects || subjects.length === 0) {
          throw new Error(
            `INVALID_COURSE_KEY: "${courseKey}" is not a recognised ${courseId} course (${Object.keys(meta.subjectGroups).join(' | ')})`
          );
        }
        return { dbCourseId: meta.dbCourseId, framework: null, subject: null, subjects, aggregate: false };
      }
      return { dbCourseId: meta.dbCourseId, framework: null, subject: suffix, aggregate: false };
    }
    if (suffix) {
      throw new Error(`INVALID_COURSE_KEY: "${courseKey}" should have no suffix`);
    }
    return { dbCourseId: meta.dbCourseId, framework: null, subject: null, aggregate: false };
  }

  // ============================================================
  // PRIVATE: Effective progression mode for a course.
  // Weakness & Daily challenges share progression with all their source
  // courses (most restrictive), so their unlock state is computed from an
  // aggregate across all per-course progress rows.
  // ============================================================
  _effectiveProgressionMode(courseKey) {
    if (courseKey === 'weakness-challenge' || courseKey === 'daily-challenge') {
      return 'SHARED';
    }
    return courseKey;
  }

  // ============================================================
  // PRIVATE: Authoritative per-course difficulty access check.
  // Returns { unlocked, locked? } where locked = first closed difficulty.
  // ============================================================
  async _validateDifficultyAccess({ userId, courseKey, difficulties }) {
    const mode = this._effectiveProgressionMode(courseKey);
    const progress = await this._fetchCourseDifficultyProgress(userId, mode);
    for (const d of difficulties) {
      if (!this._isDifficultyUnlocked(progress, d)) {
        return { unlocked: false, locked: d };
      }
    }
    return { unlocked: true };
  }

  // ============================================================
  // PRIVATE: Fetch correct-count progress per difficulty.
  // mode='SHARED' -> per-difficulty MINIMUM correct across all per-course rows.
  // Otherwise -> per-difficulty correct for that exact course_key.
  // ============================================================
  async _fetchCourseDifficultyProgress(userId, mode) {
    const base = { user_id: userId, difficulty: ['Easy', 'Moderate', 'Hard', 'Expert'] };
    let rows;
    if (mode === 'SHARED') {
      const { data, error } = await this.supabase
        .from('difficulty_progress')
        .select('difficulty, correct_count')
        .eq('user_id', userId)
        .neq('course_key', 'global')
        .in('difficulty', base.difficulty);
      if (error) {
        console.error('[QuestionSelection] Shared progress fetch error:', error);
        rows = [];
      } else {
        rows = data || [];
      }
      // Most restrictive: take the minimum correct_count per difficulty.
      const min = {};
      for (const r of rows) {
        if (!(r.difficulty in min) || r.correct_count < min[r.difficulty]) {
          min[r.difficulty] = r.correct_count;
        }
      }
      return min;
    }

    const { data, error } = await this.supabase
      .from('difficulty_progress')
      .select('difficulty, correct_count')
      .eq('user_id', userId)
      .eq('course_key', mode)
      .in('difficulty', base.difficulty);
    if (error) {
      console.error('[QuestionSelection] Progress fetch error:', error);
      return {};
    }
    return Object.fromEntries((data || []).map(r => [r.difficulty, r.correct_count]));
  }

  // ============================================================
  // PRIVATE: Is a difficulty unlocked given correct-count progress?
  //   Easy     : always
  //   Moderate : needs 50 Easy correct
  //   Hard     : needs 80 Moderate correct
  //   Expert   : needs 100 Hard correct
  // ============================================================
  _isDifficultyUnlocked(progress, requestedDifficulty) {
    const order = ['Easy', 'Moderate', 'Hard', 'Expert'];
    const thresholds = { Moderate: 50, Hard: 80, Expert: 100 };
    if (!order.includes(requestedDifficulty)) return false;
    const idx = order.indexOf(requestedDifficulty);
    if (idx <= 0) return true; // Easy always unlocked
    const gate = order[idx - 1];
    const need = thresholds[requestedDifficulty];
    return (progress[gate] || 0) >= need;
  }
}
