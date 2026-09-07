# POLYNURSE — IMPLEMENTATION PLAN

## Overview
Implement progressive difficulty locking per course, server-side quota enforcement in batch-create, courseKeyâ†’framework validation, and update all 7 E2E scripts. This plan covers database migrations, API changes, server-side validation, UI updates, and test coverage.

---

## 1. DATABASE MIGRATIONS

### 1.1 Migration v15: Per-Course Difficulty Progress (extends existing table)
**File**: scripts/migration-v15-per-course-difficulty.sql

Changes to difficulty_progress table:
- Add course_key text NOT NULL DEFAULT 'global' column
- Change PK from (user_id, difficulty) to (user_id, course_key, difficulty)
- Update ecord_difficulty_correct RPC to accept p_course_key (default 'global' for backwards compat)
- Update get_difficulty_status RPC to return per-course progress when p_course_key provided, else aggregate
- Backfill existing rows with course_key = 'global'
- Add index on (user_id, course_key)

**Course Key Mapping for Progression:**
- NCLEX (clinical-challenge:nclex) â†’ own progression
- NMCN (clinical-challenge:nmcn) â†’ own progression
- Quick Quiz NCLEX (quick-quiz:nclex) â†’ own progression
- Quick Quiz NMCN (quick-quiz:nmcn) â†’ own progression
- Nursing 200 subjects (
ursing-200:<Subject>) â†’ per-subject progression
- Midwifery 200 subjects (midwifery-200:<Subject>) â†’ per-subject progression
- Uselu Test (uselu-test) â†’ own progression
- **Weakness Challenge (weakness-challenge)** â†’ SHARES progression with source courses (NCLEX/NMCN/Nursing 200/Midwifery 200)
- **Daily Challenge (daily-challenge)** â†’ SHARED progression (aggregated across all courses)

New unlock thresholds (per course):
- Easy: 0 (always unlocked)
- Moderate: 50 correct on Easy in same course
- Hard: 80 correct on Moderate in same course
- Expert: 100 correct on Hard in same course

### 1.2 Migration v16: Update Quota Cooldown to 30 Minutes
**File**: scripts/migration-v16-30min-cooldown.sql

Update consume_course_quota RPC:
- Change 
ow() + interval '1 hour' -> 
ow() + interval '30 minutes'
- Update cooldown_remaining_seconds calculation (1800 instead of 3600)

**Rollback Note**: Dropping course_key column is NOT sufficient for v15 rollback. Full rollback requires:
1. Recreate original difficulty_progress table with PK (user_id, difficulty)
2. Migrate data back (aggregate per-course rows or keep 'global' only)
3. Restore original RPC signatures
4. This is a one-way migration; plan accordingly.

---

## 2. SERVER-SIDE API CHANGES

### 2.1 api/quiz/batch-create.js — Defense-in-Depth Quota Check
Add **before** calling QuestionSelectionService.createQuizBatch:

`javascript
// Quick quota check (defense in depth)
const quotaCheck = await supabase.rpc('consume_course_quota', {
  p_user_id: user.id,
  p_course_key: courseKey,
  p_count: finalBatchSize,
  p_is_premium: isPremium
});

if (quotaCheck.data && quotaCheck.data.allowed === false) {
  return res.status(403).json({
    error: 'QUOTA_EXHAUSTED',
    message: quotaCheck.data.message || 'Course round on cooldown',
    cooldown_remaining_seconds: quotaCheck.data.cooldown_remaining_seconds,
    window_expires_at: quotaCheck.data.window_expires_at
  });
}
`

### 2.2 api/questionSelectionService.js — Authoritative Quota + Difficulty + Framework Validation

