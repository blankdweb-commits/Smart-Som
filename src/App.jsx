import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';

// Lazy load pages for better mobile performance
const Landing = lazy(() => import('./pages/Landing'));
const Auth = lazy(() => import('./pages/Auth'));
const Activate = lazy(() => import('./pages/Activate'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Flashcards = lazy(() => import('./pages/Flashcards'));
const ExamTimetable = lazy(() => import('./pages/ExamTimetable'));
const PronunciationHelper = lazy(() => import('./pages/PronunciationHelper'));
const Quiz = lazy(() => import('./pages/Quiz'));
const Community = lazy(() => import('./pages/Community'));
const Papers = lazy(() => import('./pages/Papers'));
const Payments = lazy(() => import('./pages/Payments'));
const AdminFinance = lazy(() => import('./pages/AdminFinance'));
const Settings = lazy(() => import('./pages/Settings'));

// Loading component
const PageLoader = () => (
  <div className="flex items-center justify-center h-64">
    <div className="w-12 h-12 border-4 border-medical-500 border-t-transparent rounded-full animate-spin"></div>
  </div>
);

const ImportHandler = () => {
  const { importFlashcards } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const importData = params.get('import');
    if (importData) {
      try {
        const decoded = JSON.parse(atob(importData));
        const cards = Array.isArray(decoded) ? decoded : [decoded];
        importFlashcards(cards);

        // Remove the param from URL to prevent re-importing on refresh
        params.delete('import');
        const newSearch = params.toString();
        navigate({
          pathname: location.pathname,
          search: newSearch ? `?${newSearch}` : ''
        }, { replace: true });
      } catch (e) {
        console.error('Failed to import cards', e);
      }
    }
  }, [location, importFlashcards, navigate]);

  return null;
};

const AppRoutes = () => {
  const { userProfile, session, loadingAuth } = useAppContext();

  if (loadingAuth) return <PageLoader />;

  // If Supabase is not configured, allow access for demo purposes or show warning
  if (!import.meta.env.VITE_SUPABASE_URL && !session) {
    return (
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/flashcards" element={<Flashcards />} />
            <Route path="/quiz" element={<Quiz />} />
            <Route path="/exams" element={<ExamTimetable />} />
            <Route path="/pronunciation" element={<PronunciationHelper />} />
            <Route path="/community" element={<Community />} />
            <Route path="/papers" element={<Papers />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </Suspense>
      </Layout>
    );
  }

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Auth />} />
        <Route path="/signup" element={<Auth />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    );
  }

  if (!userProfile.isActivated) {
    return (
      <Routes>
        <Route path="/activate" element={<Activate />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="*" element={<Activate />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/activate" element={<Activate />} />
          <Route path="/flashcards" element={<Flashcards />} />
          <Route path="/quiz" element={<Quiz />} />
          <Route path="/exams" element={<ExamTimetable />} />
          <Route path="/pronunciation" element={<PronunciationHelper />} />
          <Route path="/community" element={<Community />} />
          <Route path="/papers" element={<Papers />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/admin/finance" element={<AdminFinance />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Suspense>
    </Layout>
  );
};

function App() {
  return (
    <AppProvider>
      <Router>
        <ImportHandler />
        <Suspense fallback={<PageLoader />}>
          <AppRoutes />
        </Suspense>
      </Router>
    </AppProvider>
  );
}

export default App;
