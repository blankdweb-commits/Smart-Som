import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Flashcards from './pages/Flashcards';
import ExamTimetable from './pages/ExamTimetable';
import PronunciationHelper from './pages/PronunciationHelper';
import NclexPrep from './pages/NclexPrep';
import NmcnPrep from './pages/NmcnPrep';

function App() {
  return (
    <AppProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/flashcards" element={<Flashcards />} />
            <Route path="/nclex" element={<NclexPrep />} />
            <Route path="/nmcn" element={<NmcnPrep />} />
            <Route path="/exams" element={<ExamTimetable />} />
            <Route path="/pronunciation" element={<PronunciationHelper />} />
          </Routes>
        </Layout>
      </Router>
    </AppProvider>
  );
}

export default App;