#### A. Add alidateCourseDifficultyAccess() method
`javascript
async validateCourseDifficultyAccess({ userId, courseKey, requestedDifficulty }) {
  // 1. Resolve courseKey â†’ canonical course metadata (incl. expected framework)
  const courseMeta = this._resolveCourseMetadata(courseKey);
  
  // 2. Validate framework matches
  if (courseMeta.framework && this.framework !== courseMeta.framework) {
    throw new Error(Framework mismatch: requested  but course  is );
  }
  
  // 3. Check difficulty progression per course (with Weakness/Daily sharing logic)
  const effectiveCourseKey = this._getEffectiveCourseKeyForProgression(courseKey);
  const progress = await this._fetchCourseDifficultyProgress(userId, effectiveCourseKey);
  const isUnlocked = this._isDifficultyUnlocked(progress, requestedDifficulty);
  if (!isUnlocked) {
    throw new Error(Difficulty  not unlocked for course );
  }
  
  // 4. Validate quota (authoritative, final check)
  const quota = await this._checkCourseQuota(userId, courseKey, isPremium);
  if (!quota.allowed) {
    throw new Error('QUOTA_EXHAUSTED');
  }
  
  return { courseMeta, quota };
}
`

#### B. Add _getEffectiveCourseKeyForProgression(courseKey) — Progression Sharing Logic
`javascript
_getEffectiveCourseKeyForProgression(courseKey) {
  // Weakness Challenge and Daily Challenge share progression with source courses
  if (courseKey === 'weakness-challenge' || courseKey === 'daily-challenge') {
    // For these, we check the MOST RESTRICTIVE progression across all source courses
    // Return a special marker; _fetchCourseDifficultyProgress handles aggregation
    return 'SHARED';
  }
  return courseKey;
}
`

#### C. Add _resolveCourseMetadata(courseKey) — Centralized Mapping
`javascript
_resolveCourseMetadata(courseKey) {
  const [courseId, suffix] = courseKey.split(':');
  const metadata = {
    'clinical-challenge': { frameworks: ['NCLEX', 'NMCN'], defaultFramework: 'NCLEX' },
    'quick-quiz':       { frameworks: ['NCLEX', 'NMCN'], defaultFramework: 'NMCN' },
    'nursing-200':    { frameworks: [null], defaultFramework: null, hasSubjects: true },
    'midwifery-200':  { frameworks: [null], defaultFramework: null, hasSubjects: true },
    'uselu-test':     { frameworks: [null], defaultFramework: null },
    'weakness-challenge': { frameworks: [null], defaultFramework: null },
    'daily-challenge':    { frameworks: [null], defaultFramework: null },
  };
  
  const meta = metadata[courseId];
  if (!meta) throw new Error(Unknown course: );
  
  // For framework-dedicated courses, suffix MUST be valid framework
  if (meta.frameworks.includes('NCLEX') || meta.frameworks.includes('NMCN')) {
    const framework = suffix?.toUpperCase();
    if (!C.VALID_FRAMEWORKS.includes(framework)) {
      throw new Error(Course  requires explicit framework (NCLEX|NMCN));
    }
    return { ...meta, framework, subject: null };
  }
  
  // For subject-based courses
  if (meta.hasSubjects) {
    return { ...meta, framework: null, subject: suffix };
  }
  
  return { ...meta, framework: null, subject: null };
}
`

#### D. Add _fetchCourseDifficultyProgress(userId, courseKey)
`javascript
async _fetchCourseDifficultyProgress(userId, courseKey) {
  if (courseKey === 'SHARED') {
    // For Weakness/Daily: aggregate progress across ALL courses
    // Return the MINIMUM progress per difficulty (most restrictive)
    const allCourses = [
      'clinical-challenge:nclex', 'clinical-challenge:nmcn',
      'quick-quiz:nclex', 'quick-quiz:nmcn',
      'uselu-test',
      // 200-level subjects would need dynamic lookup
    ];
    
    const combinedProgress = {};
    for (const ck of allCourses) {
      const { data } = await this.supabase
        .from('difficulty_progress')
        .select('difficulty, correct_count')
        .eq('user_id', userId)
        .eq('course_key', ck);
      
      for (const row of data || []) {
        if (!combinedProgress[row.difficulty] || row.correct_count < combinedProgress[row.difficulty]) {
          combinedProgress[row.difficulty] = row.correct_count;
        }
      }
    }
    return combinedProgress;
  }
  
  const { data, error } = await this.supabase
    .from('difficulty_progress')
    .select('difficulty, correct_count')
    .eq('user_id', userId)
    .eq('course_key', courseKey);
  
  if (error) throw error;
  return Object.fromEntries((data || []).map(r => [r.difficulty, r.correct_count]));
}
`

