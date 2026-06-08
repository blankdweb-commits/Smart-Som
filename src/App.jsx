import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
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
const Community = lazy(() => import('./pages/Community'));
const Settings = lazy(() => import('./pages/Settings'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-white dark:bg-slate-900">
    <div className="w-12 h-12 border-4 border-apex-600 border-t-transparent rounded-full animate-spin"></div>
  </div>
);

// Switch for development/QA bypass (Production ready)
const DASHBOARD_FIRST_MODE = import.meta.env.VITE_DASHBOARD_FIRST_MODE === 'true';

const ProtectedRoute = ({ children, requireActivated = true, requireAdmin = false }) => {
  const { session, userProfile, loadingAuth } = useAppContext();

  if (loadingAuth) return <PageLoader />;

  if (DASHBOARD_FIRST_MODE) return children;

  if (!session) return <Navigate to="/login" replace />;

  if (requireActivated && !userProfile.isActivated) {
    return <Navigate to="/activate" replace />;
  }

  if (requireAdmin && userProfile.role !== 'admin' && userProfile.role !== 'super_admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

const AppRouter = () => {
  const { session } = useAppContext();

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={
          DASHBOARD_FIRST_MODE ? <Navigate to="/dashboard" replace /> :
          session ? <Navigate to="/dashboard" replace /> : <Landing />
        } />

        <Route path="/login" element={<Auth />} />
        <Route path="/signup" element={<Auth />} />

        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/flashcards" element={<ErrorBoundary><Flashcards /></ErrorBoundary>} />
          <Route path="/quiz" element={<ErrorBoundary><Quiz /></ErrorBoundary>} />
          <Route path="/exams" element={<ExamTimetable />} />
          <Route path="/papers" element={<Papers />} />
          <Route path="/community" element={<Community />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route element={<ProtectedRoute requireActivated={false}><Layout /></ProtectedRoute>}>
          <Route path="/activate" element={<ErrorBoundary><Activate /></ErrorBoundary>} />
        </Route>

        <Route element={<ProtectedRoute requireAdmin={true}><Layout /></ProtectedRoute>}>
          <Route path="/admin/finance" element={<AdminFinance />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <MotionConfig reducedMotion="user">
          <Router>
            <AppRouter />
          </Router>
        </MotionConfig>
      </AppProvider>
    </ErrorBoundary>
  );
}

export default App;
