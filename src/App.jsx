import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';
import { MotionConfig } from 'framer-motion';

// Lazy load pages
const Landing = lazy(() => import('./pages/Landing'));
const Auth = lazy(() => import('./pages/Auth'));
const Activate = lazy(() => import('./pages/Activate'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Flashcards = lazy(() => import('./pages/Flashcards'));
const ExamTimetable = lazy(() => import('./pages/ExamTimetable'));
const Quiz = lazy(() => import('./pages/Quiz'));
const Papers = lazy(() => import('./pages/Papers'));
const Payments = lazy(() => import('./pages/Payments'));
const AdminFinance = lazy(() => import('./pages/AdminFinance'));
const AdminQuestionManager = lazy(() => import('./pages/AdminQuestionManager'));
const Settings = lazy(() => import('./pages/Settings'));
const Community = lazy(() => import('./pages/Community'));
const PronunciationHelper = lazy(() => import('./pages/PronunciationHelper'));
const XpHall = lazy(() => import('./pages/XpHall'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-white dark:bg-slate-900">
    <div className="w-12 h-12 border-4 border-apex-600 border-t-transparent rounded-full animate-spin"></div>
  </div>
);

const DASHBOARD_FIRST_MODE = true;

const ProtectedRoute = ({ children, requireActivated = true }) => {
  const { session, userProfile, loadingAuth } = useAppContext();
  if (loadingAuth) return <PageLoader />;
  if (!session && !DASHBOARD_FIRST_MODE) return <Navigate to="/login" replace />;
  if (requireActivated && !userProfile.isActivated && !DASHBOARD_FIRST_MODE) {
    return <Navigate to="/activate" replace />;
  }
  return children;
};

// --- MAIN ROUTER ---

const AppRouter = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/welcome" element={<Landing />} />
      <Route path="/marketing" element={<Landing />} />
      <Route path="/login" element={<Auth />} />
      <Route path="/signup" element={<Auth />} />

      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/activate" element={<Activate />} />
        <Route path="/flashcards" element={<Flashcards />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/exams" element={<ExamTimetable />} />
        <Route path="/papers" element={<Papers />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/community" element={<Community />} />
        <Route path="/pronunciation" element={<PronunciationHelper />} />
        <Route path="/admin/finance" element={<AdminFinance />} />
        <Route path="/admin/questions" element={<AdminQuestionManager />} />
      </Route>

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