#### E. Add _isDifficultyUnlocked(progress, requestedDifficulty)
`javascript
_isDifficultyUnlocked(progress, requestedDifficulty) {
  const order = ['Easy', 'Moderate', 'Hard', 'Expert'];
  const thresholds = { Moderate: 50, Hard: 80, Expert: 100 };
  const idx = order.indexOf(requestedDifficulty);
  if (idx <= 0) return true; // Easy always unlocked
  
  const requiredDiff = order[idx - 1];
  const requiredCount = thresholds[requestedDifficulty];
  const actualCount = progress[requiredDiff] || 0;
  return actualCount >= requiredCount;
}
`

#### F. Add _checkCourseQuota(userId, courseKey, isPremium) — Final Authoritative Check
`javascript
async _checkCourseQuota(userId, courseKey, isPremium) {
  if (isPremium) return { allowed: true };
  
  const { data, error } = await this.supabase.rpc('consume_course_quota', {
    p_user_id: userId,
    p_course_key: courseKey,
    p_count: 10,
    p_is_premium: false
  });
  
  if (error) throw error;
  return { allowed: data.allowed, ...data };
}
`

#### G. Integrate into createQuizBatch
Call alidateCourseDifficultyAccess at start of method, before candidate fetching.

**Admin Bypass**: is_admin() does NOT bypass difficulty locks (per clarification).

---

## 3. SERVER-SIDE DIFFICULTY RPC UPDATES

### 3.1 api/progress.js — Update to Accept Course Key
**GET /api/progress/difficulty**: Accept ?course_key= query param
- If provided, return per-course progress
- If omitted, return aggregated (backwards compat)

**POST /api/progress/difficulty**: Accept course_key in body
- Pass to ecord_difficulty_correct RPC

### 3.2 Update ecord_difficulty_correct RPC (in migration v15)
`sql
CREATE OR REPLACE FUNCTION public.record_difficulty_correct(
  p_user_id uuid,
  p_difficulty text,
  p_course_key text DEFAULT 'global'
) RETURNS void ...
`
- Upsert on (user_id, course_key, difficulty)

### 3.3 Update get_difficulty_status RPC (in migration v15)
`sql
CREATE OR REPLACE FUNCTION public.get_difficulty_status(
  p_user_id uuid,
  p_course_key text DEFAULT NULL
) RETURNS jsonb ...
`
- If p_course_key provided, filter by it
- If NULL, aggregate across all courses (for dashboard)

---

## 4. CLIENT-SIDE CHANGES

### 4.1 src/components/QuizSetupFlow.jsx — UI Difficulty Locking (Presentation Only)
- Receive difficultyProgress from context (per-course)
- In difficulty step, disable locked difficulties with lock icon
- Show tooltip: "Answer X more [previous difficulty] questions correctly to unlock"
- **Do NOT** enforce — server is authoritative

### 4.2 src/context/AppContext.jsx
- etchDifficultyStatus(courseKey) — pass courseKey to API
- ecordAnsweredBatch({ difficulty, answers, courseKey }) — pass courseKey
- Store difficultyProgress as { [courseKey]: { Easy: {...}, Moderate: {...}, ... } }

### 4.3 src/pages/Quiz.jsx
- In handleSetupComplete, pass courseKey to launchPlayer
- In launchPlayer, pass courseKey and difficulty to createBatch
- Remove client-side consumeCourseQuota call (server handles it)
- Handle 403 QUOTA_EXHAUSTED response -> show cooldown modal

### 4.4 src/hooks/useQuizBatch.js
- createBatch body includes courseKey and difficulty
- Handle 403 error with cooldown details

---

## 5. COURSEKEY â†’ FRAMEWORK VALIDATION

### Location: pi/questionSelectionService.js in _validateRequest and new _resolveCourseMetadata

Validation rules:
| courseKey pattern | Required Framework | Validation |
|-------------------|-------------------|------------|
| clinical-challenge:nclex | NCLEX | Must match |
| clinical-challenge:nmcn | NMCN | Must match |
| quick-quiz:nclex | NCLEX | Must match |
| quick-quiz:nmcn | NMCN | Must match |
| 
ursing-200:<Subject> | None (subject-based) | Subject must exist in LEVEL_SUBJECTS |
| midwifery-200:<Subject> | None (subject-based) | Subject must exist in LEVEL_SUBJECTS |
| uselu-test | None | No suffix |
| weakness-challenge | None | No suffix |
| daily-challenge | None | No suffix |

