import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import CookieConsentBanner from './components/CookieConsentBanner';
import AdSenseManager from './components/ads/AdSenseManager';
import { MotionConfig } from 'framer-motion';

// Lazy load pages
const Auth = lazy(() => import('./pages/Auth'));
const Activate = lazy(() => import('./pages/Activate'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Flashcards = lazy(() => import('./pages/Flashcards'));
const Quiz = lazy(() => import('./pages/Quiz'));
const Payments = lazy(() => import('./pages/Payments'));
const PaymentVerify = lazy(() => import('./pages/PaymentVerify'));
const AdminFinance = lazy(() => import('./pages/AdminFinance'));
const AdminQuestionManager = lazy(() => import('./pages/AdminQuestionManager'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const Settings = lazy(() => import('./pages/Settings'));
const Community = lazy(() => import('./pages/Community'));
const PronunciationHelper = lazy(() => import('./pages/PronunciationHelper'));
const XpHall = lazy(() => import('./pages/XpHall'));
  const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Challenges = lazy(() => import('./pages/Challenges'));
const Squads = lazy(() => import('./pages/Squads'));
const Rooms = lazy(() => import('./pages/Rooms'));
const GroupPage = lazy(() => import('./pages/GroupPage'));
const AnonymousRoom = lazy(() => import('./pages/AnonymousRoom'));
const StudyGroups = lazy(() => import('./components/StudyGroups'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const Voting = lazy(() => import('./pages/Voting'));
const Reviews = lazy(() => import('./pages/Reviews'));
const WeaknessDrill = lazy(() => import('./pages/WeaknessDrill'));
const Achievements = lazy(() => import('./pages/Achievements'));
const LegalPage = lazy(() => import('./pages/Legal'));
const Landing = lazy(() => import('./pages/Landing'));
const AchievementCelebration = lazy(() => import('./components/AchievementCelebration'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-white dark:bg-slate-900">
    <div className="w-12 h-12 border-4 border-apex-600 border-t-transparent rounded-full animate-spin"></div>
  </div>
);

// Session-aware root route: an authenticated device lands on the dashboard;
// everyone else gets the PUBLIC crawlable landing page (real PolyNurse content,
// no login wall) with clear navigation into the app. AdSense crawlers therefore
// receive a genuine HTTP 200 page with meaningful content at "/".
const RootRedirect = () => {
  const { session, loadingAuth } = useAppContext();
  if (loadingAuth) return <PageLoader />;
  return session ? <Navigate to="/dashboard" replace /> : <Landing />;
};

// Full-screen achievement celebration host — mounted ONCE at the app root (not
// inside Layout) so it can present over any route, including /xp-hall results.
// The celebration chunk is only requested the first time an achievement is
// actually ready to present (true lazy load — nothing ships in the entry).
const CelebrationHost = () => {
  const { activeCelebration } = useAppContext();
  if (!activeCelebration) return null;
  return (
    <Suspense fallback={null}>
      <AchievementCelebration key={`${activeCelebration.key || 'ach'}:${activeCelebration.earnedAt || activeCelebration.queueIndex}`} />
    </Suspense>
  );
};

// --- MAIN ROUTER ---
// Dashboard-first application. Routes are intentionally open;
// admin surfaces are gated in-app by profile role (nav hidden for non-admins).
const AppRouter = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route element={<Layout />}>
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/activate" element={<RequireAuth><Activate /></RequireAuth>} />
        <Route path="/flashcards" element={<RequireAuth><Flashcards /></RequireAuth>} />
        <Route path="/quiz" element={<RequireAuth><Quiz /></RequireAuth>} />
        <Route path="/weakness-drill" element={<RequireAuth><WeaknessDrill /></RequireAuth>} />
        <Route path="/achievements" element={<RequireAuth><Achievements /></RequireAuth>} />
        <Route path="/papers" element={<Navigate to="/marketplace" replace />} />
        <Route path="/marketplace" element={<RequireAuth><Marketplace /></RequireAuth>} />
        <Route path="/voting" element={<RequireAuth><Voting /></RequireAuth>} />
        <Route path="/reviews" element={<RequireAuth><Reviews /></RequireAuth>} />
        <Route path="/payments" element={<RequireAuth><Payments /></RequireAuth>} />
        <Route path="/payments/verify" element={<RequireAuth><PaymentVerify /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
        <Route path="/community" element={<RequireAuth><Community /></RequireAuth>} />
        <Route path="/community/:section" element={<RequireAuth><Community /></RequireAuth>} />
        <Route path="/study-groups" element={<RequireAuth><StudyGroups /></RequireAuth>} />
        <Route path="/study-groups/:id" element={<RequireAuth><GroupPage /></RequireAuth>} />
        <Route path="/pronunciation" element={<RequireAuth><PronunciationHelper /></RequireAuth>} />
        <Route path="/admin/finance" element={<RequireAuth><AdminFinance /></RequireAuth>} />
        <Route path="/admin/questions" element={<RequireAuth><AdminQuestionManager /></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth><AdminUsers /></RequireAuth>} />
      </Route>

      <Route path="/login" element={<Auth />} />
      <Route path="/signup" element={<Auth />} />
      <Route path="/xp-hall" element={<XpHall />} />
      {/* Anonymous room: immersive full-screen (no sidebar/bottom nav),
          direct entry at /anonymous and deep link at /anonymous/:id. */}
      <Route path="/anonymous" element={<RequireAuth><AnonymousRoom /></RequireAuth>} />
      <Route path="/anonymous/:id" element={<RequireAuth><AnonymousRoom /></RequireAuth>} />
        <Route path="/leaderboard" element={<RequireAuth><Leaderboard /></RequireAuth>} />
        <Route path="/challenges" element={<RequireAuth><Challenges /></RequireAuth>} />
        <Route path="/squads" element={<RequireAuth><Squads /></RequireAuth>} />
        <Route path="/rooms" element={<RequireAuth><Rooms /></RequireAuth>} />

      <Route path="/legal/terms" element={<LegalPage section="terms" />} />
      <Route path="/legal/privacy" element={<LegalPage section="privacy" />} />
      <Route path="/legal/cookies" element={<LegalPage section="cookies" />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </Suspense>
);

function App() {
  return (
    <AppProvider>
      <MotionConfig reducedMotion="user">
        <Router>
          <AdSenseManager>
            <AppRouter />
            <CelebrationHost />
          </AdSenseManager>
          <CookieConsentBanner />
        </Router>
      </MotionConfig>
    </AppProvider>
  );
}

export default App;
