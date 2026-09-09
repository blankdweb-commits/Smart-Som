# Question Selection Engine — Architecture & Algorithm Documentation

## Overview

The Controlled-Random Question Selection Engine is a **server-authoritative** system that provides controlled-random question batches for all quiz modes. It replaces the old client-side `selectQuestions()` function with a transactional, batch-reserving service that prevents duplicate exposure across concurrent requests.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT (React SPA)                    │
│                                                         │
│  useQuizBatch hook                                      │
│    ├─ createBatch()  → POST /api/quiz-batch-create      │
│    ├─ fetchBatch()   → GET  /api/quiz-batch-get?id=     │
│    ├─ recordAnswer() → POST /api/quiz-batch-answer      │
│    └─ completeBatch()→ POST /api/quiz-batch-complete    │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTPS (Bearer token auth)
┌─────────────────────────▼───────────────────────────────┐
│                  API LAYER (Vercel Serverless)           │
│                                                         │
│  api/quiz-batch-create.js                               │
│    └─ QuestionSelectionService.createQuizBatch()        │
│                                                         │
│  api/quiz-batch-get.js                                  │
│    └─ QuestionSelectionService.getBatch()               │
│                                                         │
│  api/quiz-batch-answer.js                               │
│    └─ QuestionSelectionService.recordAnswer()           │
│                                                         │
│  api/quiz-batch-complete.js                             │
│    └─ QuestionSelectionService.completeBatch()          │
│                                                         │
│  api/matches-create.js                                  │
│    └─ QuestionSelectionService.createMatchBatch()       │
└─────────────────────────┬───────────────────────────────┘
                          │ Service-role client
┌─────────────────────────▼───────────────────────────────┐
│                  DATABASE (Supabase PostgreSQL)          │
│                                                         │
│  questions              — normalized question bank       │
│  quiz_batches           — reserved batch records         │
│  quiz_batch_questions   — per-question tracking          │
│  user_question_history  — batch-aware exposure history   │
│  question_attempts      — legacy answer log (extended)   │
└─────────────────────────────────────────────────────────┘
```

## Data Model

### `questions`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | text PK | Question identifier (e.g. "pharm-1") |
| `course_id` | text | Course grouping (nmcn, nclex, nursing200, midwifery, uselu) |
| `subject_id` | text | Subject (e.g. "Pharmacology") |
| `topic_id` | text | Topic for diversity tracking |
| `concept_id` | text | Concept cluster for diversity (optional) |
| `difficulty` | text | Easy, Medium, Hard, Expert |
| `exam_framework` | text | NCLEX, NMCN, or null |
| `question_text` | text | The question |
| `options` | jsonb | Answer options array |
| `correct_answer` | text | Correct answer text |
| `explanation` | text | Rationale |
| `hint` | text | Hint |
| `source` | text | Provenance |

### `quiz_batches`
| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | Batch identifier |
| `user_id` | uuid FK | Owner |
| `mode` | text | Quiz mode |
| `exam_framework` | text | NCLEX/NMCN (validated) |
| `course_key` | text | Course key |
| `question_ids` | text[] | Ordered question IDs |
| `status` | text | reserved → started → completed/abandoned |
| `expires_at` | timestamptz | Batch expiry |

### `user_question_history`
| Column | Type | Purpose |
|--------|------|---------|
| `user_id` | uuid FK | Owner |
| `question_id` | text FK | Question |
| `batch_id` | uuid FK | Batch that exposed this question |
| `times_seen` | int | Total exposures |
| `last_seen_at` | timestamptz | Last exposure time |
| `correct_count` | int | Correct answers |
| `incorrect_count` | int | Incorrect answers |

## Weighting Formula

```
finalWeight =
  baseWeight
  × recencyWeight          (batch distance)
  × timeRecencyWeight      (hours since seen)
  × topicDiversityWeight   (same-topic count penalty)
  × conceptDiversityWeight (same-concept count penalty)
  × randomnessFactor       (0.8–1.2 random range)