**Failure modes**:
- Invalid course_id -> 400: Unknown course
- Framework-dedicated course without valid framework suffix -> 400: Course requires explicit framework (NCLEX|NMCN)
- Framework mismatch (e.g., mode=nclex but courseKey=clinical-challenge:nmcn) -> 400: Framework mismatch
- Subject not in canonical list -> 400: Invalid subject for course

---

## 6. UI UPDATES

### 6.1 QuizSetupFlow.jsx Difficulty Step
`jsx
{DIFFICULTIES.map((d) => {
  const isLocked = difficultyProgress?.[courseKey]?.[d.id]?.unlocked === false;
  return (
    <button
      disabled={isLocked}
      onClick={() => !isLocked && setDifficulty(d.id)}
      className={isLocked ? 'opacity-40 cursor-not-allowed' : '...'}
    >
      {d.id}
      {isLocked && <Lock size={14} className="ml-1" />}
    </button>
  );
})}
`

### 6.2 Dashboard — Remove DifficultyProgressCard (already done per prior work)
- Keep difficulty progress only in quiz setup

### 6.3 Quiz.jsx Cooldown Modal
- Already exists (cooldownNotice state)
- Update to use server response cooldown_remaining_seconds and window_expires_at

---

## 7. E2E TEST UPDATES (All 7 Scripts)

### Scripts to Update:
1. scripts/e2e-course-quota-ui.mjs
2. scripts/e2e-free-quota-courses.mjs
3. scripts/e2e-full.mjs
4. scripts/e2e-quiz-flow.mjs
5. scripts/e2e-quiz-pharm.mjs
6. scripts/dbg-repro-course.mjs
7. scripts/debug-setup.mjs

### Changes per Script:
- Replace all "Clinical Challenge" -> "NCLEX"
- Replace all "Quick Quiz" -> "NMCN"
- Update courseKey expectations: clinical-challenge:both -> clinical-challenge:nclex / clinical-challenge:nmcn
- Update quota expectations: 1h -> 30min cooldown
- Remove Speed Mode assertions
- Remove "permanently unlocked difficulties" assertions
- Add assertions for:
  - Course selection (NCLEX, NMCN, Uselu, Nursing 200, Midwifery 200, Weakness)
  - Difficulty selection with progressive locking
  - Server rejection of locked difficulty (403)
  - Course-specific progression isolation
  - Course-specific 30-min cooldown
  - Quiz batch creation flow
  - Authentication
  - Private route protection
  - Framework filtering
  - NCLEX isolation
  - NMCN isolation
  - Quiz completion
  - Duplicate/replayed requests where practical

### Test Reporting:
- Tests requiring external credentials/configuration -> SKIPPED -- MANUAL CONFIGURATION REQUIRED
- Never report unexecuted test as PASS

---

## 8. IMPLEMENTATION ORDER

### Phase A: Database Migrations (Foundation)
1. Create migration-v15-per-course-difficulty.sql
2. Create migration-v16-30min-cooldown.sql
3. Apply to Supabase (via scripts/run-migration.mjs)

### Phase B: Server-Side Core (Authoritative Logic)
1. Update pi/progress.js — accept course_key, update RPC calls
2. Update pi/questionSelectionService.js — add validation methods, integrate into createQuizBatch
3. Update pi/quiz/batch-create.js — add defense-in-depth quota check
4. Update pi/selectionConfig.js — ensure VALID_FRAMEWORKS, VALID_MODES correct

### Phase C: Client-Side Integration
1. Update src/context/AppContext.jsx — pass courseKey to difficulty APIs
2. Update src/components/QuizSetupFlow.jsx — UI difficulty locking
3. Update src/pages/Quiz.jsx — remove client quota, pass courseKey/difficulty, handle 403
4. Update src/hooks/useQuizBatch.js — pass courseKey/difficulty, handle 403

### Phase D: CourseKeyâ†’Framework Validation
1. Implement _resolveCourseMetadata in QuestionSelectionService
2. Add validation in _validateRequest and createQuizBatch
3. Add logging for mapping failures

### Phase E: E2E Test Updates
1. Update all 7 scripts
2. Run each script against local dev (API + Vite)

