import React, { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import CookieConsentBanner from './components/CookieConsentBanner';
import AdSenseManager from './components/ads/AdSenseManager';
import ChallengeProvider from './context/ChallengeContext';
import ErrorBoundary from './components/ErrorBoundary';
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
const Rumble = lazy(() => import('./pages/Rumble'));
const Rivals = lazy(() => import('./pages/Rivals'));
const Wallet = lazy(() => import('./pages/Wallet'));
  const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const Challenges = lazy(() => import('./pages/Challenges'));
const Squads = lazy(() => import('./pages/Squads'));
const Rooms = lazy(() => import('./pages/Rooms'));
const GroupPage = lazy(() => import('./pages/GroupPage'));
const AnonymousRoom = lazy(() => import('./pages/AnonymousRoom'));
const StudyGroups = lazy(() => import('./components/StudyGroups'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const AdminMarketplace = lazy(() => import('./pages/AdminMarketplace'));
const LicenseRenewal = lazy(() => import('./pages/LicenseRenewal'));
const LoanShark = lazy(() => import('./pages/LoanShark'));
const Voting = lazy(() => import('./pages/Voting'));
const Tutorials = lazy(() => import('./pages/Tutorials'));
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
        <Route path="/admin/marketplace" element={<RequireAuth><AdminMarketplace /></RequireAuth>} />
        <Route path="/voting" element={<RequireAuth><Voting /></RequireAuth>} />
        <Route path="/tutorials" element={<RequireAuth><Tutorials /></RequireAuth>} />
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
      <Route path="/rumble" element={<Rumble />} />
      <Route path="/rivals" element={<Rivals />} />
      <Route path="/wallet" element={<Wallet />} />
      <Route path="/xp-hall" element={<Navigate to="/rumble" replace />} />
      {/* Anonymous room: immersive full-screen (no sidebar/bottom nav),
          direct entry at /anonymous and deep link at /anonymous/:id. PUBLIC —
          WS4 unwraps RequireAuth so a logged-out deep link shows a preview
          (limited metadata + sign-in CTA) instead of bouncing to /login. */}
      <Route path="/anonymous" element={<AnonymousRoom />} />
      <Route path="/anonymous/:id" element={<AnonymousRoom />} />
        <Route path="/leaderboard" element={<RequireAuth><Leaderboard /></RequireAuth>} />
        <Route path="/challenges" element={<RequireAuth><Challenges /></RequireAuth>} />
        <Route path="/squads" element={<RequireAuth><Squads /></RequireAuth>} />
        <Route path="/rooms" element={<RequireAuth><Rooms /></RequireAuth>} />
        <Route path="/license" element={<RequireAuth><LicenseRenewal /></RequireAuth>} />
        <Route path="/loans" element={<RequireAuth><LoanShark /></RequireAuth>} />

      <Route path="/legal/terms" element={<LegalPage section="terms" />} />
      <Route path="/legal/privacy" element={<LegalPage section="privacy" />} />
      <Route path="/legal/cookies" element={<LegalPage section="cookies" />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </Suspense>
);

// When the push service worker is clicked it focuses this tab and posts an
// `apex:push-navigate` message with the target URL. This bridge SPA-navigates
// (no full reload) so the open app lands directly on the referenced room.
const PushNavigationListener = () => {
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
    const onMessage = (event) => {
      const msg = event?.data;
      if (!msg || msg.type !== 'apex:push-navigate' || typeof msg.url !== 'string' || !msg.url) return;
      try {
        navigate(msg.url);
      } catch {
        window.location.assign(msg.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate]);
  return null;
};

function App() {
  return (
    <AppProvider>
      {/* ChallengeProvider is inside <Router> (the bell reads the location) and
          inside <AppProvider> (it calls the arena invite wrappers). It owns a
          2.5s invite poll app-wide, which is exactly why it is NOT part of
          AppContext — that would re-render every consumer four times a minute. */}
      <MotionConfig reducedMotion="user">
        <Router>
          <ChallengeProvider>
            <PushNavigationListener />
            {/* AdSenseManager sits ABOVE <AppRouter>, so a throw inside it used to
                take down the entire tree: the only ErrorBoundary lived in
                Layout, BELOW this point, and therefore could never catch it.
                That is how a single context destructure ("Cannot destructure
                property 'isPremium'") blanked every page at once. Wrapping here
                contains any such fault to a recovery screen instead. */}
            <ErrorBoundary>
              <AdSenseManager>
                <AppRouter />
                <CelebrationHost />
              </AdSenseManager>
            </ErrorBoundary>
            <CookieConsentBanner />
          </ChallengeProvider>
        </Router>
      </MotionConfig>
    </AppProvider>
  );
}

export default App;
