import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import { MotionConfig } from 'framer-motion';

// Lazy load pages
const Auth = lazy(() => import('./pages/Auth'));
const Activate = lazy(() => import('./pages/Activate'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Flashcards = lazy(() => import('./pages/Flashcards'));
const ExamTimetable = lazy(() => import('./pages/ExamTimetable'));
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
const GroupPage = lazy(() => import('./pages/GroupPage'));
const StudyGroups = lazy(() => import('./components/StudyGroups'));
const SessionRevoked = lazy(() => import('./pages/SessionRevoked'));
const Marketplace = lazy(() => import('./pages/Marketplace'));
const Voting = lazy(() => import('./pages/Voting'));
const Reviews = lazy(() => import('./pages/Reviews'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-white dark:bg-slate-900">
    <div className="w-12 h-12 border-4 border-apex-600 border-t-transparent rounded-full animate-spin"></div>
  </div>
);

// --- MAIN ROUTER ---
// Dashboard-first application. Routes are intentionally open;
// admin surfaces are gated in-app by profile role (nav hidden for non-admins).
const AppRouter = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      <Route element={<Layout />}>
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/activate" element={<RequireAuth><Activate /></RequireAuth>} />
        <Route path="/flashcards" element={<RequireAuth><Flashcards /></RequireAuth>} />
        <Route path="/quiz" element={<RequireAuth><Quiz /></RequireAuth>} />
        <Route path="/exams" element={<RequireAuth><ExamTimetable /></RequireAuth>} />
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
      <Route path="/session-revoked" element={<SessionRevoked />} />
      <Route path="/xp-hall" element={<XpHall />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </Suspense>
);

function App() {
  return (
    <AppProvider>
      <MotionConfig reducedMotion="user">
        <Router>
          <AppRouter />
        </Router>
      </MotionConfig>
    </AppProvider>
  );
}

export default App;