```

### Recency Weights (Batch Distance)
| Distance | Weight |
|----------|--------|
| Never seen | 1.00 |
| Previous batch | 0.05 |
| 2 batches ago | 0.15 |
| 3 batches ago | 0.30 |
| 4 batches ago | 0.50 |
| 5 batches ago | 0.70 |
| 6+ batches ago | 1.00 |

### Time-Based Decay
- Half-life: 24 hours
- Max penalty: 0.4 (just-seen)
- Formula: `1.0 - exp(-hours/24) × 0.4`

## Progressive Relaxation

When the pool is too small to fill a batch:

1. **Strict** — Full recency + concept + topic diversity
2. **Relax concept** — Reduce concept penalty by 70%
3. **Relax topic** — Reduce topic penalty by 70%
4. **Relax recency** — Reduce recency multiplier by 70%, disable time decay
5. **Minimal** — No diversity penalties, minimal recency

The only constraint that NEVER relaxes: **no duplicate question ID within the same batch**.

## Special Cases

### 1v1 Matches
- Server selects ONE question sequence for the match
- Both players receive exactly the same sequence
- `createMatchBatch()` creates batches for both players with shared `question_ids`

### NCLEX/NMCN Filtering
- Hard constraint: `exam_framework` must match
- Server validates framework — client cannot override
- NCLEX batches contain only `exam_framework = 'NCLEX'` questions

## Concurrency Protection

1. Batch creation is transactional (insert batch + record exposure atomically)
2. Expired batches are cleaned up on each new batch creation
3. Batch status transitions: `reserved → started → completed | abandoned`
4. Answer recording validates batch ownership and expiry

## Configuration

All tunable parameters live in `api/selectionConfig.js`:
- Recency weights
- Unseen multiplier
- Topic/concept penalties
- Randomness range
- Progressive relaxation thresholds
- Mode-specific configs (batch size, difficulty distribution)

## Mode Configurations

| Mode | Batch Size | Difficulty Distribution |
|------|-----------|------------------------|
| practice | 10 | Easy: 10 |
| dailyQuiz | 10 | Easy: 3, Medium: 4, Hard: 3 |
| topicQuiz | 20 | Easy: 5, Medium: 5, Hard: 5, Expert: 5 |
| examSimulation | 50 | Easy: 10, Medium: 15, Hard: 15, Expert: 10 |
| nclex | 30 | Easy: 5, Medium: 10, Hard: 10, Expert: 5 |
| nmcn | 30 | Easy: 5, Medium: 10, Hard: 10, Expert: 5 |
| oneVsOne | 10 | Easy: 2, Medium: 3, Hard: 3, Expert: 2 |
| weakness | 20 | Easy: 5, Medium: 5, Hard: 5, Expert: 5 |

## Testing

### Simulation Test
Run `node scripts/simulate-question-selection.mjs` to verify:
- Zero intra-batch duplicates
- No pathological repetition
- Reasonable topic/difficulty distribution
- Long-term question coverage

### Acceptance Criteria
- [ ] No duplicate question IDs within a batch
- [ ] Questions can repeat across batches
- [ ] Recently seen questions are strongly penalized
- [ ] Older questions gradually regain probability
- [ ] Never-seen questions have strong priority
- [ ] Topic concentration is controlled
- [ ] Requested difficulty distribution is respected
- [ ] Final question order is shuffled
- [ ] NCLEX contains only NCLEX questions
- [ ] NMCN contains only NMCN questions
- [ ] 1v1 players receive the same sequence
- [ ] Question history is server-authoritative
- [ ] Exposure is recorded safely
- [ ] Concurrent quiz creation cannot create inconsistent history
- [ ] No client-side manipulation can rewrite selection history
- [ ] The algorithm is reusable across quiz modes
- [ ] Weighting parameters are configurable
