import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Flashcards from './pages/Flashcards';
import ExamTimetable from './pages/ExamTimetable';
import PronunciationHelper from './pages/PronunciationHelper';
import ClinicalSearchAssistant from './pages/ClinicalSearchAssistant';
import Quiz from './pages/Quiz';
import Community from './pages/Community';
import Settings from './pages/Settings';

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

function App() {
  return (
    <AppProvider>
      <Router>
        <ImportHandler />
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/flashcards" element={<Flashcards />} />
            <Route path="/quiz" element={<Quiz />} />
            <Route path="/exams" element={<ExamTimetable />} />
            <Route path="/search" element={<ClinicalSearchAssistant />} />
            <Route path="/pronunciation" element={<PronunciationHelper />} />
            <Route path="/community" element={<Community />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </Router>
    </AppProvider>
  );
}

export default App;