### Phase F: Verification & Acceptance Testing
1. Run all E2E scripts
2. Manual verification of 10 acceptance criteria
3. Document PASS/FAIL/SKIPPED results

---

## 9. FILES TO MODIFY

### New Files:
- scripts/migration-v15-per-course-difficulty.sql
- scripts/migration-v16-30min-cooldown.sql

### Modified Files:
**Server/API:**
- pi/progress.js
- pi/questionSelectionService.js
- pi/quiz/batch-create.js
- pi/selectionConfig.js (verify only)

**Client/Context:**
- src/context/AppContext.jsx
- src/components/QuizSetupFlow.jsx
- src/pages/Quiz.jsx
- src/hooks/useQuizBatch.js

**E2E Tests (7 files):**
- scripts/e2e-course-quota-ui.mjs
- scripts/e2e-free-quota-courses.mjs
- scripts/e2e-full.mjs
- scripts/e2e-quiz-flow.mjs
- scripts/e2e-quiz-pharm.mjs
- scripts/dbg-repro-course.mjs
- scripts/debug-setup.mjs

---

## 10. ACCEPTANCE CRITERIA (Verification Checklist)

| # | Criteria | Test Method |
|---|----------|-------------|
| 1 | Locked difficulty cannot launch via UI | E2E: select locked difficulty -> Start Quiz -> 403 |
| 2 | Locked difficulty cannot launch via direct API | E2E: POST /api/quiz/batch-create with locked difficulty -> 403 |
| 3 | Difficulty progression isolated per course | E2E: unlock Moderate in NCLEX -> verify Hard still locked in NMCN |
| 4 | Quota enforced server-side | E2E: free user starts 2 rounds same course within 30min -> 2nd fails |
| 5 | Concurrent/replayed requests no double-consume | E2E: fire 2 simultaneous batch-create -> only 1 succeeds |
| 6 | Course cooldown enforced server-side | E2E: wait 30min -> 3rd round succeeds |
| 7 | NCLEX cannot receive NMCN questions | E2E: create nclex batch -> verify all questions exam_framework=NCLEX |
| 8 | NMCN cannot receive NCLEX questions | E2E: create nmcn batch -> verify all questions exam_framework=NMCN |
| 9 | All 7 E2E scripts reflect current architecture | Run all 7, verify PASS |
| 10 | No obsolete Speed Mode / old quota logic | Grep codebase for removed terms |

---

## 11. RISK MITIGATION

| Risk | Mitigation |
|------|------------|
| Migration breaks existing user progress | Hybrid approach: backfill course_key='global', new progress per-course |
| Concurrent quota consumption race | RPC consume_course_quota uses atomic UPSERT with WHERE guard |
| Framework validation gaps | Centralized _resolveCourseMetadata with exhaustive course map |
| Client/server difficulty drift | Server authoritative; client UI only presentation |
| E2E flakiness | Use waitBody textContent polling pattern (already established) |
| v15 rollback complexity | Document as one-way migration; test thoroughly in staging first |

---

## 12. ESTIMATED EFFORT

| Phase | Files | Est. Hours |
|-------|-------|------------|
| A: Migrations | 2 new | 2 |
| B: Server Core | 4 modified | 4 |
| C: Client Integration | 4 modified | 3 |
| D: Framework Validation | 1 modified | 2 |
| E: E2E Updates | 7 modified | 3 |
| F: Verification | - | 2 |
| **Total** | **17 files** | **~16 hours** |

---

## 13. DECISIONS LOG

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Admin unlock bypass | **NO** — is_admin() does NOT bypass difficulty locks |
| 2 | Weakness Challenge progression | **SHARES** with source courses (most restrictive) |
| 3 | Daily Challenge progression | **SHARED** (aggregated across all courses) |
| 4 | v15 migration rollback | **NOT sufficient** to drop column; requires full table recreation |
| 5 | Migration strategy | **Hybrid** — extend existing table with course_key |
| 6 | Quota enforcement layer | **Both** — API handler + QuestionSelectionService (defense in depth) |
| 7 | Cooldown duration | **30 minutes** |

---

## Next Steps
Upon approval, I'll begin with Phase A (migrations) and proceed sequentially through Phase F, reporting results at each stage.
