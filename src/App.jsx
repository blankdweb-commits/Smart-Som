import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';

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
const Settings = lazy(() => import('./pages/Settings'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen bg-white dark:bg-slate-900">
    <div className="w-12 h-12 border-4 border-apex-600 border-t-transparent rounded-full animate-spin"></div>
  </div>
);

const ProtectedRoute = ({ children, requireActivated = true }) => {
  const { session, userProfile, loadingAuth } = useAppContext();

  if (loadingAuth) return <PageLoader />;
  if (!session) return <Navigate to="/" replace />;

  if (requireActivated && !userProfile.isActivated) {
    return <Navigate to="/activate" replace />;
  }

  return children;
};

const AppRoutes = () => {
  const { session, userProfile, loadingAuth } = useAppContext();

  if (loadingAuth) return <PageLoader />;

  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Auth />} />
        <Route path="/signup" element={<Auth />} />

        {/* Auth Required, but not necessarily activated */}
        <Route path="/activate" element={
          <ProtectedRoute requireActivated={false}>
             <Layout><Activate /></Layout>
          </ProtectedRoute>
        } />

        <Route path="/dashboard" element={
          <ProtectedRoute requireActivated={false}>
             <Layout><Dashboard /></Layout>
          </ProtectedRoute>
        } />

        {/* Strictly Activated Routes */}
        <Route path="/flashcards" element={
          <ProtectedRoute>
            <Layout><Flashcards /></Layout>
          </ProtectedRoute>
        } />
        <Route path="/quiz" element={
          <ProtectedRoute>
            <Layout><Quiz /></Layout>
          </ProtectedRoute>
        } />
        <Route path="/exams" element={
          <ProtectedRoute>
            <Layout><ExamTimetable /></Layout>
          </ProtectedRoute>
        } />
        <Route path="/papers" element={
          <ProtectedRoute>
            <Layout><Papers /></Layout>
          </ProtectedRoute>
        } />
        <Route path="/payments" element={
          <ProtectedRoute>
            <Layout><Payments /></Layout>
          </ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute requireActivated={false}>
            <Layout><Settings /></Layout>
          </ProtectedRoute>
        } />
        <Route path="/admin/finance" element={
          <ProtectedRoute>
            <Layout><AdminFinance /></Layout>
          </ProtectedRoute>
        } />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
};

function App() {
  return (
    <AppProvider>
      <Router>
        <AppRoutes />
      </Router>
    </AppProvider>
  );
}

export default App;
