import React, { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { MotionConfig } from 'framer-motion';

// Lazy load essential dashboard components
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

// --- MAIN ROUTER ---
// Bypassing all landing, auth, and activation gates for testing.

const AppRouter = () => (
  <Suspense fallback={<PageLoader />}>
    <Routes>
      {/* Primary Experience Root */}
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
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

      {/* Fallback all unknown routes to dashboard */}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </Suspense>
);

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
