# Course Catalogue & Question-Bank Mapping

> Phase 13 allowlist (courses = catalogue; units are NOT courses), Phase 14
> restored 200-level subjects. All counts verified live against
> `questions (is_active = true)` this session.

## Canonical catalogue (QuizSetupFlow allowlist)

### Nursing 200-Level (`nursing-200`, DB `course_id = 'nursing200'`)
Subjects resolve **directly** (`suffix` = DB `subject_id`, no group mapping):

| UI subject | DB `subject_id` | active questions |
| --- | --- | --- |
| Fundamentals of Nursing | Fundamentals of Nursing | 97 |
| Pharmacology III | Pharmacology III | 68 |
| Reproductive Health | Reproductive Health | 200 |
| Research Methodology | Research Methodology | 350 |
| Nutrition & Dietetics | Nutrition & Dietetics | 600 |
| Politics and Governance in Nursing | Politics and Governance in Nursing | 432 |
| Professional Writing and Seminar | Professional Writing and Seminar | 150 |

### Nursing 300-Level (`nursing-300`, DB `course_id = 'nursing300'`)

| UI subject | DB `subject_id`(s) | active questions |
| --- | --- | --- |
| Reproductive Health III | Reproductive Health III | 496 |
| Quality Improvement, Healthcare & Patient Safety | Quality Improvement in Healthcare and Patient Safety | 400 |
| Mental Health / Psychiatric Nursing | Mental Health/Psychiatric Nursing | 584 |
| Medical-Surgical Nursing IV | Medical-Surgical Nursing IV | 484 |
| Community Health II | Community Health II | 403 |
| Emergency & Disaster Nursing | Emergency and Disaster Nursing | 391 |

### Midwifery 200-Level — Semester 1 (`midwifery-200`, DB `course_id = 'midwifery'`)

| UI subject | DB `subject_id`(s) | active questions |
| --- | --- | --- |
| Medical-Surgical Nursing II | Medical-Surgical Nursing II | 151 |
| Principles of Management & Teaching | Principles of Management and Teaching | 108 |
| Child Health | Child Health | 50 |
| Home Health Care Nursing | Home Health Care Nursing | 200 |
| Entrepreneurship in Midwifery | Entrepreneurship in Midwifery | 200 |

### Midwifery 200-Level — Semester 2 (`midwifery-200-s2`, DB `course_id = 'midwifery200s2'`)

| UI subject | DB `subject_id`(s) | active questions |
| --- | --- | --- |
| Pharmacology in Midwifery | Pharmacology in Midwifery | 399 |
| Normal Midwifery | Midwifery | 400 |
| Community Midwifery | Community Midwifery | 400 |
| Infant / Newborn Care | The Newborn (132) + Newborn Assessment & Resuscitation (71) + Subsequent Care of the Newborn (51) + Newborn Feeding (41) + Discharge and Follow-up Care (6) | 301 |
| Fundamentals of Midwifery | Introduction to Midwifery Practice (20) + Theories and Concepts (71) + Quality Improvement in Midwifery Practice (42) + Contemporary Legal Issues (106) + The Law and the Midwife (105) + Ethics in Midwifery Practice (54) | 398 |
| Applied Anatomy & Physiology | Applied Anatomy and Physiology | 345 |
| **Complicated Midwifery I** | Complicated midwifery | **2** |

### Midwifery 300-Level (`midwifery-300`, DB `course_id = 'midwifery300'`)

| UI subject | DB `subject_id`(s) | active questions |
| --- | --- | --- |
| Neonatal Nursing / Infant II | Neonatal Nursing | 954 |
| Research & Statistics | Research and Statistics (468) + Data Collection (26) | 494 |
| Quality Improvement, Healthcare & Patient Safety | Quality Improvement in Healthcare and Patient Safety (400) + Clinic Management (50) | 450 |
| Complicated Midwifery | Complications of Puerperium (229) + Obstetric Emergencies and Life-Saving Skills (67) + Complications in Pregnancy and Childbirth (38) + Preventive Strategies of Risk Conditions (35) + Midwifery Procedures (63) | 432 |
| Reproductive Health | Reproductive Health Conditions (170) + Introduction to Fertility (42) | 212 |
| Family Planning | Family Planning Methods (123) + Introduction to Family Planning (99) | 222 |

### Exam banks
| Course | DB `course_id` | `exam_framework` | active |
| --- | --- | --- | --- |
| Clinical/Quick `:nclex` | nclex | NCLEX | verified |
| Clinical/Quick `:nmcn` | nmcn | NMCN | verified |
| Clinical/Quick `:both` / Uselu | nclex + nmcn (framework constraint dropped) | — | verified |
| Uselu Test | uselu | — | 300+ |

## How resolution works (`api/_questionSelectionService.js`)

- `_resolveCourseMetadata(courseKey)` returns `dbCourseId` (single),
  `dbCourseIds` (`:both`), or `subjectGroups` (canonical → DB `subject_id`s).
- For group-mapped courses, candidates are filtered with
  `.in('subject_id', group)` — the DB stores granular unit-level ids that are
  **not** standalone catalogue courses.
- NotFound/empty → fail-closed (`UNKNOWN_COURSE`); framework mismatch →
  `FRAMEWORK_MISMATCH`.

## Seeding (restored subjects, idempotent)

- `scripts/seed-nursing200-missing.mjs` — Nutrition & Dietetics (600 active
  after dedupe) + Politics and Governance in Nursing (432). Prefixes
  `n200x-nut-`, `n200x-pol-`.
- `scripts/seed-nursing200-professional-writing.mjs` — **applied this session**,
  150/150 upserted from `200level questions.json`
  (`subject: 'Professional Writing and Seminar in Nursing'` →
  `subject_id: 'Professional Writing and Seminar'`, `course_id 'nursing200'`).
  Prefix `n200x-pws-<id>`. Normalizer matches `seed-questions.mjs`
  (letter-index → option text, deterministic difficulty).
- `scripts/migration-v28-server-only-rpcs.sql` — NOT DB-seeding; see security
  audit.

## Caveat: Complicated Midwifery I (s2) has only 2 questions

The 200-level s2 source bank contains exactly 2 rows for “Complicated
midwifery”. A round for this subject will launch with **2 questions** (selection
fills as many as available rather than failing), and rounds for it cannot reach
10/20/30. This is a source-data limitation, not an engine defect; do not map
300-level complication content into the s2 pool (fail-closed subject isolation).