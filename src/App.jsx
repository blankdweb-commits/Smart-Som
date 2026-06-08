import React, { useEffect, lazy, Suspense, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { MotionConfig } from 'framer-motion';
import { X } from './components/Icons';

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

// Toggle via environment variable
const DASHBOARD_FIRST_MODE = import.meta.env.VITE_DASHBOARD_DEV_MODE === 'true' || import.meta.env.VITE_DEV_DASHBOARD_MODE === 'true';

const DevBanner = () => {
  const [visible, setVisible] = useState(true);
  if (!DASHBOARD_FIRST_MODE || !visible) return null;
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-amber-500 text-white px-4 py-2 rounded-full shadow-lg font-bold text-xs flex items-center gap-3 border border-amber-400/50 backdrop-blur-md animate-in slide-in-from-top-4 duration-500">
      <span>🛠️ Development Mode Active – Dashboard First</span>
      <button onClick={() => setVisible(false)} className="hover:bg-white/20 p-1 rounded-full transition-colors">
        <X size={14} />
      </button>
    </div>
  );
};

const ProtectedRoute = ({ children, requireActivated = true }) => {
  const { session, userProfile, loadingAuth } = useAppContext();

  if (loadingAuth) return <PageLoader />;

  // Bypass all gates if in Dashboard-First mode
  if (DASHBOARD_FIRST_MODE) return children;

  if (!session) return <Navigate to="/login" replace />;

  if (requireActivated && !userProfile.isActivated) {
    return <Navigate to="/activate" replace />;
  }

  return children;
};

// --- MAIN ROUTER ---

const AppRouter = () => {
  const { session } = useAppContext();

  return (
    <Suspense fallback={<PageLoader />}>
      <DevBanner />
      <Routes>
        {/* Root Route Handling */}
        <Route path="/" element={
          DASHBOARD_FIRST_MODE ? <Navigate to="/dashboard" replace /> :
          session ? <Navigate to="/dashboard" replace /> : <Landing />
        } />

        {/* Auth routes */}
        <Route path="/login" element={<Auth />} />
        <Route path="/signup" element={<Auth />} />

        {/* Primary Dashboard Experience */}
        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
          <Route path="/flashcards" element={<ErrorBoundary><Flashcards /></ErrorBoundary>} />
          <Route path="/quiz" element={<ErrorBoundary><Quiz /></ErrorBoundary>} />
          <Route path="/exams" element={<ExamTimetable />} />
          <Route path="/papers" element={<Papers />} />
          <Route path="/community" element={<Community />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/admin" element={<AdminFinance />} />
          <Route path="/admin/finance" element={<AdminFinance />} />
          <Route path="/admin/questions" element={<AdminFinance />} />
          <Route path="/admin/analytics" element={<AdminFinance />} />
          <Route path="/subject-mastery" element={<Quiz />} />
        </Route>

        <Route element={<ProtectedRoute requireActivated={false}><Layout /></ProtectedRoute>}>
          <Route path="/activate" element={<ErrorBoundary><Activate /></ErrorBoundary>} />
        </Route>

        {/* Fallback */}
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
