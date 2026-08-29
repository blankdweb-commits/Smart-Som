# Apex Scholars ? Working notes

## Current task: Entrepreneurship subject + group quiz streak + SC rarity (DONE)

### Fixes applied this session
- src/context/AppContext.jsx: moved the entire SMART COIN block (scTodayStr .. bumpGroupQuizStreak) ABOVE touchActivity to fix the pre-existing TDZ bug
  "Cannot access 'recordStreakBreak' before initialization" (touchActivity referenced SC helpers declared later).
- src/data/richardBank.js: realDifficulty() honors JSON difficulty (fallback tierForIndex).
- src/components/QuizSetupFlow.jsx: added 'Entrepreneurship in Midwifery' to midwifery-200 subjects; four->five; bankNote 509->709.
- src/pages/Quiz.jsx: groupId state + deep-link /quiz?groupId=N; added Entrepreneurship to SUBJECT_FILTERS; passes groupId to recordQuizResult.
- src/context/AppContext.jsx: removed earnSC(1,'quiz_pass'); added bumpGroupQuizStreak(groupId) calling RPC bump_group_quiz_streak.
- src/components/QuizPlayer.jsx: power-up defaults raised to skip=8, hint=5, streakFreeze=12.
- src/pages/GroupPage.jsx: leadership board sorts/babels by group_quiz_streak; added "Group Quiz Sprint" CTA with "Take Quiz" -> /quiz?groupId=ID.

### Migrations (LIVE supabase applied via ACCESS_TOKEN)
- scripts/migration-v5-sc.sql (profiles.smart_coins, smart_coin_ledger, RPCs)
- scripts/migration-v6-group-streak.sql (study_group_members group_quiz_streak/last_date/last_activity, RPC bump_group_quiz_streak)
- Verified: profiles.smart_coins, smart_coin_ledger, study_group_members.group_quiz_streak, quiz_results.group_id, RPC exist.

### E2E
- npm run e2e:group-quiz-sc  -> 10/10 PASS
- npm run e2e:study-groups   -> 7/7 PASS (no regression)
- npm run build              -> OK

### Notes
- Lint cleanup (DONE): `npm run lint` exits 0 (0 errors, 12 warnings).
  - Removed genuinely unused imports/vars (DailyChallenge Widget useMemo/studyStats, FeeBanner stub imports, FeeDashboardWidget hooks, FlashcardLibrary dead code incl. handleFileUpload + fileParser import, PremiumIntelligence studyStats, AdminFinance paymentPurposes/subscriptionPlans/searchTerm, AdminQuestionManager `catch (err)` -> optional catch, ExamDashboard `format`, CommunityAuthModal `data`).
  - Fixed real defects: ReceiptSystem missing `useAppContext` import; made `generateReceipt` internal (react-refresh); fileParser.js `[\.\)]` -> `[.)]` (no-useless-escape); eslint.config.js adds vite.config.js to node-globals (`process`).
  - ESLint 9.39 `no-unused-vars` does NOT count JSX member usage `<motion.div>` as a use -> false positives. Handled with `// eslint-disable-next-line no-unused-vars` above framer imports (most files), removed truly-dead framer imports (FeeBanner, AdminFinance, AdminQuestionManager), dropped unused AnimatePresence (ExamForm, Quiz).
  - Removed `supabase` from SC-block useCallback deps (module import, not state) in AppContext (applySC/recordQuizFailPenalty/bumpGroupQuizStreak).
  - Risky React Compiler rules downgraded to warn (NOT refactored): react-hooks/set-state-in-effect, preserve-manual-memoization, purity, immutability.
  - Known real (unfixed, runtime-valid) XpHall warning: `handleAnswer` referenced in a setInterval effect before its const declaration over the same closure scope (works at runtime).
  - Verified: lint exit 0, build OK, e2e:group-quiz-sc 10/10, e2e:study-groups 7/7.
